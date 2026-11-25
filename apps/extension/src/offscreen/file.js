/**
 * 整份视频翻译的取文件与识别（见 docs/extension/video-file-translation.md）。
 *
 * service worker 发来 { target: 'offscreen', type: 'video-file-start', jobId, url, lang, mode }：
 *   1. 凭扩展的主机权限取回整份视频（不带 Cookie 与 Referer，限大小），按文件头确认是音视频文件；
 *   2. 解码音轨、混成 16 kHz 单声道，限时长，整段没声音就直接说没有声音；
 *   3. mode 'local'：播进 MediaStreamDestination（不出声），交给设备端语音识别，按 1 倍速跑完整段，
 *      由中间结果推算每个词的时间；mode 'audio'：编成 WAV 交回去，由 service worker 发给 OpenAI 转写。
 * 进度与结果用 { type: 'video-file-event', jobId, event } 报回 service worker（每秒都有，顺带让它保持运行）。
 *
 * 这里读不到设置与界面语言（offscreen 只有 chrome.runtime），出错时只报错误代码，文案由 service worker 生成。
 * 网址只接受 service worker 传来的（来自用户右键点的那个视频），网页内容脚本连不到这里。
 */
(() => {
  const T = globalThis.AITrTranscript;
  const Speech = globalThis.AITrSpeech;
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

  const MAX_BYTES = 100 * 1024 * 1024;
  const MAX_SECONDS = 10 * 60;
  const SAMPLE_RATE = 16000;
  /** 播完后再等一会儿，让识别器把最后一句吐完。 */
  const TAIL_MS = 2500;
  /** 设备端识别连续模式偶尔会自己结束：结束了就开下一轮，同一段音频里最多开这么多轮。 */
  const MAX_ROUNDS = 60;
  const RECOVERABLE = new Set(['no-speech', 'aborted']);

  /** jobId → { controller, stop } */
  const jobs = new Map();

  class FileError extends Error {
    constructor(code, detail = '') {
      super(code);
      this.code = code;
      this.detail = String(detail || '');
    }
  }

  function emit(jobId, event) {
    try {
      const promise = chrome.runtime.sendMessage({ type: 'video-file-event', jobId, event });
      if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    } catch {
      /* service worker 正在重启：这一路随它的连接一起结束 */
    }
  }

  async function download(jobId, url, signal) {
    let response;
    try {
      response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new FileError('fetch-failed', err?.message || err);
    }
    if (!response.ok) throw new FileError('fetch-failed', response.status);
    const total = Number(response.headers.get('content-length')) || 0;
    if (total > MAX_BYTES) throw new FileError('too-large', MAX_BYTES);
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    let reported = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.length;
      if (loaded > MAX_BYTES) {
        reader.cancel().catch(() => {});
        throw new FileError('too-large', MAX_BYTES);
      }
      // 第一块就能看出是不是音视频：网页、播放列表不用等整份下完
      if (!chunks.length && !T.sniffMedia(value)) {
        reader.cancel().catch(() => {});
        throw new FileError('not-media');
      }
      chunks.push(value);
      if (Date.now() - reported > 300) {
        reported = Date.now();
        emit(jobId, { type: 'progress', phase: 'download', loaded, total });
      }
    }
    const bytes = new Uint8Array(loaded);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return bytes;
  }

  /** 解码音轨，直接重采样到 16 kHz，再把各声道平均成单声道。 */
  async function decode(bytes) {
    if (!T.sniffMedia(bytes)) throw new FileError('not-media');
    const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
    let buffer;
    try {
      buffer = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    } catch {
      throw new FileError('no-audio'); // 没有音轨，或音轨的编码解不开
    }
    if (buffer.duration > MAX_SECONDS) throw new FileError('too-long', MAX_SECONDS);
    const samples = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c += 1) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i += 1) samples[i] += data[i] / buffer.numberOfChannels;
    }
    return { samples, duration: buffer.duration * 1000 };
  }

  function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  async function checkRecognizer(lang) {
    if (!Speech.supported()) throw new FileError('sr-unsupported');
    const status = await Speech.packStatus(lang);
    if (status !== 'available') throw new FileError(`pack-${status}`);
  }

  /**
   * 设备端识别整段音频：只能按 1 倍速（2026-11 探针：2 倍速时几乎认不出字）。
   * 中间结果全部记下来，结束后推算每个词的时间。
   */
  function recognize(jobId, job, samples, duration, lang) {
    return new Promise((resolve, reject) => {
      const audio = new AudioContext({ sampleRate: SAMPLE_RATE });
      const buffer = audio.createBuffer(1, samples.length, SAMPLE_RATE);
      buffer.copyToChannel(samples, 0);
      const dest = audio.createMediaStreamDestination();
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(dest); // 不接扬声器：识别不需要出声
      const track = dest.stream.getAudioTracks()[0];

      const log = [];
      let rounds = 0;
      let rec = null;
      let fatal = null;
      let playing = true;
      let finished = false;
      let started = 0;
      let timer = 0;
      let tail = 0;

      const cleanup = () => {
        playing = false;
        clearInterval(timer);
        clearTimeout(tail);
        try { rec?.abort(); } catch { /* 已经停了 */ }
        try { source.stop(); } catch { /* 还没开始或已经停了 */ }
        track.stop();
        audio.close().catch(() => {});
      };
      const finish = (err) => {
        if (finished) return;
        finished = true;
        cleanup();
        if (err) reject(err);
        else resolve(T.timedTokens(log, { lang }));
      };
      job.stop = () => finish(new DOMException('Stopped', 'AbortError'));

      const listen = () => {
        const current = new SR();
        current.lang = lang;
        current.continuous = true;
        current.interimResults = true;
        current.processLocally = true;
        const round = rounds;
        rounds += 1;
        current.onresult = (event) => {
          const at = started ? performance.now() - started : 0;
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            log.push([round, i, at, event.results[i][0]?.transcript || '']);
          }
        };
        current.onerror = (event) => {
          if (!RECOVERABLE.has(event.error)) fatal = event.error;
        };
        current.onend = () => {
          if (finished || rec !== current) return;
          if (fatal) { finish(new FileError(fatal === 'language-not-supported' ? 'pack-unavailable' : 'sr-error', fatal)); return; }
          if (!playing) { finish(); return; }
          if (rounds >= MAX_ROUNDS) { finish(new FileError('sr-error', 'restarts')); return; }
          listen();
        };
        rec = current;
        current.start(track);
      };

      listen();
      audio.resume().catch(() => {});
      // 识别器起来需要一点时间，晚一点再开始放，免得开头几个词漏掉
      setTimeout(() => {
        if (finished) return;
        started = performance.now();
        source.start();
        timer = setInterval(() => {
          const done = Math.min(duration, performance.now() - started);
          emit(jobId, { type: 'progress', phase: 'recognize', done, total: duration });
        }, 1000);
      }, 300);
      source.onended = () => {
        tail = setTimeout(() => {
          playing = false;
          try { rec?.stop(); } catch { finish(); }
          // stop() 之后识别器会触发 onend；万一没有，最多再等 3 秒
          setTimeout(() => finish(), 3000);
        }, TAIL_MS);
      };
    });
  }

  async function run(jobId, job, { url, lang, mode }) {
    const { signal } = job.controller;
    const bytes = await download(jobId, url, signal);
    if (signal.aborted) return;
    emit(jobId, { type: 'progress', phase: 'decode' });
    const { samples, duration } = await decode(bytes);
    if (signal.aborted) return;
    if (T.isSilent(samples)) {
      emit(jobId, { type: 'done', silent: true, duration });
      return;
    }
    if (mode === 'audio') {
      emit(jobId, { type: 'done', audio: toBase64(T.encodeWav(samples, SAMPLE_RATE)), duration });
      return;
    }
    await checkRecognizer(lang);
    if (signal.aborted) return;
    emit(jobId, { type: 'progress', phase: 'recognize', done: 0, total: duration });
    const tokens = await recognize(jobId, job, samples, duration, lang);
    emit(jobId, { type: 'done', tokens, lang, duration });
  }

  function start(message) {
    const { jobId } = message;
    stop(jobId);
    const job = { controller: new AbortController(), stop: null };
    jobs.set(jobId, job);
    run(jobId, job, message)
      .catch((err) => {
        if (job.controller.signal.aborted || err?.name === 'AbortError') return;
        emit(jobId, { type: 'error', code: err?.code || 'failed', detail: err?.detail || String(err?.message || err) });
      })
      .finally(() => {
        if (jobs.get(jobId) === job) jobs.delete(jobId);
      });
  }

  function stop(jobId) {
    const job = jobs.get(jobId);
    if (!job) return;
    jobs.delete(jobId);
    job.controller.abort();
    job.stop?.();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== 'offscreen' || sender.id !== chrome.runtime.id || sender.tab) return false;
    if (message.type === 'video-file-start') {
      start(message);
      sendResponse(true);
    } else if (message.type === 'video-file-stop') {
      stop(message.jobId);
      sendResponse(true);
    }
    return false;
  });
})();

/**
 * 整份视频翻译的取文件与识别（见 docs/extension/video-file-translation.md）。
 *
 * service worker 发来 { target: 'offscreen', type: 'video-file-start', jobId, url, lang, mode }：
 *   1. 凭扩展的主机权限取回整份视频（不带 Cookie 与 Referer，限大小），按文件头确认是音视频文件；store 时存一份到视频翻译记录；
 *   2. 解码音轨、混成 16 kHz 单声道，限时长，整段没声音就直接说没有声音；
 *   3. mode 'local'：播进 MediaStreamDestination（不出声），交给设备端语音识别，按 1 倍速跑完整段，
 *      由中间结果推算每个词的时间。没指定 lang 时先判断语言：candidates 里装了语言包的几种同时听，
 *      听够了把各路文字报给 service worker 判断（judge），选中的那路继续；判断不了就请用户选（need-lang）。
 *      mode 'audio'：编成 WAV 交回去，由 service worker 发给 OpenAI 转写（它自己判断语种）。
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
  /** 判断语言：最多同时按几种语言听；至少听多久、攒够多少词再判断；听了这么久还没攒够也判断。 */
  const MAX_LANES = 3;
  const JUDGE_MS = 20000;
  const JUDGE_WORDS = 15;
  const JUDGE_MAX_MS = 45000;
  /** 少于这么多词就当作没人说话。 */
  const SPEECH_WORDS = 3;

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

  /** candidates 里已经装好离线语言包的（保持顺序）。 */
  async function installedAmong(candidates) {
    const checks = await Promise.all(candidates.map((lang) => Speech.packStatus(lang).then((status) => status === 'available', () => false)));
    return candidates.filter((_, i) => checks[i]);
  }

  /**
   * 等后台回话（判断结果、用户选的语言）。等用户时每 20 秒报一次「还在等」，免得 service worker 闲置被停掉、任务丢失。
   * job.answers[kind] 由后台消息填上（见文件末尾的 onMessage）。
   */
  function waitFor(jobId, job, kind, { heartbeat = false, timeout = 0 } = {}) {
    const { signal } = job.controller;
    return new Promise((resolve, reject) => {
      let beat = 0;
      let timer = 0;
      const done = () => { clearInterval(beat); clearTimeout(timer); delete job.answers[kind]; };
      job.answers[kind] = (value) => { done(); resolve(value); };
      signal.addEventListener('abort', () => { done(); reject(new DOMException('Stopped', 'AbortError')); }, { once: true });
      if (heartbeat) beat = setInterval(() => emit(jobId, { type: 'waiting' }), 20000);
      if (timeout) timer = setTimeout(() => { done(); reject(new FileError('lang-timeout')); }, timeout);
    });
  }

  /**
   * 设备端识别整段音频：只能按 1 倍速（2026-11 探针：2 倍速时几乎认不出字）。中间结果全部记下来，结束后推算每个词的时间。
   *
   * 设备端识别不会自己判断语种：langs 有几种就同时开几路，各自按一种语言听同一段声音。听到 JUDGE_MS 以上、
   * 有一路攒够词（或放完了）时，把各路的文字交给 judge（后台判断哪一路是真的）：选中的继续听到底，其余停掉，
   * 所以判断语言不额外花时间。judge 给不出答案时抛 'undetermined'（detail 是后台猜的语言），由调用方请用户选。
   * 没给 judge（用户选好了语言）就只有一路，直接听到底。
   */
  function recognize(jobId, job, samples, duration, langs, judge = null) {
    return new Promise((resolve, reject) => {
      const audio = new AudioContext({ sampleRate: SAMPLE_RATE });
      const buffer = audio.createBuffer(1, samples.length, SAMPLE_RATE);
      buffer.copyToChannel(samples, 0);
      const source = audio.createBufferSource();
      source.buffer = buffer;
      // 每一路一个输出轨；都不接扬声器：识别不需要出声
      const lanes = langs.map((lang) => {
        const dest = audio.createMediaStreamDestination();
        source.connect(dest);
        return { lang, track: dest.stream.getAudioTracks()[0], log: [], rounds: 0, rec: null, fatal: null, ended: false, dropped: false };
      });
      const active = () => lanes.filter((lane) => !lane.dropped);

      let playing = true;
      let finished = false;
      let judged = !judge;
      let judging = false;
      let chosen = judge ? null : langs[0];
      // 时间按音频时钟算（AudioContext.currentTime）：上下文刚建好时可能还没跑起来，按墙上时间会整体偏晚
      let startAt = -1;
      const elapsed = () => (startAt < 0 ? 0 : Math.max(0, (audio.currentTime - startAt) * 1000));
      let timer = 0;
      let tail = 0;

      const stopLane = (lane) => {
        lane.dropped = true;
        try { lane.rec?.abort(); } catch { /* 已经停了 */ }
        lane.track.stop();
      };
      const cleanup = () => {
        playing = false;
        clearInterval(timer);
        clearTimeout(tail);
        lanes.forEach(stopLane);
        try { source.stop(); } catch { /* 还没开始或已经停了 */ }
        audio.close().catch(() => {});
      };
      const finish = (err) => {
        if (finished) return;
        finished = true;
        const lane = lanes.find((item) => item.lang === chosen);
        const tokens = lane ? T.timedTokens(lane.log, { lang: lane.lang }) : [];
        cleanup();
        if (err) reject(err);
        else resolve({ lang: chosen, tokens });
      };
      job.stop = () => finish(new DOMException('Stopped', 'AbortError'));

      const runJudge = () => {
        judging = true;
        const heard = active().map((lane) => {
          const tokens = T.timedTokens(lane.log, { lang: lane.lang });
          return { lang: lane.lang, words: tokens.length, text: T.joinTokens(tokens, lane.lang).slice(0, 1500) };
        });
        judge(heard, elapsed()).then(({ lang, guess } = {}) => {
          judging = false;
          judged = true;
          if (!lang || !active().some((lane) => lane.lang === lang)) {
            finish(new FileError('undetermined', guess || ''));
            return;
          }
          chosen = lang;
          active().filter((lane) => lane.lang !== lang).forEach(stopLane);
          if (active().every((lane) => lane.ended)) finish();
        }, (err) => finish(err));
      };
      /** 各路里识别出最多的词数。 */
      const most = () => Math.max(0, ...active().map((lane) => lane.log.length ? T.timedTokens(lane.log, { lang: lane.lang }).length : 0));
      /**
       * 听够了再判断：至少 JUDGE_MS，且有一路攒够词；听了很久也只攒到几个词时接着听，
       * 不拿一段几乎没人说话的声音去判断（纯音乐的片子最后按「没有识别到人声」处理，不请用户选语言）。
       */
      const ready = () => {
        const words = most();
        return elapsed() >= JUDGE_MS && (words >= JUDGE_WORDS || (elapsed() >= JUDGE_MAX_MS && words >= SPEECH_WORDS));
      };
      const laneEnded = () => {
        if (!active().every((lane) => lane.ended)) return;
        if (judged) { finish(); return; }
        if (judging) return;
        if (most() < SPEECH_WORDS) { chosen = active()[0]?.lang || langs[0]; finish(); return; } // 整段几乎没人说话
        runJudge(); // 片子比判断时间还短：放完了再判断
      };

      const listen = (lane) => {
        const rec = new SR();
        rec.lang = lane.lang;
        rec.continuous = true;
        rec.interimResults = true;
        rec.processLocally = true;
        const round = lane.rounds;
        lane.rounds += 1;
        rec.onresult = (event) => {
          const at = elapsed();
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            lane.log.push([round, i, at, event.results[i][0]?.transcript || '']);
          }
        };
        rec.onerror = (event) => {
          if (!RECOVERABLE.has(event.error)) lane.fatal = event.error;
        };
        rec.onend = () => {
          if (finished || lane.dropped || lane.rec !== rec) return;
          if (lane.fatal || lane.rounds >= MAX_ROUNDS) {
            // 这一路出错：还有别的路就只丢掉它，只剩它就整个失败
            const code = lane.fatal === 'language-not-supported' ? 'pack-unavailable' : 'sr-error';
            if (active().length > 1) { stopLane(lane); laneEnded(); return; }
            finish(new FileError(code, lane.fatal || 'restarts'));
            return;
          }
          if (!playing) { lane.ended = true; laneEnded(); return; }
          listen(lane);
        };
        lane.rec = rec;
        rec.start(lane.track);
      };

      lanes.forEach(listen);
      // 识别器起来需要一点时间，晚一点再开始放，免得开头几个词漏掉
      audio.resume().catch(() => {}).then(() => {
        if (finished) return;
        startAt = audio.currentTime + 0.3;
        source.start(startAt);
        timer = setInterval(() => {
          if (!judged && !judging && ready()) runJudge();
          emit(jobId, judged
            ? { type: 'progress', phase: 'recognize', lang: chosen, done: Math.min(duration, elapsed()), total: duration }
            : { type: 'progress', phase: 'detect', langs: active().map((lane) => lane.lang), done: Math.min(duration, elapsed()), total: duration });
        }, 1000);
      });
      source.onended = () => {
        tail = setTimeout(() => {
          playing = false;
          for (const lane of active()) {
            try { lane.rec?.stop(); } catch { lane.ended = true; }
          }
          laneEnded();
          // stop() 之后识别器会触发 onend；万一没有，最多再等 3 秒
          setTimeout(() => { active().forEach((lane) => { lane.ended = true; }); laneEnded(); }, 3000);
        }, TAIL_MS);
      };
    });
  }

  async function run(jobId, job, { url, lang, candidates = [], mode, store }) {
    const { signal } = job.controller;
    const bytes = await download(jobId, url, signal);
    if (signal.aborted) return;
    // 留一份视频文件给「视频翻译」页播放（原网址失效、防盗链时也能看）；存不下就算了，页面退回原网址
    if (store) {
      await globalThis.AITrVideoLibrary?.putFile(jobId, new Blob([bytes], { type: T.sniffMedia(bytes) || 'video/mp4' })).catch(() => {});
    }
    emit(jobId, { type: 'progress', phase: 'decode' });
    const { samples, duration } = await decode(bytes);
    if (signal.aborted) return;
    const size = bytes.length;
    if (T.isSilent(samples)) {
      emit(jobId, { type: 'done', silent: true, duration, size });
      return;
    }
    if (mode === 'audio') {
      emit(jobId, { type: 'done', audio: toBase64(T.encodeWav(samples, SAMPLE_RATE)), duration, size });
      return;
    }
    if (!Speech.supported()) throw new FileError('sr-unsupported');

    let result;
    if (lang) {
      // 用户指定了语言：只按它听
      await checkRecognizer(lang);
      result = await recognize(jobId, job, samples, duration, [lang]);
    } else {
      // 先判断视频说的是什么语言：已装语言包的候选（网页语言在前）同时听，后台判断哪一路是真的
      const installed = await installedAmong(candidates);
      if (signal.aborted) return;
      if (!installed.length) throw new FileError('pack-none');
      const judge = (heard, at) => {
        emit(jobId, { type: 'judge', heard, at });
        return waitFor(jobId, job, 'judged', { timeout: 60000 });
      };
      try {
        result = await recognize(jobId, job, samples, duration, installed.slice(0, MAX_LANES), judge);
      } catch (err) {
        if (err?.code !== 'undetermined') throw err;
        // 判断不出来：请用户选（浮层或「视频翻译」页），选了再从头按它听
        emit(jobId, { type: 'need-lang', installed, guess: err.detail || '' });
        const picked = await waitFor(jobId, job, 'lang', { heartbeat: true, timeout: 30 * 60 * 1000 });
        await checkRecognizer(picked);
        emit(jobId, { type: 'progress', phase: 'recognize', lang: picked, done: 0, total: duration });
        result = await recognize(jobId, job, samples, duration, [picked]);
      }
    }
    emit(jobId, { type: 'done', tokens: result.tokens, lang: result.lang, duration, size });
  }

  function start(message) {
    const { jobId } = message;
    stop(jobId);
    const job = { controller: new AbortController(), stop: null, answers: {} };
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
    } else if (message.type === 'video-file-judged') {
      // 后台判断出的语言（lang 为空表示判断不了，guess 是猜的）
      jobs.get(message.jobId)?.answers.judged?.({ lang: message.lang || '', guess: message.guess || '' });
      sendResponse(true);
    } else if (message.type === 'video-file-lang') {
      // 用户选的语言
      if (typeof message.lang === 'string' && message.lang) jobs.get(message.jobId)?.answers.lang?.(message.lang);
      sendResponse(true);
    }
    return false;
  });
})();

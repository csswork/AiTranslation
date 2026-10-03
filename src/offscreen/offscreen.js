/**
 * offscreen 文档：截取标签页的声音 → 语音识别 → 断好句送回页面。
 * 默认用设备端识别（声音不出浏览器）；设置里打开「云端识别」时改用 Chrome 的云端识别。
 *
 * 为什么放在这里：
 *   - Service Worker 没有 getUserMedia / AudioContext / SpeechRecognition；
 *   - 设备端识别的语言包按源隔离。这里和设置页同为扩展的源，设置页装一次，这里就能用。
 * 这里能用的扩展 API 只有 chrome.runtime（实测），读不到设置，识别语言和方式由页面传过来。
 *
 * 页面（content/video.js）用长连接连过来：连接断开 = 页面关了、跳走了、或者用户点了关闭，
 * 这时立刻停掉这一路。一个扩展同时只能有一个 offscreen 文档，所以这里按 tabId 管理多路。
 */
(() => {
  const PORT_NAME = 'ai-video';
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  const Captions = globalThis.AITrCaptions;
  const Speech = globalThis.AITrSpeech;

  /** 停顿检测的节拍。 */
  const TICK_MS = 200;
  /** 识别器自己结束后会自动重启；这段时间内重启太多次就认定出错，不再空转。 */
  const RESTART_WINDOW_MS = 10000;
  const MAX_RESTARTS = 5;
  /** 这些错误重启识别器就能恢复（重启在 onend 里做）。 */
  const RECOVERABLE = new Set(['no-speech', 'aborted']);

  /** tabId -> 会话 */
  const sessions = new Map();

  class VideoError extends Error {
    constructor(message, action = null) {
      super(message);
      this.action = action;
    }
  }

  function langPackError(status) {
    if (status === 'downloading') return new VideoError('离线语言包还在下载，稍后再试', 'open-options');
    if (status === 'downloadable') return new VideoError('还没有下载识别这个语言所需的离线语言包', 'open-options');
    return new VideoError('这台设备不支持该语言的离线识别', 'open-options');
  }

  function recognitionError(code, cloud) {
    switch (code) {
      case 'language-not-supported':
        return cloud ? new VideoError('云端识别不支持这个语言') : langPackError('unavailable');
      case 'network':
        return new VideoError('连不上云端语音识别服务（需要能访问 Google）');
      case 'audio-capture':
        return new VideoError('读不到标签页的声音');
      case 'not-allowed':
      case 'service-not-allowed':
        return new VideoError('浏览器不允许语音识别');
      default:
        return new VideoError(`语音识别出错（${code}）`);
    }
  }

  function post(session, message) {
    try {
      session.port.postMessage(message);
    } catch {
      /* 页面已经断开 */
    }
  }

  function flush(session, lines) {
    for (const text of lines) post(session, { type: 'line', text });
  }

  /** 释放音频和识别器，但不断开连接。 */
  function release(session) {
    session.stopped = true;
    clearInterval(session.timer);
    try {
      session.rec?.abort();
    } catch {
      /* 已经停了 */
    }
    session.stream?.getTracks().forEach((track) => track.stop());
    session.audio?.close().catch(() => {});
  }

  function stop(tabId) {
    const session = sessions.get(tabId);
    if (!session) return;
    sessions.delete(tabId);
    release(session);
    try {
      session.port.disconnect();
    } catch {
      /* 已经断开 */
    }
  }

  /**
   * 出错：告诉页面，然后释放资源。
   * 不主动断开连接——紧跟在 postMessage 后面 disconnect 有丢消息的风险，
   * 让页面显示完错误、用户关掉浮层时再由页面断开。
   */
  function fail(tabId, session, err) {
    post(session, {
      type: 'error',
      message: String(err?.message || err) || '视频字幕出错',
      action: err?.action || null,
    });
    release(session);
    if (sessions.get(tabId) === session) sessions.delete(tabId);
  }

  function listen(tabId, session) {
    const rec = new SR();
    rec.lang = session.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.processLocally = !session.cloud;

    rec.onresult = (event) => {
      const parts = [];
      for (let i = 0; i < event.results.length; i += 1) parts.push(event.results[i][0]?.transcript);
      const full = Captions.joinParts(parts, session.lang);
      const { lines, partial } = session.segmenter.update(full, Date.now());
      flush(session, lines);
      post(session, { type: 'partial', text: partial });
    };
    rec.onerror = (event) => {
      if (session.stopped) return; // 自己 abort 的
      console.warn('[AI 划词翻译] 语音识别出错：', event.error, event.message || '');
      if (!RECOVERABLE.has(event.error)) session.fatal = event.error;
    };
    rec.onend = () => {
      if (session.stopped || session.rec !== rec) return;
      console.info('[AI 划词翻译] 识别器结束，准备重启');
      if (session.fatal) {
        fail(tabId, session, recognitionError(session.fatal, session.cloud));
        return;
      }
      // 新的识别器从空白开始计数，旧的没提交完的先提交掉
      flush(session, session.segmenter.reset());
      const now = Date.now();
      session.restarts = session.restarts.filter((at) => now - at < RESTART_WINDOW_MS);
      session.restarts.push(now);
      if (session.restarts.length > MAX_RESTARTS) {
        fail(
          tabId,
          session,
          new VideoError('语音识别反复中断，已停止', session.cloud ? null : 'open-options')
        );
        return;
      }
      listen(tabId, session);
    };

    session.rec = rec;
    rec.start(session.track);
  }

  async function start(tabId, port, { streamId, lang, cloud = false }) {
    stop(tabId); // 同一个标签页只保留一路
    const session = {
      port,
      lang,
      cloud,
      stopped: false,
      fatal: null,
      stream: null,
      track: null,
      audio: null,
      rec: null,
      timer: 0,
      restarts: [],
      segmenter: Captions.createSegmenter({ lang }),
    };
    sessions.set(tabId, session);

    try {
      if (cloud) {
        if (!SR) throw new VideoError('当前浏览器不支持语音识别');
      } else {
        if (!Speech.supported()) {
          throw new VideoError(
            '当前 Chrome 不支持设备端语音识别，请升级到最新版，或在设置里改用云端识别',
            'open-options'
          );
        }
        const status = await Speech.packStatus(lang);
        if (status !== 'available') throw langPackError(status);
        if (session.stopped) return;
      }

      try {
        session.stream = await navigator.mediaDevices.getUserMedia({
          audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
        });
      } catch (err) {
        throw new VideoError(`截取标签页声音失败：${err?.message || err}`);
      }
      if (session.stopped) {
        release(session);
        return;
      }

      // 标签页被截取后自己就不出声了，必须把声音接回扬声器，否则用户会以为扩展把声音弄没了
      session.audio = new AudioContext();
      session.audio.createMediaStreamSource(session.stream).connect(session.audio.destination);
      session.audio.resume().catch(() => {});

      session.track = session.stream.getAudioTracks()[0];
      // 标签页关闭时截取会自己结束。只停自己这一路：同一标签页可能已经换成了新会话
      session.track.addEventListener('ended', () => {
        if (sessions.get(tabId) === session) stop(tabId);
      });

      listen(tabId, session);
      session.timer = setInterval(() => flush(session, session.segmenter.tick(Date.now())), TICK_MS);
      post(session, { type: 'state', state: 'listening' });
    } catch (err) {
      fail(tabId, session, err);
    }
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    const tabId = port.sender?.tab?.id;
    if (tabId == null) {
      port.disconnect();
      return;
    }
    port.onMessage.addListener((message) => {
      if (message?.type === 'start') start(tabId, port, message);
    });
    port.onDisconnect.addListener(() => {
      if (sessions.get(tabId)?.port === port) stop(tabId);
    });
  });

  // 后台用来做「再点一次就关闭」
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== 'offscreen') return false;
    if (message.type === 'video-running') {
      sendResponse(sessions.has(message.tabId));
    } else if (message.type === 'video-stop') {
      stop(message.tabId);
      sendResponse(true);
    }
    return false;
  });
})();

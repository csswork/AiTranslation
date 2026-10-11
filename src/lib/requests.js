/** Disconnecting a request port aborts its provider fetch in the worker. */
(() => {
  if (globalThis.AITrRequests) return;
  function request(message, { signal } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      const port = chrome.runtime.connect({ name: 'ai-translation-request' });
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        port.disconnect();
        if (error) reject(error); else resolve(value);
      };
      const abort = () => finish(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      port.onMessage.addListener((reply) => finish(null, reply));
      port.onDisconnect.addListener(() => finish(new Error(chrome.runtime.lastError?.message || AITrI18n.t('翻译连接已中断，请重试。'))));
      try { port.postMessage(message); } catch (error) { finish(error); }
    });
  }
  globalThis.AITrRequests = { request };
})();

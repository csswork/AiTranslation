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
  /**
   * 只查本机缓存（见 lib/cache.js），返回与 texts 等长的数组，没命中的是 null。
   * 只在会走本机缓存的平台（自带 Key 的大模型、DeepL，且设置里没关）才真的去查；查询失败就当没命中。
   */
  async function lookupBatch(message, { signal, settings } = {}) {
    const { texts } = message;
    const misses = texts.map(() => null);
    const kind = globalThis.AITrSettings?.providerKind(message.providerId || settings?.provider);
    if (!texts.length || settings?.cache === false || !(kind === 'llm' || kind === 'mt')) return misses;
    try {
      const reply = await request({ ...message, type: 'cache-lookup' }, { signal });
      return reply?.ok && Array.isArray(reply.texts) && reply.texts.length === texts.length ? reply.texts : misses;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return misses;
    }
  }

  /**
   * 批量翻译，先查本机缓存：命中的段落经 onHits(found) 立刻交回（found 与 texts 等长，没命中的是 null），
   * 剩下的再发 translate-batch。不然一批里只要有一段没命中，整批都得等网络请求。
   * 已经用 lookupBatch 查过的可以把结果作为 found 传进来，不再查一次。
   * 返回与 translate-batch 相同形状的回复：{ ok, texts, refused } 或 { ok: false, error, action }。
   */
  async function translateBatch(message, { signal, settings, onHits, found } = {}) {
    const { texts } = message;
    const known = Array.isArray(found) && found.length === texts.length ? found : await lookupBatch(message, { signal, settings });
    const missing = texts.map((_, i) => i).filter((i) => typeof known[i] !== 'string');
    if (missing.length < texts.length) onHits?.(known);
    if (!missing.length) return { ok: true, texts: known };
    const whole = Array.isArray(message.whole) ? missing.map((i) => message.whole[i]) : undefined;
    const reply = await request({ ...message, type: 'translate-batch', texts: missing.map((i) => texts[i]), whole }, { signal });
    if (!reply?.ok) return reply;
    const out = [...known];
    missing.forEach((index, j) => { out[index] = reply.texts?.[j]; });
    // refused 是平台拒绝处理、保留原文的段落，序号换回 texts 里的位置
    const refused = Array.isArray(reply.refused) ? reply.refused.map((j) => missing[j]).filter((i) => i !== undefined) : [];
    return { ok: true, texts: out, refused };
  }

  globalThis.AITrRequests = { request, lookupBatch, translateBatch };
})();

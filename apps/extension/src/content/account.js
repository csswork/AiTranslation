/** 双向提示重新核对账户状态；不读取 Cookie，也不传递账号、令牌或请求地址。 */
(() => {
  if (window !== window.top) return;
  let stopped = false;
  const invalidated = (error) => /extension context invalidated/i.test(String(error?.message || error));
  const runtimeId = () => {
    try { return stopped ? null : globalThis.chrome?.runtime?.id; } catch { return null; }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* 旧上下文已失效 */ }
  };
  function onMessage(message, sender) {
    const id = runtimeId();
    if (!id) { stop(); return; }
    if (sender.id === id && message.type === 'account-session-changed') {
      window.dispatchEvent(new CustomEvent('aitr:account-changed'));
    }
  }
  function notify() {
    if (!runtimeId()) { stop(); return; }
    try {
      // sendMessage 在旧上下文中会同步抛错，不能仅依赖 Promise.catch。
      chrome.runtime.sendMessage({ type: 'account-web-changed' }).catch((error) => {
        if (!runtimeId() || invalidated(error)) stop();
      });
    } catch { stop(); }
  }
  function onPageShow(event) { if (event.persisted) notify(); }
  function onVisibilityChange() { if (!document.hidden) notify(); }
  try {
    if (!runtimeId()) return;
    const env = globalThis.AITrEnv;
    if (typeof env?.isAccountPage !== 'function' || typeof env?.isWebsitePage !== 'function') return;
    const isAccountPage = env.isAccountPage(location.href);
    if (!isAccountPage && !env.isWebsitePage(location.href)) return;
    chrome.runtime.onMessage.addListener(onMessage);
    // 官网页头也可接收刷新提示，但只有用户端能通知后台核对扩展。
    if (!isAccountPage) return;
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    notify();
  } catch (error) {
    stop();
    if (!invalidated(error)) throw error;
  }
})();

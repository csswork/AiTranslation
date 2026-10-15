/** 只通知后台重新核对账户状态；不读取 Cookie，也不传递账号、令牌或请求地址。 */
(() => {
  if (window !== window.top || !AITrEnv.isAccountPage(location.href)) return;
  const notify = () => chrome.runtime.sendMessage({ type: 'account-web-changed' }).catch(() => {});
  // 网页登录、登出、会话撤销和订阅操作都在导航完成后核对；恢复缓存页面、切回页面时也核对。
  notify();
  window.addEventListener('pageshow', (event) => { if (event.persisted) notify(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) notify(); });
})();

/**
 * 扩展登录的回调页：用户端确认后带着一次性授权码回到这里。本页只把自己的地址交给 service worker，
 * 由它核对 state、换取令牌，成功后回到发起登录的页面并关掉本页；失败时在这里显示原因。
 */
(async () => {
  const reply = await chrome.runtime.sendMessage({ type: 'account-callback', url: location.href })
    .catch((err) => ({ ok: false, error: String(err?.message || err) }));
  if (reply?.ok) return;
  await AITrI18n.ready;
  const state = document.getElementById('state');
  state.textContent = reply?.error || AITrI18n.t('登录失败，请重试');
  state.className = 'error';
  document.getElementById('back').hidden = false;
})();

/** 扩展页面共用的登录等待状态；凭据和请求仍由 service worker 处理。 */
(() => {
  let pending = false;
  const disabledBefore = new WeakMap();
  function sync() {
    for (const button of document.querySelectorAll('[data-login]')) {
      if (pending) {
        if (!disabledBefore.has(button)) disabledBefore.set(button, button.disabled);
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
      } else {
        if (disabledBefore.has(button)) {
          button.disabled = disabledBefore.get(button);
          disabledBefore.delete(button);
        }
        button.removeAttribute('aria-busy');
      }
    }
  }
  async function login({ onError, onOpened } = {}) {
    if (pending) return;
    pending = true;
    sync();
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'account-login' });
      if (!reply?.ok) throw new Error(reply?.error || AITrI18n.t('登录失败，请重试'));
      onOpened?.();
    } catch (error) {
      onError?.(String(error?.message || error));
    } finally {
      pending = false;
      sync();
    }
  }
  globalThis.AITrAuthUi = { login, sync };
})();

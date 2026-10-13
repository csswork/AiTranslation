// Google One Tap：Google 组件加载后初始化并弹出提示；用户选择账号后，把签名的 ID token
// 放进隐藏表单提交给服务端（服务端校验签名、客户端 ID、有效期和本页的一次性 nonce）。
(() => {
  const form = document.querySelector('[data-one-tap]');
  if (!form) return;
  const start = () => {
    const id = window.google && window.google.accounts && window.google.accounts.id;
    if (!id) return false;
    id.initialize({
      client_id: form.dataset.clientId,
      nonce: form.dataset.nonce,
      context: 'signin',
      cancel_on_tap_outside: true,
      itp_support: true,
      use_fedcm_for_prompt: true,
      callback: (response) => {
        if (!response || !response.credential) return;
        form.elements.credential.value = response.credential;
        form.submit();
      },
    });
    id.prompt();
    return true;
  };
  // gsi/client 是 async 加载，可能早于或晚于本脚本执行完毕。
  if (!start()) {
    const previous = window.onGoogleLibraryLoad;
    window.onGoogleLibraryLoad = () => {
      if (typeof previous === 'function') previous();
      start();
    };
  }
})();

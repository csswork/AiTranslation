// 页头控件与登录等待反馈的渐进增强；表单仍由浏览器提交，没有脚本时也可使用。
(() => {
  const root = document.documentElement;

  // 扩展退出、切回标签页或恢复缓存页后核对网页会话；管理端与未登录页不参与。
  if (document.body?.hasAttribute('data-web-session')) {
    let revision = 0;
    const checkSession = async () => {
      const current = ++revision;
      try {
        const response = await fetch('/api/web/session', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) return;
        const state = await response.json();
        if (current === revision && state.signedIn === false) location.reload();
      } catch { /* 网络异常不视为退出登录 */ }
    };
    window.addEventListener('aitr:account-changed', checkSession);
    window.addEventListener('focus', checkSession);
    window.addEventListener('pageshow', (event) => { if (event.persisted) checkSession(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSession(); });
  }

  // 登录各步骤共用锁，避免邮箱、Google、验证码和二步验证被重复提交。
  let authPending = false;
  const restoreAuth = [];
  const rememberAttribute = (node, name, value) => {
    const previous = node.getAttribute(name);
    restoreAuth.push(() => previous === null ? node.removeAttribute(name) : node.setAttribute(name, previous));
    node.setAttribute(name, value);
  };
  const beginAuth = (active, form = null) => {
    authPending = true;
    rememberAttribute(active, 'aria-busy', 'true');
    for (const control of document.querySelectorAll('[data-auth-form] button, [data-auth-link], a[href="/login"], .account-link.is-login')) {
      if ('disabled' in control) {
        const disabled = control.disabled;
        restoreAuth.push(() => { control.disabled = disabled; });
        control.disabled = true;
      } else rememberAttribute(control, 'aria-disabled', 'true');
    }
    if (form?.hasAttribute('data-one-tap')) {
      const hidden = form.hidden;
      restoreAuth.push(() => { form.hidden = hidden; });
      form.hidden = false;
    }
  };
  document.querySelectorAll('[data-auth-form]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (event.defaultPrevented) return;
      if (authPending) { event.preventDefault(); return; }
      const button = event.submitter || form.querySelector('button[type="submit"]');
      // disabled 的提交按钮不会进入 FormData；保留授权确认的 decision 等必要字段。
      if (button?.name && !button.disabled) {
        const field = document.createElement('input');
        field.type = 'hidden';
        field.name = button.name;
        field.value = button.value;
        form.appendChild(field);
        restoreAuth.push(() => field.remove());
      }
      beginAuth(button || form, form);
    });
  });
  document.querySelectorAll('[data-auth-link], a[href="/login"], .account-link.is-login').forEach((link) => {
    link.addEventListener('click', (event) => {
      // 在新标签页打开时保留浏览器的原生行为。
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (authPending) { event.preventDefault(); return; }
      beginAuth(link);
    });
  });
  window.addEventListener('pageshow', () => {
    while (restoreAuth.length) restoreAuth.pop()();
    authPending = false;
  });

  // 配色：与官网相同，跟随系统；手动切换后写入 theme Cookie，切回与系统一致时清除。
  const themeForm = document.querySelector('[data-theme-form]');
  if (themeForm) {
    // 与官网共用 theme Cookie：生产环境写在父域（服务端通过 data-cookie-domain 告知）。
    const domain = themeForm.dataset.cookieDomain ? `; Domain=${themeForm.dataset.cookieDomain}` : '';
    const attrs = `; Path=/; SameSite=Lax${domain}${location.protocol === 'https:' ? '; Secure' : ''}`;
    const button = themeForm.querySelector('button');
    const media = matchMedia('(prefers-color-scheme: dark)');
    const system = () => (media.matches ? 'dark' : 'light');
    const current = () => root.dataset.theme || system();
    const sync = () => {
      const label = current() === 'dark' ? button.dataset.toLight : button.dataset.toDark;
      button.setAttribute('aria-label', label);
      button.title = label;
    };
    themeForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const next = current() === 'dark' ? 'light' : 'dark';
      if (next === system()) {
        delete root.dataset.theme;
        document.cookie = `theme=; Max-Age=0${attrs}`;
      } else {
        root.dataset.theme = next;
        document.cookie = `theme=${next}; Max-Age=31536000${attrs}`;
      }
      sync();
    });
    media.addEventListener('change', sync);
    sync();
  }

  // 语言：选中即提交，不需要“切换”按钮。
  const langForm = document.querySelector('[data-lang-form]');
  if (langForm) {
    langForm.querySelector('[data-lang-submit]').hidden = true;
    langForm.querySelector('select').addEventListener('change', () => langForm.requestSubmit());
  }
})();

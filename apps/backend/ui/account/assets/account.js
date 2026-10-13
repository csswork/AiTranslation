// 页头两个控件的增强。没有脚本时两个表单照常提交给服务端，效果相同，只是会刷新页面。
(() => {
  const root = document.documentElement;

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

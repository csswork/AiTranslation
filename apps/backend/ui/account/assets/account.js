// 页头两个控件的增强。没有脚本时两个表单照常提交给服务端，效果相同，只是会刷新页面。
(() => {
  const root = document.documentElement;
  const secure = location.protocol === 'https:' ? '; Secure' : '';

  // 配色：与官网相同，跟随系统；手动切换后写入 theme Cookie，切回与系统一致时清除。
  const themeForm = document.querySelector('[data-theme-form]');
  if (themeForm) {
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
        document.cookie = `theme=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
      } else {
        root.dataset.theme = next;
        document.cookie = `theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
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

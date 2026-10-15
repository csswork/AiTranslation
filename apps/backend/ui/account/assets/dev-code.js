// 开发环境（没有发信服务）专用：把验证码弹出来并填进输入框。生产环境的页面不会引用这个脚本。
const holder = document.querySelector('[data-dev-code]');
if (holder) {
  const code = holder.getAttribute('data-dev-code');
  const input = document.querySelector('input[name="code"]');
  if (input && !input.value) input.value = code;
  window.alert(`开发环境验证码：${code}`);
}

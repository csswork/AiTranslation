/**
 * 发信。正式发信服务尚未选定；目前只有本地开发用的 console 方式，
 * 生产环境配置校验会拒绝启动（见 config）。
 */
const PURPOSE_LABELS = { login: '登录', change_email: '更换邮箱' };

export function createMailer(config, { log = console.log } = {}) {
  if (config.mailTransport !== 'console') throw new Error(`不支持的发信方式：${config.mailTransport}`);
  return {
    async sendCode({ to, code, purpose }) {
      log(`[开发发信] ${PURPOSE_LABELS[purpose] || purpose}验证码 → ${to}：${code}`);
    },
  };
}

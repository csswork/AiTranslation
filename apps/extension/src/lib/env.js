/**
 * 运行环境与外部地址。商店安装的扩展 manifest 带 update_url；开发者模式加载的未打包版本没有，
 * 这时账户服务、官网等链接都指向本机开发环境（与根目录 npm run dev:backend / dev:web 的端口一致）。
 * 扩展里需要的外部地址都从这里取，不在各页面写死。与 lang.js 一样，不能使用 import / export。
 */
(() => {
  const dev = !chrome.runtime.getManifest().update_url;
  const accountOrigin = dev ? 'http://localhost:8787' : 'https://app.huaci.app';
  const websiteOrigin = dev ? 'http://localhost:8788' : 'https://huaci.app';

  globalThis.AITrEnv = Object.freeze({
    dev,
    accountOrigin,
    websiteOrigin,
    links: Object.freeze({
      account: `${accountOrigin}/`,
      plans: `${accountOrigin}/plans`,
      usage: `${accountOrigin}/usage`,
      website: `${websiteOrigin}/`,
      privacy: `${websiteOrigin}/privacy.html`,
    }),
  });
})();

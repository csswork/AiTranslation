/**
 * 运行环境与外部地址。打包器明确标记生产包，不依赖不同商店是否注入 update_url。
 * 源码直接加载时使用本机开发环境；旧商店包仍兼容 update_url 判断。
 * 扩展里需要的外部地址都从这里取，不在各页面写死。与 lang.js 一样，不能使用 import / export。
 */
(() => {
  let manifest;
  try {
    // 扩展重载后，旧标签页的 runtime 会失效；不要在残留的内容脚本里继续初始化。
    if (!globalThis.chrome?.runtime?.id) return;
    manifest = chrome.runtime.getManifest();
  } catch (error) {
    if (/extension context invalidated/i.test(String(error?.message || error))) return;
    throw error;
  }
  const packaged = false; // @store-package: 打包器只在临时目录中替换为 true。
  const dev = !packaged && !manifest.update_url;
  const edge = /\bEdg\//.test(globalThis.navigator?.userAgent || '');
  const accountOrigin = dev ? 'http://localhost:8787' : 'https://app.huaci.app';
  const websiteOrigin = dev ? 'http://localhost:8788' : 'https://huaci.app';
  // Vercel 可能把裸域与 www 互相跳转；两个来源都是官网，链接仍用 websiteOrigin。
  const websiteOrigins = dev ? [websiteOrigin] : [websiteOrigin, 'https://www.huaci.app'];

  globalThis.AITrEnv = Object.freeze({
    dev,
    extensionsShortcuts: edge ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts',
    accountOrigin,
    websiteOrigin,
    // 内容脚本匹配范围可覆盖其他端口；同步时仍按完整 origin 检查。
    isAccountPage(url) {
      try { return new URL(url).origin === accountOrigin; } catch { return false; }
    },
    isWebsitePage(url) {
      try { return websiteOrigins.includes(new URL(url).origin); } catch { return false; }
    },
    links: Object.freeze({
      account: `${accountOrigin}/`,
      plans: `${accountOrigin}/plans`,
      usage: `${accountOrigin}/usage`,
      billing: `${accountOrigin}/billing`,
      website: `${websiteOrigin}/`,
      privacy: `${websiteOrigin}/privacy.html`,
    }),
  });
})();

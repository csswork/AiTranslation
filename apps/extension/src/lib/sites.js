/**
 * 整站翻译的网站名单：右键「翻译这个网站」打开后记下域名，这个网站的页面都自动翻译，直到再次关闭。
 * 只存在本机 chrome.storage.local 的 siteTranslate（域名数组），不同步、不上传。
 *
 * 同时被 service worker（import）、内容脚本和设置页加载，不能用 import / export。
 */
(() => {
  const KEY = 'siteTranslate';
  /** 名单上限：足够日常使用，又不会让存储无限增长。 */
  const MAX = 500;

  /** 只有 http(s) 网页能整站翻译；返回小写域名（含子域名与端口外的部分），其他地址返回空字符串。 */
  function hostOf(url) {
    try {
      const parsed = new URL(String(url || ''));
      return /^https?:$/.test(parsed.protocol) ? parsed.hostname.toLowerCase() : '';
    } catch {
      return '';
    }
  }

  const clean = (value) => (Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === 'string' && /^[a-z0-9.\-[\]:]+$/i.test(item)).map((item) => item.toLowerCase()))].slice(0, MAX)
    : []);

  async function list() {
    try {
      const stored = await chrome.storage.local.get(KEY);
      return clean(stored[KEY]);
    } catch {
      return [];
    }
  }

  async function has(host) {
    return Boolean(host) && (await list()).includes(String(host).toLowerCase());
  }

  /** 读改写排队，避免两个标签页同时开关时互相覆盖（只对同一个上下文有效）。 */
  let task = Promise.resolve();
  function set(host, enabled) {
    const next = task.catch(() => {}).then(async () => {
      const name = String(host || '').toLowerCase();
      if (!name) return list();
      const current = (await list()).filter((item) => item !== name);
      const sites = enabled ? [name, ...current].slice(0, MAX) : current;
      await chrome.storage.local.set({ [KEY]: sites });
      return sites;
    });
    task = next;
    return next;
  }

  async function clear() {
    await chrome.storage.local.set({ [KEY]: [] });
  }

  /** 名单变化时回调新名单。 */
  function onChange(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[KEY]) callback(clean(changes[KEY].newValue));
    });
  }

  globalThis.AITrSites = { KEY, hostOf, list, has, set, clear, onChange, clean };
})();

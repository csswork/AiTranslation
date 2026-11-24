/**
 * 整站翻译的网站名单：右键「翻译这个网站」打开后记下域名，这个网站（含子域名）的页面都自动翻译，直到再次关闭。
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

  /** 名单上的 entry 是否覆盖 host：同一个域名，或它的子域名（开着 2ch.sc 时 nozomi.2ch.sc 也算）。 */
  function covers(entry, host) {
    const name = String(host || '').toLowerCase();
    return Boolean(entry && name) && (name === entry || name.endsWith(`.${entry}`));
  }

  /** 名单里覆盖 host 的那一项，优先完全相同的、其次最接近的上级域名；没有返回空字符串。 */
  function match(sites, host) {
    return (sites || []).filter((entry) => covers(entry, host)).sort((a, b) => b.length - a.length)[0] || '';
  }

  async function has(host) {
    return Boolean(match(await list(), host));
  }

  /** 读改写排队，避免两个标签页同时开关时互相覆盖（只对同一个上下文有效）。 */
  let task = Promise.resolve();
  function update(change) {
    const next = task.catch(() => {}).then(async () => {
      const current = await list();
      const sites = change(current);
      if (sites !== current) await chrome.storage.local.set({ [KEY]: sites });
      return sites;
    });
    task = next;
    return next;
  }

  /**
   * 在某个页面上开或关整站翻译（右键菜单、页面上的「关闭整站翻译」）。
   * 开：已被上级域名覆盖时不重复记；关：去掉所有覆盖它的项，否则这个页面仍会翻译。
   */
  function set(host, enabled) {
    const name = String(host || '').toLowerCase();
    return update((current) => {
      if (!name) return current;
      if (enabled) return match(current, name) ? current : [name, ...current].slice(0, MAX);
      const sites = current.filter((item) => !covers(item, name));
      return sites.length === current.length ? current : sites;
    });
  }

  /** 从名单里只移除这一项（设置页），不动它的上级或子域名。 */
  function remove(entry) {
    const name = String(entry || '').toLowerCase();
    return update((current) => (current.includes(name) ? current.filter((item) => item !== name) : current));
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

  globalThis.AITrSites = { KEY, hostOf, covers, match, list, has, set, remove, clear, onChange, clean };
})();

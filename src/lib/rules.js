/**
 * 元素翻译规则：记住「某个域名下的哪些元素可以一键翻译」。
 *
 * 存在独立的 chrome.storage.local 键里，不进 settings——settings.normalize()
 * 会剥掉未知字段，两者混在一起迟早出事。
 *
 * 与 lang.js 一样，同时被内容脚本、service worker 和管理页加载，
 * 所以不能出现 import / export。
 */
(() => {
  const STORE_KEY = 'domRules';

  /** 单个域名下最多记多少条，避免误操作攒出一大堆。 */
  const MAX_RULES_PER_HOST = 50;

  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  function newId() {
    return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /** 把任意存储内容整理成 { host: [rule, ...] }。 */
  function normalize(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const [host, list] of Object.entries(input)) {
      if (!str(host) || !Array.isArray(list)) continue;
      const seen = new Set();
      const rules = [];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const selector = str(item.selector);
        if (!selector || seen.has(selector)) continue;
        seen.add(selector);
        rules.push({
          id: str(item.id) || newId(),
          selector,
          label: str(item.label) || selector,
          createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        });
        if (rules.length >= MAX_RULES_PER_HOST) break;
      }
      if (rules.length) out[host] = rules;
    }
    return out;
  }

  async function loadRules() {
    const stored = await chrome.storage.local.get(STORE_KEY);
    return normalize(stored[STORE_KEY]);
  }

  async function saveRules(rules) {
    const clean = normalize(rules);
    await chrome.storage.local.set({ [STORE_KEY]: clean });
    return clean;
  }

  /** 取某个域名的规则。域名大小写不敏感，www. 视作同一个站点。 */
  function hostKey(host) {
    return str(host).toLowerCase().replace(/^www\./, '');
  }

  async function rulesFor(host) {
    const all = await loadRules();
    return all[hostKey(host)] || [];
  }

  async function addRule(host, selector, label) {
    const key = hostKey(host);
    const clean = str(selector);
    if (!key || !clean) return null;

    const all = await loadRules();
    const list = all[key] || [];
    const existing = list.find((item) => item.selector === clean);
    if (existing) return { rules: all, rule: existing, added: false };
    if (list.length >= MAX_RULES_PER_HOST) {
      return { rules: all, rule: null, added: false, full: true };
    }

    const rule = { id: newId(), selector: clean, label: str(label) || clean, createdAt: Date.now() };
    all[key] = [...list, rule];
    return { rules: await saveRules(all), rule, added: true };
  }

  async function removeRule(host, id) {
    const key = hostKey(host);
    const all = await loadRules();
    if (!all[key]) return all;
    all[key] = all[key].filter((item) => item.id !== id);
    if (!all[key].length) delete all[key];
    return saveRules(all);
  }

  async function removeHost(host) {
    const all = await loadRules();
    delete all[hostKey(host)];
    return saveRules(all);
  }

  async function clearAll() {
    await chrome.storage.local.set({ [STORE_KEY]: {} });
    return {};
  }

  globalThis.AITrRules = {
    STORE_KEY,
    MAX_RULES_PER_HOST,
    normalize,
    loadRules,
    saveRules,
    hostKey,
    rulesFor,
    addRule,
    removeRule,
    removeHost,
    clearAll,
  };
})();

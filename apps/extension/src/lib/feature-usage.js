/** 统计标记随现有托管请求发送。只在本机保存限频所需的时间。 */
(() => {
  const ENABLED = 'featureUsageEnabled';
  const MARKS = 'featureUsageMarks';
  const WINDOW = 24 * 60 * 60 * 1000;
  const FEATURES = new Set(['selection', 'panel', 'page', 'site', 'image', 'pdf', 'reader', 'subtitle', 'alternatives']);
  const firefoxPermission = { data_collection: ['technicalAndInteraction'] };
  let writes = Promise.resolve();

  function serialize(run) {
    const next = writes.catch(() => {}).then(run);
    writes = next;
    return next;
  }

  async function enabled() {
    if (AITrEnv.firefox) return Boolean(await globalThis.browser?.permissions.contains(firefoxPermission));
    return (await chrome.storage.local.get(ENABLED))[ENABLED] === true;
  }

  async function setEnabled(value) {
    if (AITrEnv.firefox) {
      // Firefox 要求 request 在用户点击的同步调用中发起。
      if (value) return globalThis.browser?.permissions.request(firefoxPermission);
      await globalThis.browser?.permissions.remove(firefoxPermission);
    } else {
      await chrome.storage.local.set({ [ENABLED]: value });
    }
    if (!value) await serialize(() => chrome.storage.local.remove(MARKS));
    return value;
  }

  function reserve(feature, owner) {
    if (!FEATURES.has(feature) || !owner) return null;
    return serialize(async () => {
      if (!await enabled()) return null;
      // 后台在普通与隐私窗口间共用。在浏览器允许扩展进入隐私窗口时暂停统计。
      if (chrome.extension?.inIncognitoContext || await chrome.extension?.isAllowedIncognitoAccess?.()) return null;
      const now = Date.now();
      const key = `${owner}:${feature}`;
      const saved = (await chrome.storage.local.get(MARKS))[MARKS] || {};
      if (saved[key] >= now - WINDOW) return null;
      const marks = Object.fromEntries(Object.entries(saved).filter(([, time]) => time >= now - WINDOW));
      marks[key] = now;
      await chrome.storage.local.set({ [MARKS]: marks });
      return { key, time: now };
    });
  }

  function release({ key, time }) {
    return serialize(async () => {
      const marks = (await chrome.storage.local.get(MARKS))[MARKS];
      if (marks?.[key] !== time) return;
      delete marks[key];
      await chrome.storage.local.set({ [MARKS]: marks });
    });
  }

  globalThis.AITrFeatureUsage = { KEY: ENABLED, enabled, setEnabled, reserve, release };
})();

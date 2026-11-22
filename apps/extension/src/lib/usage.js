/**
 * 自愿分享的功能使用记录（见 docs/extension/usage-sharing.md）。与 lang.js 一样，不能使用 import / export。
 *
 * 设置里开启「分享功能使用情况」（settings.shareUsage，默认关闭）后，自带 Key 的大模型、DeepL 与本机翻译的每次调用
 * 按「浏览器本地日期 × 功能 × 平台」在本机累加次数；service worker 每天把已结束日子的计数发给后台。
 * 点数翻译不计（服务端本来就有记录）；无痕窗口里的使用不计；不记原文、译文、网址、语言或模型。
 *
 * 计数只在 service worker 里写入 chrome.storage.local 并排队串行；扩展页面（阅读、PDF、图片、翻译面板）
 * 直接调用 providers.js，经消息交给 service worker 计数。关闭开关或本机退出登录时清空队列。
 */
(() => {
  const KEY = 'usageShare';
  const FEATURES = ['selection', 'panel', 'page', 'site', 'image', 'pdf', 'reader', 'subtitle', 'alternatives'];
  const PROVIDERS = ['openai', 'deepseek', 'deepl', 'local'];
  /** 后台只收 35 天内的日期。 */
  const KEEP_DAYS = 35;
  const MAX_COUNT = 10_000;
  const MAX_SEND = 200;
  const DAY_MS = 86_400_000;

  const pad = (n) => String(n).padStart(2, '0');
  /** 浏览器本地日期 YYYY-MM-DD。 */
  const localDay = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const isWorker = typeof document === 'undefined';

  let task = Promise.resolve();
  const queued = (job) => {
    const next = task.catch(() => {}).then(job);
    task = next;
    return next;
  };

  /** Firefox 要求用户另外授予「技术与交互数据」这项可选的数据收集权限；Chrome / Edge 由设置开关决定。 */
  async function permitted() {
    if (!globalThis.AITrEnv?.firefox) return true;
    try {
      return await globalThis.browser?.permissions?.contains({ data_collection: ['technicalAndInteraction'] }) === true;
    } catch {
      return false;
    }
  }

  async function enabled() {
    const settings = await globalThis.AITrSettings.loadSettings();
    return settings.shareUsage === true && await permitted();
  }

  const readQueue = async () => {
    const stored = (await chrome.storage.local.get(KEY))[KEY];
    return stored && typeof stored === 'object' ? stored : {};
  };

  /** 去掉超过保留期或格式不对的条目。 */
  function prune(queue, now = Date.now()) {
    const earliest = localDay(new Date(now - KEEP_DAYS * DAY_MS));
    for (const [key, entry] of Object.entries(queue)) {
      const [day] = key.split('|');
      if (!(day >= earliest) || typeof entry?.id !== 'string' || !(entry.requests >= 1)) delete queue[key];
    }
    return queue;
  }

  /** service worker 内：把一次调用计入当天。 */
  function add({ feature, provider, ok }, now = Date.now()) {
    return queued(async () => {
      if (!await enabled()) return;
      const queue = prune(await readQueue(), now);
      const key = `${localDay(new Date(now))}|${feature}|${provider}`;
      const entry = queue[key] || { id: crypto.randomUUID(), requests: 0, failures: 0 };
      entry.requests = Math.min(MAX_COUNT, entry.requests + 1);
      if (!ok) entry.failures = Math.min(entry.requests, entry.failures + 1);
      queue[key] = entry;
      await chrome.storage.local.set({ [KEY]: queue });
    });
  }

  /**
   * 记一次调用。provider 是平台 ID（hosted 与未知平台不计），feature 是使用场景；incognito 为真时不计。
   * 不在 service worker 时交给它计数，不等待结果。计数失败不影响翻译。
   */
  function record({ feature, provider, ok = true, incognito = false }) {
    if (incognito || !FEATURES.includes(feature) || !PROVIDERS.includes(provider)) return;
    if (globalThis.chrome?.extension?.inIncognitoContext) return;
    if (!isWorker) {
      try { chrome.runtime.sendMessage({ type: 'usage-count', feature, provider, ok: ok === true })?.catch?.(() => {}); } catch { /* 忽略 */ }
      return;
    }
    add({ feature, provider, ok }).catch(() => {});
  }

  /** 待发送的全部条目（设置页预览用），按日期、功能、平台排序。 */
  async function pending() {
    const queue = prune(await readQueue());
    return Object.entries(queue).map(([key, entry]) => {
      const [day, feature, provider] = key.split('|');
      return { id: entry.id, day, feature, provider, requests: entry.requests, failures: entry.failures };
    }).sort((a, b) => a.day.localeCompare(b.day) || a.feature.localeCompare(b.feature) || a.provider.localeCompare(b.provider));
  }

  function clear() {
    return queued(() => chrome.storage.local.remove(KEY));
  }

  /**
   * 发送已结束日子的计数（今天的留到明天）。send(rows) 返回 'sent'（已收下）、'rejected'（格式被拒，丢弃）
   * 或其他（稍后重试）。没有开启时清空队列，什么都不发。返回本次发出的条数。
   */
  async function flush(send, now = Date.now()) {
    if (!await enabled()) {
      await clear();
      return 0;
    }
    const today = localDay(new Date(now));
    const rows = (await pending()).filter((row) => row.day < today).slice(0, MAX_SEND);
    if (!rows.length) return 0;
    const result = await send(rows);
    if (result !== 'sent' && result !== 'rejected') return 0;
    const ids = new Set(rows.map((row) => row.id));
    await queued(async () => {
      const queue = await readQueue();
      for (const [key, entry] of Object.entries(queue)) if (ids.has(entry?.id)) delete queue[key];
      await chrome.storage.local.set({ [KEY]: queue });
    });
    return result === 'sent' ? rows.length : 0;
  }

  // 关闭开关（或 Firefox 撤销数据收集权限）时清空本机队列。
  if (isWorker && globalThis.chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings && changes.settings.newValue?.shareUsage !== true
        && changes.settings.oldValue?.shareUsage === true) clear().catch(() => {});
    });
    globalThis.browser?.permissions?.onRemoved?.addListener?.((removed) => {
      if (removed?.data_collection?.includes('technicalAndInteraction')) clear().catch(() => {});
    });
  }

  globalThis.AITrUsage = { KEY, FEATURES, PROVIDERS, localDay, record, add, pending, clear, flush, permitted };
})();

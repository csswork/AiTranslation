/**
 * 商店评价邀请：长期、真正在用自带 API Key（ChatGPT、DeepSeek、DeepL）的用户，打开设置页时邀请一次去商店评价。
 * 与 lang.js 一样，不能使用 import / export。
 *
 * 只在本机记录：首次成功使用自带 Key 的日期、最近 60 个有成功调用的日期（浏览器本地日期）和累计使用天数，
 * 存在 chrome.storage.local 的 reviewPrompt，不上传、不依赖「分享功能使用情况」开关。无痕窗口与点数、本机翻译不计。
 *
 * 出现条件（全部满足）：首次使用满 30 天；累计有 12 天在用；最近 14 天里至少 4 天在用（现在仍在用）；
 * 没点过「去评价」或「不再提示」；距上次出现满 30 天；最多出现 3 次。
 * 读写只在 service worker 里排队进行；设置页经消息查询和回报。
 */
(() => {
  const KEY = 'reviewPrompt';
  const PROVIDERS = ['openai', 'deepseek', 'deepl'];
  const RULES = Object.freeze({ minAgeDays: 30, minDays: 12, recentWindow: 14, minRecentDays: 4, snoozeDays: 30, maxShown: 3, keepDays: 60 });
  const DAY_MS = 86_400_000;

  const pad = (n) => String(n).padStart(2, '0');
  const localDay = (ms) => {
    const date = new Date(ms);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  /** 两个本地日期之间相差的天数（b − a）。 */
  const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
  const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

  let task = Promise.resolve();
  const queued = (job) => {
    const next = task.catch(() => {}).then(job);
    task = next;
    return next;
  };

  function normalize(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const days = Array.isArray(input.days) ? [...new Set(input.days.filter(isDay))].sort().slice(-RULES.keepDays) : [];
    return {
      first: isDay(input.first) ? input.first : days[0] || null,
      days,
      total: Number.isInteger(input.total) && input.total >= days.length ? input.total : days.length,
      shown: Number.isInteger(input.shown) && input.shown > 0 ? input.shown : 0,
      snoozeUntil: Number(input.snoozeUntil) > 0 ? Number(input.snoozeUntil) : 0,
      done: input.done === true,
    };
  }

  const read = async () => normalize((await chrome.storage.local.get(KEY))[KEY]);
  const write = (state) => chrome.storage.local.set({ [KEY]: state });

  /** 现在是否该邀请。纯函数，便于测试。 */
  function eligible(state, now = Date.now()) {
    const s = normalize(state);
    if (s.done || s.shown >= RULES.maxShown || now < s.snoozeUntil || !s.first) return false;
    const today = localDay(now);
    if (daysBetween(s.first, today) < RULES.minAgeDays || s.total < RULES.minDays) return false;
    const recent = s.days.filter((day) => daysBetween(day, today) < RULES.recentWindow).length;
    return recent >= RULES.minRecentDays;
  }

  /** 记一次调用：只有成功的自带 Key 调用才算，同一天只记一次。 */
  let notedDay = '';
  function note({ provider, ok }, now = Date.now()) {
    if (ok !== true || !PROVIDERS.includes(provider)) return Promise.resolve();
    const today = localDay(now);
    if (notedDay === today) return Promise.resolve();
    return queued(async () => {
      const state = await read();
      if (!state.days.includes(today)) {
        state.first ||= today;
        state.days = [...state.days, today].sort().slice(-RULES.keepDays);
        state.total += 1;
        await write(state);
      }
      notedDay = today;
    });
  }

  /** 设置页打开时询问；该邀请时同时记下这次出现（30 天内不再出现），返回 true。 */
  function check(now = Date.now()) {
    return queued(async () => {
      const state = await read();
      if (!eligible(state, now)) return false;
      await write({ ...state, shown: state.shown + 1, snoozeUntil: now + RULES.snoozeDays * DAY_MS });
      return true;
    });
  }

  /** 用户的选择：rate（去评价）、never（不再提示）结束邀请；later（以后再说）保持 30 天后再问。 */
  function act(action) {
    if (action !== 'rate' && action !== 'never') return Promise.resolve();
    return queued(async () => write({ ...(await read()), done: true }));
  }

  globalThis.AITrReview = { KEY, RULES, PROVIDERS, eligible, note, check, act, read };
})();

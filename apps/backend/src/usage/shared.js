/**
 * 自愿分享的功能使用记录（见 docs/extension/usage-sharing.md）。
 *
 * 用户在扩展设置里开启后，扩展每天把已结束日子里「自带 Key / DeepL / 本机翻译」的调用次数按
 * 「浏览器本地日期 × 功能 × 平台」汇总发来。点数翻译不在这里（服务端已有 usage_events），两者在报表里分开显示，
 * 因为这里只是开启分享的用户，不是全部用户。不含原文、译文、网址、语言或模型。
 */
import { FEATURE_LABELS } from './features.js';

export const SHARED_FEATURES = Object.keys(FEATURE_LABELS);
export const SHARED_PROVIDERS = ['openai', 'deepseek', 'deepl', 'local'];
export const SHARED_PROVIDER_LABELS = { openai: 'ChatGPT', deepseek: 'DeepSeek', deepl: 'DeepL', local: '本机翻译' };
export const SHARED_MAX_ROWS = 200;
export const SHARED_MAX_COUNT = 10_000;
/** 扩展本机最多留 35 天；更早的日期不收。 */
export const SHARED_MAX_AGE_DAYS = 35;
export const SHARED_RETENTION_DAYS = 180;

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * 校验一批记录。只收已结束的日子：浏览器本地「昨天」最晚等于 UTC 今天（UTC+14），所以上限是 UTC 今天。
 * 任何一条不合格就整批拒绝（返回 null），不做部分写入。
 */
export function readSharedRows(value, now = Date.now()) {
  if (!Array.isArray(value) || !value.length || value.length > SHARED_MAX_ROWS) return null;
  const latest = utcDay(now);
  const earliest = utcDay(now - SHARED_MAX_AGE_DAYS * DAY_MS);
  const count = (n, min) => Number.isInteger(n) && n >= min && n <= SHARED_MAX_COUNT;
  const rows = [];
  for (const row of value) {
    const { id, day, feature, provider, requests, failures } = row || {};
    if (typeof id !== 'string' || !UUID.test(id)) return null;
    if (typeof day !== 'string' || !DAY.test(day) || utcDay(Date.parse(`${day}T00:00:00Z`) || 0) !== day) return null;
    if (day > latest || day < earliest) return null;
    if (!SHARED_FEATURES.includes(feature) || !SHARED_PROVIDERS.includes(provider)) return null;
    if (!count(requests, 1) || !count(failures, 0) || failures > requests) return null;
    rows.push({ id: id.toLowerCase(), day, feature, provider, requests, failures });
  }
  return rows;
}

/** 写入一批记录；扩展生成的 id 已存在时跳过（重试不重复记录）。返回新写入的条数。 */
export async function recordSharedUsage(db, userId, rows, { extVersion = null, browser = null, browserMajor = null, os = null } = {}) {
  const { rowCount } = await db.query(
    `INSERT INTO shared_feature_usage (id, user_id, day, feature, provider, requests, failures, ext_version, browser, browser_major, os)
     SELECT id, $1, day, feature, provider, requests, failures, $8, $9, $10, $11
     FROM unnest($2::uuid[], $3::date[], $4::text[], $5::text[], $6::int[], $7::int[])
       AS x(id, day, feature, provider, requests, failures)
     ON CONFLICT (id) DO NOTHING`,
    [userId, rows.map((r) => r.id), rows.map((r) => r.day), rows.map((r) => r.feature), rows.map((r) => r.provider),
      rows.map((r) => r.requests), rows.map((r) => r.failures), extVersion, browser, browserMajor, os],
  );
  return rowCount;
}

/** 删除超过保留期的记录（按日期）。 */
export async function pruneSharedUsage(db) {
  const { rowCount } = await db.query(
    `DELETE FROM shared_feature_usage WHERE day < (now() AT TIME ZONE 'UTC')::date - $1::int`, [SHARED_RETENTION_DAYS]);
  return rowCount;
}

/** 删除本人全部分享记录（用户端）。 */
export async function deleteSharedUsage(db, userId) {
  const { rowCount } = await db.query('DELETE FROM shared_feature_usage WHERE user_id = $1', [userId]);
  return rowCount;
}

/**
 * 管理端：fromDay–lastDay（含）内各功能的使用天次（账户 × 日）、账户数、请求数与失败数，并按平台拆分。
 * 列出全部功能（没用过的为 0），按使用天次、账户数排序。sharingAccounts 是区间内有记录的账户数。
 */
export async function sharedUsageRanking(db, { fromDay, lastDay }) {
  const { rows } = await db.query(
    `SELECT feature, provider, COUNT(DISTINCT (user_id, day))::int AS user_days, COUNT(DISTINCT user_id)::int AS accounts,
            SUM(requests)::int AS requests, SUM(failures)::int AS failures
     FROM shared_feature_usage WHERE day BETWEEN $1::date AND $2::date
     GROUP BY GROUPING SETS ((feature), (feature, provider))`,
    [fromDay, lastDay],
  );
  const { rows: [{ accounts, user_days: userDays }] } = await db.query(
    `SELECT COUNT(DISTINCT user_id)::int AS accounts, COUNT(DISTINCT (user_id, day))::int AS user_days
     FROM shared_feature_usage WHERE day BETWEEN $1::date AND $2::date`, [fromDay, lastDay]);
  const shape = (row) => ({
    userDays: row?.user_days || 0, accounts: row?.accounts || 0, requests: row?.requests || 0, failures: row?.failures || 0,
  });
  const order = SHARED_FEATURES;
  const features = order.map((key) => {
    const own = rows.filter((row) => row.feature === key);
    return {
      key, ...shape(own.find((row) => row.provider === null)),
      providers: Object.fromEntries(SHARED_PROVIDERS.map((p) => [p, shape(own.find((row) => row.provider === p))])),
    };
  }).sort((a, b) => b.userDays - a.userDays || b.accounts - a.accounts || order.indexOf(a.key) - order.indexOf(b.key));
  return { rows: features, sharingAccounts: accounts, userDays };
}

/** 单个账户 fromDay–lastDay（含）内按功能、平台汇总的天数、请求数与失败数。 */
export async function sharedUsageForAccount(db, userId, { fromDay, lastDay }) {
  const { rows } = await db.query(
    `SELECT feature AS key, provider, COUNT(DISTINCT day)::int AS days, SUM(requests)::int AS requests, SUM(failures)::int AS failures
     FROM shared_feature_usage WHERE user_id = $1 AND day BETWEEN $2::date AND $3::date
     GROUP BY 1, 2 ORDER BY days DESC, requests DESC, key, provider`,
    [userId, fromDay, lastDay],
  );
  return rows;
}

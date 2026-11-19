import { dayLabels } from '../admin/finance.js';
import { k } from '../i18n/index.js';

const FEATURE_USAGE_MIN_ACCOUNTS = 5;
const FEATURE_USAGE_SHARE_DAYS = 30;
export const FEATURE_USAGE_SHARE_HOURS = 24;

export const FEATURE_LABELS = {
  selection: k('划词翻译'), panel: k('翻译面板'), page: k('网页区域'), site: k('整站翻译'),
  image: k('图片翻译'), pdf: k('整份 PDF 翻译'), reader: k('双语阅读'), subtitle: k('视频字幕'), alternatives: k('其他译法'),
};

// 独立的识图接口只记录 kind，与图片工具发出的文字翻译归为同一功能。
const FEATURE = `CASE WHEN kind = 'image' THEN 'image' ELSE surface END`;
const CLASSIFIED = `status = 'ok' AND (surface IS NOT NULL OR kind = 'image')`;

export async function featureUsageRanking(db, { from, to }) {
  const { rows } = await db.query(
    `WITH classified AS (
       SELECT ${FEATURE} AS key, user_id
       FROM usage_events WHERE ${CLASSIFIED} AND created_at >= $1 AND created_at < $2
     )
     SELECT key, COUNT(*)::bigint AS requests, COUNT(DISTINCT user_id)::int AS accounts,
            (SELECT COUNT(DISTINCT user_id)::int FROM classified) AS active_accounts
     FROM classified GROUP BY key HAVING COUNT(DISTINCT user_id) >= $3
     ORDER BY accounts DESC, requests DESC, key`,
    [from, to, FEATURE_USAGE_MIN_ACCOUNTS],
  );
  return { rows, minAccounts: FEATURE_USAGE_MIN_ACCOUNTS, activeAccounts: rows[0]?.active_accounts || 0 };
}

/** 授权范围为之前完整的 30 个自然日，endDay 是不包含在内的今天。 */
function featureUsagePeriod(endDay, timeZone) {
  const day = new Date(`${endDay}T00:00:00Z`);
  const labels = dayLabels(FEATURE_USAGE_SHARE_DAYS, 'UTC', 1, day);
  return { fromDay: labels[0], lastDay: labels.at(-1), endDay, timeZone };
}

export function recentFeatureUsagePeriod(timeZone) {
  return featureUsagePeriod(dayLabels(1, timeZone)[0], timeZone);
}

export async function featureUsageForAccount(db, userId, period) {
  const { rows } = await db.query(
    `SELECT ${FEATURE} AS key, COUNT(*)::int AS requests
     FROM usage_events WHERE user_id = $1 AND ${CLASSIFIED}
       AND created_at >= ($2::date::timestamp AT TIME ZONE $4) AND created_at < ($3::date::timestamp AT TIME ZONE $4)
     GROUP BY 1 ORDER BY requests DESC, key`,
    [userId, period.fromDay, period.endDay, period.timeZone],
  );
  return rows;
}

export async function activeFeatureUsageShare(db, userId, { lock = false } = {}) {
  const { rows: [row] } = await db.query(
    `SELECT to_char(end_day, 'YYYY-MM-DD') AS end_day, time_zone, expires_at FROM feature_usage_shares
     WHERE user_id = $1 AND request_counts AND expires_at > clock_timestamp()${lock ? ' FOR SHARE' : ''}`,
    [userId],
  );
  return row ? { ...featureUsagePeriod(row.end_day, row.time_zone), expiresAt: row.expires_at } : null;
}

export function shareFeatureUsage(db, userId, { endDay, timeZone }) {
  return db.query(
    `INSERT INTO feature_usage_shares (user_id, end_day, time_zone, expires_at, request_counts)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4), true)
     ON CONFLICT (user_id) DO UPDATE SET end_day = EXCLUDED.end_day, time_zone = EXCLUDED.time_zone,
       expires_at = EXCLUDED.expires_at, request_counts = true`,
    [userId, endDay, timeZone, FEATURE_USAGE_SHARE_HOURS],
  );
}

export function revokeFeatureUsageShare(db, userId) {
  return db.query('DELETE FROM feature_usage_shares WHERE user_id = $1', [userId]);
}

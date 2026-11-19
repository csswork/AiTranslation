import { dayLabels } from '../admin/finance.js';

const FEATURE_USAGE_DAYS = 30;

export const FEATURE_LABELS = {
  selection: '划词翻译', panel: '翻译面板', page: '网页区域', site: '整站翻译',
  image: '图片翻译', pdf: '整份 PDF 翻译', reader: '双语阅读', subtitle: '视频字幕', alternatives: '其他译法',
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
     SELECT key, COUNT(*)::int AS requests, COUNT(DISTINCT user_id)::int AS accounts,
            (SELECT COUNT(DISTINCT user_id)::int FROM classified) AS active_accounts
     FROM classified GROUP BY key
     ORDER BY accounts DESC, requests DESC, key`,
    [from, to],
  );
  return { rows, activeAccounts: rows[0]?.active_accounts || 0 };
}

/** 查询范围为最近 30 个自然日（含今天），endDay 是今天的日期。 */
function featureUsagePeriod(endDay, timeZone) {
  const day = new Date(`${endDay}T00:00:00Z`);
  const labels = dayLabels(FEATURE_USAGE_DAYS, 'UTC', 0, day);
  return { fromDay: labels[0], lastDay: labels.at(-1), endDay, timeZone };
}

export function recentFeatureUsagePeriod(timeZone) {
  return featureUsagePeriod(dayLabels(1, timeZone)[0], timeZone);
}

export async function featureUsageForAccount(db, userId, period) {
  const { rows } = await db.query(
    `SELECT ${FEATURE} AS key, COUNT(*)::int AS requests
     FROM usage_events WHERE user_id = $1 AND ${CLASSIFIED}
       AND created_at >= ($2::date::timestamp AT TIME ZONE $4)
       AND created_at < (($3::date::timestamp AT TIME ZONE $4) + interval '1 day')
     GROUP BY 1 ORDER BY requests DESC, key`,
    [userId, period.fromDay, period.endDay, period.timeZone],
  );
  return rows;
}

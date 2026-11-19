import { dayLabels } from '../admin/finance.js';

const FEATURE_USAGE_DAYS = 30;

export const FEATURE_LABELS = {
  selection: '划词翻译', panel: '翻译面板', page: '网页区域', site: '整站翻译',
  image: '图片翻译', pdf: '整份 PDF 翻译', reader: '双语阅读', subtitle: '视频字幕', alternatives: '其他译法',
};

/** 2.3.0 及更早的扩展不上报功能类别，这些文字请求归入这一项，保证请求总数完整。 */
export const UNCLASSIFIED_FEATURE = 'unknown';
export const UNCLASSIFIED_LABEL = '未区分（旧版扩展）';

// 独立的识图接口只记录 kind，与图片工具发出的文字翻译归为同一功能。
const FEATURE = `CASE WHEN kind = 'image' THEN 'image' ELSE COALESCE(surface, '${UNCLASSIFIED_FEATURE}') END`;
const SUCCEEDED = `status = 'ok'`;

/**
 * 每个功能的使用人数与成功请求数：列出全部功能（没用过的为 0），
 * 已用的按人数、请求数排序，未区分的旧版请求放在最后。activeAccounts 是有成功请求的账户数。
 */
export async function featureUsageRanking(db, { from, to }) {
  const { rows } = await db.query(
    `WITH succeeded AS (
       SELECT ${FEATURE} AS key, user_id
       FROM usage_events WHERE ${SUCCEEDED} AND created_at >= $1 AND created_at < $2
     )
     SELECT key, COUNT(*)::int AS requests, COUNT(DISTINCT user_id)::int AS accounts,
            (SELECT COUNT(DISTINCT user_id)::int FROM succeeded) AS active_accounts
     FROM succeeded GROUP BY key`,
    [from, to],
  );
  const found = new Map(rows.map((row) => [row.key, row]));
  const order = Object.keys(FEATURE_LABELS);
  const features = order
    .map((key) => ({ key, requests: found.get(key)?.requests || 0, accounts: found.get(key)?.accounts || 0 }))
    .sort((a, b) => b.accounts - a.accounts || b.requests - a.requests || order.indexOf(a.key) - order.indexOf(b.key));
  const unclassified = found.get(UNCLASSIFIED_FEATURE);
  return {
    rows: unclassified ? [...features, { key: UNCLASSIFIED_FEATURE, requests: unclassified.requests, accounts: unclassified.accounts }] : features,
    activeAccounts: rows[0]?.active_accounts || 0,
  };
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
     FROM usage_events WHERE user_id = $1 AND ${SUCCEEDED}
       AND created_at >= ($2::date::timestamp AT TIME ZONE $4)
       AND created_at < (($3::date::timestamp AT TIME ZONE $4) + interval '1 day')
     GROUP BY 1 ORDER BY requests DESC, key`,
    [userId, period.fromDay, period.endDay, period.timeZone],
  );
  return rows;
}

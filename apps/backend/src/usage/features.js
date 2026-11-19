import { dayLabels } from '../admin/finance.js';

const FEATURE_USAGE_DAYS = 30;

export const FEATURE_LABELS = {
  selection: '划词翻译', panel: '翻译面板', page: '网页区域', site: '整站翻译',
  image: '图片翻译', pdf: '整份 PDF 翻译', reader: '双语阅读', subtitle: '视频字幕', alternatives: '其他译法',
};

/** 2.3.0 及更早的扩展不上报功能类别，这些请求归入这一项，保证总数完整。 */
export const UNCLASSIFIED_FEATURE = 'unknown';
export const UNCLASSIFIED_LABEL = '未区分（旧版扩展）';

/*
 * 计数口径：同一账户、同一功能、同一自然日（报表时区）只算 1 次「使用」。
 * - 使用：服务端接受并开始处理的托管请求，无论成功、失败或仍在处理；一次 PDF、整站翻译或图片翻译
 *   会发出多条请求（识图 + 翻译），按天去重后只算一次。
 * - 被拒：点数不足、限频、冻结等被拒绝的请求（usage_rejections）。只在当天这个功能没有任何「使用」时
 *   才计入「仅被拒」，不与使用重复计算。
 * - 访客合并进正式账户时，请求和被拒记录一起迁移，不会把同一个人算成两个账户。
 * 独立的识图接口只记录 kind = 'image'，与图片工具发出的文字翻译归为同一功能。
 */
const FEATURE = `CASE WHEN kind = 'image' THEN 'image' ELSE COALESCE(surface, '${UNCLASSIFIED_FEATURE}') END`;
const REJECTED_FEATURE = `COALESCE(surface, '${UNCLASSIFIED_FEATURE}')`;

/**
 * 各功能的使用天次（账户 × 自然日）、使用人数、请求数与仅被拒天次。列出全部功能（没用过的为 0），
 * 按使用天次、人数排序；未区分的旧版请求放在最后。activeAccounts 是有「使用」的账户数。
 */
export async function featureUsageRanking(db, { from, to, timeZone }) {
  const { rows } = await db.query(
    `WITH used AS (
       SELECT ${FEATURE} AS key, user_id, (created_at AT TIME ZONE $3)::date AS day, COUNT(*)::int AS requests
       FROM usage_events WHERE created_at >= $1 AND created_at < $2
       GROUP BY 1, 2, 3
     ), rejected AS (
       SELECT DISTINCT ${REJECTED_FEATURE} AS key, user_id, (created_at AT TIME ZONE $3)::date AS day
       FROM usage_rejections WHERE created_at >= $1 AND created_at < $2
     ), totals AS (
       SELECT key, COUNT(*)::int AS user_days, COUNT(DISTINCT user_id)::int AS accounts, SUM(requests)::int AS requests
       FROM used GROUP BY key
     ), blocked AS (
       SELECT r.key, COUNT(*)::int AS rejected_days FROM rejected r
       WHERE NOT EXISTS (SELECT 1 FROM used u WHERE u.key = r.key AND u.user_id = r.user_id AND u.day = r.day)
       GROUP BY r.key
     )
     SELECT COALESCE(t.key, b.key) AS key, COALESCE(t.user_days, 0) AS user_days, COALESCE(t.accounts, 0) AS accounts,
            COALESCE(t.requests, 0) AS requests, COALESCE(b.rejected_days, 0) AS rejected_days,
            (SELECT COUNT(DISTINCT user_id)::int FROM used) AS active_accounts
     FROM totals t FULL JOIN blocked b ON b.key = t.key`,
    [from, to, timeZone],
  );
  const found = new Map(rows.map((row) => [row.key, row]));
  const pick = (key) => {
    const row = found.get(key);
    return { key, userDays: row?.user_days || 0, accounts: row?.accounts || 0, requests: row?.requests || 0, rejectedDays: row?.rejected_days || 0 };
  };
  const order = Object.keys(FEATURE_LABELS);
  const features = order.map(pick)
    .sort((a, b) => b.userDays - a.userDays || b.accounts - a.accounts || b.rejectedDays - a.rejectedDays
      || order.indexOf(a.key) - order.indexOf(b.key));
  return {
    rows: found.has(UNCLASSIFIED_FEATURE) ? [...features, pick(UNCLASSIFIED_FEATURE)] : features,
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

/** 单个账户各功能的使用天数与请求数，口径同上。 */
export async function featureUsageForAccount(db, userId, period) {
  const { rows } = await db.query(
    `SELECT ${FEATURE} AS key, COUNT(DISTINCT (created_at AT TIME ZONE $4)::date)::int AS days, COUNT(*)::int AS requests
     FROM usage_events WHERE user_id = $1
       AND created_at >= ($2::date::timestamp AT TIME ZONE $4)
       AND created_at < (($3::date::timestamp AT TIME ZONE $4) + interval '1 day')
     GROUP BY 1 ORDER BY days DESC, requests DESC, key`,
    [userId, period.fromDay, period.endDay, period.timeZone],
  );
  return rows;
}

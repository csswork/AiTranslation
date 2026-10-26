/**
 * 运营报表（A2）：趋势、转化、构成、语言、国家、时段与性能。
 *
 * 口径：
 * - 时间按 REPORT_TIMEZONE（默认 Asia/Shanghai）切分到天和小时；指标与上一个等长周期对比。
 * - 收入是订单税前金额（未扣 Creem 费用、未计折扣），退款按税前折算；趋势与环比只看 USD，其他币种单列。
 * - 模型成本是按管理员设置的单价估算的值，与服务商账单分开标记；MRR 按价格展示估算。
 * - 国家只有两位代码（反向代理地理请求头或账单国家），语言是语言代码；不涉及原文译文。
 */

import { dayLabels, financeReport } from './finance.js';

const ENTITLED = ['active', 'trialing', 'paid', 'scheduled_cancel', 'past_due'];
const ACTIVE_SUB = `status = ANY($1) AND (current_period_end IS NULL OR current_period_end > now())`;

/** 当前周期与上一周期各算一次的核心指标。 */
async function periodTotals(db, from, to) {
  const { rows: [r] } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM guest_claims WHERE created_at >= $1 AND created_at < $2)::int AS installs,
       (SELECT COUNT(*) FROM users WHERE kind = 'member' AND created_at >= $1 AND created_at < $2)::int AS members,
       (SELECT COUNT(*) FROM subscriptions WHERE created_at >= $1 AND created_at < $2)::int AS subs,
       (SELECT COUNT(DISTINCT user_id) FROM usage_events WHERE status = 'ok' AND created_at >= $1 AND created_at < $2)::int AS active_users,
       (SELECT COUNT(*) FROM usage_events WHERE created_at >= $1 AND created_at < $2)::int AS requests,
       (SELECT COUNT(*) FROM usage_events WHERE status = 'failed' AND created_at >= $1 AND created_at < $2)::int AS failed,
       (SELECT COALESCE(SUM(chars), 0) FROM usage_events WHERE status = 'ok' AND created_at >= $1 AND created_at < $2)::bigint AS chars,
       (SELECT COALESCE(SUM(cost_micros), 0) FROM usage_events WHERE created_at >= $1 AND created_at < $2)::bigint AS cost_micros,
       (SELECT COALESCE(SUM(amount - refunded_amount), 0) FROM orders WHERE currency = 'USD' AND created_at >= $1 AND created_at < $2)::bigint AS revenue_usd`,
    [from, to],
  );
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
}

export async function overview(db, days, { settings = {}, timeZone = 'Asia/Shanghai' } = {}) {
  const now = new Date();
  const labels = dayLabels(days, timeZone, 0, now);
  const prevLabels = dayLabels(days, timeZone, days, now);
  // 汇总、每日趋势与财务报表共用自然日边界；由 PostgreSQL 处理时区及夏令时。
  const { rows: [bounds] } = await db.query(
    'SELECT $1::date::timestamp AT TIME ZONE $3 AS start, $2::date::timestamp AT TIME ZONE $3 AS previous',
    [labels[0], prevLabels[0], timeZone],
  );
  const from = bounds.start;
  const prevFrom = bounds.previous;
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const window = [from, now];

  const [current, previous, subsNow, daily, funnel, audiences, providers, targetLangs, sourceLangs, uiLangs, browsers,
    installCountries, usageCountries, revenueCountries, revenue, heat, latency, sizes, outcomes, errors, topUsers] = await Promise.all([
    periodTotals(db, from, now),
    periodTotals(db, prevFrom, from),
    q(`SELECT plan, COUNT(*)::int AS n FROM subscriptions WHERE ${ACTIVE_SUB} GROUP BY plan`, [ENTITLED]),
    q(`WITH d AS (
         SELECT generate_series(date_trunc('day', now() AT TIME ZONE $2) - make_interval(days => $1 - 1),
                                date_trunc('day', now() AT TIME ZONE $2), interval '1 day') AS day
       )
       SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
         (SELECT COUNT(*) FROM guest_claims g WHERE date_trunc('day', g.created_at AT TIME ZONE $2) = d.day)::int AS installs,
         (SELECT COUNT(*) FROM users u WHERE u.kind = 'member' AND date_trunc('day', u.created_at AT TIME ZONE $2) = d.day)::int AS members,
         (SELECT COUNT(*) FROM subscriptions s WHERE date_trunc('day', s.created_at AT TIME ZONE $2) = d.day)::int AS subs,
         (SELECT COUNT(DISTINCT e.user_id) FROM usage_events e WHERE e.status = 'ok' AND date_trunc('day', e.created_at AT TIME ZONE $2) = d.day)::int AS active_users,
         (SELECT COUNT(*) FROM usage_events e WHERE date_trunc('day', e.created_at AT TIME ZONE $2) = d.day)::int AS requests,
         (SELECT COUNT(*) FROM usage_events e WHERE e.status = 'failed' AND date_trunc('day', e.created_at AT TIME ZONE $2) = d.day)::int AS failed,
         (SELECT COALESCE(SUM(e.chars), 0) FROM usage_events e WHERE e.status = 'ok' AND date_trunc('day', e.created_at AT TIME ZONE $2) = d.day)::bigint AS chars,
         (SELECT COALESCE(SUM(e.cost_micros), 0) FROM usage_events e WHERE date_trunc('day', e.created_at AT TIME ZONE $2) = d.day)::bigint AS cost_micros,
         (SELECT COALESCE(SUM(o.amount - o.refunded_amount), 0) FROM orders o WHERE o.currency = 'USD' AND date_trunc('day', o.created_at AT TIME ZONE $2) = d.day)::bigint AS revenue_usd
       FROM d ORDER BY d.day`, [days, timeZone]),
    // 转化漏斗：这段时间安装的访客里，有多少用过托管翻译、注册、订阅（访客合并后按转成的正式账户算）。
    q(`WITH c AS (SELECT COALESCE(merged_user_id, user_id) AS uid, merged_user_id FROM guest_claims WHERE created_at >= $1 AND created_at < $2)
       SELECT COUNT(*)::int AS installs,
         COUNT(*) FILTER (WHERE uid IS NOT NULL AND EXISTS (SELECT 1 FROM usage_events e WHERE e.user_id = c.uid AND e.status = 'ok'))::int AS used,
         COUNT(*) FILTER (WHERE merged_user_id IS NOT NULL)::int AS registered,
         COUNT(*) FILTER (WHERE merged_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = c.merged_user_id))::int AS subscribed
       FROM c`, window),
    q(`SELECT COALESCE(audience, 'member') AS key, COUNT(*)::int AS requests, COUNT(DISTINCT user_id)::int AS users,
              COALESCE(SUM(chars) FILTER (WHERE status = 'ok'), 0)::bigint AS chars, COALESCE(SUM(cost_micros), 0)::bigint AS cost_micros
       FROM usage_events WHERE created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY requests DESC`, window),
    q(`SELECT CASE WHEN error = 'primary_failed' THEN 'fallback' WHEN status = 'failed' THEN 'failed' ELSE 'primary' END AS key,
              COUNT(*)::int AS requests, COALESCE(SUM(cost_micros), 0)::bigint AS cost_micros
       FROM usage_events WHERE created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY requests DESC`, window),
    q(`SELECT target_lang AS key, COUNT(*)::int AS requests, COUNT(DISTINCT user_id)::int AS users, COALESCE(SUM(chars), 0)::bigint AS chars
       FROM usage_events WHERE status = 'ok' AND target_lang IS NOT NULL AND created_at >= $1 AND created_at < $2
       GROUP BY 1 ORDER BY requests DESC LIMIT 12`, window),
    q(`SELECT COALESCE(source_lang, 'auto') AS key, COUNT(*)::int AS requests
       FROM usage_events WHERE status = 'ok' AND target_lang IS NOT NULL AND created_at >= $1 AND created_at < $2
       GROUP BY 1 ORDER BY requests DESC LIMIT 12`, window),
    q(`SELECT ui_lang AS key, COUNT(*)::int AS installs FROM guest_claims
       WHERE ui_lang IS NOT NULL AND created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY installs DESC LIMIT 12`, window),
    // 安装来源：按扩展 ID 区分商店（迁移 012 之前的记录为空，显示为未记录）。
    q(`SELECT extension_id AS key, COUNT(*)::int AS installs, COUNT(*) FILTER (WHERE merged_user_id IS NOT NULL)::int AS registered
       FROM guest_claims WHERE created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY installs DESC`, window),
    q(`SELECT country AS key, COUNT(*)::int AS installs, COUNT(*) FILTER (WHERE merged_user_id IS NOT NULL)::int AS registered
       FROM guest_claims WHERE country IS NOT NULL AND created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY installs DESC`, window),
    q(`SELECT country AS key, COUNT(*)::int AS requests, COUNT(DISTINCT user_id)::int AS users, COALESCE(SUM(cost_micros), 0)::bigint AS cost_micros
       FROM usage_events WHERE country IS NOT NULL AND created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY requests DESC`, window),
    q(`SELECT country AS key, COUNT(*)::int AS orders, COALESCE(SUM(amount - refunded_amount), 0)::bigint AS revenue
       FROM orders WHERE currency = 'USD' AND country IS NOT NULL AND created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY revenue DESC`, window),
    q(`SELECT currency, COUNT(*)::int AS orders, COALESCE(SUM(amount), 0)::bigint AS gross, COALESCE(SUM(refunded_amount), 0)::bigint AS refunded
       FROM orders WHERE created_at >= $1 AND created_at < $2 GROUP BY currency ORDER BY gross DESC`, window),
    // 星期 × 小时的请求分布（ISO 星期：1 = 周一）。
    q(`SELECT EXTRACT(ISODOW FROM created_at AT TIME ZONE $3)::int AS dow, EXTRACT(HOUR FROM created_at AT TIME ZONE $3)::int AS hour, COUNT(*)::int AS n
       FROM usage_events WHERE created_at >= $1 AND created_at < $2 GROUP BY 1, 2`, [...window, timeZone]),
    q(`SELECT
         (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms))::int AS p50,
         (PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY latency_ms))::int AS p90,
         (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms))::int AS p95,
         (PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms))::int AS p99,
         COUNT(*) FILTER (WHERE latency_ms < 1000)::int AS b1,
         COUNT(*) FILTER (WHERE latency_ms >= 1000 AND latency_ms < 2000)::int AS b2,
         COUNT(*) FILTER (WHERE latency_ms >= 2000 AND latency_ms < 4000)::int AS b3,
         COUNT(*) FILTER (WHERE latency_ms >= 4000 AND latency_ms < 8000)::int AS b4,
         COUNT(*) FILTER (WHERE latency_ms >= 8000)::int AS b5
       FROM usage_events WHERE status = 'ok' AND latency_ms IS NOT NULL AND created_at >= $1 AND created_at < $2`, window),
    q(`SELECT
         COUNT(*) FILTER (WHERE chars <= 50)::int AS b1,
         COUNT(*) FILTER (WHERE chars > 50 AND chars <= 200)::int AS b2,
         COUNT(*) FILTER (WHERE chars > 200 AND chars <= 500)::int AS b3,
         COUNT(*) FILTER (WHERE chars > 500 AND chars <= 2000)::int AS b4,
         COUNT(*) FILTER (WHERE chars > 2000)::int AS b5
       FROM usage_events WHERE status = 'ok' AND created_at >= $1 AND created_at < $2`, window),
    q(`SELECT outcome AS key, COUNT(*)::int AS n, COALESCE(SUM(granted_units), 0)::text AS credit_units
       FROM guest_claims WHERE created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY n DESC`, window),
    q(`SELECT error AS key, COUNT(*)::int AS n FROM usage_events
       WHERE error IS NOT NULL AND created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY n DESC LIMIT 8`, window),
    q(`SELECT e.user_id, u.username, u.kind,
              (ARRAY_AGG(e.audience ORDER BY e.created_at DESC))[1] AS audience,
              COUNT(*)::int AS requests, SUM(e.chars)::bigint AS chars, COALESCE(SUM(e.cost_micros), 0)::bigint AS cost_micros
       FROM usage_events e JOIN users u ON u.id = e.user_id
       WHERE e.status = 'ok' AND e.created_at >= $1 AND e.created_at < $2
       GROUP BY e.user_id, u.username, u.kind ORDER BY chars DESC LIMIT 10`, window),
  ]);

  const rejectionQuery = (a, b) => q(
    `SELECT reason AS key, COUNT(*)::int AS n, COUNT(DISTINCT user_id)::int AS users
     FROM usage_rejections WHERE created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY n DESC`, [a, b],
  );
  const [rejections, prevRejections] = await Promise.all([rejectionQuery(from, now), rejectionQuery(prevFrom, from)]);

  const plans = Object.fromEntries(subsNow.map((r) => [r.plan || 'unknown', r.n]));
  const activeSubs = subsNow.reduce((n, r) => n + r.n, 0);
  const monthly = Number(settings.price_monthly || 0);
  const yearly = Number(settings.price_yearly || 0);
  // MRR（月经常性收入）按价格展示估算：月付按月价，年付折成月均。
  const mrrCents = Math.round(((plans.monthly || 0) * monthly + (plans.yearly || 0) * yearly / 12) * 100);
  const subscriberCost = Number(audiences.find((a) => a.key === 'subscriber')?.cost_micros || 0);
  const finance = await financeReport(db, {
    labels,
    prevLabels,
    timeZone,
    settings,
  });

  return {
    days,
    timeZone,
    current,
    previous,
    subs: { active: activeSubs, plans, mrrCents },
    daily: daily.map((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k === 'day' ? v : Number(v)]))),
    funnel: funnel[0],
    audiences,
    providers,
    targetLangs,
    sourceLangs,
    uiLangs,
    browsers,
    countries: { installs: installCountries, usage: usageCountries, revenue: revenueCountries },
    revenue,
    heat,
    latency: latency[0],
    sizes: sizes[0],
    outcomes,
    errors,
    topUsers,
    finance,
    rejections,
    prevRejectionCount: prevRejections.reduce((n, r) => n + r.n, 0),
    costPerSubscriberMicros: activeSubs && subscriberCost ? Math.round(subscriberCost / activeSubs) : null,
  };
}

/**
 * 每位用户的 API 用量（托管翻译）：成功、失败、被拒次数，字数、token、估算成本与最近使用时间。
 * days 为 null 时统计全部时间。sort: cost | requests | chars | tokens | rejected | last。
 */
export async function apiUsageByUser(db, { days = 30, q = '', sort = 'cost', limit = 200 } = {}) {
  const order = {
    cost: 'cost_micros DESC', requests: 'ok + failed DESC', chars: 'chars DESC', tokens: 'input_tokens + output_tokens DESC',
    rejected: 'rejected DESC', last: 'last_used DESC',
  }[sort] || 'cost_micros DESC';
  const term = String(q || '').trim().toLowerCase().slice(0, 254);
  const { rows } = await db.query(
    `WITH ev AS (
       SELECT user_id,
         COUNT(*) FILTER (WHERE status = 'ok')::int AS ok,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COALESCE(SUM(chars) FILTER (WHERE status = 'ok'), 0)::bigint AS chars,
         COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
         COALESCE(SUM(cached_tokens), 0)::bigint AS cached_tokens,
         COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
         COALESCE(SUM(cost_micros), 0)::bigint AS cost_micros,
         COALESCE(SUM(cost_units) FILTER (WHERE status = 'ok'), 0)::text AS credit_units,
         MAX(created_at) AS last_event,
         (ARRAY_AGG(audience ORDER BY created_at DESC))[1] AS audience
       FROM usage_events WHERE $1::int IS NULL OR created_at > now() - make_interval(days => $1::int) GROUP BY user_id
     ), rj AS (
       SELECT user_id, COUNT(*)::int AS rejected, MAX(created_at) AS last_rejection
       FROM usage_rejections WHERE $1::int IS NULL OR created_at > now() - make_interval(days => $1::int) GROUP BY user_id
     ), merged AS (
       SELECT COALESCE(ev.user_id, rj.user_id) AS user_id,
         COALESCE(ev.ok, 0) AS ok, COALESCE(ev.failed, 0) AS failed, COALESCE(rj.rejected, 0) AS rejected,
         COALESCE(ev.chars, 0) AS chars, COALESCE(ev.input_tokens, 0) AS input_tokens, COALESCE(ev.cached_tokens, 0) AS cached_tokens,
         COALESCE(ev.output_tokens, 0) AS output_tokens, COALESCE(ev.cost_micros, 0) AS cost_micros, COALESCE(ev.credit_units, '0') AS credit_units,
         GREATEST(ev.last_event, rj.last_rejection) AS last_used, ev.audience
       FROM ev FULL OUTER JOIN rj ON rj.user_id = ev.user_id
     )
     SELECT m.*, u.username, u.kind, u.email, u.hosted_frozen_at
     FROM merged m JOIN users u ON u.id = m.user_id
     WHERE $2 = '' OR u.email = $2 OR u.username LIKE $3 OR u.id::text = $2
     ORDER BY ${order} NULLS LAST, m.user_id LIMIT $4`,
    [days, term, `%${term.replace(/[%_\\]/g, '\\$&')}%`, limit],
  );
  const users = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^\d+$/.test(v) && !['username', 'credit_units'].includes(k) ? Number(v) : v])));
  const totals = users.reduce((t, u) => {
    for (const k of ['ok', 'failed', 'rejected', 'chars', 'input_tokens', 'cached_tokens', 'output_tokens', 'cost_micros']) t[k] = (t[k] || 0) + u[k];
    return t;
  }, { users: users.length });
  return { users, totals };
}

/** 单个用户的 API 消耗汇总：近 days 天与全部时间，按模型拆分，以及最近的被拒记录。 */
export async function apiUsageForUser(db, userId, days = 30) {
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const summary = (since) => q(
    `SELECT COUNT(*) FILTER (WHERE status = 'ok')::int AS ok, COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
            COALESCE(SUM(chars) FILTER (WHERE status = 'ok'), 0)::bigint AS chars,
            COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens, COALESCE(SUM(cached_tokens), 0)::bigint AS cached_tokens,
            COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens, COALESCE(SUM(cost_micros), 0)::bigint AS cost_micros,
            (SELECT COUNT(*) FROM usage_rejections r WHERE r.user_id = $1 AND ($2::int IS NULL OR r.created_at > now() - make_interval(days => $2::int)))::int AS rejected,
            MIN(created_at) AS first_used, MAX(created_at) AS last_used
     FROM usage_events WHERE user_id = $1 AND ($2::int IS NULL OR created_at > now() - make_interval(days => $2::int))`,
    [userId, since],
  );
  const [[recent], [all], models, rejections] = await Promise.all([
    summary(days),
    summary(null),
    q(`SELECT provider, model, COUNT(*)::int AS requests, COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
              COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens, COALESCE(SUM(cost_micros), 0)::bigint AS cost_micros
       FROM usage_events WHERE user_id = $1 AND provider IS NOT NULL GROUP BY provider, model ORDER BY requests DESC`, [userId]),
    q(`SELECT reason, chars, cost_units, target_lang, created_at FROM usage_rejections WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [userId]),
  ]);
  const numbers = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v]));
  return { days, recent: numbers(recent), all: numbers(all), models: models.map(numbers), rejections };
}

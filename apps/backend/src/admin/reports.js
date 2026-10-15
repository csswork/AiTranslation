/**
 * 运营报表（A2）：用户与转化、订阅、收入、托管用量与模型成本。
 * 收入按订单金额（税前、未扣支付平台费用、未计折扣）统计，保留币种；模型成本是按单价设置的估算值，
 * 与服务商的已核对账单分开标记。所有数字只来自元数据，不涉及原文译文。
 */

const ENTITLED = ['active', 'trialing', 'paid', 'scheduled_cancel', 'past_due'];

export async function overview(db, days) {
  const params = [days];
  const since = `now() - make_interval(days => $1)`;
  const one = async (sql, extra = []) => (await db.query(sql, [...params, ...extra])).rows[0];
  const many = async (sql, extra = []) => (await db.query(sql, [...params, ...extra])).rows;

  const [users, guests, subs, revenue, usage, audiences, daily, topUsers, totals] = await Promise.all([
    one(`SELECT
           COUNT(*) FILTER (WHERE created_at > ${since})::int AS new_members
         FROM users WHERE kind = 'member'`),
    one(`SELECT
           COUNT(*)::int AS installs,
           COUNT(*) FILTER (WHERE outcome = 'granted')::int AS granted,
           COUNT(*) FILTER (WHERE outcome = 'ip_limited')::int AS ip_limited,
           COUNT(*) FILTER (WHERE outcome = 'daily_cap')::int AS daily_cap,
           COUNT(*) FILTER (WHERE outcome = 'reinstall')::int AS reinstall,
           COUNT(*) FILTER (WHERE outcome = 'claimed_member')::int AS claimed_member,
           COUNT(*) FILTER (WHERE merged_user_id IS NOT NULL)::int AS converted,
           COALESCE(SUM(granted), 0)::int AS credits_granted
         FROM guest_claims WHERE created_at > ${since}`),
    one(`SELECT
           COUNT(*) FILTER (WHERE status = ANY($2) AND (current_period_end IS NULL OR current_period_end > now()))::int AS active,
           COUNT(*) FILTER (WHERE status = ANY($2) AND (current_period_end IS NULL OR current_period_end > now()) AND plan = 'monthly')::int AS active_monthly,
           COUNT(*) FILTER (WHERE status = ANY($2) AND (current_period_end IS NULL OR current_period_end > now()) AND plan = 'yearly')::int AS active_yearly,
           COUNT(*) FILTER (WHERE created_at > ${since})::int AS new_subs,
           COUNT(*) FILTER (WHERE status IN ('canceled', 'scheduled_cancel', 'expired') AND updated_at > ${since})::int AS churned,
           COUNT(*) FILTER (WHERE status IN ('past_due', 'unpaid'))::int AS payment_issues
         FROM subscriptions`, [ENTITLED]),
    many(`SELECT currency, COUNT(*)::int AS orders, COALESCE(SUM(amount), 0)::bigint AS gross,
                 COALESCE(SUM(refunded_amount), 0)::bigint AS refunded
          FROM orders WHERE created_at > ${since} GROUP BY currency ORDER BY gross DESC`),
    one(`SELECT
           COUNT(*)::int AS requests,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
           COUNT(*) FILTER (WHERE error = 'primary_failed')::int AS fallback,
           COALESCE(SUM(chars) FILTER (WHERE status = 'ok'), 0)::bigint AS chars,
           COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
           COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
           COALESCE(SUM(cost_micros), 0)::bigint AS cost_micros,
           COALESCE(SUM(cost) FILTER (WHERE status = 'ok'), 0)::bigint AS credits_used,
           ROUND(AVG(latency_ms) FILTER (WHERE status = 'ok'))::int AS avg_latency,
           (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE status = 'ok'))::int AS p95_latency
         FROM usage_events WHERE created_at > ${since}`),
    many(`SELECT COALESCE(audience, 'member') AS audience, COUNT(*)::int AS requests,
                 COUNT(DISTINCT user_id)::int AS users,
                 COALESCE(SUM(chars) FILTER (WHERE status = 'ok'), 0)::bigint AS chars,
                 COALESCE(SUM(cost_micros), 0)::bigint AS cost_micros
          FROM usage_events WHERE created_at > ${since} GROUP BY 1 ORDER BY 1`),
    many(`WITH d AS (
            SELECT generate_series(date_trunc('day', now()) - make_interval(days => $1 - 1), date_trunc('day', now()), interval '1 day') AS day
          )
          SELECT d.day,
            (SELECT COUNT(*) FROM guest_claims g WHERE date_trunc('day', g.created_at) = d.day)::int AS installs,
            (SELECT COUNT(*) FROM users u WHERE u.kind = 'member' AND date_trunc('day', u.created_at) = d.day)::int AS members,
            (SELECT COUNT(*) FROM subscriptions s WHERE date_trunc('day', s.created_at) = d.day)::int AS subs,
            (SELECT COALESCE(SUM(o.amount - o.refunded_amount), 0) FROM orders o WHERE o.currency = 'USD' AND date_trunc('day', o.created_at) = d.day)::bigint AS revenue_usd,
            (SELECT COUNT(*) FROM usage_events e WHERE date_trunc('day', e.created_at) = d.day)::int AS requests,
            (SELECT COALESCE(SUM(e.chars), 0) FROM usage_events e WHERE e.status = 'ok' AND date_trunc('day', e.created_at) = d.day)::bigint AS chars,
            (SELECT COALESCE(SUM(e.cost_micros), 0) FROM usage_events e WHERE date_trunc('day', e.created_at) = d.day)::bigint AS cost_micros,
            (SELECT COUNT(*) FROM usage_events e WHERE e.status = 'failed' AND date_trunc('day', e.created_at) = d.day)::int AS failed
          FROM d ORDER BY d.day DESC`),
    many(`SELECT e.user_id, u.username, u.kind, COALESCE(e_aud.audience, u.kind) AS audience,
                 COUNT(*)::int AS requests, SUM(e.chars)::bigint AS chars, COALESCE(SUM(e.cost_micros), 0)::bigint AS cost_micros
          FROM usage_events e
          JOIN users u ON u.id = e.user_id
          LEFT JOIN LATERAL (SELECT audience FROM usage_events x WHERE x.user_id = e.user_id ORDER BY created_at DESC LIMIT 1) e_aud ON true
          WHERE e.created_at > ${since} AND e.status = 'ok'
          GROUP BY e.user_id, u.username, u.kind, e_aud.audience
          ORDER BY chars DESC LIMIT 15`),
    one(`SELECT
           (SELECT COUNT(*) FROM users WHERE kind = 'member')::int AS members,
           (SELECT COUNT(*) FROM users WHERE kind = 'guest')::int AS guests
         FROM (SELECT $1::int) AS _`),
  ]);

  const subscriberCost = audiences.find((a) => a.audience === 'subscriber');
  return {
    days,
    users,
    guests,
    subs,
    revenue,
    usage,
    audiences,
    daily,
    topUsers,
    totals,
    // 每位活跃订阅用户在这段时间的平均估算成本，用来判断定价与隐藏上限是否合适。
    costPerSubscriberMicros: subs.active && subscriberCost ? Math.round(Number(subscriberCost.cost_micros) / subs.active) : null,
  };
}

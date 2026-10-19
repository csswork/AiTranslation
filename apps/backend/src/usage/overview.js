/** 用户自己的托管用量总览。按 UTC 天聚合；点数始终保留整数额度，仅在视图展示时换算。 */
export async function usageOverview(db, userId, { period = 'month', kind = 'all', now = new Date() } = {}) {
  period = ['month', '7d', '30d'].includes(period) ? period : 'month';
  kind = ['all', 'text', 'image'].includes(kind) ? kind : 'all';
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(today);
  if (period === 'month') from.setUTCDate(1);
  else from.setUTCDate(from.getUTCDate() - (period === '7d' ? 6 : 29));
  const { rows } = await db.query(
    `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
            COUNT(*)::text AS requests,
            COALESCE(SUM(cost_units) FILTER (WHERE status = 'ok'), 0)::text AS credits_units,
            COALESCE(SUM(chars) FILTER (WHERE status = 'ok'), 0)::text AS chars,
            COALESCE(SUM(input_tokens), 0)::text AS input,
            COALESCE(SUM(output_tokens), 0)::text AS output
     FROM usage_events
     WHERE user_id = $1 AND created_at >= $2 AND created_at <= $3
       AND status IN ('ok', 'failed') AND ($4::text = 'all' OR kind = $4)
     GROUP BY 1 ORDER BY 1`,
    [userId, from, now, kind],
  );
  const fields = ['requests', 'credits_units', 'chars', 'input', 'output'];
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const totals = Object.fromEntries(fields.map((field) => [field, 0n]));
  const days = [];
  for (let date = new Date(from); date <= today; date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.toISOString().slice(0, 10);
    const values = Object.fromEntries(fields.map((field) => [field, BigInt(byDay.get(day)?.[field] || 0)]));
    for (const field of fields) totals[field] += values[field];
    days.push({ day, ...values });
  }
  return { period, kind, from, to: now, totals, days };
}

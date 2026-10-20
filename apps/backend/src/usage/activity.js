/** 点数收入与支出分别读取，图表直接聚合全部记录，不受明细条数限制。 */
import { usagePeriod } from './period.js';

export const INCOME_TYPES = ['trial_grant', 'guest_grant', 'transfer', 'adjust', 'refund'];
const FIELDS = ['spent_units', 'usage_units', 'void_units', 'requests', 'ok', 'failed', 'pending', 'chars'];

// userId 必须由路由明确传入；只有管理端可显式传 null 读取全局数据。
export async function creditActivity(db, userId, { period = 'month', now = new Date(), incomeType = '', limit = 100 } = {}) {
  if (userId === undefined || userId === '') throw new Error('missing_activity_user');
  const range = usagePeriod(period, now);
  incomeType = INCOME_TYPES.includes(incomeType) ? incomeType : '';
  limit = Number.isInteger(limit) ? Math.min(300, Math.max(1, limit)) : 100;
  const scope = [userId, range.from, now];
  const [income, expenses, events, ledgerDays, requestDays] = await Promise.all([
    db.query(
      `SELECT l.user_id, u.username, l.entry_type, l.amount_units, l.expires_at, l.reason, l.created_at
       FROM credit_ledger l JOIN users u ON u.id = l.user_id
       WHERE ($1::uuid IS NULL OR l.user_id = $1) AND l.amount_units > 0
         AND ($2 = '' OR l.entry_type = $2)
       ORDER BY l.created_at DESC, l.id DESC LIMIT $3`, [userId, incomeType, limit]),
    db.query(
      `SELECT l.user_id, u.username, l.entry_type, l.amount_units, l.reason, l.created_at
       FROM credit_ledger l JOIN users u ON u.id = l.user_id
       WHERE ($1::uuid IS NULL OR l.user_id = $1) AND l.amount_units < 0
         AND l.created_at >= $2 AND l.created_at <= $3
       ORDER BY l.created_at DESC, l.id DESC LIMIT $4`, [...scope, limit]),
    db.query(
      `SELECT e.user_id, u.username, e.kind, e.audience, e.chars, e.cost_units, e.model,
              e.input_tokens, e.output_tokens, e.cost_micros, e.latency_ms, e.target_lang, e.status, e.error, e.created_at
       FROM usage_events e JOIN users u ON u.id = e.user_id
       WHERE ($1::uuid IS NULL OR e.user_id = $1) AND e.created_at >= $2 AND e.created_at <= $3
       ORDER BY e.created_at DESC, e.id DESC LIMIT $4`, [...scope, limit]),
    db.query(
      `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              SUM(-amount_units)::text AS spent_units,
              COALESCE(SUM(-amount_units) FILTER (WHERE entry_type = 'usage'), 0)::text AS usage_units,
              COALESCE(SUM(-amount_units) FILTER (WHERE entry_type <> 'usage'), 0)::text AS void_units
       FROM credit_ledger
       WHERE ($1::uuid IS NULL OR user_id = $1) AND amount_units < 0 AND created_at >= $2 AND created_at <= $3
       GROUP BY 1 ORDER BY 1`, scope),
    db.query(
      `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              COUNT(*)::text AS requests,
              COUNT(*) FILTER (WHERE status = 'ok')::text AS ok,
              COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
              COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
              COALESCE(SUM(chars), 0)::text AS chars
       FROM usage_events
       WHERE ($1::uuid IS NULL OR user_id = $1) AND created_at >= $2 AND created_at <= $3
       GROUP BY 1 ORDER BY 1`, scope),
  ]);
  const byDay = new Map();
  for (const row of [...ledgerDays.rows, ...requestDays.rows]) byDay.set(row.day, { ...byDay.get(row.day), ...row });
  const totals = Object.fromEntries(FIELDS.map((field) => [field, 0n]));
  const days = [];
  for (let date = new Date(range.from); date <= range.today; date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.toISOString().slice(0, 10);
    const values = Object.fromEntries(FIELDS.map((field) => [field, BigInt(byDay.get(day)?.[field] || 0)]));
    for (const field of FIELDS) totals[field] += values[field];
    days.push({ day, ...values });
  }
  return { ...range, incomeType, limit, income: income.rows, expenses: expenses.rows, events: events.rows, totals, days };
}

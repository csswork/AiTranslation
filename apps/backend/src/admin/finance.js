/**
 * 收支与 API 消耗（A2）。
 *
 * 收入：订单税前金额（USD）减退款；首期与续费按同一订阅是否已有更早订单区分。
 * 支出：
 *   - 模型 API：默认按用量估算（usage_events.cost_micros）；设置 api_cost_source = bills 时改用录入的模型 API 账单，
 *     估算值只作参考。两者不会同时计入，避免重复。
 *   - 支付手续费：按设置的比例 + 每笔固定费用估算。
 *   - 其他：管理员录入的支出。一次性的记在当天；按月、按年的按天分摊（月 = 年 / 12，年按 365 天）。
 * 所有金额以美元分为单位（小数保留到分以下，展示时再取整）；天按 REPORT_TIMEZONE 切分。
 */

export const EXPENSE_CATEGORIES = {
  server: '服务器',
  domain: '域名',
  mail: '发信服务',
  model_api: '模型 API 账单',
  payment: '支付平台费用（账单）',
  marketing: '推广营销',
  tools: '软件与工具',
  other: '其他',
};
export const RECURRING = { none: '一次性', monthly: '每月', yearly: '每年' };

const DAY_MS = 86400_000;
const isoDay = (date) => date.toISOString().slice(0, 10);

/** 报表时区里的「今天」往前 days 天（含今天），返回 YYYY-MM-DD 列表。endOffset 用来取上一周期。 */
export function dayLabels(days, timeZone, endOffset = 0, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const end = new Date(`${today}T00:00:00Z`).getTime() - endOffset * DAY_MS;
  return Array.from({ length: days }, (_, i) => isoDay(new Date(end - (days - 1 - i) * DAY_MS)));
}

export async function listExpenses(db) {
  const { rows } = await db.query(
    `SELECT e.id, e.category, e.amount_cents, e.recurring, to_char(e.start_date, 'YYYY-MM-DD') AS start_date,
            to_char(e.end_date, 'YYYY-MM-DD') AS end_date, e.note, e.created_at, u.email AS created_by
     FROM expenses e LEFT JOIN users u ON u.id = e.created_by
     WHERE e.deleted_at IS NULL ORDER BY e.start_date DESC, e.created_at DESC`,
  );
  return rows;
}

/** 校验并规范录入的支出；无效时返回 null。 */
export function parseExpense(body) {
  const category = String(body.category || '');
  const recurring = String(body.recurring || 'none');
  const amount = String(body.amount || '').trim();
  const start = String(body.start_date || '');
  const end = String(body.end_date || '');
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!EXPENSE_CATEGORIES[category] || !RECURRING[recurring]) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return null;
  if (!day.test(start) || (end && (!day.test(end) || end < start))) return null;
  return {
    category,
    recurring,
    amountCents: Math.round(Number(amount) * 100),
    startDate: start,
    endDate: recurring === 'none' ? null : end || null,
    note: String(body.note || '').trim().slice(0, 200) || null,
  };
}

/** 把支出分摊到给定的每一天：返回 { [day]: { [category]: cents } }。 */
export function allocateExpenses(expenses, labels) {
  const byDay = Object.fromEntries(labels.map((d) => [d, {}]));
  const add = (day, category, cents) => { byDay[day][category] = (byDay[day][category] || 0) + cents; };
  for (const e of expenses) {
    if (e.recurring === 'none') {
      if (byDay[e.start_date]) add(e.start_date, e.category, e.amount_cents);
      continue;
    }
    const perDay = e.recurring === 'monthly' ? (e.amount_cents * 12) / 365 : e.amount_cents / 365;
    for (const day of labels) {
      if (day >= e.start_date && (!e.end_date || day <= e.end_date)) add(day, e.category, perDay);
    }
  }
  return byDay;
}

/**
 * 收支、利润与 API 消耗。labels / prevLabels 是本期与上期的日期列表（报表时区）。
 * 返回的金额都是美元分（可能带小数）。
 */
export async function financeReport(db, { labels, prevLabels, timeZone, settings }) {
  const first = prevLabels[0];
  const last = labels[labels.length - 1];
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const range = [first, last, timeZone];
  const inRange = `(created_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date`;

  const [orders, usageDaily, models, tokensDaily, expenses] = await Promise.all([
    // 订单：区分首期与续费（同一订阅已有更早的订单即为续费）。
    q(`SELECT to_char(o.created_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day, o.plan, o.amount, o.refunded_amount, o.user_id,
              EXISTS (SELECT 1 FROM orders p WHERE p.provider_subscription_id = o.provider_subscription_id
                        AND o.provider_subscription_id IS NOT NULL AND p.created_at < o.created_at) AS renewal
       FROM orders o WHERE o.currency = 'USD' AND (o.created_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date`, range),
    q(`SELECT to_char(created_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day, COALESCE(SUM(cost_micros), 0)::bigint AS cost_micros
       FROM usage_events WHERE ${inRange} GROUP BY 1`, range),
    // 按服务商与模型的 API 消耗（只统计本期）。
    q(`SELECT provider, model, COUNT(*)::int AS requests, COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
              COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens, COALESCE(SUM(cached_tokens), 0)::bigint AS cached_tokens,
              COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens, COALESCE(SUM(cost_micros), 0)::bigint AS cost_micros,
              COALESCE(SUM(chars) FILTER (WHERE status = 'ok'), 0)::bigint AS chars, ROUND(AVG(latency_ms))::int AS latency
       FROM usage_events WHERE provider IS NOT NULL AND (created_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
       GROUP BY provider, model ORDER BY cost_micros DESC`, [labels[0], last, timeZone]),
    q(`SELECT to_char(created_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(input_tokens - COALESCE(cached_tokens, 0)), 0)::bigint AS input_tokens,
              COALESCE(SUM(cached_tokens), 0)::bigint AS cached_tokens, COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens
       FROM usage_events WHERE (created_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date GROUP BY 1`, [labels[0], last, timeZone]),
    q(`SELECT category, amount_cents, recurring, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date
       FROM expenses
       WHERE deleted_at IS NULL AND start_date <= $2::date AND (recurring <> 'none' OR start_date >= $1::date)
         AND (end_date IS NULL OR end_date >= $1::date)`, [first, last]),
  ]);

  const feePct = Number(settings.payment_fee_percent || 0) / 100;
  const feeFixed = Number(settings.payment_fee_fixed || 0) * 100;
  const useBills = settings.api_cost_source === 'bills';
  const allocated = allocateExpenses(expenses, [...prevLabels, ...labels]);
  const usageByDay = new Map(usageDaily.map((r) => [r.day, Number(r.cost_micros) / 10_000]));

  /** 某一天的收入与各项支出（美元分）。 */
  const dayFigures = (day) => {
    const dayOrders = orders.filter((o) => o.day === day);
    const gross = dayOrders.reduce((n, o) => n + o.amount, 0);
    const refunded = dayOrders.reduce((n, o) => n + o.refunded_amount, 0);
    const manual = allocated[day] || {};
    const apiEstimate = usageByDay.get(day) || 0;
    const apiBills = manual.model_api || 0;
    const fees = dayOrders.length * feeFixed + gross * feePct;
    const other = Object.entries(manual).filter(([k]) => k !== 'model_api').reduce((n, [, v]) => n + v, 0);
    const api = useBills ? apiBills : apiEstimate;
    return {
      day,
      gross,
      refunded,
      net: gross - refunded,
      newNet: dayOrders.filter((o) => !o.renewal).reduce((n, o) => n + o.amount - o.refunded_amount, 0),
      renewalNet: dayOrders.filter((o) => o.renewal).reduce((n, o) => n + o.amount - o.refunded_amount, 0),
      orders: dayOrders.length,
      api,
      apiEstimate,
      apiBills,
      fees,
      other,
      manual,
      expenses: api + fees + other,
    };
  };
  const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);
  const current = labels.map(dayFigures);
  const previous = prevLabels.map(dayFigures);
  const totals = (rows) => {
    const t = Object.fromEntries(['gross', 'refunded', 'net', 'newNet', 'renewalNet', 'orders', 'api', 'apiEstimate', 'apiBills', 'fees', 'other', 'expenses']
      .map((k) => [k, sum(rows, k)]));
    t.profit = t.net - t.expenses;
    t.margin = t.net > 0 ? t.profit / t.net : null;
    return t;
  };

  // 本期支出按类别汇总（模型 API 按当前口径只计一份）。
  const byCategory = {};
  for (const d of current) {
    for (const [k, v] of Object.entries(d.manual)) if (k !== 'model_api') byCategory[k] = (byCategory[k] || 0) + v;
  }
  const curOrders = orders.filter((o) => o.day >= labels[0]);
  const payers = new Set(curOrders.filter((o) => o.user_id).map((o) => o.user_id)).size;
  const byPlan = ['monthly', 'yearly'].map((plan) => {
    const rows = curOrders.filter((o) => o.plan === plan);
    return { plan, orders: rows.length, net: rows.reduce((n, o) => n + o.amount - o.refunded_amount, 0) };
  }).filter((p) => p.orders);

  const tokensByDay = new Map(tokensDaily.map((r) => [r.day, r]));
  return {
    useBills,
    current: totals(current),
    previous: totals(previous),
    daily: current,
    byCategory,
    byPlan,
    payers,
    api: {
      models: models.map((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v]))),
      tokens: labels.map((day) => ({
        day,
        input: Number(tokensByDay.get(day)?.input_tokens || 0),
        cached: Number(tokensByDay.get(day)?.cached_tokens || 0),
        output: Number(tokensByDay.get(day)?.output_tokens || 0),
      })),
    },
  };
}

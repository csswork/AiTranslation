/**
 * 用量与点数账本的自然日范围。用户端按 UTC；管理端传入 REPORT_TIMEZONE，与运营报表同一口径。
 * today / from 是该时区日期（YYYY-MM-DD）的 UTC 零点，只用来生成日期标签；
 * 查询边界用 fromDay 交给 PostgreSQL 按时区换算（含夏令时）。
 */
export function usagePeriod(period = 'month', now = new Date(), timeZone = 'UTC') {
  period = ['month', '7d', '30d'].includes(period) ? period : 'month';
  const todayDay = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const today = new Date(`${todayDay}T00:00:00Z`);
  const from = new Date(today);
  if (period === 'month') from.setUTCDate(1);
  else from.setUTCDate(from.getUTCDate() - (period === '7d' ? 6 : 29));
  return { period, timeZone, today, from, fromDay: from.toISOString().slice(0, 10), to: now };
}

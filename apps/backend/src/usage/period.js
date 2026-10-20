/** 用户端与点数账本共用 UTC 自然日范围。 */
export function usagePeriod(period = 'month', now = new Date()) {
  period = ['month', '7d', '30d'].includes(period) ? period : 'month';
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(today);
  if (period === 'month') from.setUTCDate(1);
  else from.setUTCDate(from.getUTCDate() - (period === '7d' ? 6 : 29));
  return { period, today, from, to: now };
}

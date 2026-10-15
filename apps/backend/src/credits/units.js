/** 内部额度只用整数：1 单位 = 1 个 Unicode 字符，固定 500 单位 = 1 展示点数。 */
export const UNITS_PER_CREDIT = 500n;

/** 管理员配置的点数最多两位小数，转换不经过浮点乘法。 */
export function creditsToUnits(value) {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(String(value ?? '').trim());
  if (!match) throw new Error('invalid_credits');
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
  return cents * (UNITS_PER_CREDIT / 100n);
}

/** 只在展示边界舍入；返回十进制字符串，不把舍入值用于计费。 */
export function displayCredits(units, { signed = false } = {}) {
  const value = BigInt(units ?? 0);
  const magnitude = value < 0n ? -value : value;
  const cents = (magnitude * 100n + UNITS_PER_CREDIT / 2n) / UNITS_PER_CREDIT;
  const sign = value < 0n && cents > 0n ? '-' : signed && value > 0n ? '+' : '';
  return `${sign}${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

export const creditView = (units) => ({ balance: displayCredits(units), available: BigInt(units) > 0n });

/** 不按 UTF-16 码元重复计费：一个补充平面字符（例如 emoji）也是一个字符。 */
export function countCharacters(texts) {
  let count = 0;
  for (const text of texts) for (const _ of text) count++;
  return count;
}

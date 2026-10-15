/**
 * 可调运营规则（管理员界面 A4、A7 修改）。值保存在 app_settings，未设置时使用环境变量或代码默认值。
 * 服务端每次判断都从这里读取，缓存几秒；修改后立即清缓存。
 *
 * 金额（价格、模型单价）用字符串保存的十进制数，避免浮点误差；模型单价单位是「美元 / 每百万 token」。
 */

import { creditsToUnits, displayCredits } from '../credits/units.js';

const MONEY = /^\d{1,7}(\.\d{1,4})?$/;

/** 设置项定义：key、类型、分组、说明（管理员界面只用中文）、默认值（可取自 config）。 */
export const SETTINGS = [
  { key: 'guest_credits', type: 'credits', group: 'trial', label: '访客赠送点数', help: '支持两位小数，后台换算为精确额度；不过期', def: (c) => displayCredits(creditsToUnits(c.guestCredits)) },
  { key: 'signup_credits', type: 'credits', group: 'trial', label: '注册赠送点数', help: '支持两位小数；访客的精确剩余额度另外转入', def: (c) => displayCredits(creditsToUnits(c.trialCredits)) },
  { key: 'guest_ip_limit', type: 'int', group: 'trial', label: '同一网络领取次数上限', help: '同一 IP（IPv6 按 /64）在统计周期内最多领取访客点数的次数', def: () => 3 },
  { key: 'guest_ip_window_days', type: 'int', group: 'trial', label: '同一网络统计周期（天）', def: () => 30 },
  { key: 'guest_daily_cap', type: 'int', group: 'trial', label: '每日访客领取总量', help: '最近 24 小时内全站最多发放访客点数的次数；0 表示暂停发放', def: () => 2000 },

  { key: 'hosted_enabled', type: 'bool', group: 'hosted', label: '启用托管文字翻译', def: () => true },
  { key: 'hosted_max_chars', type: 'int', group: 'hosted', label: '单次请求最多字数', def: (c) => c.hostedMaxChars, min: 1 },
  { key: 'subscriber_monthly_chars', type: 'int', group: 'hosted', label: '订阅用户每月字数上限（隐藏）', help: '界面显示无限使用；超过后返回「本月用量较高，请稍后再试」。0 表示不限制', def: () => 0 },

  { key: 'price_currency', type: 'text', group: 'pricing', label: '展示币种', def: () => 'USD' },
  { key: 'price_monthly', type: 'money', group: 'pricing', label: '月付现价', help: '只用于展示；实际扣款以 Creem 商品价格为准，两边需保持一致', def: () => '3.99' },
  { key: 'price_monthly_original', type: 'money', group: 'pricing', label: '月付原价（划线价）', help: '留空不显示。只有过去确实按这个价格卖过才能填，否则可能被认定为虚假信息', def: () => '', optional: true },
  { key: 'price_yearly', type: 'money', group: 'pricing', label: '年付现价', def: () => '29.99' },
  { key: 'price_yearly_original', type: 'money', group: 'pricing', label: '年付原价（划线价）', help: '留空不显示', def: () => '', optional: true },

  { key: 'cost_primary_input', type: 'money', group: 'cost', label: '主力模型输入单价', help: '美元 / 百万 token，用于成本估算', def: () => '0.30' },
  { key: 'cost_primary_cached', type: 'money', group: 'cost', label: '主力模型缓存命中输入单价', def: () => '0.006' },
  { key: 'cost_primary_output', type: 'money', group: 'cost', label: '主力模型输出单价', def: () => '1.20' },
  { key: 'cost_fallback_input', type: 'money', group: 'cost', label: '备用模型输入单价', def: () => '0.45' },
  { key: 'cost_fallback_cached', type: 'money', group: 'cost', label: '备用模型缓存命中输入单价', def: () => '0.009' },
  { key: 'cost_fallback_output', type: 'money', group: 'cost', label: '备用模型输出单价', def: () => '1.80' },

  { key: 'payment_fee_percent', type: 'money', group: 'finance', label: '支付手续费比例（%）', help: '按每笔订单估算支付平台费用；请按 Creem 账户的实际费率填写', def: () => '3.9' },
  { key: 'payment_fee_fixed', type: 'money', group: 'finance', label: '支付手续费每笔固定（USD）', def: () => '0.40' },
  {
    key: 'api_cost_source', type: 'choice', group: 'finance', label: '利润表的模型成本', def: () => 'estimate',
    options: [['estimate', '按用量估算'], ['bills', '按录入的模型 API 账单']],
    help: '选「账单」时，利润表用「收支」里录入的模型 API 支出，估算值只作参考',
  },
];

export const SETTING_GROUPS = [
  { key: 'trial', label: '试用与访客' },
  { key: 'hosted', label: '托管翻译' },
  { key: 'pricing', label: '价格展示' },
  { key: 'cost', label: '模型成本单价' },
  { key: 'finance', label: '收支口径' },
];

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

/** 把表单或 JSON 里的值规范成对应类型；无效时返回 undefined。 */
export function parseSetting(key, raw) {
  const def = BY_KEY.get(key);
  if (!def) return undefined;
  const text = String(raw ?? '').trim();
  switch (def.type) {
    case 'credits':
      return /^\d{1,9}(\.\d{1,2})?$/.test(text) ? displayCredits(creditsToUnits(text)) : undefined;
    case 'int': {
      if (!/^\d{1,9}$/.test(text)) return undefined;
      const n = Number(text);
      return n >= (def.min ?? 0) ? n : undefined;
    }
    case 'bool':
      return raw === true || text === 'true' || text === 'on' || text === '1';
    case 'money':
      if (!text && def.optional) return '';
      return MONEY.test(text) ? text : undefined;
    case 'text':
      return /^[A-Z]{3}$/.test(text) ? text : undefined;
    case 'choice':
      return def.options.some(([value]) => value === text) ? text : undefined;
    default:
      return undefined;
  }
}

export function createSettings(pool, config, { ttlMs = 5_000 } = {}) {
  let cache = null;
  let loadedAt = 0;

  const defaults = () => Object.fromEntries(SETTINGS.map((s) => [s.key, s.def(config)]));

  async function all() {
    if (cache && Date.now() - loadedAt < ttlMs) return cache;
    const { rows } = await pool.query('SELECT key, value FROM app_settings');
    const values = defaults();
    for (const row of rows) {
      if (!BY_KEY.has(row.key)) continue;
      const parsed = parseSetting(row.key, row.value);
      if (parsed !== undefined) values[row.key] = parsed;
    }
    cache = values;
    loadedAt = Date.now();
    return values;
  }

  /** 修改一项设置；返回旧值与新值。无效值抛错。调用方负责写审计。 */
  async function set(key, raw, adminId = null) {
    const value = parseSetting(key, raw);
    if (value === undefined) throw new Error(`invalid_setting:${key}`);
    const before = (await all())[key];
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, JSON.stringify(value), adminId],
    );
    cache = null;
    return { before, after: value };
  }

  return { all, set, defaults, clear: () => { cache = null; } };
}

/** 按每百万 token 单价估算一次请求的成本，单位百万分之一美元（整数）。 */
export function estimateCostMicros(settings, providerKey, { inputTokens = 0, cachedTokens = 0, outputTokens = 0 } = {}) {
  const price = (name) => Number(settings[`cost_${providerKey}_${name}`] || 0);
  const uncached = Math.max(0, inputTokens - cachedTokens);
  // 单价是美元 / 1,000,000 token，成本以 1/1,000,000 美元为单位：两者正好抵消。
  return Math.round(uncached * price('input') + cachedTokens * price('cached') + outputTokens * price('output'));
}

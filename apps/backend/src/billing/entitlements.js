/**
 * 订阅权益：以已验签的支付回调写入的订阅状态为准，客户端显示的内容不作为依据。
 * 订阅用户托管翻译不扣点（界面显示「无限使用」），用量照常记录；管理员可设隐藏的每月字数上限。
 */
import { creditSummary } from '../credits/ledger.js';

// 可以使用的订阅状态。scheduled_cancel 在本期结束前仍有效；past_due 在扣款重试期间、本期结束前保留权益。
const ENTITLED = ['active', 'trialing', 'paid', 'scheduled_cancel', 'past_due'];

/** 当前有效的订阅（没有则 null）。 */
export async function activeSubscription(db, userId) {
  const { rows: [row] } = await db.query(
    `SELECT plan, status, current_period_end, provider_customer_id
     FROM subscriptions
     WHERE user_id = $1 AND status = ANY($2)
       AND (current_period_end IS NULL OR current_period_end > now())
     ORDER BY current_period_end DESC NULLS FIRST
     LIMIT 1`,
    [userId, ENTITLED],
  );
  return row || null;
}

/** 最近一条订阅记录（含已取消），用户端账单页显示和打开 Creem 客户门户用。 */
export async function latestSubscription(db, userId) {
  const { rows: [row] } = await db.query(
    `SELECT plan, status, current_period_end, canceled_at, provider_customer_id, updated_at
     FROM subscriptions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  );
  return row || null;
}

export const subscriptionView = (sub) => (sub
  ? {
    plan: sub.plan,
    status: sub.status,
    unlimited: true,
    renews: sub.status !== 'scheduled_cancel',
    periodEnd: sub.current_period_end,
  }
  : null);

/** 扩展、官网和用户端共用的账户状态：用户类型、点数余额与订阅。 */
export async function accountState(db, user) {
  const [credits, sub] = await Promise.all([
    creditSummary(db, user.id),
    user.kind === 'member' ? activeSubscription(db, user.id) : null,
  ]);
  return {
    kind: user.kind,
    credits: { balance: credits.balance },
    subscription: subscriptionView(sub),
    frozen: Boolean(user.hosted_frozen_at),
  };
}

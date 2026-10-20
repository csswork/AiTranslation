/**
 * 管理员删除用户：删除账号及其名下数据。
 *
 * 随账号一起删除（外键 ON DELETE CASCADE）：登录方式绑定、邮箱验证码、网页与扩展会话、扩展授权码、
 * 访客关联码、点数账本、托管请求与被拒记录。该邮箱尚未使用的验证码按邮箱另行删除。
 * 保留但解除关联（ON DELETE SET NULL）：订阅与订单（收入与对账，只含平台对象 ID 与金额）、
 * 访客领取记录与浏览器标记（只有带密钥的哈希，用于防止删除后重复领取试用）。
 *
 * 管理员账号与仍有有效订阅的用户不能删除：管理员由命令行管理；有效订阅需先在 Creem 取消，
 * 否则支付平台会继续扣款。
 */
import { activeSubscription } from '../billing/entitlements.js';
import { transaction } from '../db/index.js';

const count = async (db, sql, id) => (await db.query(sql, [id])).rows[0].n;

/** 删除前的确认信息：会删除和会保留的数据数量，以及不能删除的原因（null 表示可以删除）。 */
export async function deletionSummary(db, user) {
  const [isAdmin, subscription, removed, kept] = await Promise.all([
    count(db, 'SELECT COUNT(*)::int AS n FROM admins WHERE user_id = $1', user.id),
    activeSubscription(db, user.id),
    Promise.all([
      count(db, 'SELECT COUNT(*)::int AS n FROM identities WHERE user_id = $1', user.id),
      count(db, 'SELECT COUNT(*)::int AS n FROM sessions WHERE user_id = $1', user.id),
      count(db, 'SELECT COUNT(*)::int AS n FROM credit_ledger WHERE user_id = $1', user.id),
      count(db, 'SELECT COUNT(*)::int AS n FROM usage_events WHERE user_id = $1', user.id),
      count(db, 'SELECT COUNT(*)::int AS n FROM usage_rejections WHERE user_id = $1', user.id),
    ]),
    Promise.all([
      count(db, 'SELECT COUNT(*)::int AS n FROM subscriptions WHERE user_id = $1', user.id),
      count(db, 'SELECT COUNT(*)::int AS n FROM orders WHERE user_id = $1', user.id),
      count(db, 'SELECT COUNT(*)::int AS n FROM guest_claims WHERE user_id = $1 OR merged_user_id = $1', user.id),
      count(db, 'SELECT COUNT(*)::int AS n FROM browser_marks WHERE user_id = $1', user.id),
    ]),
  ]);
  const [identities, sessions, ledger, usage, rejections] = removed;
  const [subscriptions, orders, guestClaims, browserMarks] = kept;
  return {
    blocked: isAdmin ? 'admin' : subscription ? 'subscription' : null,
    removed: { identities, sessions, ledger, usage, rejections },
    kept: { subscriptions, orders, guestClaims, browserMarks },
  };
}

/**
 * 在一个事务里删除用户。返回删除前的数量（写入审计）；用户不存在或不能删除时返回 { blocked }。
 * 先锁住用户行再检查，避免与登录、支付回调并发时漏掉新写入的数据。
 */
export async function deleteUser(pool, userId) {
  return transaction(pool, async (client) => {
    const { rows: [user] } = await client.query('SELECT id, kind, email FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!user) return { blocked: 'missing' };
    const summary = await deletionSummary(client, user);
    if (summary.blocked) return summary;
    if (user.email) await client.query('DELETE FROM email_codes WHERE email = $1', [user.email]);
    await client.query('DELETE FROM users WHERE id = $1', [user.id]);
    return { ...summary, kind: user.kind };
  });
}

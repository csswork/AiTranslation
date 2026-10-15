/**
 * 点数账本。只追加记录，余额由服务端按账本汇总，客户端显示的数字不作为授权依据。
 *
 * 发放（trial_grant 注册、guest_grant 访客、transfer 访客转入、adjust 管理员补发）是正数，
 * 目前都不过期（字段保留到期时间）；扣点（usage）、返还（refund）和作废（void）都记在某一笔发放上（grant_id）。余额 = 未过期发放各自的「发放额 + 其扣点与返还」之和，
 * 所以发放过期后剩下的点数一起失效，不会出现负余额。
 */

import { creditsToUnits } from './units.js';

/** 发放一笔不过期的整数额度；同一 idempotency_key 只入账一次。 */
async function grant(db, userId, entryType, amount, key, reason = null) {
  if (!amount) return;
  await db.query(
    `INSERT INTO credit_ledger (user_id, entry_type, amount_units, idempotency_key, reason)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [userId, entryType, amount, key, reason],
  );
}

/** 注册赠送：每个账号只发一次，绑定新的登录方式不会再领。 */
export const grantTrial = (db, amount, userId) => grant(db, userId, 'trial_grant', creditsToUnits(amount), `trial:${userId}`);

/** 访客赠送：每个访客账户只发一次。 */
export const grantGuest = (db, amount, userId) => grant(db, userId, 'guest_grant', creditsToUnits(amount), `guest:${userId}`);

/** 管理员补发（A6）：必须填写原因；requestId 防止重复提交。 */
export const adjustCredits = (db, { userId, amount, reason, requestId }) => {
  const units = creditsToUnits(amount);
  if (units <= 0n || !reason) throw new Error('invalid_adjustment');
  return grant(db, userId, 'adjust', units, `adjust:${requestId}`, reason);
};

/** 未过期的发放及各自剩余点数，按到期时间先后（先用快到期的）。 */
async function activeGrants(db, userId) {
  const { rows } = await db.query(
    `SELECT g.id, g.expires_at, (g.amount_units + COALESCE(SUM(d.amount_units), 0))::text AS remaining_units
     FROM credit_ledger g
     LEFT JOIN credit_ledger d ON d.grant_id = g.id
     WHERE g.user_id = $1 AND g.grant_id IS NULL AND g.amount_units > 0
       AND (g.expires_at IS NULL OR g.expires_at > now())
     GROUP BY g.id
     ORDER BY g.expires_at NULLS LAST, g.created_at`,
    [userId],
  );
  return rows.map((row) => ({ ...row, remaining_units: BigInt(row.remaining_units) }));
}

export async function creditBalance(db, userId) {
  return (await activeGrants(db, userId)).reduce((sum, g) => sum + (g.remaining_units > 0n ? g.remaining_units : 0n), 0n);
}

export async function creditSummary(db, userId) {
  const { rows: [trial] } = await db.query(
    `SELECT 1 FROM credit_ledger WHERE user_id = $1 AND entry_type IN ('trial_grant', 'guest_grant') LIMIT 1`,
    [userId],
  );
  return { balance: await creditBalance(db, userId), trialGranted: Boolean(trial) };
}

/** 作废一个账户全部发放的剩余点数（例如同一浏览器重复领取的访客点数），写入 void 记录。 */
export async function voidRemaining(db, userId, reason) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`credits:${userId}`]);
  for (const g of await activeGrants(db, userId)) {
    if (g.remaining_units <= 0n) continue;
    await db.query(
      `INSERT INTO credit_ledger (user_id, entry_type, amount_units, grant_id, idempotency_key, reason)
       VALUES ($1, 'void', $2, $3, $4, $5)`,
      [userId, -g.remaining_units, g.id, `void:${g.id}:${Date.now()}`, reason],
    );
  }
}

/** 访客合并进正式账户：把访客剩余点数作为一笔 transfer 转入，每个访客只转一次。 */
export async function transferGuestCredits(db, guestId, memberId) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`credits:${guestId}`]);
  const remaining = await creditBalance(db, guestId);
  await grant(db, memberId, 'transfer', remaining, `transfer:${guestId}`);
  return remaining;
}

/**
 * 为一次托管请求预扣点数，必须在事务里调用（client 来自 transaction）。
 * 同一用户的预扣串行执行；余额不足返回 false，不写任何记录。
 */
export async function reserveCredits(client, userId, cost, usageEventId) {
  if (typeof cost !== 'bigint' || cost < 0n) throw new Error('invalid_credit_units');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`credits:${userId}`]);
  if (cost === 0n) return true;
  const grants = (await activeGrants(client, userId)).filter((g) => g.remaining_units > 0n);
  if (grants.reduce((sum, g) => sum + g.remaining_units, 0n) < cost) return false;
  let left = cost;
  for (const [index, grant] of grants.entries()) {
    if (!left) break;
    const take = left < grant.remaining_units ? left : grant.remaining_units;
    left -= take;
    await client.query(
      `INSERT INTO credit_ledger (user_id, entry_type, amount_units, grant_id, usage_event_id, idempotency_key)
       VALUES ($1, 'usage', $2, $3, $4, $5)`,
      [userId, -take, grant.id, usageEventId, `usage:${usageEventId}:${index}`],
    );
  }
  return true;
}

/** 托管请求失败：按原扣点逐笔返还到原来的发放上；重复调用不会重复返还。 */
export async function refundCredits(db, usageEventId) {
  await db.query(
    `INSERT INTO credit_ledger (user_id, entry_type, amount_units, grant_id, usage_event_id, idempotency_key)
     SELECT user_id, 'refund', -amount_units, grant_id, usage_event_id, 'refund:' || id
     FROM credit_ledger WHERE usage_event_id = $1 AND entry_type = 'usage'
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [usageEventId],
  );
}

export async function ledgerEntries(db, userId, limit = 100) {
  const { rows } = await db.query(
    `SELECT entry_type, amount_units, expires_at, reason, created_at
     FROM credit_ledger WHERE user_id = $1 ORDER BY created_at DESC, entry_type LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

export async function usageEvents(db, userId, limit = 100) {
  const { rows } = await db.query(
    `SELECT kind, audience, chars, cost_units, status, created_at
     FROM usage_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

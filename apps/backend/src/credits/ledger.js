/**
 * 点数账本。只追加记录，余额由服务端按账本汇总，客户端显示的数字不作为授权依据。
 *
 * 发放（trial_grant，以后还有购买）是正数，可带到期时间；扣点（usage）和返还（refund）
 * 都记在某一笔发放上（grant_id）。余额 = 未过期发放各自的「发放额 + 其扣点与返还」之和，
 * 所以发放过期后剩下的点数一起失效，不会出现负余额。
 */

/** 每个账号只发一次试用点数；重复调用由 idempotency_key 去重。 */
export async function grantTrial(db, config, userId) {
  if (!config.trialCredits) return;
  await db.query(
    `INSERT INTO credit_ledger (user_id, entry_type, amount, expires_at, idempotency_key)
     VALUES ($1, 'trial_grant', $2,
             CASE WHEN $3::int > 0 THEN now() + make_interval(days => $3::int) END,
             $4)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [userId, config.trialCredits, config.trialDays, `trial:${userId}`],
  );
}

/** 未过期的发放及各自剩余点数，按到期时间先后（先用快到期的）。 */
async function activeGrants(db, userId) {
  const { rows } = await db.query(
    `SELECT g.id, g.expires_at, (g.amount + COALESCE(SUM(d.amount), 0))::int AS remaining
     FROM credit_ledger g
     LEFT JOIN credit_ledger d ON d.grant_id = g.id
     WHERE g.user_id = $1 AND g.grant_id IS NULL AND g.amount > 0
       AND (g.expires_at IS NULL OR g.expires_at > now())
     GROUP BY g.id
     ORDER BY g.expires_at NULLS LAST, g.created_at`,
    [userId],
  );
  return rows;
}

export async function creditSummary(db, userId) {
  const grants = await activeGrants(db, userId);
  const { rows: [trial] } = await db.query(
    `SELECT expires_at FROM credit_ledger WHERE user_id = $1 AND entry_type = 'trial_grant'`,
    [userId],
  );
  return {
    balance: grants.reduce((sum, g) => sum + Math.max(0, g.remaining), 0),
    trialGranted: Boolean(trial),
    trialExpiresAt: trial?.expires_at || null,
  };
}

/**
 * 为一次托管请求预扣点数，必须在事务里调用（client 来自 transaction）。
 * 同一用户的预扣串行执行；余额不足返回 false，不写任何记录。
 */
export async function reserveCredits(client, userId, cost, usageEventId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`credits:${userId}`]);
  if (cost <= 0) return true;
  const grants = (await activeGrants(client, userId)).filter((g) => g.remaining > 0);
  if (grants.reduce((sum, g) => sum + g.remaining, 0) < cost) return false;
  let left = cost;
  for (const [index, grant] of grants.entries()) {
    if (!left) break;
    const take = Math.min(left, grant.remaining);
    left -= take;
    await client.query(
      `INSERT INTO credit_ledger (user_id, entry_type, amount, grant_id, usage_event_id, idempotency_key)
       VALUES ($1, 'usage', $2, $3, $4, $5)`,
      [userId, -take, grant.id, usageEventId, `usage:${usageEventId}:${index}`],
    );
  }
  return true;
}

/** 托管请求失败：按原扣点逐笔返还到原来的发放上；重复调用不会重复返还。 */
export async function refundCredits(db, usageEventId) {
  await db.query(
    `INSERT INTO credit_ledger (user_id, entry_type, amount, grant_id, usage_event_id, idempotency_key)
     SELECT user_id, 'refund', -amount, grant_id, usage_event_id, 'refund:' || id
     FROM credit_ledger WHERE usage_event_id = $1 AND entry_type = 'usage'
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [usageEventId],
  );
}

export async function ledgerEntries(db, userId, limit = 100) {
  const { rows } = await db.query(
    `SELECT entry_type, amount, expires_at, created_at
     FROM credit_ledger WHERE user_id = $1 ORDER BY created_at DESC, entry_type LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

export async function usageEvents(db, userId, limit = 100) {
  const { rows } = await db.query(
    `SELECT kind, chars, cost, status, created_at
     FROM usage_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

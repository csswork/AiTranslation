/**
 * 点数账本。只追加记录，余额由服务端按账本汇总，客户端显示的数字不作为授权依据。
 * 第一批只有注册试用发放；预扣、结算、返还随托管翻译接入。
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

export async function creditSummary(db, userId) {
  const { rows: [row] } = await db.query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE expires_at IS NULL OR expires_at > now()), 0)::int AS balance,
       MAX(expires_at) FILTER (WHERE entry_type = 'trial_grant') AS trial_expires_at,
       BOOL_OR(entry_type = 'trial_grant') AS trial_granted
     FROM credit_ledger WHERE user_id = $1`,
    [userId],
  );
  return {
    balance: row.balance,
    trialGranted: Boolean(row.trial_granted),
    trialExpiresAt: row.trial_expires_at,
  };
}

export async function ledgerEntries(db, userId, limit = 100) {
  const { rows } = await db.query(
    `SELECT entry_type, amount, expires_at, created_at
     FROM credit_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

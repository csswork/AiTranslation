/** 限期审核账号：仅命令行建立普通用户，凭据不进入 URL、日志或数据库明文。 */
import { createHash, randomBytes } from 'node:crypto';
import { transaction } from '../db/index.js';
import { audit } from '../admin/auth.js';
import { adjustCredits } from '../credits/ledger.js';
import { isValidEmail, isValidUsername, normalizeEmail, normalizeUsername } from './users.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const validCredential = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

export async function provisionReviewAccess(pool, { email: rawEmail, username: rawUsername, days = 30, credits = '1000.00', credential = randomBytes(32).toString('base64url') }) {
  const email = normalizeEmail(rawEmail);
  const username = normalizeUsername(rawUsername);
  if (!isValidEmail(email) || !isValidUsername(username) || !username.startsWith('review_')
      || !Number.isInteger(days) || days < 1 || days > 30 || !validCredential(credential)) throw new Error('Invalid review account parameters');
  const result = await transaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`review:${email}`]);
    const { rows: [existing] } = await db.query(
      `SELECT u.id, u.username, r.user_id AS review_id, a.user_id AS admin_id
       FROM users u LEFT JOIN review_access r ON r.user_id = u.id LEFT JOIN admins a ON a.user_id = u.id
       WHERE u.email = $1`, [email],
    );
    // 不能给既有客户或管理员新增免邮箱登录方式。
    if (existing && (!existing.review_id || existing.admin_id || existing.username !== username)) throw new Error('Existing account is not this review account');
    const userId = existing?.id || (await db.query(
      'INSERT INTO users (email, username) VALUES ($1, $2) RETURNING id', [email, username],
    )).rows[0].id;
    const { rows: [access] } = await db.query(
      `INSERT INTO review_access (user_id, credential_hash, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))
       ON CONFLICT (user_id) DO UPDATE SET credential_hash = EXCLUDED.credential_hash,
         expires_at = EXCLUDED.expires_at, revoked_at = NULL, last_used_at = NULL
       RETURNING expires_at`, [userId, hash(credential), days],
    );
    await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
    // 审核额度是一次性运营赠送，轮换凭据不重复发放，也不伪造支付或订阅。
    await adjustCredits(db, { userId, amount: credits, reason: 'Microsoft Edge certification review', requestId: `review:${userId}` });
    await audit(db, { action: existing ? 'review.rotate' : 'review.create', targetType: 'user', targetId: userId, reason: 'cli' });
    return { userId, email, username, expiresAt: access.expires_at };
  });
  return { ...result, credential };
}

export async function verifyReviewAccess(db, rawEmail, credential) {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email) || !validCredential(credential)) return null;
  const { rows: [row] } = await db.query(
    `UPDATE review_access r SET last_used_at = now() FROM users u
     WHERE r.user_id = u.id AND u.email = $1 AND u.kind = 'member' AND r.credential_hash = $2
       AND r.revoked_at IS NULL AND r.expires_at > now()
       AND NOT EXISTS (SELECT 1 FROM admins a WHERE a.user_id = u.id)
     RETURNING r.user_id`, [email, hash(credential)],
  );
  return row?.user_id || null;
}

export async function revokeReviewAccess(pool, rawEmail) {
  return transaction(pool, async (db) => {
    const { rows: [row] } = await db.query(
      `UPDATE review_access r SET revoked_at = now() FROM users u
       WHERE r.user_id = u.id AND u.email = $1 RETURNING r.user_id`, [normalizeEmail(rawEmail)],
    );
    if (!row) throw new Error('Review account not found');
    await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [row.user_id]);
    await audit(db, { action: 'review.revoke', targetType: 'user', targetId: row.user_id, reason: 'cli' });
  });
}

/**
 * 管理员权限与会话（A1）。管理员由命令行指定（scripts/admin.mjs），普通用户注册不会获得管理权限。
 * 登录：管理员邮箱验证码（独立用途 admin_login）→ TOTP 二步验证（首次登录时绑定）。
 * 管理员会话独立于用户会话：只用于管理端主机，令牌只存哈希，12 小时有效，二步验证通过前不能访问任何管理页面。
 */
import { createHash, randomBytes } from 'node:crypto';

const SESSION_HOURS = 12;
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export async function findAdminByEmail(db, email) {
  const { rows: [row] } = await db.query(
    `SELECT u.id, u.email, u.username, a.totp_secret, a.totp_enabled_at, a.totp_last_step
     FROM admins a JOIN users u ON u.id = a.user_id WHERE u.email = $1 AND u.kind = 'member'`,
    [email],
  );
  return row || null;
}

export async function createAdminSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  await db.query(`DELETE FROM admin_sessions WHERE user_id = $1 AND (revoked_at IS NOT NULL OR expires_at <= now())`, [userId]);
  await db.query(
    `INSERT INTO admin_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [userId, hashToken(token), SESSION_HOURS],
  );
  return token;
}

/** 返回 { session, admin }；verified 表示已通过二步验证。 */
export async function validateAdminSession(db, token) {
  if (!token || token.length > 100) return null;
  const { rows: [row] } = await db.query(
    `SELECT s.id AS session_id, s.verified_at, u.id, u.email, u.username, a.totp_secret, a.totp_enabled_at, a.totp_last_step
     FROM admin_sessions s
     JOIN admins a ON a.user_id = s.user_id
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [hashToken(token)],
  );
  if (!row) return null;
  const { session_id: id, verified_at: verifiedAt, ...admin } = row;
  return { session: { id, verified: Boolean(verifiedAt) }, admin };
}

export const markVerified = (db, sessionId) => db.query('UPDATE admin_sessions SET verified_at = now() WHERE id = $1', [sessionId]);
export const revokeAdminSession = (db, sessionId) => db.query('UPDATE admin_sessions SET revoked_at = now() WHERE id = $1', [sessionId]);

/** 写管理操作审计（A9）。 */
export function audit(db, { adminId, action, targetType = null, targetId = null, reason = null, detail = null }) {
  return db.query(
    `INSERT INTO admin_audit (admin_id, action, target_type, target_id, reason, detail) VALUES ($1, $2, $3, $4, $5, $6)`,
    [adminId, action, targetType, targetId, reason, detail ? JSON.stringify(detail) : null],
  );
}

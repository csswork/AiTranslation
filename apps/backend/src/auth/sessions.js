/**
 * 登录会话。令牌是 32 字节随机数，只发给客户端；数据库保存它的 SHA-256。
 * 会话只记录客户端类型（网站或扩展）和时间，不记录设备、位置或指纹。
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const hashToken = (token) => createHash('sha256').update(token).digest('hex');
// 最近使用时间每小时最多写一次，同时顺延有效期；提高配置期限时也为仍有效的旧会话续期。
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export async function createSession(db, config, userId, client = 'web', { id = randomUUID(), webSessionId = null } = {}) {
  const token = randomBytes(32).toString('base64url');
  // 已退出或过期的会话不再保留。
  await db.query('DELETE FROM sessions WHERE user_id = $1 AND (revoked_at IS NOT NULL OR expires_at <= now())', [userId]);
  await db.query(
    `INSERT INTO sessions (id, user_id, token_hash, client, expires_at, web_session_id)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), $6)`,
    [id, userId, hashToken(token), client, config.sessionDays, webSessionId],
  );
  return token;
}

/** 返回 { session, user }；令牌无效、已退出或已过期时返回 null。 */
export async function validateSession(db, config, token) {
  if (!token || token.length > 100) return null;
  const { rows: [row] } = await db.query(
    `SELECT s.id AS session_id, s.client, s.last_used_at, s.expires_at, s.web_session_id,
            w.last_used_at AS web_last_used_at, w.expires_at AS web_expires_at,
            u.id, u.kind, u.email, u.username, u.email_verified_at, u.hosted_frozen_at, u.created_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     LEFT JOIN sessions w ON w.id = s.web_session_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
       AND (s.web_session_id IS NULL OR (w.revoked_at IS NULL AND w.expires_at > now()))`,
    [hashToken(token)],
  );
  if (!row) return null;
  const {
    session_id: id, client, last_used_at: lastUsedAt, expires_at: expiresAt,
    web_session_id: webSessionId, web_last_used_at: webLastUsedAt, web_expires_at: webExpiresAt,
    ...user
  } = row;
  const now = Date.now();
  const renewalDue = (lastUsed, expires) => now - new Date(lastUsed).getTime() > TOUCH_INTERVAL_MS
    || new Date(expires).getTime() - now < config.sessionDays * 86400_000 - TOUCH_INTERVAL_MS;
  const renewIds = [];
  if (renewalDue(lastUsedAt, expiresAt)) renewIds.push(id);
  // 扩展的有效使用也保留授权它的网页会话，避免只使用扩展的客户因父会话到期而掉线。
  if (webSessionId && renewalDue(webLastUsedAt, webExpiresAt)) renewIds.push(webSessionId);
  if (renewIds.length) {
    await db.query(
      `UPDATE sessions SET last_used_at = now(), expires_at = GREATEST(expires_at, now() + make_interval(days => $2))
       WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL AND expires_at > now()`,
      [renewIds, config.sessionDays],
    );
  }
  return { session: { id, client }, user };
}

/** 网页会话：只接受 client = 'web' 且是正式账户的会话（扩展令牌或访客不能当网页会话用）。 */
export async function validateWebSession(db, config, token) {
  const auth = await validateSession(db, config, token);
  return auth && auth.session.client === 'web' && auth.user.kind === 'member' ? auth : null;
}

export async function listSessions(db, userId) {
  const { rows } = await db.query(
    `SELECT s.id, s.client, s.created_at, s.last_used_at, s.expires_at
     FROM sessions s LEFT JOIN sessions w ON w.id = s.web_session_id
     WHERE s.user_id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
       AND (s.web_session_id IS NULL OR (w.revoked_at IS NULL AND w.expires_at > now()))
     ORDER BY s.last_used_at DESC`,
    [userId],
  );
  return rows;
}

export async function revokeSession(db, userId, sessionId) {
  const { rowCount } = await db.query(
    'UPDATE sessions SET revoked_at = now() WHERE (id = $1 OR web_session_id = $1) AND user_id = $2 AND revoked_at IS NULL',
    [sessionId, userId],
  );
  return rowCount > 0;
}

export async function revokeOtherSessions(db, userId, keepSessionId) {
  const { rowCount } = await db.query(
    'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL',
    [userId, keepSessionId],
  );
  return rowCount;
}

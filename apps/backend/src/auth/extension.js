/**
 * Chrome 扩展登录：扩展在当前窗口的标签页里打开用户端的授权页，用户确认后回到扩展自己的回调页
 * chrome-extension://<扩展 ID>/src/auth/callback.html 并带上一次性授权码；扩展再用 PKCE 的
 * code_verifier 换取扩展会话令牌。回调地址里只有授权码，不出现会话令牌。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const CODE_TTL_SECONDS = 120;
const sha256 = (value) => createHash('sha256').update(value).digest();
const hashCode = (code) => sha256(code).toString('hex');

export const EXTENSION_CALLBACK_PATH = '/src/auth/callback.html';

/** 回调地址必须是扩展的回调页；配置了 EXTENSION_IDS 时只接受名单里的扩展。 */
export function extensionIdFromRedirect(redirectUri, config) {
  let url;
  try {
    url = new URL(String(redirectUri || ''));
  } catch {
    return null;
  }
  const match = url.protocol === 'chrome-extension:' && !url.port && !url.search && !url.hash
    && url.pathname === EXTENSION_CALLBACK_PATH && url.hostname.match(/^([a-p]{32})$/);
  if (!match) return null;
  return isAllowedExtension(match[1], config) ? match[1] : null;
}

/** 生产环境必须列出允许的扩展 ID；开发环境未配置时接受任意扩展（开发版 ID 随加载路径变化）。 */
export function isAllowedExtension(id, config) {
  if (config.extensionIds.length) return config.extensionIds.includes(id);
  return !config.production;
}

/**
 * 各商店正式扩展 ID（公开渠道标识）。管理端据此区分用户来自哪个浏览器；
 * 新上架商店时在这里登记，同时加入生产 EXTENSION_IDS。不在表里的 ID（如本地开发版）显示为「其他」。
 */
export const EXTENSION_STORES = {
  hogimafgjmlpdlnepojgigjkhaccbcbj: 'Chrome',
  mojcgjimlkkbohomcijkmoefpeekmohe: 'Edge',
};
export const extensionStore = (id) => (id ? EXTENSION_STORES[id] || '其他' : null);

/** 请求来源里的扩展 ID（chrome-extension://<ID>），格式不对时为 null。 */
export const extensionIdFromOrigin = (origin) => String(origin || '').match(/^chrome-extension:\/\/([a-p]{32})$/)?.[1] || null;

/** 记录账户用过这个扩展：建立扩展会话时调用，首次时间保留，最近时间更新。 */
export async function recordExtension(db, userId, extensionId) {
  if (!extensionId) return;
  await db.query(
    `INSERT INTO user_extensions (user_id, extension_id) VALUES ($1, $2)
     ON CONFLICT (user_id, extension_id) DO UPDATE SET last_seen_at = now()`,
    [userId, extensionId],
  );
}

/** 访客合并或重装接回时，把访客的扩展记录并入目标账户（访客随后删除）。 */
export async function moveExtensions(db, fromUserId, toUserId) {
  await db.query(
    `INSERT INTO user_extensions (user_id, extension_id, first_seen_at, last_seen_at)
     SELECT $2, extension_id, first_seen_at, last_seen_at FROM user_extensions WHERE user_id = $1
     ON CONFLICT (user_id, extension_id) DO UPDATE SET
       first_seen_at = LEAST(user_extensions.first_seen_at, EXCLUDED.first_seen_at),
       last_seen_at = GREATEST(user_extensions.last_seen_at, EXCLUDED.last_seen_at)`,
    [fromUserId, toUserId],
  );
}

export const isValidChallenge = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const isValidVerifier = (value) => typeof value === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(value);

export async function createAuthCode(db, { userId, redirectUri, codeChallenge, webSessionId }) {
  const code = randomBytes(32).toString('base64url');
  await db.query('DELETE FROM extension_auth_codes WHERE expires_at < now() - interval \'1 day\'');
  await db.query(
    `INSERT INTO extension_auth_codes (code_hash, user_id, redirect_uri, code_challenge, expires_at, web_session_id)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5), $6)`,
    [hashCode(code), userId, redirectUri, codeChallenge, CODE_TTL_SECONDS, webSessionId],
  );
  return code;
}

/** 兑换授权码：同时验证授权网页会话仍有效，返回用户和网页会话 ID，否则返回 null。 */
export async function redeemAuthCode(db, { code, codeVerifier, redirectUri }) {
  if (typeof code !== 'string' || !code || !isValidVerifier(codeVerifier)) return null;
  const { rows: [row] } = await db.query(
    `UPDATE extension_auth_codes c SET used_at = now()
     FROM sessions w
     WHERE c.code_hash = $1 AND c.used_at IS NULL AND c.expires_at > now()
       AND w.id = c.web_session_id AND w.user_id = c.user_id AND w.client = 'web'
       AND w.revoked_at IS NULL AND w.expires_at > now()
     RETURNING c.user_id, c.redirect_uri, c.code_challenge, c.web_session_id`,
    [hashCode(code)],
  );
  if (!row || row.redirect_uri !== redirectUri) return null;
  const expected = Buffer.from(row.code_challenge);
  const actual = Buffer.from(sha256(codeVerifier).toString('base64url'));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { userId: row.user_id, webSessionId: row.web_session_id };
}

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
export const FIREFOX_EXTENSION_ID = 'huaci@huaci.app';
export const FIREFOX_CALLBACK_PATH = '/extension/firefox/callback';

/** 回调地址必须是扩展的回调页；配置了 EXTENSION_IDS 时只接受名单里的扩展。 */
export function extensionIdFromRedirect(redirectUri, config) {
  let url;
  try {
    url = new URL(String(redirectUri || ''));
  } catch {
    return null;
  }
  // Firefox's moz-extension host is random per installation. Use one fixed HTTPS callback;
  // the extension observes its tab, then exchanges the code with the same PKCE verifier.
  // Never whitelist arbitrary moz-extension UUIDs or reflect them into redirects/CORS.
  if (url.href === config.appOrigin + FIREFOX_CALLBACK_PATH) {
    return isAllowedExtension(FIREFOX_EXTENSION_ID, config) ? FIREFOX_EXTENSION_ID : null;
  }
  const match = url.protocol === 'chrome-extension:' && !url.port && !url.search && !url.hash
    && !url.username && !url.password
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
  [FIREFOX_EXTENSION_ID]: 'Firefox',
};
export const extensionStore = (id) => (id ? EXTENSION_STORES[id] || '其他' : null);

/** 请求来源里的扩展 ID（chrome-extension://<ID>），格式不对时为 null。 */
export const extensionIdFromOrigin = (origin) => String(origin || '').match(/^chrome-extension:\/\/([a-p]{32})$/)?.[1] || null;

/** 扩展请求头 X-Huaci-Version 里的版本号（manifest version，一到四段数字）；格式不对时为 null。 */
export const readExtensionVersion = (value) => {
  const version = String(value || '').trim();
  return /^\d{1,5}(\.\d{1,5}){0,3}$/.test(version) ? version : null;
};

/**
 * 请求来自哪个扩展（只用于统计）：Chrome / Edge 取 Origin 里的扩展 ID；Firefox 的 moz-extension 主机名
 * 每次安装随机，扩展另在 X-Huaci-Extension 里带上固定 ID，只接受这一个值。不在白名单里时为 null。
 */
export function requestExtensionId(origin, header, config) {
  const id = extensionIdFromOrigin(origin);
  if (id) return isAllowedExtension(id, config) ? id : null;
  return header === FIREFOX_EXTENSION_ID && isAllowedExtension(FIREFOX_EXTENSION_ID, config) ? FIREFOX_EXTENSION_ID : null;
}

/** 记录账户在用的扩展版本，同时更新最近使用时间；没有这条扩展记录时新建。 */
export async function recordExtensionVersion(db, userId, extensionId, version) {
  await db.query(
    `INSERT INTO user_extensions (user_id, extension_id, version, version_seen_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, extension_id) DO UPDATE SET version = EXCLUDED.version, version_seen_at = now(), last_seen_at = now()`,
    [userId, extensionId, version],
  );
}

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
    `INSERT INTO user_extensions (user_id, extension_id, first_seen_at, last_seen_at, version, version_seen_at)
     SELECT $2, extension_id, first_seen_at, last_seen_at, version, version_seen_at FROM user_extensions WHERE user_id = $1
     ON CONFLICT (user_id, extension_id) DO UPDATE SET
       first_seen_at = LEAST(user_extensions.first_seen_at, EXCLUDED.first_seen_at),
       last_seen_at = GREATEST(user_extensions.last_seen_at, EXCLUDED.last_seen_at),
       -- 版本取最近看到的那一边
       version = CASE WHEN EXCLUDED.version_seen_at > user_extensions.version_seen_at OR user_extensions.version_seen_at IS NULL
                      THEN COALESCE(EXCLUDED.version, user_extensions.version) ELSE user_extensions.version END,
       version_seen_at = GREATEST(user_extensions.version_seen_at, EXCLUDED.version_seen_at)`,
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

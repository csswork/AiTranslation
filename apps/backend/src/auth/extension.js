/**
 * Chrome 扩展登录：chrome.identity.launchWebAuthFlow 打开用户端的授权页，用户确认后
 * 回调到 https://<扩展 ID>.chromiumapp.org/ 并带上一次性授权码；扩展再用 PKCE 的 code_verifier
 * 换取扩展会话令牌。回调地址里只有授权码，不出现会话令牌。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const CODE_TTL_SECONDS = 120;
const sha256 = (value) => createHash('sha256').update(value).digest();
const hashCode = (code) => sha256(code).toString('hex');

/** 回调地址必须是 chromiumapp.org 的扩展地址；配置了 EXTENSION_IDS 时只接受名单里的扩展。 */
export function extensionIdFromRedirect(redirectUri, config) {
  let url;
  try {
    url = new URL(String(redirectUri || ''));
  } catch {
    return null;
  }
  const match = url.protocol === 'https:' && !url.port && !url.search && !url.hash
    && url.hostname.match(/^([a-p]{32})\.chromiumapp\.org$/);
  if (!match) return null;
  return isAllowedExtension(match[1], config) ? match[1] : null;
}

/** 生产环境必须列出允许的扩展 ID；开发环境未配置时接受任意扩展（开发版 ID 随加载路径变化）。 */
export function isAllowedExtension(id, config) {
  if (config.extensionIds.length) return config.extensionIds.includes(id);
  return !config.production;
}

export const isValidChallenge = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const isValidVerifier = (value) => typeof value === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(value);

export async function createAuthCode(db, { userId, redirectUri, codeChallenge }) {
  const code = randomBytes(32).toString('base64url');
  await db.query('DELETE FROM extension_auth_codes WHERE expires_at < now() - interval \'1 day\'');
  await db.query(
    `INSERT INTO extension_auth_codes (code_hash, user_id, redirect_uri, code_challenge, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
    [hashCode(code), userId, redirectUri, codeChallenge, CODE_TTL_SECONDS],
  );
  return code;
}

/** 兑换授权码：只能用一次、未过期、回调地址一致、PKCE 校验通过时返回用户 ID，否则返回 null。 */
export async function redeemAuthCode(db, { code, codeVerifier, redirectUri }) {
  if (typeof code !== 'string' || !code || !isValidVerifier(codeVerifier)) return null;
  const { rows: [row] } = await db.query(
    `UPDATE extension_auth_codes SET used_at = now()
     WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id, redirect_uri, code_challenge`,
    [hashCode(code)],
  );
  if (!row || row.redirect_uri !== redirectUri) return null;
  const expected = Buffer.from(row.code_challenge);
  const actual = Buffer.from(sha256(codeVerifier).toString('base64url'));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return row.user_id;
}

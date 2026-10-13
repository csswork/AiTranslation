/**
 * 校验 Google One Tap 交给页面的 ID token。
 *
 * 与授权码流程不同，这个令牌经由浏览器传来，必须验证 Google 的签名（RS256，公钥取自 JWKS），
 * 并检查 iss、aud（本应用的客户端 ID）、有效期和 nonce（与本站登录页下发的一次性值一致，防重放和跨站登录）。
 * 只返回登录所需的 sub、email、email_verified；其余资料不读取。
 */
import { createPublicKey, verify } from 'node:crypto';
import { normalizeEmail } from './users.js';

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLOCK_SKEW_SECONDS = 60;

const decodePart = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/** 按 Cache-Control 缓存 Google 公钥；遇到未知 kid（Google 轮换密钥）时最多每分钟重新拉取一次。 */
export function googleJwks({ url = JWKS_URL, fetchImpl = (...args) => fetch(...args) } = {}) {
  let keys = new Map();
  let expiresAt = 0;
  let lastFetch = 0;
  const refresh = async () => {
    lastFetch = Date.now();
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`JWKS ${res.status}`);
    const maxAge = Number((res.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
    const { keys: list } = await res.json();
    keys = new Map(list.filter((k) => k.kty === 'RSA').map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })]));
    expiresAt = Date.now() + maxAge * 1000;
  };
  return async (kid) => {
    if (Date.now() >= expiresAt || (!keys.has(kid) && Date.now() - lastFetch > 60_000)) await refresh();
    return keys.get(kid) || null;
  };
}

export class IdTokenError extends Error {}

/**
 * 返回 { subject, email, emailVerified }；任何一项校验失败都抛出 IdTokenError（消息不含令牌内容）。
 */
export async function verifyGoogleIdToken(token, { clientId, nonce, getKey, now = Date.now() }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new IdTokenError('format');
  let header;
  let claims;
  try {
    header = decodePart(parts[0]);
    claims = decodePart(parts[1]);
  } catch {
    throw new IdTokenError('format');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new IdTokenError('alg');
  const key = await getKey(header.kid);
  if (!key) throw new IdTokenError('kid');
  const signed = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  if (!signed) throw new IdTokenError('signature');

  const seconds = Math.floor(now / 1000);
  if (!ISSUERS.has(claims.iss)) throw new IdTokenError('iss');
  if (claims.aud !== clientId) throw new IdTokenError('aud');
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < seconds) throw new IdTokenError('exp');
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > seconds) throw new IdTokenError('iat');
  if (!nonce || claims.nonce !== nonce) throw new IdTokenError('nonce');

  return {
    subject: typeof claims.sub === 'string' ? claims.sub : '',
    email: normalizeEmail(claims.email),
    emailVerified: claims.email_verified === true,
  };
}

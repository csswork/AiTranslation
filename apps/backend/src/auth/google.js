/**
 * Google 登录（OAuth 2.0 授权码 + PKCE）。只申请 openid 和 email，
 * 只读取 sub、email、email_verified 三项；姓名、头像等资料不读取、不保存。
 */
import { Google, decodeIdToken, generateCodeVerifier, generateState } from 'arctic';
import { normalizeEmail } from './users.js';

export const GOOGLE_SCOPES = ['openid', 'email'];

export function createGoogleClient(config) {
  if (!config.google) return null;
  return new Google(config.google.clientId, config.google.clientSecret, `${config.appOrigin}/auth/google/callback`);
}

export function startGoogleAuth(google) {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = google.createAuthorizationURL(state, codeVerifier, GOOGLE_SCOPES);
  return { state, codeVerifier, url: url.toString() };
}

/**
 * 用授权码换取令牌并提取登录所需的声明。ID token 由后端经 TLS 直接从 Google 令牌端点取得，
 * 按 OpenID Connect 授权码流程可不再单独验签。
 */
export async function finishGoogleAuth(google, code, codeVerifier) {
  const tokens = await google.validateAuthorizationCode(code, codeVerifier);
  const claims = decodeIdToken(tokens.idToken());
  return {
    subject: typeof claims.sub === 'string' ? claims.sub : '',
    email: normalizeEmail(claims.email),
    emailVerified: claims.email_verified === true,
  };
}

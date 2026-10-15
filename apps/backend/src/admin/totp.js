/**
 * TOTP 二步验证（RFC 6238，SHA-1、30 秒、6 位），兼容常见的身份验证器 App。
 * 密钥用 AUTH_SECRET 派生的 AES-256-GCM 密钥加密后入库；同一时间步的验证码只能用一次。
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STEP_SECONDS = 30;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of String(text).replace(/[\s=]/g, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('invalid_base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpCode(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/** 校验验证码，允许前后各一个时间步的时钟误差。返回匹配的时间步，失败返回 null。 */
export function verifyTotp(secret, code, { now = Date.now(), lastStep = null } = {}) {
  const input = String(code ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(input)) return null;
  const step = currentStep(now);
  for (const candidate of [step - 1, step, step + 1]) {
    if (lastStep != null && candidate <= Number(lastStep)) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secret, candidate)), Buffer.from(input))) return candidate;
  }
  return null;
}

export const otpauthUrl = (secret, account, issuer = 'Huaci Admin') =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

const keyFrom = (authSecret) => createHash('sha256').update(`admin-totp:${authSecret}`).digest();

export function sealSecret(authSecret, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(authSecret), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function openSecret(authSecret, sealed) {
  const [iv, tag, data] = String(sealed).split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(authSecret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

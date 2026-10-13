/**
 * 邮箱验证码：6 位数字，10 分钟有效，最多尝试 5 次。
 * 数据库只存 HMAC(AUTH_SECRET)；同一邮箱 60 秒内只能发一次、每小时最多 5 次。
 */
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { transaction } from '../db/index.js';

export const CODE_TTL_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;
const HOURLY_LIMIT = 5;

const hashCode = (secret, id, code) => createHmac('sha256', secret).update(`${id}:${code}`).digest('hex');

/**
 * 发出新验证码并作废同一邮箱、同一用途的旧验证码。
 * 返回 { ok: true, code } 或 { ok: false, reason: 'too_soon' | 'too_many' }。
 */
export async function issueCode(pool, config, { email, purpose, userId = null }) {
  return transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${purpose}:${email}`]);
    const { rows: [recent] } = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS last_hour,
         COALESCE(BOOL_OR(created_at > now() - make_interval(secs => $3)), false) AS too_soon
       FROM email_codes WHERE email = $1 AND purpose = $2`,
      [email, purpose, RESEND_SECONDS],
    );
    if (recent.too_soon) return { ok: false, reason: 'too_soon' };
    if (recent.last_hour >= HOURLY_LIMIT) return { ok: false, reason: 'too_many' };

    // 只保留运行所需的近期记录。
    await client.query(`DELETE FROM email_codes WHERE created_at < now() - interval '1 day'`);
    await client.query(
      'UPDATE email_codes SET consumed_at = now() WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL',
      [email, purpose],
    );
    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await client.query(
      `INSERT INTO email_codes (id, email, purpose, user_id, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6))`,
      [id, email, purpose, userId, hashCode(config.authSecret, id, code), CODE_TTL_MINUTES],
    );
    return { ok: true, code };
  });
}

/**
 * 校验并消耗验证码。userId 用于更换邮箱：验证码只对发起更换的账号有效。
 * 返回 { ok: true } 或 { ok: false, reason: 'invalid' | 'expired' | 'locked', remaining? }。
 */
export async function verifyCode(pool, config, { email, purpose, userId = null, code }) {
  const input = String(code ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(input)) return { ok: false, reason: 'invalid' };
  return transaction(pool, async (client) => {
    const { rows: [row] } = await client.query(
      `SELECT id, code_hash, attempts, expires_at <= now() AS expired
       FROM email_codes
       WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL AND user_id IS NOT DISTINCT FROM $3::uuid
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [email, purpose, userId],
    );
    if (!row || row.expired) return { ok: false, reason: 'expired' };
    if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked' };

    const expected = Buffer.from(row.code_hash, 'hex');
    const actual = Buffer.from(hashCode(config.authSecret, row.id, input), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      const attempts = row.attempts + 1;
      await client.query('UPDATE email_codes SET attempts = $2 WHERE id = $1', [row.id, attempts]);
      return attempts >= MAX_ATTEMPTS
        ? { ok: false, reason: 'locked' }
        : { ok: false, reason: 'invalid', remaining: MAX_ATTEMPTS - attempts };
    }
    await client.query('UPDATE email_codes SET consumed_at = now() WHERE id = $1', [row.id]);
    return { ok: true };
  });
}

/**
 * 账号与登录方式。账号资料只有 email 和 username；第三方登录只记录平台名与平台用户标识。
 * 访客账户（kind = 'guest'）没有邮箱，只能通过扩展会话使用，注册或登录时合并进正式账户（见 src/guest）。
 */
import { randomBytes } from 'node:crypto';
import { isUniqueViolation, transaction } from '../db/index.js';
import { grantTrial } from '../credits/ledger.js';

export const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();
export const isValidEmail = (email) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const normalizeUsername = (value) => String(value ?? '').trim().toLowerCase();
export const isValidUsername = (username) => /^[a-z0-9_-]{3,24}$/.test(username);

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const generateUsername = () => `user_${Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('')}`;

const USER_COLUMNS = 'id, kind, email, username, email_verified_at, hosted_frozen_at, created_at';

export async function findUserById(db, id) {
  const { rows } = await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function findUserByEmail(db, email) {
  const { rows } = await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE email = $1`, [email]);
  return rows[0] || null;
}

/**
 * 按已验证的邮箱查找账号，不存在就创建，并在同一事务里发放注册赠送点数（signupCredits，不过期）。
 * identity 可选：新账号同时绑定的第三方登录。返回 { user, created }。
 */
export async function findOrCreateUserByEmail(pool, signupCredits, email, identity = null) {
  const existing = await findUserByEmail(pool, email);
  if (existing) return { user: existing, created: false };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const user = await transaction(pool, async (client) => {
        const { rows: [row] } = await client.query(
          `INSERT INTO users (email, username, email_verified_at) VALUES ($1, $2, now()) RETURNING ${USER_COLUMNS}`,
          [email, generateUsername()],
        );
        if (identity) {
          await client.query('INSERT INTO identities (user_id, provider, subject) VALUES ($1, $2, $3)',
            [row.id, identity.provider, identity.subject]);
        }
        await grantTrial(client, signupCredits, row.id);
        return row;
      });
      return { user, created: true };
    } catch (error) {
      if (isUniqueViolation(error, 'users_username_key')) continue;
      // 同一邮箱并发完成注册：使用先创建的账号。
      if (isUniqueViolation(error, 'users_email_key')) {
        return { user: await findUserByEmail(pool, email), created: false };
      }
      throw error;
    }
  }
  throw new Error('无法生成唯一的用户名');
}

/** 新建访客账户（在调用方的事务里）。用户名带 guest_ 前缀，不能登录网页。 */
export async function createGuestUser(client) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const username = `guest_${Array.from(randomBytes(10), (b) => ALPHABET[b % ALPHABET.length]).join('')}`;
    const { rows: [row] } = await client.query(
      `INSERT INTO users (kind, username) VALUES ('guest', $1) ON CONFLICT (username) DO NOTHING RETURNING ${USER_COLUMNS}`,
      [username],
    );
    if (row) return row;
  }
  throw new Error('无法生成唯一的用户名');
}

/** 返回 'ok' | 'invalid' | 'taken'。 */
export async function updateUsername(db, userId, value) {
  const username = normalizeUsername(value);
  if (!isValidUsername(username)) return 'invalid';
  try {
    await db.query('UPDATE users SET username = $2, updated_at = now() WHERE id = $1', [userId, username]);
    return 'ok';
  } catch (error) {
    if (isUniqueViolation(error, 'users_username_key')) return 'taken';
    throw error;
  }
}

/** 邮箱已通过验证码确认后调用。返回 'ok' | 'taken'。 */
export async function updateEmail(db, userId, email) {
  try {
    await db.query('UPDATE users SET email = $2, email_verified_at = now(), updated_at = now() WHERE id = $1', [userId, email]);
    return 'ok';
  } catch (error) {
    if (isUniqueViolation(error, 'users_email_key')) return 'taken';
    throw error;
  }
}

export async function findIdentity(db, provider, subject) {
  const { rows } = await db.query('SELECT user_id FROM identities WHERE provider = $1 AND subject = $2', [provider, subject]);
  return rows[0] || null;
}

export async function listIdentities(db, userId) {
  const { rows } = await db.query('SELECT provider, created_at FROM identities WHERE user_id = $1 ORDER BY provider', [userId]);
  return rows;
}

/** 返回 'ok' | 'taken'（该第三方账号已绑定其他账户）| 'already'（当前账户已绑定同一平台）。 */
export async function linkIdentity(db, userId, provider, subject) {
  try {
    await db.query('INSERT INTO identities (user_id, provider, subject) VALUES ($1, $2, $3)', [userId, provider, subject]);
    return 'ok';
  } catch (error) {
    if (isUniqueViolation(error, 'identities_provider_subject_key')) {
      const owner = await findIdentity(db, provider, subject);
      return owner?.user_id === userId ? 'already' : 'taken';
    }
    if (isUniqueViolation(error, 'identities_user_id_provider_key')) return 'already';
    throw error;
  }
}

/** 邮箱验证码始终可以登录，所以解除第三方绑定不会让账号无法登录。 */
export async function unlinkIdentity(db, userId, provider) {
  const { rowCount } = await db.query('DELETE FROM identities WHERE user_id = $1 AND provider = $2', [userId, provider]);
  return rowCount > 0;
}

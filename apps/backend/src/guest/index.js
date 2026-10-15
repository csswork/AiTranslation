/**
 * 访客试用：扩展安装后不需要任何操作就能使用托管翻译。
 *
 * 1. 扩展静默调用 POST /api/extension/guest：按 IP 限频与全站每日总量决定是否赠送访客点数，
 *    建立访客账户和扩展会话，并签发一次性的欢迎页关联码。
 * 2. 扩展打开用户端欢迎页 /welcome?link=<关联码>。服务端读取本站的浏览器标记 Cookie（扩展卸载后仍在）：
 *    - 没有标记：第一次领取，写入标记并关联到这个访客；
 *    - 标记属于另一个访客：同一浏览器卸载重装，把扩展会话接回旧访客（继续用剩余点数），新访客作废；
 *    - 标记属于正式账户：这个浏览器已注册过，作废新访客的点数，提示登录。
 * 3. 注册或登录时把访客合并进正式账户：剩余点数转入，用量记录随之转移。
 *
 * IP 只存带密钥的哈希（IPv6 按 /64 前缀），浏览器标记是随机值、只存哈希，不采集设备指纹。
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import { createSession } from '../auth/sessions.js';
import { createGuestUser } from '../auth/users.js';
import { grantGuest, transferGuestCredits, voidRemaining } from '../credits/ledger.js';
import { transaction } from '../db/index.js';

const LINK_TTL_MINUTES = 30;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** 把地址规范成计数用的网络：IPv4 用完整地址，IPv6 用前 64 位（一个家庭通常分到整个 /64）。 */
export function networkOf(address) {
  let ip = String(address || '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  if (isIPv4(ip)) return ip;
  if (!isIPv6(ip)) return ip || 'unknown';
  ip = ip.split('%')[0];
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => parseInt(g || '0', 16).toString(16)).join(':')}::/64`;
}

export const ipHash = (config, address) => createHmac('sha256', config.authSecret).update(`ip:${networkOf(address)}`).digest('hex');

/**
 * 新建访客：在一个事务里判断是否赠送点数、建账户、写领取记录、建扩展会话和欢迎页关联码。
 * 返回 { token, linkCode, outcome, granted }。
 */
export async function createGuest(pool, config, settings, address) {
  const hash = ipHash(config, address);
  return transaction(pool, async (client) => {
    // 串行处理领取，保证每日总量与同一网络次数准确。
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['guest-claims']);
    const { rows: [counts] } = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE ip_hash = $1 AND created_at > now() - make_interval(days => $2))::int AS same_network,
         COUNT(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS last_day
       FROM guest_claims WHERE outcome = 'granted'`,
      [hash, settings.guest_ip_window_days],
    );
    let outcome = 'granted';
    if (counts.same_network >= settings.guest_ip_limit) outcome = 'ip_limited';
    else if (counts.last_day >= settings.guest_daily_cap) outcome = 'daily_cap';
    const granted = outcome === 'granted' ? settings.guest_credits : 0;

    const user = await createGuestUser(client);
    await grantGuest(client, granted, user.id);
    await client.query(
      'INSERT INTO guest_claims (user_id, ip_hash, granted, outcome) VALUES ($1, $2, $3, $4)',
      [user.id, hash, granted, outcome],
    );
    const token = await createSession(client, config, user.id, 'extension');
    const linkCode = randomBytes(24).toString('base64url');
    await client.query(
      `INSERT INTO guest_link_codes (code_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [sha256(linkCode), user.id, LINK_TTL_MINUTES],
    );
    return { token, linkCode, outcome, granted, userId: user.id };
  });
}

/**
 * 访客合并进正式账户（在调用方的事务里）：剩余点数转入、用量记录与浏览器标记改到正式账户，
 * moveSessions 为真时访客的扩展会话也改到正式账户（同一浏览器在网页上登录后，扩展随之登录）。
 * 访客账户随后删除。返回转入的点数。
 */
export async function mergeGuest(client, guestId, memberId, { moveSessions = false } = {}) {
  const { rows: [guest] } = await client.query(`SELECT id FROM users WHERE id = $1 AND kind = 'guest' FOR UPDATE`, [guestId]);
  if (!guest || guestId === memberId) return 0;
  const transferred = await transferGuestCredits(client, guestId, memberId);
  await client.query('UPDATE usage_events SET user_id = $2 WHERE user_id = $1', [guestId, memberId]);
  await client.query('UPDATE guest_claims SET merged_user_id = $2 WHERE user_id = $1', [guestId, memberId]);
  await client.query('UPDATE browser_marks SET user_id = $2 WHERE user_id = $1', [guestId, memberId]);
  if (moveSessions) await client.query(`UPDATE sessions SET user_id = $2 WHERE user_id = $1 AND client = 'extension'`, [guestId, memberId]);
  await client.query('DELETE FROM users WHERE id = $1', [guestId]);
  return transferred;
}

/**
 * 欢迎页：用关联码找到这次安装的访客，再用浏览器标记判断是否重复领取。
 * markValue 是浏览器带来的标记 Cookie（可能没有）。返回
 * { outcome: 'new' | 'same' | 'restored' | 'already_member' | 'invalid', claim, newMark?, userId? }。
 */
export async function linkBrowser(pool, { linkCode, markValue }) {
  return transaction(pool, async (client) => {
    const { rows: [link] } = await client.query(
      `UPDATE guest_link_codes SET used_at = now()
       WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [sha256(String(linkCode || ''))],
    );
    if (!link) return { outcome: 'invalid' };
    const guestId = link.user_id;
    const { rows: [claim] } = await client.query(
      'SELECT id, granted, outcome FROM guest_claims WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [guestId],
    );

    const mark = markValue
      ? (await client.query(
        `SELECT m.id, m.user_id, u.kind FROM browser_marks m LEFT JOIN users u ON u.id = m.user_id WHERE m.mark_hash = $1 FOR UPDATE OF m`,
        [sha256(markValue)],
      )).rows[0]
      : null;

    if (!mark) {
      const newMark = randomBytes(32).toString('base64url');
      await client.query('INSERT INTO browser_marks (mark_hash, user_id) VALUES ($1, $2)', [sha256(newMark), guestId]);
      return { outcome: 'new', claim, newMark, userId: guestId };
    }
    await client.query('UPDATE browser_marks SET last_seen_at = now() WHERE id = $1', [mark.id]);
    if (mark.user_id === guestId) return { outcome: 'same', claim, userId: guestId };

    if (mark.kind === 'guest') {
      // 同一浏览器重装：扩展会话接回旧访客，这次新建的访客与它的点数作废（删除），不计入领取次数。
      await client.query(`UPDATE sessions SET user_id = $2 WHERE user_id = $1 AND client = 'extension'`, [guestId, mark.user_id]);
      await client.query(`UPDATE guest_claims SET outcome = 'reinstall', granted = 0 WHERE user_id = $1`, [guestId]);
      await client.query('DELETE FROM users WHERE id = $1', [guestId]);
      return { outcome: 'restored', claim, userId: mark.user_id };
    }

    // 这个浏览器已经注册过（或旧账户已删除）：新访客的点数作废，提示登录；不凭 Cookie 自动登录正式账户。
    await voidRemaining(client, guestId, 'browser_already_claimed');
    await client.query(`UPDATE guest_claims SET outcome = 'claimed_member', granted = 0 WHERE user_id = $1`, [guestId]);
    if (!mark.user_id) await client.query('UPDATE browser_marks SET user_id = $2 WHERE id = $1', [mark.id, guestId]);
    return { outcome: 'already_member', claim, userId: guestId };
  });
}

/** 网页登录后：这个浏览器的标记如果属于访客，把访客合并进刚登录的正式账户（扩展也随之登录）。 */
export async function mergeBrowserGuest(pool, markValue, memberId) {
  if (!markValue) return 0;
  return transaction(pool, async (client) => {
    const { rows: [mark] } = await client.query(
      `SELECT m.user_id, u.kind FROM browser_marks m JOIN users u ON u.id = m.user_id WHERE m.mark_hash = $1`,
      [sha256(markValue)],
    );
    if (!mark || mark.kind !== 'guest') return 0;
    return mergeGuest(client, mark.user_id, memberId, { moveSessions: true });
  });
}

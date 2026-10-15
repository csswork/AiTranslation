/**
 * 指定或撤销管理员（A1）。只能在 VPS 上通过命令行操作，网页上无法给自己授权。
 *
 *   npm run admin -- grant <email>       设为管理员；账户不存在时直接建立（首次登录管理端时绑定二步验证）
 *   npm run admin -- revoke <email>      撤销管理员并退出其管理端会话
 *   npm run admin -- reset-2fa <email>   清除二步验证，下次登录重新绑定
 *   npm run admin -- list
 */
import { findOrCreateUserByEmail, isValidEmail } from '../src/auth/users.js';
import { loadLocalEnv, readConfig } from '../src/config/index.js';
import { createPool } from '../src/db/index.js';

loadLocalEnv();
const config = readConfig();
const pool = createPool(config.databaseUrl);
const [command, rawEmail] = process.argv.slice(2);
const email = String(rawEmail || '').trim().toLowerCase();

const userId = async () => {
  const { rows: [row] } = await pool.query(`SELECT id FROM users WHERE email = $1 AND kind = 'member'`, [email]);
  if (!row) throw new Error(`找不到已注册的账户：${email}（请先在用户端注册）`);
  return row.id;
};
const log = (action, id) => pool.query(`INSERT INTO admin_audit (action, target_type, target_id, reason) VALUES ($1, 'user', $2, 'cli')`, [action, id]);

try {
  if (command === 'grant') {
    if (!isValidEmail(email)) throw new Error(`邮箱无效：${rawEmail || ''}`);
    const { user, created } = await findOrCreateUserByEmail(pool, config.trialCredits, email);
    if (created) console.log(`已建立账户：${email}`);
    const id = user.id;
    await pool.query('INSERT INTO admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    await log('admin.grant', id);
    console.log(`已设为管理员：${email}。在 ${config.adminOrigin || 'ADMIN_ORIGIN'} 登录并绑定二步验证。`);
  } else if (command === 'revoke') {
    const id = await userId();
    await pool.query('DELETE FROM admins WHERE user_id = $1', [id]);
    await log('admin.revoke', id);
    console.log(`已撤销管理员：${email}`);
  } else if (command === 'reset-2fa') {
    const id = await userId();
    await pool.query('UPDATE admins SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE user_id = $1', [id]);
    await pool.query('UPDATE admin_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    await log('admin.reset_2fa', id);
    console.log(`已清除二步验证：${email}`);
  } else if (command === 'list') {
    const { rows } = await pool.query(`SELECT u.email, a.totp_enabled_at, a.created_at FROM admins a JOIN users u ON u.id = a.user_id ORDER BY a.created_at`);
    for (const r of rows) console.log(`${r.email}\t二步验证：${r.totp_enabled_at ? '已启用' : '未绑定'}`);
    if (!rows.length) console.log('还没有管理员。');
  } else {
    console.log('用法：npm run admin -- grant|revoke|reset-2fa <email> | list');
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

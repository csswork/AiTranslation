/** npm run review -- create <email> <review_username> <absolute-output-file> | revoke <email> */
import fs from 'node:fs';
import path from 'node:path';
import { provisionReviewAccess, revokeReviewAccess } from '../src/auth/review.js';
import { loadLocalEnv, readConfig } from '../src/config/index.js';
import { createPool } from '../src/db/index.js';

loadLocalEnv();
const config = readConfig();
const [command, email, username, output] = process.argv.slice(2);
const pool = createPool(config.databaseUrl);
let fd;
let complete = false;
try {
  if (command === 'create') {
    if (!output || !path.isAbsolute(output)) throw new Error('Provide an absolute private output file path');
    // 先以 0600 独占创建，拒绝覆盖文件或跟随符号链接；明文凭据只写此文件。
    fd = fs.openSync(output, 'wx', 0o600);
    const access = await provisionReviewAccess(pool, { email, username });
    fs.writeFileSync(fd, JSON.stringify({ loginUrl: `${config.appOrigin}/review-login`, ...access }, null, 2) + '\n');
    complete = true;
    console.log(`审核账号已建立/轮换；凭据写入：${output}（30 天、普通用户、首次赠送 1000.00 点）。`);
  } else if (command === 'revoke' && email) {
    await revokeReviewAccess(pool, email);
    console.log('审核登录凭据及该账号全部网页/扩展会话已撤销。');
  } else {
    throw new Error('Usage: npm run review -- create <email> <review_username> <absolute-output-file> | revoke <email>');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (fd !== undefined) {
    fs.closeSync(fd);
    if (!complete) fs.unlinkSync(output);
  }
  await pool.end();
}

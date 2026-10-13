/**
 * 按文件名顺序执行 migrations/*.sql，已执行的记录在 schema_migrations。
 * 每个文件在独立事务中执行；用咨询锁防止多个进程同时迁移。
 *
 *   node src/db/migrate.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_ROOT, loadLocalEnv } from '../config/index.js';
import { createPool } from './index.js';

const MIGRATIONS_DIR = path.join(APP_ROOT, 'migrations');
const LOCK_ID = 7_202_610;

const migrationFiles = () => fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

/** 返回尚未执行的迁移文件名；服务启动前检查，不自动迁移生产数据库。 */
export async function pendingMigrations(pool) {
  const { rows: [{ exists }] } = await pool.query("SELECT to_regclass('schema_migrations') IS NOT NULL AS exists");
  const done = exists ? new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name)) : new Set();
  return migrationFiles().filter((f) => !done.has(f));
}

export async function migrate(pool, { log = () => {} } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = migrationFiles();
    const applied = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`迁移 ${file} 失败：${error.message}`, { cause: error });
      }
      applied.push(file);
      log(`已执行 ${file}`);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadLocalEnv();
  if (!process.env.DATABASE_URL) {
    console.error('缺少 DATABASE_URL');
    process.exit(1);
  }
  const pool = createPool(process.env.DATABASE_URL);
  try {
    const applied = await migrate(pool, { log: console.log });
    if (!applied.length) console.log('数据库已是最新');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

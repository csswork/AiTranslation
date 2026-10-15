import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createPool } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { creditBalance } from '../src/credits/ledger.js';
import { TEST_DATABASE_URL } from './helpers.mjs';

test('升级旧整数点数数据：余额、历史预扣、访客发放与拒绝记录等值迁移，迁移可重跑', async () => {
  if (new URL(TEST_DATABASE_URL).pathname !== '/huaci_test') throw new Error('只允许 huaci_test');
  const pool = createPool(TEST_DATABASE_URL);
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await pool.query('CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const dir = new URL('../migrations/', import.meta.url);
    for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.sql') && n < '008').sort()) {
      await pool.query(fs.readFileSync(new URL(name, dir), 'utf8'));
      await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    }
    const { rows: [user] } = await pool.query("INSERT INTO users (kind, email, username) VALUES ('member', 'legacy@example.com', 'legacy') RETURNING id");
    const { rows: [grant] } = await pool.query("INSERT INTO credit_ledger (user_id, entry_type, amount, idempotency_key) VALUES ($1, 'trial_grant', 100, 'old-grant') RETURNING id", [user.id]);
    const { rows: [usage] } = await pool.query("INSERT INTO usage_events (user_id, kind, chars, cost, status) VALUES ($1, 'text', 1100, 3, 'ok') RETURNING id", [user.id]);
    await pool.query("INSERT INTO credit_ledger (user_id, entry_type, amount, grant_id, usage_event_id, idempotency_key) VALUES ($1, 'usage', -3, $2, $3, 'old-usage')", [user.id, grant.id, usage.id]);
    await pool.query("INSERT INTO guest_claims (user_id, ip_hash, granted, outcome) VALUES ($1, 'hash', 50, 'granted')", [user.id]);
    await pool.query("INSERT INTO usage_rejections (user_id, reason, chars, cost) VALUES ($1, 'insufficient_credits', 2000, 4)", [user.id]);
    await pool.query("INSERT INTO app_settings (key, value) VALUES ('chars_per_credit', '1000')");
    assert.deepEqual(await migrate(pool), ['008_exact_credit_units.sql', '009_hosted_image_recognition.sql']);
    assert.equal(await creditBalance(pool, user.id), 48500n, '旧余额 97 点原样保留，不重新按字数计算旧账');
    assert.equal((await pool.query('SELECT cost_units FROM usage_events')).rows[0].cost_units, '1500');
    assert.equal((await pool.query('SELECT granted_units FROM guest_claims')).rows[0].granted_units, '25000');
    assert.equal((await pool.query('SELECT cost_units FROM usage_rejections')).rows[0].cost_units, '2000');
    assert.equal((await pool.query("SELECT 1 FROM app_settings WHERE key = 'chars_per_credit'")).rowCount, 0);
    assert.deepEqual(await migrate(pool), []);
  } finally { await pool.end(); }
});

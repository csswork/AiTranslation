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
    assert.deepEqual(await migrate(pool), fs.readdirSync(dir).filter(n => n.endsWith('.sql') && n >= '008').sort());
    assert.equal(await creditBalance(pool, user.id), 48500n, '旧余额 97 点原样保留，不重新按字数计算旧账');
    assert.equal((await pool.query('SELECT cost_units FROM usage_events')).rows[0].cost_units, '1500');
    assert.equal((await pool.query('SELECT granted_units FROM guest_claims')).rows[0].granted_units, '25000');
    assert.equal((await pool.query('SELECT cost_units FROM usage_rejections')).rows[0].cost_units, '2000');
    assert.equal((await pool.query("SELECT 1 FROM app_settings WHERE key = 'chars_per_credit'")).rowCount, 0);
    assert.deepEqual(await migrate(pool), []);
  } finally { await pool.end(); }
});

test('安装记录补齐：在的访客补原访客 ID；已合并的按转入流水一一对应补齐，对不上的保持为空', async () => {
  const pool = createPool(TEST_DATABASE_URL);
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await pool.query('CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const dir = new URL('../migrations/', import.meta.url);
    for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.sql') && n < '010').sort()) {
      await pool.query(fs.readFileSync(new URL(name, dir), 'utf8'));
      await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    }
    const member = async (email) => (await pool.query("INSERT INTO users (kind, email, username) VALUES ('member', $1, $2) RETURNING id", [email, `user_${email[0]}`])).rows[0].id;
    const claim = (userId, mergedId, at) => pool.query(
      "INSERT INTO guest_claims (user_id, merged_user_id, ip_hash, granted_units, outcome, created_at) VALUES ($1, $2, 'h', 25000, 'granted', $3) RETURNING id",
      [userId, mergedId, at],
    ).then((r) => r.rows[0].id);
    const transfer = (userId, guestId, units, at) => pool.query(
      "INSERT INTO credit_ledger (user_id, entry_type, amount_units, idempotency_key, created_at) VALUES ($1, 'transfer', $2, $3, $4)",
      [userId, units, `transfer:${guestId}`, at],
    );
    const { rows: [alive] } = await pool.query("INSERT INTO users (kind, username) VALUES ('guest', 'guest_alive') RETURNING id");
    const aliveClaim = await claim(alive.id, null, '2026-10-01T00:00:00Z');
    // 两个访客先后合并进 a，各有一笔转入
    const a = await member('a@example.com');
    const [ga1, ga2] = ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2'];
    const a1 = await claim(null, a, '2026-10-02T00:00:00Z');
    const a2 = await claim(null, a, '2026-10-04T00:00:00Z');
    await transfer(a, ga1, 25000, '2026-10-03T00:00:00Z');
    await transfer(a, ga2, 24000, '2026-10-05T00:00:00Z');
    // b 有两次合并但只有一笔转入（另一个访客点数已用完）：对不上，不猜
    const b = await member('b@example.com');
    const b1 = await claim(null, b, '2026-10-02T00:00:00Z');
    await claim(null, b, '2026-10-04T00:00:00Z');
    await transfer(b, '00000000-0000-4000-8000-0000000000b1', 25000, '2026-10-05T00:00:00Z');

    assert.ok((await migrate(pool)).includes('010_guest_claim_tracking.sql'));
    const row = async (id) => (await pool.query('SELECT guest_id, merged_at, transferred_units FROM guest_claims WHERE id = $1', [id])).rows[0];
    assert.equal((await row(aliveClaim)).guest_id, alive.id);
    assert.deepEqual(await row(a1), { guest_id: ga1, merged_at: new Date('2026-10-03T00:00:00Z'), transferred_units: '25000' });
    assert.deepEqual(await row(a2), { guest_id: ga2, merged_at: new Date('2026-10-05T00:00:00Z'), transferred_units: '24000' });
    assert.deepEqual(await row(b1), { guest_id: null, merged_at: null, transferred_units: null });
  } finally { await pool.end(); }
});

test('历史安装归为 Chrome：只补 012 之前没有来源的记录与账户，之后的记录不受影响', async () => {
  const pool = createPool(TEST_DATABASE_URL);
  const CHROME = 'hogimafgjmlpdlnepojgigjkhaccbcbj';
  const EDGE = 'mojcgjimlkkbohomcijkmoefpeekmohe';
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await pool.query('CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const dir = new URL('../migrations/', import.meta.url);
    for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.sql') && n < '013').sort()) {
      await pool.query(fs.readFileSync(new URL(name, dir), 'utf8'));
      await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    }
    await pool.query("UPDATE schema_migrations SET applied_at = '2026-10-26T12:00:00Z' WHERE name = '012_extension_source.sql'");
    const user = async (kind, name, email = null) => (await pool.query('INSERT INTO users (kind, username, email) VALUES ($1, $2, $3) RETURNING id', [kind, name, email])).rows[0].id;
    const claim = (userId, mergedId, at, ext = null) => pool.query(
      "INSERT INTO guest_claims (user_id, guest_id, merged_user_id, merged_at, ip_hash, granted_units, outcome, created_at, extension_id) VALUES ($1, $1, $2, $3, 'h', 25000, 'granted', $4, $5) RETURNING id",
      [userId, mergedId, mergedId ? '2026-10-22T00:00:00Z' : null, at, ext],
    ).then((r) => r.rows[0].id);
    const guest = await user('guest', 'guest_old');
    const member = await user('member', 'member_old', 'old@example.com');
    const extOnly = await user('member', 'ext_only', 'ext@example.com');
    const fresh = await user('guest', 'guest_new');
    const oldGuestClaim = await claim(guest, null, '2026-10-20T00:00:00Z');
    const mergedClaim = await claim(null, member, '2026-10-21T00:00:00Z');
    const newNull = await claim(fresh, null, '2026-10-27T00:00:00Z');
    const newEdge = await claim(fresh, null, '2026-10-27T01:00:00Z', EDGE);
    await pool.query(
      "INSERT INTO sessions (user_id, token_hash, client, created_at, last_used_at, expires_at) VALUES ($1, 'x', 'extension', '2026-10-23T00:00:00Z', '2026-10-25T00:00:00Z', now() + interval '1 day')",
      [extOnly],
    );
    await pool.query(`INSERT INTO user_extensions (user_id, extension_id, first_seen_at) VALUES ($1, $2, '2026-10-27T01:00:00Z')`, [fresh, EDGE]);

    assert.deepEqual(await migrate(pool), ['013_backfill_chrome_source.sql']);
    const ext = async (id) => (await pool.query('SELECT extension_id FROM guest_claims WHERE id = $1', [id])).rows[0].extension_id;
    assert.equal(await ext(oldGuestClaim), CHROME);
    assert.equal(await ext(mergedClaim), CHROME);
    assert.equal(await ext(newNull), null, '012 之后的记录不归类');
    assert.equal(await ext(newEdge), EDGE);
    const { rows } = await pool.query('SELECT user_id, extension_id, first_seen_at, last_seen_at FROM user_extensions ORDER BY first_seen_at');
    const byUser = Object.fromEntries(rows.map((r) => [`${r.user_id}:${r.extension_id}`, r]));
    assert.deepEqual([byUser[`${guest}:${CHROME}`].first_seen_at, byUser[`${guest}:${CHROME}`].last_seen_at].map((d) => d.toISOString()), ['2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z']);
    assert.equal(byUser[`${member}:${CHROME}`].first_seen_at.toISOString(), '2026-10-22T00:00:00.000Z', '合并进来的账户按合并时间');
    assert.deepEqual([byUser[`${extOnly}:${CHROME}`].first_seen_at, byUser[`${extOnly}:${CHROME}`].last_seen_at].map((d) => d.toISOString()), ['2026-10-23T00:00:00.000Z', '2026-10-25T00:00:00.000Z']);
    assert.ok(!byUser[`${fresh}:${CHROME}`], '012 之后才出现的账户不归为 Chrome');
    assert.ok(byUser[`${fresh}:${EDGE}`]);
    assert.deepEqual(await migrate(pool), []);
  } finally { await pool.end(); }
});

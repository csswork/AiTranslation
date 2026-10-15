import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { createSession, validateWebSession } from '../src/auth/sessions.js';
import { adjustCredits, creditBalance, refundCredits, reserveCredits } from '../src/credits/ledger.js';
import { countCharacters, creditsToUnits, creditView, displayCredits } from '../src/credits/units.js';
import { transaction } from '../src/db/index.js';
import { parseSetting } from '../src/settings/index.js';
import { buildApp, createTestPool, resetData, signInWithEmail } from './helpers.mjs';

let pool;
before(async () => { pool = await createTestPool(); });
after(async () => { await pool?.end(); });
beforeEach(async () => { await resetData(pool); });

test('整数额度换算：500=1 点，显示两位小数不影响余额，金额解析无浮点乘法', () => {
  assert.equal(creditsToUnits('0.29'), 145n);
  assert.equal(creditsToUnits('999999999999.99'), 499999999999995n);
  assert.equal(displayCredits(1n), '0.00');
  assert.equal(displayCredits(3n), '0.01');
  assert.equal(displayCredits(499n), '1.00');
  assert.equal(displayCredits(500n), '1.00');
  assert.equal(displayCredits(-1n), '0.00', '不显示负零');
  assert.equal(displayCredits(-251n), '-0.50');
  assert.deepEqual(creditView(1n), { balance: '0.00', available: true });
  assert.deepEqual(creditView(0n), { balance: '0.00', available: false });
  for (const bad of ['-1', '0.001', '1e3', 'NaN', 'Infinity', '']) assert.throws(() => creditsToUnits(bad));
  assert.equal(countCharacters(['你好', '😀', 'a\n']), 5);
  assert.equal(parseSetting('guest_credits', '0.29'), '0.29');
  assert.equal(parseSetting('signup_credits', '0.001'), undefined);
  assert.equal(parseSetting('chars_per_credit', '1000'), undefined, '换算不再是可调运营规则');
});

async function account({ email = 'precision@example.com', hosted } = {}) {
  const calls = [];
  const model = hosted || (async ({ texts }) => {
    calls.push(texts);
    return { translations: texts, meta: { providerKey: 'primary', provider: 'fake', model: 'fake', fellBack: false } };
  });
  const { app, config, mailbox, settings } = buildApp({ pool, hosted: model });
  await settings.set('signup_credits', '1');
  const web = await signInWithEmail(app, config, mailbox, email);
  const auth = await validateWebSession(pool, config, web.jar.get('huaci_session'));
  const token = await createSession(pool, config, auth.user.id, 'extension', { webSessionId: auth.session.id });
  const request = (texts) => app.request(new URL('/api/extension/translate', config.appOrigin), {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ texts, target: 'en' }),
  });
  return { request, calls, userId: auth.user.id, web, config };
}

test('拆分与合并请求扣费相同；500 个字符严格扣 1 点，最后一个字符不会被显示舍入丢弃', async () => {
  const split = await account();
  for (let i = 0; i < 30; i++) assert.equal((await split.request(['x'])).status, 200);
  assert.equal(await creditBalance(pool, split.userId), 470n, '30 次各 0.002 点，没有最小 1 点扣费');
  let res = await split.request(['a'.repeat(469)]);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).credits, { balance: '0.00', available: true });
  assert.equal(await creditBalance(pool, split.userId), 1n);
  res = await split.request(['😀']);
  assert.equal(res.status, 200, '一个 emoji 是一个字符，剩余的 1 单位仍可使用');
  assert.deepEqual((await res.json()).credits, { balance: '0.00', available: false });
  assert.equal(await creditBalance(pool, split.userId), 0n);
  assert.equal((await split.request(['x'])).status, 402);

  const whole = await account({ email: 'whole@example.com' });
  res = await whole.request(['a'.repeat(250), 'b'.repeat(250)]);
  assert.equal((await res.json()).cost, '1.00');
  assert.equal(await creditBalance(pool, whole.userId), 0n);
  const { rows } = await pool.query('SELECT amount_units FROM credit_ledger WHERE user_id = $1 AND entry_type = \'usage\'', [split.userId]);
  assert.equal(rows.reduce((n, r) => n + BigInt(r.amount_units), 0n), -500n);
  assert.match(await split.web.text('/usage'), /0\.00/);
});

test('并发请求按精确余额串行预扣，余额不足不调用模型、不透支', async () => {
  const a = await account();
  await pool.query("UPDATE credit_ledger SET amount_units = 5 WHERE user_id = $1 AND entry_type = 'trial_grant'", [a.userId]);
  const responses = await Promise.all([a.request(['aaaa']), a.request(['bbbb'])]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 402]);
  assert.equal(a.calls.length, 1);
  assert.equal(await creditBalance(pool, a.userId), 1n);
  assert.equal((await a.request(['x'])).status, 200);
  assert.equal(await creditBalance(pool, a.userId), 0n);
});

test('跨多笔发放的预扣和失败返还逐单位准确，重复返还幂等，过期发放不复活', async () => {
  const a = await account();
  await pool.query('DELETE FROM credit_ledger WHERE user_id = $1', [a.userId]);
  for (const requestId of ['one', 'two']) await adjustCredits(pool, { userId: a.userId, amount: '0.01', reason: 'test', requestId });
  const { rows: [usage] } = await pool.query("INSERT INTO usage_events (user_id, kind, chars, cost_units, status) VALUES ($1, 'text', 6, 6, 'pending') RETURNING id", [a.userId]);
  await transaction(pool, async client => assert.equal(await reserveCredits(client, a.userId, 6n, usage.id), true));
  assert.equal(await creditBalance(pool, a.userId), 4n);
  const debits = (await pool.query("SELECT amount_units FROM credit_ledger WHERE entry_type = 'usage' ORDER BY amount_units")).rows;
  assert.deepEqual(debits.map(r => r.amount_units), ['-5', '-1']);
  await refundCredits(pool, usage.id);
  await refundCredits(pool, usage.id);
  assert.equal(await creditBalance(pool, a.userId), 10n);
  await pool.query("UPDATE credit_ledger SET expires_at = now() - interval '1 second' WHERE id = (SELECT id FROM credit_ledger WHERE entry_type = 'adjust' LIMIT 1)");
  assert.equal(await creditBalance(pool, a.userId), 5n);
});

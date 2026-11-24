/** 自愿分享的功能使用计数（src/lib/usage.js）与 providers.js 里的计数点。 */
import { installExtensionFixture } from './extension-fixture.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const store = {};
const changeListeners = [];
const messages = [];
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
      set: async (o) => {
        const changes = Object.fromEntries(Object.entries(o).map(([key, value]) => [key, { oldValue: store[key], newValue: structuredClone(value) }]));
        Object.assign(store, structuredClone(o));
        for (const listener of changeListeners) listener(changes, 'local');
      },
      remove: async (k) => { delete store[k]; },
    },
    onChanged: { addListener: (fn) => changeListeners.push(fn) },
  },
  runtime: { sendMessage: async (message) => { messages.push(message); } },
};
const load = (p) => new Function(fs.readFileSync(`${ROOT}/${p}`, 'utf8'))();
installExtensionFixture(chrome);
for (const file of ['languages', 'lang', 'settings', 'terms', 'cache', 'usage', 'providers']) load(`src/lib/${file}.js`);
const { AITrSettings: S, AITrProviders: P, AITrUsage: U } = globalThis;
const { create, memoryBackend } = globalThis.AITrCache;
globalThis.AITrCache = create({ backend: memoryBackend() });
globalThis.AITrAccount = { translate: async ({ texts }) => texts.map((text) => `托管:${text}`) };

const idle = () => new Promise((resolve) => setTimeout(resolve, 20));
const counts = async () => (await U.pending()).map(({ feature, provider, requests, failures }) => `${feature}/${provider}/${requests}/${failures}`).sort();
const reply = (content) => ({ ok: true, json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }) });
const settings = S.normalize({ provider: 'openai', target: 'zh-Hans', stream: false, openai: { apiKey: 'sk-test' }, deepseek: { apiKey: 'sk-ds' } });
const enable = (on) => S.saveSettings({ ...settings, shareUsage: on });
const collect = async (iter) => { let out = ''; for await (const chunk of iter) out += chunk; return out; };

/* 1. 默认关闭：什么都不记 */
{
  assert.equal(S.normalize({}).shareUsage, false, '默认关闭');
  assert.equal(S.normalize({ shareUsage: 'yes' }).shareUsage, false);
  await enable(false);
  globalThis.fetch = async () => reply('["一"]');
  await P.translateBatch({ texts: ['one'], settings, surface: 'reader' });
  await idle();
  assert.deepEqual(await counts(), []);
  console.log('✓ 默认关闭，不计数');
}

/* 2. 开启后：按功能与平台计数，点数翻译、无痕、未知功能不计；失败与取消分别处理 */
{
  await enable(true);
  globalThis.fetch = async (url, init) => reply(JSON.stringify(JSON.parse(JSON.parse(init.body).messages.at(-1).content).map((s) => `译:${s}`)));
  await P.translateBatch({ texts: ['a'], settings, surface: 'reader' });
  await P.translateBatch({ texts: ['b'], settings, surface: 'reader' });
  await P.translateBatch({ texts: ['c'], settings, providerId: 'deepseek', surface: 'pdf' });
  await P.translateBatch({ texts: ['d'], settings, surface: 'pdf', incognito: true });
  await P.translateBatch({ texts: ['e'], settings, surface: 'bogus' });
  await P.translateBatch({ texts: ['f'], settings: { ...settings, provider: 'hosted' }, surface: 'pdf' });

  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }), text: async () => 'bad key' });
  await assert.rejects(P.translateBatch({ texts: ['g'], settings, surface: 'site' }));
  globalThis.fetch = async () => { throw new DOMException('Aborted', 'AbortError'); };
  await assert.rejects(P.translateBatch({ texts: ['h'], settings, surface: 'site' }));

  // 单段：读到一半停下算一次成功
  globalThis.fetch = async () => reply('你好');
  assert.equal(await collect(P.translate({ text: 'hi', settings, surface: 'selection' })), '你好');
  for await (const _ of P.translate({ text: 'hey', settings, surface: 'selection' })) break;
  await idle();
  assert.deepEqual(await counts(), ['pdf/deepseek/1/0', 'reader/openai/2/0', 'selection/openai/2/0', 'site/openai/2/1']);
  console.log('✓ 按功能与平台计数；点数翻译、无痕、未知场景不计；失败计入、取消不算失败');
}

/* 3. 只查缓存：全部命中才算一次（部分命中由随后的 translateBatch 计） */
{
  await U.clear();
  globalThis.fetch = async (url, init) => reply(JSON.stringify(JSON.parse(JSON.parse(init.body).messages.at(-1).content).map((s) => `译:${s}`)));
  await P.translateBatch({ texts: ['Hello world.'], whole: [true], settings, surface: 'site' });
  await globalThis.AITrCache.flush();
  await U.clear();
  const all = await P.lookupBatch({ texts: ['Hello world.'], whole: [true], settings, surface: 'site' });
  assert.deepEqual(all, ['译:Hello world.']);
  const partial = await P.lookupBatch({ texts: ['Hello world.', 'Other text.'], whole: [true, true], settings, surface: 'site' });
  assert.equal(partial[1], null);
  await idle();
  assert.deepEqual(await counts(), ['site/openai/1/0']);
  console.log('✓ 缓存全部命中时计一次，部分命中不重复计');
}

/* 4. 发送：只发已结束的日子；收下或被拒后删除，失败留着重试；关闭开关清空 */
{
  await U.clear();
  const DAY = 86_400_000;
  const now = Date.now();
  await U.add({ feature: 'reader', provider: 'local', ok: true }, now - 2 * DAY);
  await U.add({ feature: 'reader', provider: 'local', ok: false }, now - 2 * DAY);
  await U.add({ feature: 'pdf', provider: 'deepl', ok: true }, now - DAY);
  await U.add({ feature: 'pdf', provider: 'deepl', ok: true }, now);
  await U.add({ feature: 'page', provider: 'openai', ok: true }, now - 40 * DAY);
  const queued = await U.pending();
  assert.equal(queued.length, 3, '超过 35 天的丢弃');
  assert.ok(queued.every((row) => /^[0-9a-f-]{36}$/.test(row.id)));

  const sent = [];
  assert.equal(await U.flush(async (rows) => { sent.push(rows); return 'retry'; }, now), 0);
  assert.equal((await U.pending()).length, 3, '失败时保留');
  assert.equal(await U.flush(async (rows) => { sent.push(rows); return 'sent'; }, now), 2);
  assert.deepEqual(sent[1].map(({ day, feature, provider, requests, failures }) => [day, feature, provider, requests, failures]), [
    [U.localDay(new Date(now - 2 * DAY)), 'reader', 'local', 2, 1],
    [U.localDay(new Date(now - DAY)), 'pdf', 'deepl', 1, 0],
  ]);
  assert.deepEqual(Object.keys(sent[1][0]).sort(), ['day', 'failures', 'feature', 'id', 'provider', 'requests'], '只发这几个字段');
  assert.deepEqual((await U.pending()).map((row) => row.day), [U.localDay(new Date(now))], '今天的留到明天');
  assert.equal(await U.flush(async () => { throw new Error('不应发送'); }, now), 0, '没有已结束的日子时不发');

  await U.add({ feature: 'pdf', provider: 'deepl', ok: true }, now - DAY);
  assert.equal(await U.flush(async () => 'rejected', now), 0);
  assert.equal((await U.pending()).length, 1, '被拒的丢弃，不反复重试');

  await enable(false);
  await idle();
  assert.deepEqual(await U.pending(), [], '关闭开关时清空');
  await enable(true);
  await U.add({ feature: 'pdf', provider: 'deepl', ok: true }, now - DAY);
  await S.saveSettings({ ...settings, shareUsage: false });
  assert.equal(await U.flush(async () => 'sent', now), 0, '关闭后不发送');
  console.log('✓ 只发已结束的日子；收下或被拒后删除、失败保留；关闭开关清空');
}

/* 5. 扩展页面里经消息交给 service worker 计数 */
{
  const source = fs.readFileSync(`${ROOT}/src/lib/usage.js`, 'utf8');
  globalThis.document = {};
  new Function(source)();
  globalThis.AITrUsage.record({ feature: 'pdf', provider: 'local', ok: true });
  globalThis.AITrUsage.record({ feature: 'pdf', provider: 'hosted', ok: true });
  delete globalThis.document;
  assert.deepEqual(messages, [{ type: 'usage-count', feature: 'pdf', provider: 'local', ok: true }]);
  const background = fs.readFileSync(`${ROOT}/src/background.js`, 'utf8');
  assert.match(background, /type === 'usage-count'[\s\S]{0,200}sender\.url[\s\S]{0,80}getURL/, '只接受扩展自己的页面');
  for (const page of ['reader/reader.html', 'pdf/pdf.html', 'image/image.html', 'translate/translate.html']) {
    const html = fs.readFileSync(`${ROOT}/src/${page}`, 'utf8');
    assert.ok(html.indexOf('../lib/usage.js') > 0 && html.indexOf('../lib/usage.js') < html.indexOf('../lib/providers.js'), page);
  }
  const account = fs.readFileSync(`${ROOT}/src/lib/account.js`, 'utf8');
  assert.match(account, /function signOutLocally[\s\S]{0,300}AITrUsage\?\.clear\(\)/, '本机退出登录时清空');
  console.log('✓ 扩展页面经消息计数；本机退出登录时清空');
}

import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const store = {};
globalThis.chrome = { storage: {
  local: {
    get: async (k) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
    set: async (o) => Object.assign(store, structuredClone(o)),
  },
  onChanged: { addListener() {} },
} };
new Function(fs.readFileSync(`${ROOT}/src/lib/sites.js`, 'utf8'))();
const { AITrSites: Sites } = globalThis;

/* 1. 名单上的域名覆盖它自己和子域名，不覆盖上级、兄弟或只是后缀相同的域名 */
{
  assert.equal(Sites.covers('2ch.sc', '2ch.sc'), true);
  assert.equal(Sites.covers('2ch.sc', 'nozomi.2ch.sc'), true, '子域名');
  assert.equal(Sites.covers('2ch.sc', 'a.b.2ch.sc'), true, '多级子域名');
  assert.equal(Sites.covers('2ch.sc', 'NOZOMI.2CH.SC'), true, '不分大小写');
  assert.equal(Sites.covers('nozomi.2ch.sc', '2ch.sc'), false, '子域名不覆盖上级');
  assert.equal(Sites.covers('nozomi.2ch.sc', 'ikura.2ch.sc'), false, '兄弟域名');
  assert.equal(Sites.covers('2ch.sc', 'x2ch.sc'), false, '只是后缀相同');
  assert.equal(Sites.covers('2ch.sc', ''), false);
  assert.equal(Sites.match(['2ch.sc', 'nozomi.2ch.sc', 'example.com'], 'nozomi.2ch.sc'), 'nozomi.2ch.sc', '优先最具体的一项');
  assert.equal(Sites.match(['2ch.sc', 'example.com'], 'ikura.2ch.sc'), '2ch.sc');
  assert.equal(Sites.match(['2ch.sc'], 'machi.to'), '');
  console.log('✓ 域名与子域名的覆盖关系');
}

/* 2. 开、关与设置页移除 */
{
  await Sites.set('2ch.sc', true);
  assert.equal(await Sites.has('nozomi.2ch.sc'), true, '开着上级域名时子域名也算开着');
  await Sites.set('ikura.2ch.sc', true);
  assert.deepEqual(await Sites.list(), ['2ch.sc'], '已被上级覆盖的子域名不重复记');

  store.siteTranslate = ['nozomi.2ch.sc', '2ch.sc', 'example.com'];
  await Sites.set('nozomi.2ch.sc', false);
  assert.deepEqual(await Sites.list(), ['example.com'], '在子域名上关闭：去掉所有覆盖它的项，否则仍会翻译');

  store.siteTranslate = ['nozomi.2ch.sc', '2ch.sc'];
  await Sites.set('2ch.sc', false);
  assert.deepEqual(await Sites.list(), ['nozomi.2ch.sc'], '在上级域名上关闭不动单独开着的子域名');

  store.siteTranslate = ['nozomi.2ch.sc', '2ch.sc'];
  await Sites.remove('nozomi.2ch.sc');
  assert.deepEqual(await Sites.list(), ['2ch.sc'], '设置页移除只去掉这一项');
  console.log('✓ 开关与移除按子域名处理');
}

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = new URL('../', import.meta.url).pathname;
execFileSync(process.execPath, ['scripts/build-extension-i18n.mjs', '--check'], { cwd: root, stdio: 'pipe' });
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const locales = read('extension-i18n/locales.json');
const en = read('extension-i18n/en.json');
const placeholders = (text) => [...text.matchAll(/\$(\d+)/g)].map((m) => m[1]).sort();
for (const locale of locales) {
  const catalog = locale.id === 'zh-Hans' ? Object.fromEntries(Object.keys(en).map((key) => [key, key])) : read(`extension-i18n/${locale.id}.json`);
  assert.deepEqual(Object.keys(catalog).sort(), Object.keys(en).sort());
  for (const [key, value] of Object.entries(catalog)) {
    assert.ok(value.trim(), `${locale.id}: ${key}`);
    assert.deepEqual(placeholders(value), placeholders(key), `${locale.id}: ${key}`);
    if (!['zh-Hans', 'zh-Hant', 'ja'].includes(locale.id)) assert.ok(!/\p{Script=Han}/u.test(value), `${locale.id}: unexpected Chinese text: ${key}`);
  }
}
let stored = { uiLanguage: 'ar' };
const changes = [];
const context = vm.createContext({ Intl, console, chrome: {
  i18n: { getUILanguage: () => 'en', getMessage: () => '' },
  storage: { local: { get: async () => ({ settings: stored }) }, onChanged: { addListener: (fn) => changes.push(fn) } },
  runtime: { getURL: (p) => p },
}, fetch: async (file) => ({ ok: true, json: async () => read(file) }) });
for (const file of ['languages', 'messages', 'i18n']) vm.runInContext(fs.readFileSync(path.join(root, `src/lib/${file}.js`), 'utf8'), context);
await context.AITrI18n.ready;
assert.equal(context.AITrI18n.locale(), 'ar');
assert.equal(context.AITrI18n.t('翻译'), read('extension-i18n/ar.json')['翻译']);
assert.ok(context.AITrI18n.t('翻译成$1', ['Test $2']).includes('Test $2'), 'Substitutions must be inserted once, as plain text');
stored = { uiLanguage: 'ur' };
await context.AITrI18n.reload();
assert.equal(context.AITrI18n.locale(), 'ur');
assert.equal(context.AITrI18n.t('翻译'), read('extension-i18n/ur.json')['翻译']);
console.log('24 complete catalogs, source freshness, placeholders and runtime language loading passed');

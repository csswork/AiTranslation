import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const code = (name) => fs.readFileSync(new URL(`src/lib/${name}.js`, root), 'utf8');
let stored, writes = 0, browserLocale = 'fr-CA';
const context = vm.createContext({ Intl, AbortController, DOMException, console,
  chrome: { i18n: { getUILanguage: () => browserLocale }, storage: { local: {
    get: async () => ({ settings: stored }), set: async (next) => { writes++; stored = next.settings; },
  } } },
  AITrI18n: { locale: () => 'en', t: (s, values = []) => s.replace(/\$(\d+)/g, (_, n) => String(values[n - 1] ?? '')) },
});
for (const name of ['languages', 'settings', 'lang', 'providers']) vm.runInContext(code(name), context);
const { AITrLanguages: L, AITrSettings: S, AITrLang: lang, AITrProviders: P } = context;
assert.equal(S.targetList().length, 24);
for (const [input, id] of Object.entries({ 'zh-HK': 'zh-Hant', 'zh_SG': 'zh-Hans', 'pt-PT': 'pt', 'ar-EG': 'ar', 'en-GB': 'en', 'xx': null })) assert.equal(L.match(input), id);
await S.migrateSettings();
assert.equal(stored.target, 'fr');
assert.equal(writes, 1);
browserLocale = 'ja-JP';
await S.migrateSettings();
assert.equal(stored.target, 'fr', 'An installed default must not follow later browser locale changes');
assert.equal(writes, 1);
stored = { provider: 'deepseek', target: 'zh-Hant', openai: { apiKey: 'local-key' }, videoEnabled: true, videoLang: 'ja-JP' };
await S.migrateSettings();
assert.equal(stored.target, 'zh-Hant');
assert.equal(stored.openai.apiKey, 'local-key');
assert.equal(stored.videoLang, 'ja');
assert.equal(stored.videoEnabled, true);
assert.equal(S.normalize({ provider: 'deepl' }).target, 'zh-Hans', 'Legacy installations retain the old default');
assert.equal(S.normalize(null).videoEnabled, false);
assert.equal(S.normalize({ schemaVersion: 2, uiLanguage: 'ar', target: 'de' }).target, 'de');
for (const text of ['你好', '繁體中文', '日本語', '한글', 'مرحبا', 'שלום', 'नमस्ते', 'বাংলা', 'สวัสดี', 'Hello 世界', 'a']) assert.equal(lang.shouldOffer(text), true, text);
for (const text of ['', '12345', '。!?', '🎉']) assert.equal(lang.shouldOffer(text), false, text);
let calls = [];
context.fetch = async (url, init) => {
  const body = init.body && JSON.parse(init.body);
  calls.push({ url, body });
  if (url.includes('/v3/languages')) return { ok: true, json: async () => [{ lang: 'fr', usable_as_target: true }, { lang: 'zh', usable_as_source: true }] };
  return { ok: true, json: async () => url.includes('/v2/translate') ? { translations: [{ text: 'Bonjour' }] } : { choices: [{ message: { content: 'Translated' } }] } };
};
let settings = S.normalize({ schemaVersion: 2, target: 'en', stream: false, openai: { apiKey: 'fake' } });
for (const target of S.targetList()) {
  for await (const _ of P.translate({ text: '你好', settings, targetId: target.id, sourceId: 'zh-Hans' })) {}
  const system = calls.at(-1).body.messages[0].content;
  assert.ok(system.includes(target.prompt), target.id);
  assert.ok(system.includes('Simplified Chinese'));
}
settings = S.normalize({ schemaVersion: 2, provider: 'deepl', target: 'fr', deepl: { apiKey: 'fake:fx' } });
for await (const _ of P.translate({ text: '你好', settings, sourceId: 'zh-Hans' })) {}
assert.equal(calls.at(-1).body.target_lang, 'FR');
assert.equal(calls.at(-1).body.source_lang, 'ZH');
const before = calls.length;
await assert.rejects(async () => { for await (const _ of P.translate({ text: 'hi', settings, targetId: 'ur' })) {} }, /DeepL/);
assert.equal(calls.length, before, 'Unsupported targets must not trigger translation with a substituted language');
await assert.rejects(async () => { for await (const _ of P.translate({ text: 'hi', settings, sourceId: 'ur' })) {} }, /DeepL/);
console.log('24 languages: migration, script handling, explicit directions and provider capability checks passed');

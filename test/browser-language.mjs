import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const script = (name) => fs.readFileSync(new URL(`src/lib/${name}.js`, root), 'utf8');
async function environment({ preferred, navigatorLanguages = [], ui = 'en-US', settings, failure = false, delay = 0 } = {}) {
  let stored = settings;
  const context = vm.createContext({ Intl,
    navigator: { languages: navigatorLanguages, language: navigatorLanguages[0] },
    chrome: {
      i18n: { getUILanguage: () => ui, getAcceptLanguages: async () => { if (failure) throw new Error('unavailable'); if (delay) await new Promise((resolve) => setTimeout(resolve, delay)); return preferred; }, getMessage: () => '' },
      storage: { local: { get: async () => ({ settings: stored }), set: async (value) => { stored = value.settings; } }, onChanged: { addListener() {} } },
      runtime: { getURL: (file) => file },
    },
    fetch: async (file) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(new URL(file, root), 'utf8')) }),
  });
  for (const name of ['languages', 'messages', 'i18n', 'settings']) vm.runInContext(script(name), context);
  await Promise.all([context.AITrI18n.ready, context.AITrSettings.migrateSettings()]);
  return { ...context, stored };
}
// Reproduce the mismatch in the service worker: English UI locale / Chinese preferences.
let app = await environment({ preferred: ['zh-CN', 'en-US', 'en'], navigatorLanguages: ['en-US'], delay: 20 });
assert.equal(app.AITrI18n.locale(), 'zh-Hans');
assert.equal(app.AITrI18n.t('翻译'), '翻译');
assert.equal(app.stored.target, 'zh-Hans', 'First installation must await preferred-language detection');
for (const [preferred, expected] of [
  [['zh-TW', 'en'], 'zh-Hant'], [['zh-HK'], 'zh-Hant'], [['zh-Hans-HK'], 'zh-Hans'],
  [['zh-Hant-CN'], 'zh-Hant'], [['xx-XX', 'ja-JP', 'en'], 'ja'], [['en-US', 'zh-CN'], 'en'],
]) {
  app = await environment({ preferred });
  assert.equal(app.AITrI18n.locale(), expected, preferred.join(','));
}
app = await environment({ preferred: [], navigatorLanguages: ['zh-Hans-CN'] });
assert.equal(app.AITrI18n.locale(), 'zh-Hans');
app = await environment({ failure: true, navigatorLanguages: ['zh-TW'] });
assert.equal(app.AITrI18n.locale(), 'zh-Hant');
app = await environment({ preferred: [], ui: 'de-DE' });
assert.equal(app.AITrI18n.locale(), 'de');
app = await environment({ preferred: ['xx'], ui: 'xx' });
assert.equal(app.AITrI18n.locale(), 'en');
app = await environment({ preferred: ['zh-CN'], settings: { schemaVersion: 2, uiLanguage: 'en', target: 'fr' } });
assert.equal(app.AITrI18n.locale(), 'en', 'Explicit interface choice overrides detection');
assert.equal(app.stored.target, 'fr', 'Detection must not overwrite a saved translation target');
app = await environment({ preferred: ['zh-CN'], settings: { schemaVersion: 2, uiLanguage: 'auto', target: 'en' } });
assert.equal(app.AITrI18n.locale(), 'zh-Hans');
assert.equal(app.stored.target, 'en');
console.log('Preferred-language detection, Chinese scripts, fallbacks and explicit settings passed');

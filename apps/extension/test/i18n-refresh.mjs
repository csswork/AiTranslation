import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const repo = new URL('../', import.meta.url).pathname;
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aitr-refresh-'));
const dir = path.join(workspace, 'apps/extension');
fs.mkdirSync(dir, { recursive: true });
const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
try {
  for (const name of ['scripts', 'i18n', 'src']) fs.mkdirSync(path.join(dir, name));
  for (const name of ['translate-extension-i18n.mjs', 'extension-messages.mjs']) fs.copyFileSync(path.join(repo, 'scripts', name), path.join(dir, 'scripts', name));
  write('i18n/locales.json', [{ id: 'en', prompt: 'English' }, { id: 'fr', prompt: 'French' }]);
  write('i18n/en.json', { 翻译: 'Translate' });
  write('i18n/fr.json', { 翻译: 'Traduire' });
  write('i18n/source-snapshot.json', { fr: { 翻译: 'Translate' } });
  fs.writeFileSync(path.join(dir, 'src/ui.js'), "t('翻译');");
  let calls = [];
  globalThis.fetch = async (_url, options) => {
    const local = fs.existsSync(path.join(dir, '.env.local'));
    assert.equal(options.headers.Authorization, `Bearer ${local ? 'app-fixture-only' : 'fixture-only'}`, 'Keep repository env fallback and app-local precedence');
    const body = JSON.parse(options.body);
    calls.push(body);
    const items = JSON.parse(body.messages[1].content);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ translations: items.map(({ id, source }) => ({ id, text: source === '关闭' ? body.messages[0].content.includes('into English') ? 'Close' : 'Fermer' : 'Traduire le texte' })) }) } }] }) };
  };
  const run = async (round) => import(pathToFileURL(path.join(dir, 'scripts/translate-extension-i18n.mjs')).href + `?round=${round}`);
  await run(1);
  assert.equal(calls.length, 0, 'Unchanged messages must not call the API');
  fs.writeFileSync(path.join(workspace, '.env.local'), 'DEEPSEEK_API_KEY=fixture-only');
  write('i18n/en.json', { 翻译: 'Translate text' });
  await run(2);
  assert.equal(calls.length, 1, 'Changed English must invalidate cached translations');
  assert.equal(calls[0].model, 'deepseek-flash');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'i18n/fr.json'))).翻译, 'Traduire le texte');
  fs.writeFileSync(path.join(dir, '.env.local'), 'DEEPSEEK_API_KEY=app-fixture-only');
  fs.appendFileSync(path.join(dir, 'src/ui.js'), "t('关闭');");
  await run(3);
  assert.equal(calls.length, 3, 'New UI messages refresh English and the target catalog');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'i18n/en.json'))).关闭, 'Close');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'i18n/fr.json'))).关闭, 'Fermer');
  await run(4);
  assert.equal(calls.length, 3, 'Repeated builds reuse the refreshed translations');
  write('i18n/locales.json', [{ id: 'en', prompt: 'English' }, { id: 'fr', prompt: 'French' }, { id: 'bn', prompt: 'Bengali' }]);
  write('i18n/bn.json', { 翻译: 'अनुवाद', 关闭: 'বন্ধ করুন' });
  const snapshots = JSON.parse(fs.readFileSync(path.join(dir, 'i18n/source-snapshot.json')));
  snapshots.bn = { 翻译: 'Translate text', 关闭: 'Close' };
  write('i18n/source-snapshot.json', snapshots);
  let bengaliCalls = 0;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.ok(body.messages[0].content.includes('into Bengali'));
    const items = JSON.parse(body.messages[1].content);
    assert.deepEqual(items.map((item) => item.source), ['翻译'], 'Keep valid Bengali cached');
    bengaliCalls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      translations: items.map(({ id }) => ({ id, text: bengaliCalls === 1 ? 'अनुवाद' : 'অনুবাদ করুন' })),
    }) } }] }) };
  };
  await run(5);
  assert.equal(bengaliCalls, 2, 'Repair cached Hindi and reject a Hindi model response before retrying');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'i18n/bn.json'))).翻译, 'অনুবাদ করুন');
  await run(6);
  assert.equal(bengaliCalls, 2, 'Repaired Bengali is cached on later builds');
  console.log('Local refresh: cache, content edits, new messages and Bengali script repair passed');
} finally { fs.rmSync(workspace, { recursive: true, force: true }); }

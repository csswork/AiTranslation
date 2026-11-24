import { installExtensionFixture } from './extension-fixture.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const store = {};
globalThis.chrome = { storage: { local: {
  get: async (k) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
  set: async (o) => Object.assign(store, structuredClone(o)),
  remove: async (k) => { delete store[k]; },
} } };
const load = (p) => new Function(fs.readFileSync(`${ROOT}/${p}`, 'utf8'))();
installExtensionFixture(chrome);
let chromeDetect = { isReliable: false, languages: [] };
chrome.i18n.detectLanguage = async () => chromeDetect;
load('src/lib/languages.js'); load('src/lib/lang.js'); load('src/lib/settings.js'); load('src/lib/terms.js');

/* 浏览器不支持时：不出现在平台列表里，已选的保留并给出原因 */
{
  load('src/lib/local.js'); load('src/lib/providers.js');
  const { AITrSettings: S, AITrProviders: P } = globalThis;
  assert.equal(S.localSupported(), false);
  assert.ok(!S.providerList('openai').some((p) => p.id === 'local'), '不支持时不列出');
  assert.ok(S.providerList('local').some((p) => p.id === 'local'), '已选中的仍然列出');
  const settings = S.normalize({ provider: 'local', target: 'zh-Hans' });
  await assert.rejects(P.translateBatch({ texts: ['Hello'], settings }), (e) => e.action === 'open-options' && /Chrome 或 Edge/.test(e.message));
  console.log('✓ 浏览器不支持时的列表与报错');
}

/* 假的内置 API：记录创建与翻译调用 */
const created = [];
const installed = new Set(['en>zh', 'zh>en', 'ja>zh', 'en>zh-Hant']);
let gesture = false;
globalThis.Translator = class {
  static async availability({ sourceLanguage: s, targetLanguage: t }) {
    if (s === 'fa' || t === 'fa') return 'unavailable';
    return installed.has(`${s}>${t}`) ? 'available' : 'downloadable';
  }
  static async create({ sourceLanguage: s, targetLanguage: t, monitor }) {
    if (s === 'fa' || t === 'fa') throw new DOMException('Unable to create translator', 'NotSupportedError');
    if (!installed.has(`${s}>${t}`)) {
      if (!gesture) throw new DOMException('Requires a user gesture', 'NotAllowedError');
      const target = new EventTarget();
      monitor?.(target);
      target.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: 1 }));
      installed.add(`${s}>${t}`);
    }
    created.push(`${s}>${t}`);
    const translator = new globalThis.Translator();
    translator.pair = `${s}>${t}`;
    return translator;
  }
  async translate(text) { return `[${this.pair}] ${text}`; }
};
const detections = {
  'Hello world, this is a test.': [{ detectedLanguage: 'en', confidence: 0.99 }],
  '这是中文。': [{ detectedLanguage: 'zh-Hans', confidence: 0.99 }],
  'これは日本語です。': [{ detectedLanguage: 'ja', confidence: 0.98 }],
  ok: [{ detectedLanguage: 'en', confidence: 0.3 }],
};
globalThis.LanguageDetector = class { static async create() { return { detect: async (text) => detections[text] || [{ detectedLanguage: 'und', confidence: 1 }] }; } };

load('src/lib/local.js'); load('src/lib/providers.js');
const { AITrSettings: S, AITrProviders: P, AITrLocal: L, AITrTerms: T } = globalThis;

/* 平台定义：不需要 Key、不能识图、不流式、不算自带 Key 的平台 */
{
  assert.equal(S.localSupported(), true);
  assert.ok(S.providerList('openai').some((p) => p.id === 'local' && p.label === '本机翻译'));
  assert.ok(!S.KEY_PROVIDERS.includes('local'), '不算自带 Key 的平台');
  assert.equal(S.normalize({ provider: 'local' }).provider, 'local');
  assert.equal(S.normalize({ provider: 'local' }).local, undefined, '不保存 Key 配置');
  assert.equal(S.supportsVision('local'), false);
  assert.equal(S.supportsStreaming('local'), false);
  assert.equal(S.needsModel('local'), false);
  assert.equal(S.resolveProvider(S.normalize({ provider: 'local' })).label, '本机翻译');
  console.log('✓ 平台定义');
}

/* 语言代码：简体中文是 zh，繁体是 zh-Hant，地区后缀去掉 */
{
  assert.equal(L.code('zh-Hans'), 'zh');
  assert.equal(L.code('zh-CN'), 'zh');
  assert.equal(L.code('zh-TW'), 'zh-Hant');
  assert.equal(L.code('zh-Hant'), 'zh-Hant');
  assert.equal(L.code('en-US'), 'en');
  assert.equal(L.code('pt-BR'), 'pt');
  assert.equal(L.code('sr'), 'sr');
  console.log('✓ 语言代码换算');
}

const settings = S.normalize({ provider: 'local', target: 'zh-Hans' });

/* 自动识别原文语言，按语言对翻译；原文已是目标语言时照原样返回；翻译器复用 */
{
  const out = await P.translateBatch({ texts: ['Hello world, this is a test.', '这是中文。', 'これは日本語です。', '  '], settings });
  assert.deepEqual(out, ['[en>zh] Hello world, this is a test.', '这是中文。', '[ja>zh] これは日本語です。', '  ']);
  await P.translateBatch({ texts: ['Hello world, this is a test.'], settings });
  assert.equal(created.filter((p) => p === 'en>zh').length, 1, '同一语言对只创建一次');
  console.log('✓ 自动识别、同语言原样返回、复用翻译器');
}

/* 显式源语言优先；繁体目标用 zh-Hant */
{
  let out = '';
  for await (const chunk of P.translate({ text: 'whatever', settings: S.normalize({ ...settings, target: 'zh-Hant' }), targetId: 'zh-Hant', sourceId: 'en' })) out += chunk;
  assert.equal(out, '[en>zh-Hant] whatever');
  console.log('✓ 显式源语言与繁体目标');
}

/* 低置信度时退回 chrome.i18n；都识别不出时提示手动选择 */
{
  chromeDetect = { isReliable: true, languages: [{ language: 'en', percentage: 100 }] };
  assert.deepEqual(await P.translateBatch({ texts: ['ok'], settings }), ['[en>zh] ok']);
  chromeDetect = { isReliable: false, languages: [{ language: 'sr', percentage: 100 }] };
  await assert.rejects(P.translateBatch({ texts: ['???'], settings }), /手动选择原文语言/);
  console.log('✓ 识别退回与识别失败');
}

/* 没下载的语言包：没有点击时提示去设置页；不支持的语言对说明原因 */
{
  const missing = await P.translateBatch({ texts: ['Hello world, this is a test.'], settings: S.normalize({ ...settings, target: 'ko' }), targetId: 'ko' }).catch((e) => e);
  assert.equal(missing.action, 'open-options');
  assert.match(missing.message, /本机还没有「.+ → .+」语言包/);
  const unsupported = await P.translateBatch({ texts: ['Hello world, this is a test.'], settings: S.normalize({ ...settings, target: 'fa' }), targetId: 'fa' }).catch((e) => e);
  assert.match(unsupported.message, /本机翻译不支持从/);
  console.log('✓ 缺语言包与不支持的语言对');
}

/* 设置页下载：点击时创建、报告进度，之后翻译直接可用 */
{
  gesture = true;
  const progress = [];
  assert.equal(await L.prepare({ sourceId: 'en', targetId: 'ko', onProgress: (v) => progress.push(v) }), 'available');
  gesture = false;
  assert.deepEqual(progress, [1]);
  assert.deepEqual(await P.translateBatch({ texts: ['Hello world, this is a test.'], settings: S.normalize({ ...settings, target: 'ko' }), targetId: 'ko' }), ['[en>ko] Hello world, this is a test.']);
  console.log('✓ 下载语言包后可用');
}

/* 用词偏好在译文里替换；不支持换说法和识图；测试连接 */
{
  await T.remember({ source: 'world', from: 'Hello', to: '你好', target: 'zh-Hans' });
  assert.deepEqual(await P.translateBatch({ texts: ['Hello world, this is a test.'], settings, targetId: 'zh-Hans' }), ['[en>zh] 你好 world, this is a test.']);
  await T.clear();
  await assert.rejects(P.alternatives({ source: 'a b', translation: 'c d', start: 0, end: 1, settings }), (e) => e.action === 'unsupported');
  await assert.rejects(P.readImageText({ image: 'data:', settings }), /只能翻译文本/);
  assert.deepEqual(await P.testConnection({ settings }), { model: '本机翻译', sample: '[en>zh] Hello! This is a connection test.' });
  assert.equal(await P.translateCaption({ text: 'Hello world, this is a test.', settings }), '[en>zh] Hello world, this is a test.');
  console.log('✓ 用词偏好、换说法、识图、测试连接与字幕');
}

/* 换说法：本机翻译和 DeepL 不支持，界面不出现可点的词 */
{
  assert.equal(S.supportsAlternatives('local'), false);
  assert.equal(S.supportsAlternatives('deepl'), false);
  assert.equal(S.supportsAlternatives('hosted'), true);
  assert.equal(S.supportsAlternatives('openai'), true);
  console.log('✓ 换说法的支持情况');
}

/* 语言下拉：本机翻译只列已下载的语言，当前选中的保留；其他平台不变 */
{
  const list = S.targetList();
  const pairs = await L.installedPairs();
  assert.ok(pairs.some(([s, t]) => s === 'en' && t === 'zh-Hans'), '已下载的语言对按项目语言 id');
  assert.ok(pairs.some(([s, t]) => s === 'en' && t === 'ko'), '刚下载的语言对立即出现');
  const targets = (await L.limit(list, { providerId: 'local', keep: 'fr' })).map((item) => item.id);
  assert.deepEqual(targets.sort(), ['en', 'fr', 'ko', 'zh-Hans', 'zh-Hant'].sort());
  const sources = (await L.limit(list, { providerId: 'local', role: 'source', target: 'zh-Hans' })).map((item) => item.id);
  assert.deepEqual(sources.sort(), ['en', 'ja'].sort());
  assert.equal((await L.limit(list, { providerId: 'openai' })).length, list.length, '其他平台不过滤');
  console.log('✓ 语言下拉只列已下载的语言');
}

/* 「下载更多语言…」：只在本机翻译时出现，选中后恢复原值并打开设置页 */
{
  const opened = [];
  chrome.runtime = { getURL: (path) => `chrome-extension://id/${path}` };
  chrome.tabs = { create: (args) => opened.push(args.url) };
  const options = [];
  const select = { value: 'zh-Hans', ownerDocument: { createElement: () => ({}) }, append: (option) => options.push(option) };
  L.addMoreOption(select, 'openai');
  assert.equal(options.length, 0);
  L.addMoreOption(select, 'local');
  assert.equal(options[0].value, L.MORE);
  assert.equal(L.pickedMore(select, 'zh-Hans'), false);
  select.value = L.MORE;
  assert.equal(L.pickedMore(select, 'zh-Hans'), true);
  assert.equal(select.value, 'zh-Hans');
  assert.deepEqual(opened, ['chrome-extension://id/src/options/options.html#local']);
  console.log('✓ 下载更多语言');
}

console.log('\n全部通过');

/** 商店评价邀请（src/lib/review.js）：本机使用天数与出现时机。 */
import { installExtensionFixture } from './extension-fixture.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const store = {};
globalThis.chrome = {
  storage: { local: {
    get: async (k) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
    set: async (o) => Object.assign(store, structuredClone(o)),
    remove: async (k) => { delete store[k]; },
  } },
  runtime: { sendMessage: async () => {} },
};
const load = (p) => new Function(fs.readFileSync(`${ROOT}/${p}`, 'utf8'))();
installExtensionFixture(chrome);
for (const file of ['languages', 'lang', 'settings', 'review', 'usage']) load(`src/lib/${file}.js`);
const { AITrReview: R, AITrUsage: U } = globalThis;

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 22, 12).getTime();
const at = (daysAgo) => NOW - daysAgo * DAY;
const day = (daysAgo) => { const d = new Date(at(daysAgo)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const state = (daysAgo, extra = {}) => ({ first: day(Math.max(...daysAgo)), days: daysAgo.map(day).sort(), total: daysAgo.length, ...extra });
// 40 天前开始，累计 12 天，最近 14 天里 4 天
const steady = [40, 35, 30, 27, 24, 21, 18, 16, 10, 6, 3, 1];

/* 1. 出现条件 */
{
  assert.equal(R.eligible(state(steady), NOW), true);
  assert.equal(R.eligible(state([29, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2, 1]), NOW), false, '首次使用不满 30 天');
  assert.equal(R.eligible(state(steady.slice(1)), NOW), false, '累计不到 12 天');
  assert.equal(R.eligible(state([60, 55, 50, 45, 40, 35, 30, 27, 24, 21, 18, 10, 6, 3]), NOW), false, '最近 14 天只用了 3 天');
  assert.equal(R.eligible(state(steady, { total: 30 }), NOW), true, '累计数不受只保留 60 天的影响');
  assert.equal(R.eligible(state(steady, { done: true }), NOW), false, '已评价或不再提示');
  assert.equal(R.eligible(state(steady, { shown: 3 }), NOW), false, '最多 3 次');
  assert.equal(R.eligible(state(steady, { snoozeUntil: NOW + 1 }), NOW), false, '距上次不满 30 天');
  assert.equal(R.eligible({}, NOW), false);
  console.log('✓ 满 30 天、累计 12 天、最近 14 天 4 天才出现；已评价、次数上限与间隔');
}

/* 2. 记录：只记成功的自带 Key 调用，同一天一次；无痕、点数与本机翻译不计 */
{
  for (const [i, d] of steady.entries()) {
    await R.note({ provider: i % 2 ? 'deepseek' : 'openai', ok: true }, at(d));
    await R.note({ provider: 'deepl', ok: true }, at(d)); // 同一天再记一次
  }
  await R.note({ provider: 'openai', ok: false }, at(2));
  await R.note({ provider: 'local', ok: true }, at(2));
  await R.note({ provider: 'hosted', ok: true }, at(2));
  let saved = await R.read();
  assert.equal(saved.total, 12);
  assert.equal(saved.first, day(40));
  assert.ok(!saved.days.includes(day(2)), '失败、本机与点数翻译不算');

  // 经 usage.js 的计数点：无痕不计；不依赖分享开关
  await S_save({ shareUsage: false });
  U.record({ feature: 'reader', provider: 'deepl', ok: true, incognito: true });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await R.read()).total, 12, '无痕不计');
  U.record({ feature: 'reader', provider: 'deepl', ok: true });
  await new Promise((r) => setTimeout(r, 20));
  saved = await R.read();
  assert.equal(saved.total, 13, '分享开关关闭时也在本机记录');
  assert.deepEqual(Object.keys(store).sort(), ['reviewPrompt', 'settings'], '分享队列没有写入');
  console.log('✓ 只记成功的自带 Key 调用，每天一次；无痕不计；与分享开关无关');
}

/* 3. 出现、以后再说、去评价 */
{
  store.reviewPrompt = state(steady);
  assert.equal(await R.check(NOW), true);
  assert.equal(await R.check(NOW), false, '刚出现过，30 天内不再出现');
  await R.act('later');
  assert.equal(await R.check(NOW + 29 * DAY), false);
  // 30 天后仍在用才再问
  store.reviewPrompt = { ...(await R.read()), days: [...steady.map(day), day(-31), day(-33), day(-35), day(-37)].sort() };
  assert.equal(await R.check(NOW + 38 * DAY), true);
  await R.act('rate');
  assert.equal(await R.check(NOW + 90 * DAY), false, '去评价后不再出现');
  console.log('✓ 出现后记下，以后再说 30 天后再问，去评价后不再出现');
}

/* 4. 设置页与商店链接 */
{
  const options = fs.readFileSync(`${ROOT}/src/options/options.js`, 'utf8');
  assert.match(options, /onboarding === 'pending' \|\| location\.hash/, '引导中或从语言下拉跳来时不打扰');
  const env = fs.readFileSync(`${ROOT}/src/lib/env.js`, 'utf8');
  assert.match(env, /hogimafgjmlpdlnepojgigjkhaccbcbj\/reviews/);
  assert.match(env, /addons\.mozilla\.org\/firefox\/addon\/huaci-ai-translator\/reviews/);
  assert.match(options, /if \(!reviewPreview\) chrome\.runtime\.sendMessage\(\{ type: 'review-action'/, '预览时按钮不改记录');
  const devTools = fs.readFileSync(`${ROOT}/src/options/dev-tools.js`, 'utf8');
  assert.match(devTools, /if \(!globalThis\.AITrEnv\?\.dev\) return;/, '开发工具只在开发版出现');
  assert.match(devTools, /aitr-review-preview/);
  const html = fs.readFileSync(`${ROOT}/src/options/options.html`, 'utf8');
  assert.ok(html.indexOf('src="../lib/review.js"') > 0 && html.indexOf('src="../lib/review.js"') < html.indexOf('src="dev-tools.js"'));
  console.log('✓ 设置页时机、开发工具预览与各商店评价链接');
}

async function S_save(patch) {
  await globalThis.AITrSettings.saveSettings({ ...(await globalThis.AITrSettings.loadSettings()), ...patch });
}

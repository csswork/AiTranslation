/**
 * 宣传站的语言选择逻辑（docs/lang.js）：
 *   - localStorage 里选过 → 一切以选择为准
 *   - 没选过 → 按 navigator.languages 判断，认不出就落到 fallback
 *   - 爬虫 / 无头浏览器不跳转（否则 Googlebot 会把中文原文跳没）
 *   - 切换器列出所有启用语言 + 「自动」，选择后记住并跳转
 * lang.js 是生成产物，这里用打桩的 document/navigator/localStorage/location 直接跑它。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const CODE = fs.readFileSync(ROOT + 'docs/lang.js', 'utf8');

function boot({ pathname = '/', langs = ['en-US'], stored = null, attrs = {}, crawler = false, webdriver = false } = {}) {
  const state = { replaced: [], store: stored, href: '' };
  const makeEl = (tag) => {
    const el = { tagName: tag, children: [], attrs: {}, value: '', textContent: '', selected: false, listeners: {} };
    el.appendChild = (c) => el.children.push(c);
    el.setAttribute = (k, v) => { el.attrs[k] = v; };
    el.addEventListener = (type, fn) => { el.listeners[type] = fn; };
    return el;
  };
  const box = makeEl('span');
  const document = {
    documentElement: { getAttribute: (k) => (k in attrs ? attrs[k] : null) },
    readyState: 'complete',
    querySelector: (sel) => (sel === '[data-lang-switcher]' ? box : null),
    createElement: makeEl,
    addEventListener: () => {},
  };
  const navigator = {
    languages: langs,
    language: langs[0] || '',
    userAgent: crawler ? 'Mozilla/5.0 (compatible; Googlebot/2.1)' : 'Mozilla/5.0 (Macintosh) Chrome/154',
    webdriver: webdriver,
  };
  const localStorage = {
    getItem: () => state.store,
    setItem: (k, v) => { state.store = v; },
    removeItem: () => { state.store = null; },
  };
  const location = {
    pathname, search: '', hash: '', href: '',
    replace: (u) => state.replaced.push(u),
  };
  new Function('document', 'navigator', 'localStorage', 'location', CODE)(document, navigator, localStorage, location);
  const select = box.children[0] || null;
  return { state, box, select, location };
}

const target = (t) => (t.state.replaced[0] || null);

/* ---- 1. 没选过：按浏览器语言走 ---- */
{
  assert.equal(target(boot({ pathname: '/', langs: ['en-US'] })), '/en/', 'en-US 应跳到 /en/');
  assert.equal(target(boot({ pathname: '/privacy.html', langs: ['en-GB'] })), '/en/privacy.html', '换页也要保留路径');
  assert.equal(target(boot({ pathname: '/', langs: ['zh-CN'] })), null, '中文用户留在 /');
  assert.equal(target(boot({ pathname: '/en/', langs: ['zh-CN'] })), '/', '中文用户从 /en/ 回 /');
  assert.equal(target(boot({ pathname: '/', langs: ['th-TH', 'ja-JP'] })), '/en/', '都不认时落到 fallback（en）');
  assert.equal(target(boot({ pathname: '/', langs: ['ja-JP', 'en-US'] })), '/en/', '未启用的语言顺延到下一个可认的');
  console.log('✓ 没选过时按浏览器语言判断（含后备与路径保留）');
}

/* ---- 2. 选过：以选择为准 ---- */
{
  assert.equal(target(boot({ pathname: '/', langs: ['en-US'], stored: 'zh-Hans' })), null, '选了中文就不再跳');
  assert.equal(target(boot({ pathname: '/', langs: ['zh-CN'], stored: 'en' })), '/en/', '选了英文就跳英文');
  assert.equal(target(boot({ pathname: '/en/changelog.html', langs: ['en-US'], stored: 'zh-Hans' })), '/changelog.html', '从英文页切回中文');
  assert.equal(target(boot({ pathname: '/', langs: ['en-US'], stored: 'auto' })), '/en/', '「自动」等于没选过');
  console.log('✓ 手动选择优先于浏览器语言');
}

/* ---- 3. 爬虫与无头浏览器不跳 ---- */
{
  assert.equal(target(boot({ pathname: '/', langs: ['en-US'], stored: 'en', crawler: true })), null, 'Googlebot 不该被跳走');
  assert.equal(target(boot({ pathname: '/', langs: ['en-US'], stored: 'en', webdriver: true })), null, '自动化环境不跳');
  assert.equal(target(boot({ pathname: '/', langs: ['en-US'], stored: 'en', attrs: { 'data-no-redirect': 'true' } })), null, 'data-no-redirect 生效');
  console.log('✓ 爬虫 / 无头 / data-no-redirect 一律不跳');
}

/* ---- 4. 404 页：按语言送回首页，而不是停在死地址 ---- */
{
  assert.equal(target(boot({ pathname: '/nope', langs: ['en-US'], stored: 'en', attrs: { 'data-lang-home': 'true' } })), '/en/', '404 送去该语言的首页');
  assert.equal(target(boot({ pathname: '/nope', langs: ['zh-CN'], attrs: { 'data-lang-home': 'true' } })), null, '中文用户留在中文 404');
  console.log('✓ 404 页按语言回首页');
}

/* ---- 5. 切换器 ---- */
{
  const t = boot({ pathname: '/', langs: ['zh-CN'] });
  assert.ok(t.select, '应当生成 <select>');
  const values = t.select.children.map((o) => o.value);
  assert.deepEqual(values, ['zh-Hans', 'en', 'auto'], '选项 = 启用语言 + 自动');
  assert.equal(t.select.children.find((o) => o.value === 'zh-Hans').selected, true, '当前语言选中');
  assert.equal(t.select.children.find((o) => o.value === 'auto').selected, true, '没选过时显示「自动」');
  assert.ok(t.select.attrs['aria-label'], '下拉要有 aria-label');

  // 手动选英文：写进 localStorage 并跳转
  const t2 = boot({ pathname: '/changelog.html', langs: ['zh-CN'] });
  t2.select.value = 'en';
  t2.select.listeners.change();
  assert.equal(t2.state.store, 'en', '选择要记住');
  assert.equal(t2.location.href, '/en/changelog.html', '选择后跳到该语言的同一页');

  // 选「自动」：清掉记录
  const t3 = boot({ pathname: '/en/', langs: ['zh-CN'], stored: 'en' });
  t3.select.value = 'auto';
  t3.select.listeners.change();
  assert.equal(t3.state.store, null, '「自动」应清掉记录');
  assert.equal(t3.location.href, '/', '回到浏览器语言对应的页面');
  console.log('✓ 切换器：列全语言、记住选择、支持回到「自动」');
}

console.log('\n全部通过');
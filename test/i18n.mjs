/**
 * 宣传站多语言：产物必须和中文源同步。
 *
 * 中文页面（docs/*.html）是唯一的源；改了中文却没跑 node i18n/build.mjs，
 * 英文页就会落后。这里把三种常见事故都拦下来：
 *   1. 有段没译 / 译文对不上中文（build.mjs --check）
 *   2. 生成本身没同步（同样由 --check 兜住）
 *   3. 生成出来的页面里还留着中文、相对链接或缺失的 hreflang
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const CONFIG = JSON.parse(fs.readFileSync(ROOT + 'i18n/locales.json', 'utf8'));
const enabled = CONFIG.locales.filter((l) => l.enabled);
const PAGES = ['index.html', 'privacy.html', 'changelog.html'];

/* ---- 1. 工具自检：缺译、过期产物、hreflang 失配都在这里报 ---- */
try {
  const out = execFileSync(process.execPath, ['i18n/build.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /一致/, '--check 应当打印通过信息');
  console.log('✓ 多语言产物与中文源一致（' + out.trim().split('\n').pop() + '）');
} catch (err) {
  assert.fail('i18n --check 失败：\n' + (err.stdout || '') + (err.stderr || err.message));
}

/* ---- 2. 每个启用语言都要有完整译文 ---- */
{
  const zh = JSON.parse(fs.readFileSync(ROOT + 'i18n/' + CONFIG.base + '.json', 'utf8'));
  for (const loc of enabled) {
    if (loc.code === CONFIG.base) continue;
    const cat = JSON.parse(fs.readFileSync(ROOT + 'i18n/' + loc.code + '.json', 'utf8'));
    const missing = Object.keys(zh).filter((k) => !cat[k]);
    assert.deepEqual(missing, [], loc.code + ' 缺 ' + missing.length + ' 条译文');
    // 日语与繁体中文本来就用汉字，这两条检查只对拉丁/西里尔/阿拉伯/谚文语言成立
    if (loc.usesHan) {
      const han = Object.values(cat).filter((v) => /[\u3400-\u9FFF]/.test(v)).length;
      console.log('✓ ' + loc.code + '：' + Object.keys(cat).length + ' 条译文，无缺漏（' + han + ' 条含汉字，符合该语言）');
    } else {
      const withHan = Object.entries(cat).filter(([, v]) => /[\u3400-\u9FFF]/.test(v));
      assert.deepEqual(withHan.map(([k]) => k.slice(0, 30)), [], loc.code + ' 的译文里还留着汉字');
      console.log('✓ ' + loc.code + '：' + Object.keys(cat).length + ' 条译文，无缺漏、无残留中文');
    }
    // 繁体中文不该出现简体字：简繁同形字太多，这里只查一批只存在于简体里的字
    if (loc.code === 'zh-Hant') {
      const SIMPLIFIED = /[这个说时发对们应该会与网设软视频档数据语译扩页图键连关选择认让记请谢读终备]/;
      const bad = Object.entries(cat).filter(([, v]) => SIMPLIFIED.test(v));
      assert.deepEqual(bad.map(([k]) => k.slice(0, 30)), [], 'zh-Hant 里混进了简体字');
    }
  }
}

/* ---- 2b. 语言切换器不能被卷进翻译目录 ---- */
{
  const zh = JSON.parse(fs.readFileSync(ROOT + 'i18n/' + CONFIG.base + '.json', 'utf8'));
  const leaked = Object.entries(zh).filter(([k, v]) => /data-lang-switcher|notranslate|class="lang"/.test(k + v));
  assert.deepEqual(leaked.map(([k]) => k.slice(0, 40)), [], '语言切换器的标记混进了待译清单');
  for (const loc of enabled) {
    if (loc.code === CONFIG.base) continue;
    for (const page of PAGES) {
      const html = fs.readFileSync(ROOT + 'docs/' + loc.path + '/' + page, 'utf8');
      assert.match(html, /class="lang notranslate" translate="no"/, loc.code + '/' + page + '：切换器缺 translate="no"');
    }
  }
  console.log('✓ 语言切换器带 translate="no"，且没有进入任何语言的待译清单');
}

/* ---- 3. 生成页面的硬性要求 ---- */
{
  for (const loc of enabled) {
    if (loc.code === CONFIG.base) continue;
    const prefix = '/' + loc.path + '/';
    for (const page of PAGES) {
      const file = ROOT + 'docs/' + loc.path + '/' + page;
      assert.ok(fs.existsSync(file), file + ' 不存在，跑一次 build.mjs');
      const html = fs.readFileSync(file, 'utf8');
      // 不剥 <svg>：首屏示意图里的 <text> 也是要翻的文案，剥掉就查不出漏译
      const stripped = html
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ');
      if (!loc.usesHan) {
        const han = stripped.match(/[\u3400-\u9FFF]+/g) || [];
        assert.deepEqual(han.slice(0, 5), [], loc.code + '/' + page + ' 还有没翻的中文：' + han.slice(0, 5).join(' / '));
      }
      assert.match(html, new RegExp('<html lang="' + loc.htmlLang + '" data-locale="' + loc.code + '"'), file + ' 的 <html> 不对');
      assert.ok(html.includes('href="' + CONFIG.site + (loc.path ? prefix : '/') + (page === 'index.html' ? '' : page) + '"'), file + ' 缺 canonical');
      assert.ok(html.includes('data-lang-switcher'), file + ' 缺语言切换器');
      assert.ok(html.includes('src="/lang.js"'), file + ' 缺 lang.js');
      // 相对链接在子目录里会指错地方
      const rel = [...html.matchAll(/(?:href|src)="(?!https?:|mailto:|#|\/)([^"]*)"/g)].map((m) => m[1]);
      assert.deepEqual(rel, [], file + ' 还有相对链接：' + rel.join(', '));
    }
    // hreflang 要把所有启用语言都列全
    const html = fs.readFileSync(ROOT + 'docs/' + loc.path + '/index.html', 'utf8');
    for (const other of enabled) {
      assert.ok(html.includes('hreflang="' + other.htmlLang + '"'), loc.code + '/index.html 缺 ' + other.htmlLang + ' 的 hreflang');
    }
    assert.ok(html.includes('hreflang="x-default"'), loc.code + '/index.html 缺 x-default');
    console.log('✓ ' + loc.code + '：' + PAGES.length + ' 个页面都已生成、无残留中文、hreflang 齐全');
  }
}

/* ---- 4. sitemap / robots / lang.js 与配置一致 ---- */
{
  const sitemap = fs.readFileSync(ROOT + 'docs/sitemap.xml', 'utf8');
  const robots = fs.readFileSync(ROOT + 'docs/robots.txt', 'utf8');
  for (const loc of enabled) {
    const url = CONFIG.site + (loc.path ? '/' + loc.path + '/' : '/');
    assert.ok(sitemap.includes('<loc>' + url + '</loc>'), 'sitemap 缺 ' + url);
  }
  assert.ok(robots.includes(CONFIG.site + '/sitemap.xml'), 'robots.txt 没指向 sitemap');
  const lang = fs.readFileSync(ROOT + 'docs/lang.js', 'utf8');
  for (const loc of enabled) assert.ok(lang.includes('"code":"' + loc.code + '"'), 'lang.js 缺 ' + loc.code);
  for (const loc of CONFIG.locales.filter((l) => !l.enabled)) {
    assert.ok(!lang.includes('"code":"' + loc.code + '"'), 'lang.js 不该出现未启用的 ' + loc.code);
  }
  console.log('✓ sitemap / robots.txt / lang.js 与 locales.json 一致（' + enabled.length + ' 种启用语言）');
}

console.log('\n全部通过');
/**
 * huaci.app 宣传站的多语言工具（无第三方依赖）。
 *
 * 中文页面 docs/*.html 是唯一的源：
 *   node i18n/build.mjs                 # 抽取中文段 + 生成所有启用的语言 + sitemap + lang.js
 *   node i18n/build.mjs --check         # 只检查：没译的段、过期产物、失配的 hreflang（CI 用）
 *   node i18n/build.mjs --coverage      # 检查中文页里有没有漏抽的段
 *   node i18n/build.mjs --extract       # 只把中文段抽到 i18n/zh-Hans.json
 *   node i18n/build.mjs --locale en     # 只生成某个语言
 *   node i18n/build.mjs --translate en  # 用 API 补该语言缺失的段（需要环境变量里的 Key）
 *
 * 译文按「段」存，键就是中文原文：
 *   文本段：叶子级元素的 innerHTML，行内标签（<a>、<span class=mono>）原样保留在里面
 *   属性段：'@title|原文'、'@aria-label|原文'、'@meta:og:title|原文'
 * 中文一改，旧键消失、新键出现，--check 会列出来要重译哪些。
 *
 * 不改的东西：<svg> 子树（首屏示意图是产品截图，保持原样）、HTML 注释、class/href 等非文案属性。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DOCS = path.join(ROOT, 'docs');
// 本文件所在的 i18n/ 就是译文目录：locales.json + 每种语言一个 <code>.json
const CATALOG_DIR = HERE;
const CONFIG = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, 'locales.json'), 'utf8'));
const SITE = CONFIG.site;
const BASE = CONFIG.base;
/** 404 只做中文一份：Vercel 只会给它自己的 404.html，语言靠切换器兜底 */
const SKIP_GENERATE = new Set(['404.html']);
const PAGES = fs.readdirSync(DOCS).filter((f) => f.endsWith('.html')).sort();
const GEN_PAGES = PAGES.filter((p) => !SKIP_GENERATE.has(p));

const VOID_TAGS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const SKIP_TAGS = new Set(['script','style','svg']);
/** 块级元素：父级里出现带中文的块级子元素时，父级不成段，交给子元素各自成段 */
const BLOCK = new Set(['address','article','aside','blockquote','body','caption','dd','details','dialog','div','dl','dt','fieldset','figcaption','figure','footer','form','h1','h2','h3','h4','h5','h6','head','header','hr','html','li','main','nav','noscript','ol','p','pre','section','select','summary','table','tbody','td','tfoot','th','thead','title','tr','ul']);
const TEXT_ATTRS = new Set(['title','aria-label','alt']);
const META_KEYS = new Set(['description','og:title','og:description','og:image:alt','og:site_name']);
const CJK = /[\u3400-\u9FFF]/;
const ALT_START = '<!-- i18n:alternates -->';
const ALT_END = '<!-- /i18n:alternates -->';

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const read = (p) => fs.readFileSync(p, 'utf8');
const pagePath = (page) => path.join(DOCS, page);
const byCode = (code) => CONFIG.locales.find((l) => l.code === code);
const enabled = () => CONFIG.locales.filter((l) => l.enabled);

/* ------------------------------------------------------------------ 扫描 */

/**
 * 把一页里的可译段扫出来：{ start, end, key, kind, tag }。
 * 规则：某个元素有中文、且没有子孙元素已经成段 → 它自己成段（innerHTML 整段翻译）。
 */
function scan(html) {
  const edits = [];
  const stack = [];
  const skip = [];
  const re = /<!--[\s\S]*?-->|<[^>]*>|[^<]+/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tok = m[0];
    const start = m.index;
    if (tok.startsWith('<!--')) continue;
    if (tok[0] !== '<') {
      if (skip.length === 0 && CJK.test(tok)) for (const el of stack) el.hasCJK = true;
      continue;
    }
    if (tok.startsWith('</')) {
      const tag = tok.slice(2).replace(/[\s>].*$/, '').toLowerCase();
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i -= 1) if (stack[i].tag === tag) { idx = i; break; }
      if (idx === -1) continue;
      if (SKIP_TAGS.has(tag)) {
        const at = skip.lastIndexOf(tag);
        if (at !== -1) skip.splice(at, 1);
      }
      // 逐个弹出（正常只弹一个；标签没闭合时把中间那些一起关掉），关闭时决定要不要成段
      while (stack.length > idx) {
        const el = stack.pop();
        if (el.hasCJK && !el.blockCJK && !el.skipped && !SKIP_TAGS.has(el.tag)) {
          const key = norm(html.slice(el.innerStart, start));
          if (key && CJK.test(key)) edits.push({ start: el.innerStart, end: start, key, kind: 'text', tag: el.tag });
        }
        const parent = stack[stack.length - 1];
        if (parent && !parent.skipped) {
          if (el.hasCJK) parent.hasCJK = true;
          // 子元素是块级、或它内部还有块级中文、或它带着要单独翻的属性 → 父级不许整段吞掉
          if (el.blockCJK || el.hasTextAttr || (BLOCK.has(el.tag) && el.hasCJK)) parent.blockCJK = true;
        }
      }
      continue;
    }
    const nameMatch = /^<([a-zA-Z][-a-zA-Z0-9]*)/.exec(tok);
    if (!nameMatch) continue;
    const tag = nameMatch[1].toLowerCase();
    const selfClose = /\/>\s*$/.test(tok);
    if (skip.length > 0) { if (!selfClose && !VOID_TAGS.has(tag)) stack.push({ tag, innerStart: start + tok.length, hasCJK: false, blockCJK: false, hasTextAttr: false, skipped: true }); continue; }
    // 属性：只认白名单，值里得有中文
    const attrs = {};
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
    let a;
    while ((a = attrRe.exec(tok)) !== null) attrs[a[1].toLowerCase()] = { value: a[2], at: start + a.index + a[0].indexOf('"') + 1 };
    let textAttr = false;
    for (const [attrName, info] of Object.entries(attrs)) {
      if (!info.value || !CJK.test(info.value)) continue;
      let key = null;
      if (TEXT_ATTRS.has(attrName)) key = '@' + attrName + '|' + norm(info.value);
      else if (tag === 'meta' && attrName === 'content') {
        const name = (attrs.name && attrs.name.value) || (attrs.property && attrs.property.value);
        if (name && META_KEYS.has(name.toLowerCase())) key = '@meta:' + name.toLowerCase() + '|' + norm(info.value);
      }
      if (!key) continue;
      textAttr = true;
      edits.push({ start: info.at, end: info.at + info.value.length, key, kind: 'attr', tag });
    }
    if (SKIP_TAGS.has(tag)) skip.push(tag);
    if (!selfClose && !VOID_TAGS.has(tag)) stack.push({ tag, innerStart: start + tok.length, hasCJK: false, blockCJK: false, hasTextAttr: textAttr });
  }
  edits.sort((x, y) => x.start - y.start);
  return edits;
}

/** 去掉被外层文本段包住的属性段（外层整段替换时它们会被一并换掉） */
function pruneNested(edits, html, warn) {
  const out = [];
  let lastEnd = -1;
  for (const e of edits) {
    if (e.start < lastEnd) {
      if (warn && e.kind === 'attr') warn('跳过被外层段落包住的属性：' + e.key);
      continue;
    }
    out.push(e);
    lastEnd = e.end;
  }
  return out;
}

function applyEdits(html, edits, valueOf) {
  let out = '';
  let at = 0;
  for (const e of edits) {
    out += html.slice(at, e.start) + valueOf(e);
    at = e.end;
  }
  return out + html.slice(at);
}

/* -------------------------------------------------------------- 目录读写 */

const catalogPath = (code) => path.join(CATALOG_DIR, code + '.json');
function loadCatalog(code) {
  try { return JSON.parse(read(catalogPath(code))); } catch { return {}; }
}
function saveCatalog(code, map) {
  const ordered = {};
  for (const k of Object.keys(map).sort()) ordered[k] = map[k];
  fs.writeFileSync(catalogPath(code), JSON.stringify(ordered, null, 2) + '\n');
}

/* ---------------------------------------------------------------- 抽取 */

function extract({ quiet } = {}) {
  const catalog = {};
  const index = {};
  const dupes = [];
  for (const page of PAGES) {
    const html = read(pagePath(page));
    const edits = pruneNested(scan(html), html, quiet ? null : (w) => console.warn('  ! ' + page + ' ' + w));
    for (const e of edits) {
      const value = e.kind === 'attr' ? e.key.slice(e.key.indexOf('|') + 1) : e.key;
      if (e.key in catalog) {
        if (!index[e.key].pages.includes(page)) index[e.key].pages.push(page);
        if (e.key === value) dupes.push(e.key);
        continue;
      }
      catalog[e.key] = value;
      index[e.key] = { kind: e.kind, tag: e.tag, pages: [page] };
    }
  }
  saveCatalog(BASE, catalog);
  fs.writeFileSync(path.join(CATALOG_DIR, '_index.json'), JSON.stringify(index, null, 2) + '\n');
  if (!quiet) console.log('中文段：' + Object.keys(catalog).length + ' 条（i18n/' + BASE + '.json）');
  return { catalog, index };
}

/* ------------------------------------------------------------ 生成页面 */

const basePrefix = (loc) => (loc.path ? '/' + loc.path + '/' : '/');
const urlFor = (loc, page) => SITE + basePrefix(loc) + (page === 'index.html' ? '' : page);

/** 站点根目录下与语言无关的共享资源：不能加语言前缀（会 404），一律写成根绝对路径 */
const SHARED_ROOT = /^(?:assets\/|styles\.css|main\.js|lang\.js|sitemap\.xml|robots\.txt|favicon)/;

/** 站内链接 → 绝对路径：页面链接带语言前缀，共享资源留在根目录 */
function rewriteLinks(html, loc) {
  const prefix = basePrefix(loc);
  return html.replace(/\b(href|src|data-video|poster)="([^"]*)"/g, (all, attr, url) => {
    if (!url || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) return all;
    const bare = url.replace(/^\.?\//, '');
    if (SHARED_ROOT.test(bare)) return attr + '="/' + bare + '"';
    let next = url;
    if (url.startsWith('/')) next = prefix + url.slice(1);
    else if (url.startsWith('./')) next = prefix + url.slice(2);
    else if (url === '.') next = prefix;
    else if (!url.startsWith('#')) next = prefix + url;
    return attr + '="' + next + '"';
  });
}

function alternatesBlock(page) {
  const lines = [ALT_START];
  for (const loc of enabled()) lines.push('<link rel="alternate" hreflang="' + loc.htmlLang + '" href="' + urlFor(loc, page) + '" />');
  // x-default 指向基础语言（中文）：语言不匹配的访客与爬虫都留在这里，再由 lang.js 跳转
  lines.push('<link rel="alternate" hreflang="x-default" href="' + urlFor(byCode(BASE), page) + '" />');
  lines.push(ALT_END);
  return lines.join('\n');
}

/** 替换（或首次插入）hreflang 块：锚点依次找 canonical、robots、</title> */
function withAlternates(html, block) {
  if (html.includes(ALT_START)) return html.replace(new RegExp(ALT_START + '[\\s\\S]*?' + ALT_END), block);
  const m = /(<link rel="canonical"[^>]*>)|(<meta name="robots"[^>]*>)|(<\/title>)/.exec(html);
  if (!m) return html;
  return html.slice(0, m.index) + m[0] + '\n' + block + html.slice(m.index + m[0].length);
}

function htmlTag(loc) {
  return '<html lang="' + loc.htmlLang + '" data-locale="' + loc.code + '"' + (loc.dir === 'rtl' ? ' dir="rtl"' : '') + '>';
}

function rewrite(html, loc, page) {
  let out = html.replace(/<html[^>]*>/, htmlTag(loc));
  const url = urlFor(loc, page);
  out = out.replace(/(<link rel="canonical" href=")[^"]*(")/, '$1' + url + '$2');
  out = out.replace(/(<meta property="og:url" content=")[^"]*(")/, '$1' + url + '$2');
  out = out.replace(/(<meta property="og:locale" content=")[^"]*(")/, '$1' + loc.ogLocale + '$2');
  out = rewriteLinks(out, loc);
  // 非基础语言：删掉只给中文页看的整块内容（例如隐私页里那份英文原文）
  out = out.replace(new RegExp('<!--\\s*i18n:base-only[^>]*-->[\\s\\S]*?<!--\\s*/i18n:base-only\\s*-->', 'g'), '');
  // 那些页面里已经没有 #english 那一节了，指向它的链接（连同前后的「 · 」分隔符）必须一起去掉，
  // 否则读者点到的是一条死锚点。译文里若已删掉这个链接，这行正则不会命中。
  out = out.replace(/<a\b[^>]*href="#english"[^>]*>[\s\S]*?<\/a>\s*·\s*/g, '');
  return withAlternates(out, alternatesBlock(page));
}

/** 基础语言（中文源页面）只维护 hreflang 块，其余原样 */
function refreshBase(page) {
  const html = read(pagePath(page));
  const out = withAlternates(html, alternatesBlock(page));
  if (out !== html) fs.writeFileSync(pagePath(page), out);
  return out !== html;
}

function buildLocale(loc) {
  const catalog = loadCatalog(loc.code);
  const missing = new Set();
  const outDir = loc.path ? path.join(DOCS, loc.path) : DOCS;
  fs.mkdirSync(outDir, { recursive: true });
  for (const page of GEN_PAGES) {
    const html = read(pagePath(page));
    const edits = pruneNested(scan(html), html);
    const filled = applyEdits(html, edits, (e) => {
      const v = catalog[e.key];
      if (typeof v === 'string' && v) return v;
      missing.add(e.key);
      return e.kind === 'attr' ? e.key.slice(e.key.indexOf('|') + 1) : e.key;
    });
    fs.writeFileSync(path.join(outDir, page), rewrite(filled, loc, page));
  }
  return missing;
}

/* --------------------------------------------------------- sitemap/lang.js */

function writeSitemap() {
  const urls = [];
  for (const page of GEN_PAGES) {
    for (const loc of enabled()) {
      const alts = enabled().map((l) => '    <xhtml:link rel="alternate" hreflang="' + l.htmlLang + '" href="' + urlFor(l, page) + '" />');
      urls.push('  <url>\n    <loc>' + urlFor(loc, page) + '</loc>\n' + alts.join('\n') + '\n  </url>');
    }
  }
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + urls.join('\n') + '\n</urlset>\n';
  fs.writeFileSync(path.join(DOCS, 'sitemap.xml'), xml);
  fs.writeFileSync(path.join(DOCS, 'robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: ' + SITE + '/sitemap.xml\n');
}

function writeLangJs() {
  const data = {
    defaultLocale: BASE,
    fallback: CONFIG.fallback,
    locales: enabled().map((l) => ({ code: l.code, path: l.path, label: l.label, match: l.match, auto: l.auto, switchLabel: l.switchLabel })),
  };
  const tpl = read(path.join(HERE, 'lang.template.js'));
  fs.writeFileSync(path.join(DOCS, 'lang.js'), tpl.replace('__DATA__', JSON.stringify(data)));
}

/* ----------------------------------------------------------------- 检查 */

function check() {
  const problems = [];
  const { catalog, index } = extract({ quiet: true });
  const sourceKeys = new Set(Object.keys(catalog));
  const pending = [];
  for (const loc of CONFIG.locales) {
    if (loc.code === BASE) continue;
    const file = catalogPath(loc.code);
    if (!fs.existsSync(file)) {
      // 没启用的语言还没开始翻译很正常，不当成错误
      if (loc.enabled) problems.push(loc.code + '：已启用但还没有 ' + path.relative(ROOT, file));
      else pending.push(loc.code);
      continue;
    }
    const cat = loadCatalog(loc.code);
    const keys = new Set(Object.keys(cat));
    const missing = [...sourceKeys].filter((k) => !keys.has(k));
    const orphan = [...keys].filter((k) => !sourceKeys.has(k));
    if (loc.enabled && missing.length) problems.push(loc.code + '：' + missing.length + ' 条中文段还没译（例：' + missing.slice(0, 3).map((k) => JSON.stringify(k).slice(0, 40)).join(' / ') + '）');
    if (orphan.length) problems.push(loc.code + '：' + orphan.length + ' 条译文已经没有对应中文（例：' + orphan.slice(0, 3).map((k) => JSON.stringify(k).slice(0, 40)).join(' / ') + '）');
    if (!loc.enabled) {
      const left = missing.length;
      if (left) console.log('未启用：' + loc.code + ' 还差 ' + left + ' 段（--translate ' + loc.code + ' 可补齐）');
      else console.log('未启用：' + loc.code + ' 已译完，把 i18n/locales.json 里的 enabled 改成 true 即可上线');
    }
  }
  if (pending.length) console.log('未启用：' + pending.join('、') + ' 还没开始翻译');
  const stale = [];
  for (const loc of enabled()) {
    if (loc.code === BASE) continue;
    const dir = path.join(DOCS, loc.path);
    for (const page of GEN_PAGES) {
      const file = path.join(dir, page);
      const html = read(pagePath(page));
      const edits = pruneNested(scan(html), html);
      const filled = applyEdits(html, edits, (e) => { const v = loadCatalog(loc.code)[e.key]; return typeof v === 'string' && v ? v : (e.kind === 'attr' ? e.key.slice(e.key.indexOf('|') + 1) : e.key); });
      const want = rewrite(filled, loc, page);
      if (!fs.existsSync(file) || read(file) !== want) stale.push(path.relative(ROOT, file));
    }
  }
  for (const f of ['sitemap.xml', 'robots.txt', 'lang.js']) {
    if (!fs.existsSync(path.join(DOCS, f))) { stale.push('docs/' + f); continue; }
    const before = read(path.join(DOCS, f));
    if (f === 'sitemap.xml') writeSitemap(); else if (f === 'robots.txt') writeSitemap(); else writeLangJs();
    if (read(path.join(DOCS, f)) !== before) stale.push('docs/' + f);
  }
  if (stale.length) {
    problems.push('这些产物和中文源不一致，跑一次 node tools/i18n/build.mjs：' + stale.join(', '));
  } else if (fs.existsSync(path.join(DOCS, 'sitemap.xml'))) {
    writeSitemap(); writeLangJs();
  }
  for (const p of PAGES) {
    const html = read(pagePath(p));
    if (!html.includes('data-locale=')) problems.push('docs/' + p + '：<html> 上缺 data-locale');
    if (!html.includes('src="/lang.js"')) problems.push('docs/' + p + '：缺 <script src="/lang.js">');
    if (!html.includes(ALT_START)) problems.push('docs/' + p + '：缺 hreflang 块');
    if (!html.includes('data-lang-switcher')) problems.push('docs/' + p + '：导航里缺语言切换器占位');
  }
  if (problems.length) { console.error(problems.map((p) => '✗ ' + p).join('\n')); process.exitCode = 1; return; }
  console.log('✓ 多语言产物与中文源一致（' + sourceKeys.size + ' 段，' + enabled().length + ' 种语言）');
}

/* ------------------------------------------------------------- 覆盖率 */

/** 把所有段挖空之后，页面里不该再剩下中文（注释、脚本、SVG 除外）。漏掉的那几段会在这里露出来。 */
function coverage() {
  let bad = 0;
  for (const page of PAGES) {
    const html = read(pagePath(page));
    const edits = pruneNested(scan(html), html);
    const stripped = applyEdits(html, edits, () => '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
    const holes = [];
    for (const m of stripped.matchAll(/[^<>]*[\u3400-\u9FFF][^<>]*/g)) holes.push(norm(m[0]));
    if (holes.length) {
      bad += 1;
      console.log('✗ ' + page + '：还有 ' + holes.length + ' 处中文没被任何段覆盖');
      for (const h of holes.slice(0, 10)) console.log('    ' + h.slice(0, 90));
    } else {
      console.log('✓ ' + page + '：' + edits.length + ' 段，中文全部覆盖');
    }
  }
  if (bad) process.exitCode = 1;
}

/* --------------------------------------------------------------- 翻译 */

async function translate(code) {
  const loc = byCode(code);
  if (!loc) throw new Error('未知语言：' + code);
  const { catalog: source, index } = extract({ quiet: true });
  const cat = loadCatalog(code);
  const todo = Object.keys(source).filter((k) => !cat[k]);
  if (!todo.length) { console.log('✓ ' + code + ' 没有待翻译的段'); return; }
  const key = process.env.HUACI_TRANSLATE_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
  const useDeepSeek = !process.env.OPENAI_API_KEY && Boolean(process.env.DEEPSEEK_API_KEY);
  const baseUrl = process.env.HUACI_TRANSLATE_BASE || (useDeepSeek ? 'https://api.deepseek.com' : 'https://api.openai.com/v1');
  const model = process.env.HUACI_TRANSLATE_MODEL || (useDeepSeek ? 'deepseek-chat' : 'gpt-4o-mini');
  if (!key) {
    console.error('缺少 API Key：请设置 HUACI_TRANSLATE_KEY（或 OPENAI_API_KEY / DEEPSEEK_API_KEY）后重跑');
    console.error('待翻译 ' + todo.length + ' 段，可用 --extract 先看清单：' + path.relative(ROOT, catalogPath(BASE)));
    process.exitCode = 1;
    return;
  }
  console.log('用 ' + model + ' 翻译 ' + todo.length + ' 段 → ' + loc.label);

  // 键是整段中文 HTML，让模型原样回传键不可靠（长键容易被改写），所以按数组进出、用 id 对齐。
  const system = [
    '你在本地化一个 Chrome 扩展的产品官网，把中文页面文案翻译成 ' + loc.label + '。',
    '输入是 JSON 数组，每项 {"id": 数字, "kind": "标签名", "html": "中文原文"}。',
    '输出必须是 JSON 数组，长度与输入完全一致、顺序一致，每项 {"id": 同输入, "text": "译文"}；除这个数组外不要输出任何内容。',
    '规则：',
    '1. HTML 标签与属性原样保留（如 <span class="mono">chrome.storage.local</span>、<a class="link" href="...">）；标签不能增删，href/src 一个字符都不要改；',
    '2. 不翻译 OpenAI、ChatGPT、DeepSeek、DeepL、GitHub、Chrome、GPL-3.0、API Key、chrome.storage.local、URL 与代码；',
    '3. 产品名「AI 划词翻译」统一写作 AI Selection Translator；',
    '4. 技术说明文语气，克制准确，不用感叹号；表格单元格保持简短；',
    '5. 只输出译文，不要解释。',
  ].join('\n');

  const kindOf = (k) => (index[k] && index[k].kind === 'attr' ? k.slice(0, k.indexOf('|')) : index[k] && index[k].tag) || 'text';
  const tagSeq = (s) => (s.match(/<\/?([a-zA-Z][-a-zA-Z0-9]*)/g) || []).map((x) => x.replace(/[<\/]/g, '').toLowerCase()).sort().join(',');

  /** 一次请求：返回 id → 译文。模型漏 id 时按位置兜底。 */
  async function ask(items) {
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(items) },
        ],
      }),
    });
    if (!res.ok) throw new Error('翻译接口返回 ' + res.status + '：' + (await res.text()).slice(0, 200));
    const data = await res.json();
    const text = String((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '')
      .replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
    let parsed;
    try { parsed = JSON.parse(text); } catch (err) { throw new Error('模型返回的不是 JSON：' + text.slice(0, 160)); }
    const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.items) ? parsed.items : null);
    if (!list) throw new Error('返回结构不对：' + text.slice(0, 160));
    const out = new Map();
    list.forEach((item, i) => {
      const value = typeof (item && item.text) === 'string' ? item.text : '';
      if (!value.trim()) return;
      const id = Number(item && item.id);
      out.set(Number.isFinite(id) ? id : (items[i] && items[i].id), value);
    });
    return out;
  }

  const before = Object.keys(cat).length;
  const failed = [];
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20);
    const items = batch.map((k, id) => ({ id, kind: kindOf(k), html: source[k] }));
    let got = new Map();
    try { got = await ask(items); } catch (err) { console.warn('  ! 整批失败，改为逐条重试：' + err.message); }
    for (let j = 0; j < batch.length; j += 1) {
      const value = got.get(j);
      if (!value) continue;
      if (tagSeq(batch[j]) !== tagSeq(value)) console.warn('  ~ 标签结构可能变了：' + JSON.stringify(source[batch[j]]).slice(0, 40));
      cat[batch[j]] = value;
    }
    // 整批没给的，逐条再要一次；还拿不到就记下来，最后一起报
    for (const k of batch.filter((x) => !cat[x])) {
      try {
        const one = await ask([{ id: 0, kind: kindOf(k), html: source[k] }]);
        if (one.get(0)) { cat[k] = one.get(0); continue; }
      } catch (err) { console.warn('  ! 单条重试失败：' + err.message); }
      failed.push(k);
    }
    saveCatalog(code, cat);
    console.log('  已写 ' + (Object.keys(cat).length - before) + '/' + todo.length + (failed.length ? '，仍缺 ' + failed.length : ''));
  }
  if (failed.length) {
    console.error('✗ 还有 ' + failed.length + ' 段没译上：' + failed.slice(0, 5).map((k) => JSON.stringify(k).slice(0, 40)).join(' / '));
    process.exitCode = 1;
    return;
  }
  console.log('✓ 已写入 i18n/' + code + '.json；把 locales.json 里的 enabled 改成 true 并跑一次 i18n/build.mjs 即可上线');
}

/* ---------------------------------------------------------------- 入口 */

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : (args[i + 1] || true); };

if (args.includes('--coverage')) {
  coverage();
} else if (args.includes('--check')) {
  check();
} else if (args.includes('--extract')) {
  extract();
  for (const p of PAGES) refreshBase(p);
} else if (flag('--translate')) {
  await translate(String(flag('--translate')));
} else if (flag('--locale')) {
  const loc = byCode(String(flag('--locale')));
  if (!loc) throw new Error('未知语言：' + flag('--locale'));
  extract();
  const missing = loc.code === BASE ? new Set() : buildLocale(loc);
  writeSitemap(); writeLangJs();
  console.log('✓ 生成 ' + loc.code + '（缺 ' + missing.size + ' 段）');
} else {
  extract();
  for (const p of PAGES) refreshBase(p);
  let missingTotal = 0;
  for (const loc of enabled()) {
    if (loc.code === BASE) continue;
    const missing = buildLocale(loc);
    missingTotal += missing.size;
    console.log('  生成 ' + loc.code + '：缺 ' + missing.size + ' 段');
  }
  writeSitemap(); writeLangJs();
  console.log('✓ 完成' + (missingTotal ? '（有 ' + missingTotal + ' 段未译，页面上会退回中文）' : ''));
}

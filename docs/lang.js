/**
 * 宣传站的语言选择器 + 自动跳转。
 *
 * 这个文件是生成出来的（源：i18n/lang.template.js，数据来自 i18n/locales.json），
 * 别直接改 docs/lang.js —— 下次 build 会被覆盖。
 *
 * 两件事：
 *   1. 在 <head> 里同步加载、尽早跳转：localStorage 里选过就听用户的，没选过按浏览器语言猜；
 *      「自动」= 清掉记录，回到跟随浏览器。
 *   2. 渲染导航里的 [data-lang-switcher]。
 *
 * 搜索引擎与无头浏览器不做跳转：Googlebot 的 Accept-Language 是 en-US，跟着跳会让中文原文
 * （x-default）在索引里消失；检测到爬虫时始终留在这页。
 */
(function () {
  'use strict';

  var DATA = {"defaultLocale":"zh-Hans","fallback":"en","locales":[{"code":"zh-Hans","path":"","label":"简体中文","match":["zh","zh-hans","zh-cn","zh-sg","zh-my"],"auto":"自动","switchLabel":"语言"},{"code":"en","path":"en","label":"English","match":["en"],"auto":"Auto","switchLabel":"Language"},{"code":"zh-Hant","path":"zh-Hant","label":"繁體中文","match":["zh-hant","zh-tw","zh-hk","zh-mo"],"auto":"自動","switchLabel":"語言"},{"code":"ja","path":"ja","label":"日本語","match":["ja"],"auto":"自動","switchLabel":"言語"},{"code":"ko","path":"ko","label":"한국어","match":["ko"],"auto":"자동","switchLabel":"언어"},{"code":"es","path":"es","label":"Español","match":["es"],"auto":"Automático","switchLabel":"Idioma"},{"code":"pt","path":"pt","label":"Português","match":["pt"],"auto":"Automático","switchLabel":"Idioma"},{"code":"fr","path":"fr","label":"Français","match":["fr"],"auto":"Automatique","switchLabel":"Langue"},{"code":"de","path":"de","label":"Deutsch","match":["de"],"auto":"Automatisch","switchLabel":"Sprache"},{"code":"ru","path":"ru","label":"Русский","match":["ru"],"auto":"Авто","switchLabel":"Язык"},{"code":"ar","path":"ar","label":"العربية","match":["ar"],"auto":"تلقائي","switchLabel":"اللغة"}]};
  var KEY = 'lang';
  var html = document.documentElement;
  var CRAWLER = /bot|crawler|spider|slurp|bingpreview|headlesschrome|lighthouse|google-inspectiontool/i.test(navigator.userAgent || '');

  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function write(v) { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) { /* 隐私模式：这一页照样切，只是不记住 */ } }
  function byCode(code) { for (var i = 0; i < DATA.locales.length; i++) if (DATA.locales[i].code === code) return DATA.locales[i]; return DATA.locales[0]; }
  function prefixOf(loc) { return loc.path ? '/' + loc.path + '/' : '/'; }

  /** 页面实际属于哪个语言：优先看 URL 前缀（404 页会把任意路径兜进来） */
  function current() {
    var p = location.pathname;
    for (var i = 0; i < DATA.locales.length; i++) {
      var loc = DATA.locales[i];
      if (loc.path && (p === prefixOf(loc) || p.indexOf(prefixOf(loc)) === 0)) return loc.code;
    }
    return DATA.defaultLocale;
  }

  function supported(code) { for (var i = 0; i < DATA.locales.length; i++) if (DATA.locales[i].code === code) return true; return false; }

  /**
   * 浏览器语言 → 已支持的语言：取「匹配得最长」的那条，都不认时给 fallback。
   * 不能按数组顺序取第一个命中：zh-Hans 的 match 里有裸 'zh'，
   * 先到先得的话 zh-TW / zh-HK 会被它抢走，永远轮不到 zh-Hant。
   */
  function detect() {
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < list.length; i++) {
      var tag = String(list[i] || '').toLowerCase();
      if (!tag) continue;
      var best = null;
      for (var j = 0; j < DATA.locales.length; j++) {
        var loc = DATA.locales[j];
        for (var k = 0; k < loc.match.length; k++) {
          var m = String(loc.match[k]).toLowerCase();
          if (tag !== m && tag.indexOf(m + '-') !== 0) continue;
          if (!best || m.length > best.matched) best = { code: loc.code, matched: m.length };
        }
      }
      if (best) return best.code;
    }
    return DATA.fallback;
  }

  /** 同一个页面在目标语言下的地址：去掉已有前缀，再加目标前缀 */
  function hrefFor(code, pathname) {
    var p = pathname || location.pathname;
    var rest = p;
    for (var i = 0; i < DATA.locales.length; i++) {
      var pre = prefixOf(DATA.locales[i]);
      if (DATA.locales[i].path && (p === pre || p.indexOf(pre) === 0)) { rest = '/' + p.slice(pre.length); break; }
    }
    if (html.getAttribute('data-lang-home') === 'true') rest = '/';
    if (rest === '//') rest = '/';
    var loc = byCode(code);
    if (!loc.path) return rest;
    return rest === '/' ? prefixOf(loc) : '/' + loc.path + rest;
  }

  /* ------------------------------------------------------------ 跳转 */
  var choice = read();
  // 记录里的语言如果已经不启用了（下架/改名），当没选过，回到跟随浏览器
  if (choice && choice !== 'auto' && !supported(choice)) choice = null;
  var want = choice && choice !== 'auto' ? choice : detect();
  if (!CRAWLER && !navigator.webdriver && html.getAttribute('data-no-redirect') !== 'true' && want !== current()) {
    var target = hrefFor(want) + location.search + location.hash;
    if (target !== location.pathname + location.search + location.hash) {
      location.replace(target);
      return; // 正在跳，别再画切换器
    }
  }

  /* -------------------------------------------------------- 切换器 */
  function render() {
    var box = document.querySelector('[data-lang-switcher]');
    if (!box) return;
    var here = byCode(current());
    var select = document.createElement('select');
    select.setAttribute('aria-label', here.switchLabel || 'Language');
    for (var i = 0; i < DATA.locales.length; i++) {
      var loc = DATA.locales[i];
      var o = document.createElement('option');
      o.value = loc.code;
      o.textContent = loc.label;
      if (loc.code === here.code) o.selected = true;
      select.appendChild(o);
    }
    var auto = document.createElement('option');
    auto.value = 'auto';
    auto.textContent = here.auto || 'Auto';
    auto.selected = !choice;
    select.appendChild(auto);
    select.addEventListener('change', function () {
      var v = select.value;
      write(v === 'auto' ? null : v);
      location.href = hrefFor(v === 'auto' ? detect() : v) + location.hash;
    });
    box.appendChild(select);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();

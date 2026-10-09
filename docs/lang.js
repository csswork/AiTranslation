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

  var DATA = {"defaultLocale":"zh-Hans","fallback":"en","locales":[{"code":"zh-Hans","path":"","label":"简体中文","match":["zh","zh-hans","zh-cn","zh-sg","zh-my"],"auto":"自动","switchLabel":"语言"},{"code":"en","path":"en","label":"English","match":["en"],"auto":"Auto","switchLabel":"Language"}]};
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

  /** 浏览器语言 → 已支持的语言：命中 match 前缀就选它，都不认时给 fallback */
  function detect() {
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < list.length; i++) {
      var tag = String(list[i] || '').toLowerCase();
      if (!tag) continue;
      for (var j = 0; j < DATA.locales.length; j++) {
        var loc = DATA.locales[j];
        for (var k = 0; k < loc.match.length; k++) {
          var m = String(loc.match[k]).toLowerCase();
          if (tag === m || tag.indexOf(m + '-') === 0) return loc.code;
        }
      }
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

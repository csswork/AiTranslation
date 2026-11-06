import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
new Function(fs.readFileSync(`${ROOT}/src/lib/article.js`, 'utf8'))();
const A = globalThis.AITrArticle;

/** 最小的假 DOM：h('p', { class: 'x' }, '文字', h('a', {}, '链接'))。 */
function h(tag, attrs = {}, ...children) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: children.flat().map((child) => (typeof child === 'string' ? { nodeType: 3, nodeValue: child } : child)),
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    removeChild(child) { node.childNodes.splice(node.childNodes.indexOf(child), 1); },
  };
  for (const child of node.childNodes) child.parentNode = node;
  Object.defineProperty(node, 'textContent', {
    get() {
      const walk = (n) => (n.nodeType === 3 ? n.nodeValue : n.childNodes.map(walk).join(''));
      return walk(node);
    },
  });
  return node;
}

/* --- 1. 段落、小标题、行内元素与换行 --- */
{
  const { blocks } = A.toBlocks(h('div', {},
    h('h1', {}, 'The Title'),
    h('p', {}, 'Hello ', h('em', {}, 'brave'), ' world', h('sup', {}, '1'), '.'),
    h('h2', {}, 'Section ', h('a', { href: '#' }, 'one')),
    h('p', {}, 'Line one', h('br'), 'line two'),
    h('p', {}, '中文', h('strong', {}, '加粗'), '不补空格'),
    h('h5', {}, 'Small heading'),
  ), { title: 'The Title' });
  assert.deepEqual(blocks.map((b) => [b.type, b.text]), [
    ['p', 'Hello brave world1.'],
    ['h2', 'Section one'],
    ['p', 'Line one\nline two'],
    ['p', '中文加粗不补空格'],
    ['h4', 'Small heading'],
  ]);
  console.log('✓ 段落与小标题，行内元素不插空格，<br> 保留换行，开头重复的大标题跳过');
}

/* --- 2. 列表（含嵌套与编号）、引用、代码、分隔线 --- */
{
  const { blocks } = A.toBlocks(h('article', {},
    h('ol', { start: '3' },
      h('li', {}, 'First ', h('b', {}, 'item')),
      h('li', {}, 'Second', h('ul', {}, h('li', {}, 'Nested point')))),
    h('blockquote', {}, h('p', {}, 'Quoted one.'), h('p', {}, 'Quoted two.')),
    h('blockquote', {}, 'Inline quote'),
    h('pre', {}, h('code', {}, 'const a = 1;\n  return a;\n')),
    h('hr'),
    h('p', {}, 'After rule.'),
    h('hr'),
  ));
  assert.deepEqual(blocks.map((b) => b.type), ['li', 'li', 'li', 'quote', 'quote', 'quote', 'code', 'hr', 'p']);
  assert.deepEqual(blocks.slice(0, 3).map((b) => [b.text, b.ordered, b.index, b.depth]), [
    ['First item', true, 3, 0], ['Second', true, 4, 0], ['Nested point', false, 1, 1],
  ]);
  assert.equal(blocks[6].text, 'const a = 1;\n  return a;', '代码保留缩进与换行');
  assert.deepEqual(A.parts(blocks[6]), [], '代码不翻译');
  console.log('✓ 列表编号与嵌套层级，多段引用，代码原样保留，结尾的分隔线去掉');
}

/* --- 3. 图片：只收 http(s)，相对地址补全，图注归到最后一张 --- */
{
  const { blocks } = A.toBlocks(h('div', {},
    h('figure', {}, h('img', { src: '/a.png', alt: 'A' }), h('figcaption', {}, 'Caption here')),
    h('p', {}, 'Text with ', h('img', { src: 'https://cdn.example/b.jpg' }), 'image'),
    h('img', { src: 'javascript:alert(1)' }),
    h('img', { src: 'data:image/png;base64,AAAA' }),
    h('img', { 'data-src': 'lazy.jpg' }),
    h('picture', {}, h('img', { srcset: 'small.jpg 1x, big.jpg 2x' })),
  ), { base: 'https://example.com/post/' });
  assert.deepEqual(blocks.map((b) => [b.type, b.src || b.text]), [
    ['img', 'https://example.com/a.png'],
    ['p', 'Text with image'],
    ['img', 'https://cdn.example/b.jpg'],
    ['img', 'https://example.com/post/lazy.jpg'],
    ['img', 'https://example.com/post/big.jpg'],
  ]);
  assert.equal(blocks[0].text, 'Caption here');
  assert.deepEqual(A.parts(blocks[0]), ['Caption here']);
  console.log('✓ 图片只接受 http(s)，相对与懒加载地址补全，javascript:/data: 丢弃');
}

/* --- 4. 表格逐格翻译；单列表格当段落；脚本与表单跳过 --- */
{
  const { blocks } = A.toBlocks(h('div', {},
    h('table', {}, h('tbody', {},
      h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Role')),
      h('tr', {}, h('td', {}, 'Ada'), h('td', {}, 'Engineer')))),
    h('table', {}, h('tr', {}, h('td', {}, 'Layout table text'))),
    h('script', {}, 'alert(1)'),
    h('form', {}, h('p', {}, 'Subscribe now')),
    h('p', {}, h('button', {}, 'Share'), 'Real text'),
  ));
  assert.deepEqual(blocks[0], { type: 'table', rows: [['Name', 'Role'], ['Ada', 'Engineer']] });
  assert.deepEqual(A.parts(blocks[0]), ['Name', 'Role', 'Ada', 'Engineer']);
  assert.deepEqual(blocks.slice(1).map((b) => [b.type, b.text]), [['p', 'Layout table text'], ['p', 'Real text']]);
  console.log('✓ 表格按单元格展开，单列排版表格当段落，脚本、表单与按钮跳过');
}

/* --- 5. 署名行跳过，长段在句末切开，总量有上限 --- */
{
  const long = Array.from({ length: 140 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const { blocks } = A.toBlocks(h('div', {},
    h('p', {}, 'By Jane Doe · 3 May 2026'),
    h('p', {}, long),
  ), { byline: 'Jane Doe' });
  assert.ok(blocks.every((b) => b.text !== 'By Jane Doe · 3 May 2026'), '开头的署名行跳过');
  assert.ok(blocks.length >= 2 && blocks.every((b) => b.text.length <= 1800), '长段切成多块');
  assert.ok(blocks.every((b) => /\.$/.test(b.text)), '在句末切开');
  assert.equal(blocks.map((b) => b.text).join(' '), long);

  const many = h('div', {}, ...Array.from({ length: 2500 }, (_, i) => h('p', {}, `Paragraph ${i} text`)));
  const capped = A.toBlocks(many);
  assert.equal(capped.blocks.length, 2000);
  assert.equal(capped.truncated, true);
  console.log('✓ 署名行跳过，过长段落按句切开，块数有上限并标记截断');
}

/* --- 6. 判断是不是一篇完整的文章 --- */
{
  const para = (text) => ({ type: 'p', text });
  const en = 'This is a reasonably long paragraph of English prose that keeps going for a while. ';
  const article = { title: 'A title', blocks: Array.from({ length: 6 }, () => para(en.repeat(2))) };
  assert.equal(A.assess(article).verdict, 'article');
  assert.equal(A.assess(article, { readerable: false }).verdict, 'weak', '页面整体不像文章时让用户决定');
  assert.equal(A.assess({ title: '', blocks: article.blocks }).verdict, 'weak', '没有标题');
  assert.equal(A.assess({ title: 'Home', blocks: Array.from({ length: 12 }, () => ({ type: 'li', text: 'Headline number about something' })) }).verdict, 'weak');
  assert.equal(A.assess({ title: 'x', blocks: [para('Too short.')] }).verdict, 'none');
  const zh = '这是一段足够长的中文正文，用来检验中日韩文字的字数折算是否合理，避免中文文章被误判。';
  assert.equal(A.assess({ title: '标题', blocks: Array.from({ length: 5 }, () => para(zh + zh)) }).verdict, 'article', '中文按折算字数判断');
  console.log('✓ 文章判断：标题、正文长度、段落数，中日韩字数折算');
}

/* --- 7. 切批与可翻译判断 --- */
{
  const units = Array.from({ length: 45 }, (_, i) => ({ text: `Unit ${i} `.repeat(10) }));
  const groups = A.batches(units);
  assert.deepEqual(groups.flat(), units.map((_, i) => i), '顺序不变、不漏不重');
  assert.ok(groups.every((g) => g.length <= 20 && g.reduce((n, i) => n + units[i].text.length, 0) <= 2000 || g.length === 1));
  assert.deepEqual(A.batches([{ text: 'x'.repeat(5000) }, { text: 'y' }]), [[0], [1]], '超长单段自成一批');
  assert.equal(A.translatable('2026'), false);
  assert.equal(A.translatable('— 3 —'), false);
  assert.equal(A.translatable('OK'), true);
  assert.equal(A.translatable('中文'), true);
  console.log('✓ 切批不超过 20 段、2000 字；纯数字与符号不送去翻译');
}

/* --- 8. 广告：容器在识别前去掉，广告标签与统计像素不进正文 --- */
{
  const page = h('body', {},
    h('header', { class: 'masthead' }, 'Site'),
    h('div', { class: 'ad-slot' }, 'Advertisement'),
    h('div', { id: 'div-gpt-ad-123' }),
    h('ins', { class: 'adsbygoogle' }),
    h('div', { 'data-ad-unit': 'x' }, 'Buy now'),
    h('aside', { class: 'sidebar-sponsored' }, 'Sponsored links'),
    h('div', { class: 'taboola-feed' }, 'You may like'),
    h('section', { 'aria-label': 'Advertisement' }, 'x'),
    h('div', { class: 'article-body has-ads' }, 'Long article text '.repeat(40)),
    h('div', { class: 'add-to-cart load-more' }, 'Real content'),
  );
  const removed = A.stripAds(page);
  assert.equal(removed, 7);
  assert.deepEqual(page.childNodes.map((n) => n.getAttribute('class')), ['masthead', 'article-body has-ads', 'add-to-cart load-more'],
    '文字很多的容器（整篇正文）保留；head、add-to-cart 等不误删');

  const { blocks } = A.toBlocks(h('div', {},
    h('p', {}, 'Real paragraph one.'),
    h('p', {}, 'ADVERTISEMENT'),
    h('p', {}, 'Story continues below advertisement'),
    h('div', {}, 'Advertisement - Scroll to continue reading'),
    h('p', {}, '广告'),
    h('h3', {}, 'Sponsored'),
    h('p', {}, 'Ads are everywhere, and this sentence is about them.'),
    h('img', { src: 'https://example.com/pixel.gif', width: '1', height: '1' }),
    h('img', { src: 'https://securepubads.g.doubleclick.net/x.png' }),
    h('img', { src: 'https://example.com/photo.jpg' }),
  ), { base: 'https://example.com/' });
  assert.deepEqual(blocks.map((b) => b.text || b.src), ['Real paragraph one.', 'Ads are everywhere, and this sentence is about them.', 'https://example.com/photo.jpg']);
  assert.equal(A.isAdLabel('Sponsored by Acme Corp'), false, '有具体内容的不算广告标签');
  console.log('✓ 广告容器在识别前去掉；广告标签、统计像素、广告服务器图片不进正文；正文不误删');
}

console.log('\n全部通过');

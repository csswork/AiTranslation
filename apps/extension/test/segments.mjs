import fs from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
new Function(fs.readFileSync(`${ROOT}/src/lib/segments.js`, 'utf8'))();
const { isWhole } = globalThis.AITrSegments;

/** 最小的假 DOM：只有 isWhole 用到的 nodeValue / parentElement / parentNode / localName / textContent。 */
const text = (value) => ({ nodeType: 3, nodeValue: value, parentNode: null, get parentElement() { return this.parentNode?.localName ? this.parentNode : null; }, get textContent() { return this.nodeValue; } });
const el = (localName, ...children) => {
  const node = { nodeType: 1, localName, children, parentNode: null,
    get parentElement() { return this.parentNode?.localName ? this.parentNode : null; },
    get textContent() { return this.children.map((child) => child.textContent).join(''); } };
  for (const child of children) child.parentNode = node;
  return node;
};
const shadow = (...children) => {
  const node = { nodeType: 11, children, get textContent() { return this.children.map((child) => child.textContent).join(''); } };
  for (const child of children) child.parentNode = node;
  return node;
};

// 导航：每个链接独立成段
const home = text('Home');
const about = text(' About\n  ');
el('ul', el('li', el('a', home)), el('li', el('a', about)));
assert.equal(isWhole(home), true, '列表项里的链接是完整的一段');
assert.equal(isWhole(about), true, '首尾空白不影响');

// 被行内标签切开的句子：每段都是片段
const a = text('Read the ');
const b = text('docs');
const c = text(' before you start.');
el('p', a, el('a', b), c);
assert.equal([a, b, c].some(isWhole), false, '同一句话的各段都是片段');

// 没有行内标记的段落、按钮、标题
const plain = text('A whole paragraph.');
el('div', el('p', plain), el('p', text('Another.')));
assert.equal(isWhole(plain), true);
const label = text('Sign in');
el('div', el('button', el('span', label)), text('or continue'));
assert.equal(isWhole(label), true, '按钮是块级边界');

// 链接旁边还有角标：不算完整
const inbox = text('Inbox');
el('li', el('a', inbox), text(' '), el('span', text('3')));
assert.equal(isWhole(inbox), false);

// 换行分开的两行、自定义元素当行内看待
const line = text('Line one');
el('p', line, el('br'), text('Line two'));
assert.equal(isWhole(line), false, 'br 隔开的两行属于同一段');
const custom = text('Hello');
el('p', el('x-link', custom), text(' world'));
assert.equal(isWhole(custom), false, '不认识的自定义元素按行内处理');

// 行内元素一路走到 shadow root 顶上：容器是 shadow root
const top = text('Hello');
shadow(el('span', top), el('b', text('world')));
assert.equal(isWhole(top), false);
const alone = text('Alone');
shadow(el('span', alone));
assert.equal(isWhole(alone), true);

// 有计算样式时按 display：flex 导航里的链接各自是一段
const styled = (display, ...children) => Object.assign(el(display.tag, ...children), {
  ownerDocument: { defaultView: { getComputedStyle: () => ({ display: display.value }) } },
});
const navLink = text('Pricing');
styled({ tag: 'nav', value: 'flex' }, styled({ tag: 'a', value: 'block' }, navLink), styled({ tag: 'a', value: 'block' }, text('Docs')));
assert.equal(isWhole(navLink), true, 'flex 子项的链接按 block 算');
const inSentence = text('docs');
styled({ tag: 'p', value: 'block' }, text('Read the '), styled({ tag: 'a', value: 'inline' }, inSentence));
assert.equal(isWhole(inSentence), false, '句子里的行内链接仍是片段');

assert.equal(isWhole(text('')), false);
assert.equal(isWhole(text('orphan')), false, '没有父元素时当片段');
console.log('全部通过');

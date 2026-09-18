import fs from 'node:fs';
import assert from 'node:assert/strict';
const ROOT = new URL('..', import.meta.url).pathname;
const store = {};
globalThis.chrome = { storage: { local: {
  get: async (k) => (k in store ? { [k]: store[k] } : {}),
  set: async (o) => Object.assign(store, o) }}};
new Function(fs.readFileSync(`${ROOT}/src/lib/rules.js`, 'utf8'))();
const R = globalThis.AITrRules;

/* 1. 新增 / 读取 */
let res = await R.addRule('Example.COM', '.article-body', 'div.article-body · 正文');
assert.equal(res.added, true);
assert.deepEqual(Object.keys(await R.loadRules()), ['example.com'], '域名应归一化为小写');
let list = await R.rulesFor('example.com');
assert.equal(list.length, 1);
assert.equal(list[0].selector, '.article-body');
assert.ok(list[0].id && list[0].createdAt);
console.log('✓ 新增规则，域名大小写归一化');

/* 2. www. 视作同一站点 */
assert.equal((await R.rulesFor('www.example.com')).length, 1);
res = await R.addRule('www.example.com', '.sidebar');
assert.equal(res.added, true);
assert.equal((await R.rulesFor('example.com')).length, 2, 'www 与裸域名共用一份规则');
console.log('✓ www. 与裸域名视作同一站点');

/* 3. 重复选择器不会重复添加 */
res = await R.addRule('example.com', '.article-body');
assert.equal(res.added, false);
assert.equal((await R.rulesFor('example.com')).length, 2);
console.log('✓ 重复选择器不重复记录');

/* 4. 删除单条 / 整站 */
list = await R.rulesFor('example.com');
await R.removeRule('example.com', list[0].id);
assert.equal((await R.rulesFor('example.com')).length, 1);
await R.addRule('other.org', '.main');
await R.removeHost('example.com');
assert.deepEqual(Object.keys(await R.loadRules()), ['other.org'], '整站删除后该键应消失');
console.log('✓ 删除单条规则与整站');

/* 5. 最后一条删掉后，域名本身也不该残留 */
list = await R.rulesFor('other.org');
await R.removeRule('other.org', list[0].id);
assert.deepEqual(await R.loadRules(), {}, '空域名不应残留');
console.log('✓ 删光后域名不残留');

/* 6. 脏数据兜底 */
const dirty = R.normalize({
  'good.com': [
    { selector: '.a' },
    { selector: '.a' },              // 重复
    { selector: '' },                // 空
    null, 'nonsense',                // 垃圾
    { selector: '.b', id: 'keep', createdAt: 123 },
  ],
  '': [{ selector: '.x' }],          // 空域名
  'bad.com': 'not-an-array',
});
assert.deepEqual(Object.keys(dirty), ['good.com']);
assert.deepEqual(dirty['good.com'].map((r) => r.selector), ['.a', '.b']);
assert.equal(dirty['good.com'][1].id, 'keep');
assert.equal(dirty['good.com'][0].label, '.a', 'label 缺省时回落到选择器');
console.log('✓ 脏数据兜底');

/* 7. 单站上限 */
await R.clearAll();
for (let i = 0; i < R.MAX_RULES_PER_HOST + 5; i += 1) {
  await R.addRule('big.com', `.rule-${i}`);
}
assert.equal((await R.rulesFor('big.com')).length, R.MAX_RULES_PER_HOST);
const full = await R.addRule('big.com', '.one-more');
assert.equal(full.full, true, '超出上限应明确告知');
console.log(`✓ 单站上限 ${R.MAX_RULES_PER_HOST} 条`);

/* 8. 清空 */
assert.deepEqual(await R.clearAll(), {});
assert.deepEqual(await R.loadRules(), {});
console.log('✓ 全部清空');

/* 9. 修改规则 */
await R.clearAll();
await R.addRule('site.com', '.first');
await R.addRule('site.com', '.second');
await R.addRule('other.com', '.first');
let rid = (await R.rulesFor('site.com')).map((r) => r.id);

let up = await R.updateRule('site.com', rid[0], '  .updated  ');
assert.equal(up.ok, true);
let after = await R.rulesFor('site.com');
assert.equal(after[0].selector, '.updated', '应写入并 trim');
assert.equal(after[0].id, rid[0], 'id 不变');
assert.equal(after[1].selector, '.second', '其他规则不受影响');
assert.equal(after.length, 2, '不该多出或丢失规则');
console.log('✓ 修改选择器');

// 撞上同站已有的选择器：normalize 会静默丢重复项，必须提前拦住
up = await R.updateRule('site.com', rid[0], '.second');
assert.equal(up.ok, false);
assert.match(up.error, /已经有相同的选择器/);
assert.equal((await R.rulesFor('site.com')).length, 2, '被拒后规则数不变');
assert.equal((await R.rulesFor('site.com'))[0].selector, '.updated', '被拒后内容不变');
console.log('✓ 同站重复选择器被拒，且不破坏已有数据');

// 不同站点用相同选择器是允许的
up = await R.updateRule('other.com', (await R.rulesFor('other.com'))[0].id, '.updated');
assert.equal(up.ok, true, '跨站点同名选择器应当允许');
console.log('✓ 跨站点可用相同选择器');

// 空值与不存在的规则
up = await R.updateRule('site.com', rid[0], '   ');
assert.equal(up.ok, false);
assert.match(up.error, /不能为空/);
up = await R.updateRule('site.com', 'no-such-id', '.x');
assert.equal(up.ok, false);
assert.match(up.error, /不存在/);
up = await R.updateRule('no-such-host.com', rid[0], '.x');
assert.equal(up.ok, false);
console.log('✓ 空值 / 不存在的规则或站点都会被拒');

// 改成和自己一样：视为成功且不产生变化
up = await R.updateRule('site.com', rid[0], '.updated');
assert.equal(up.ok, true);
assert.equal((await R.rulesFor('site.com')).length, 2);
console.log('✓ 原样保存是幂等的');

console.log('\n全部通过');

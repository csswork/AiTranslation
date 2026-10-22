// 扩展更新后，已打开页面里的旧脚本联系不上扩展：确认失效后才撤掉，正常的脚本不受新脚本广播影响。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const code = fs.readFileSync(new URL('../src/lib/lifecycle.js', import.meta.url), 'utf8');
const document = new EventTarget();

/** 每次注入都是独立的隔离环境，只共享页面 DOM。 */
function inject() {
  const runtime = { id: 'ext' };
  const context = vm.createContext({ document, CustomEvent, AbortController, chrome: { runtime } });
  vm.runInContext(code, context);
  return { life: context.AITrLifecycle, invalidate: () => { delete runtime.id; } };
}

const first = inject();
let cleaned = 0;
first.life.onRetire(() => { cleaned += 1; });
const pageListener = () => { cleaned += 10; };
document.addEventListener('mouseup', pageListener, { signal: first.life.signal });

// 同一版本重复注入（另一个隔离环境）：旧的仍可用，不能被撤
const twin = inject();
assert.equal(first.life.signal.aborted, false);
assert.equal(cleaned, 0);

// 扩展更新：旧脚本失效，新脚本加载时广播，旧的撤掉自己的监听与界面
first.invalidate();
twin.invalidate();
const fresh = inject();
assert.equal(first.life.signal.aborted, true);
assert.equal(twin.life.signal.aborted, true);
assert.equal(cleaned, 1);
document.dispatchEvent(new Event('mouseup'));
assert.equal(cleaned, 1, '撤掉后页面监听不再触发');
assert.equal(fresh.life.signal.aborted, false);

// 没有补注入时：用户一按键就发现失效并撤掉
fresh.invalidate();
let late = 0;
fresh.life.onRetire(() => { late += 1; });
document.dispatchEvent(new Event('mousedown'));
assert.equal(fresh.life.signal.aborted, true);
assert.equal(late, 1);
fresh.life.onRetire(() => { late += 1; });
assert.equal(late, 2, '撤掉之后登记的清理立即执行');
console.log('✓ 旧内容脚本确认失效后才撤掉，并清理监听与界面');

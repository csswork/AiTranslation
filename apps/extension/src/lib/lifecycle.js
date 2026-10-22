/**
 * 内容脚本的生命周期。扩展更新或重新加载后，已打开页面里的旧脚本还在，但已经联系不上扩展：
 * 按钮照常出现，点了却没有反应。后台会给这些页面补注入新脚本（见 background.js injectOpenTabs），
 * 旧脚本要把自己的按钮、弹窗和页面监听撤掉。
 *
 * 撤掉的前提永远是「扩展上下文确实已失效」，有两个时机：
 *   - 新脚本加载时在页面上广播一次，旧脚本收到后检查；
 *   - 用户按下鼠标或键盘时检查（没有补注入的页面也能及时撤掉，按钮不会再冒出来）。
 * 各模块给页面级监听带上 `signal`，把插入页面的元素交给 `onRetire` 移除。
 * 与 lang.js 一样，不能使用 import / export。
 */
(() => {
  if (globalThis.AITrLifecycle) return;
  const EVENT = 'aitr-content-loaded';
  const token = Math.random().toString(36).slice(2);
  const controller = new AbortController();
  const cleanups = [];

  function alive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function retire() {
    if (controller.signal.aborted) return;
    controller.abort();
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        /* 页面已经改过这些节点，忽略 */
      }
    }
  }

  /** 扩展已失效就撤掉；返回当前是否仍可用。 */
  function check() {
    if (!controller.signal.aborted && !alive()) retire();
    return !controller.signal.aborted;
  }

  function onRetire(cleanup) {
    if (controller.signal.aborted) cleanup();
    else cleanups.push(cleanup);
  }

  // 广播在 DOM 上进行，新旧脚本处在不同的隔离环境里也收得到；只传字符串。
  document.addEventListener(EVENT, (event) => {
    if (event.detail !== token) check();
  }, { signal: controller.signal });
  for (const type of ['mousedown', 'keydown']) {
    document.addEventListener(type, check, { capture: true, signal: controller.signal });
  }
  document.dispatchEvent(new CustomEvent(EVENT, { detail: token }));

  globalThis.AITrLifecycle = { signal: controller.signal, onRetire, check };
})();

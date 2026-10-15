/**
 * 开发工具：只在未打包加载的开发版（AITrEnv.dev）显示，商店版不渲染任何内容。
 * 显示本机保存的账户状态（会话、是否已领过访客试用、状态缓存），并可以清除它们，
 * 方便在本地反复测试新安装、访客试用与登录流程。
 * 文案只有中文、用 DOM 直接生成，不进入扩展的多语言目录。
 */
(() => {
  if (!globalThis.AITrEnv?.dev) return;
  const section = document.getElementById('devTools');
  if (!section) return;

  // 与 lib/account.js、background.js 使用的键一致。
  const KEYS = ['accountSession', 'accountStatus', 'guestClaimed', 'onboarding'];
  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };
  const time = (ms) => (ms ? new Date(ms).toLocaleString() : '—');

  const facts = el('dl', { className: 'dev-facts' });
  const message = el('p', { className: 'help dev-message', hidden: true });
  const clearButton = el('button', { type: 'button', className: 'btn ghost small', textContent: '清除本地账户状态' });
  const reinstallButton = el('button', { type: 'button', className: 'btn ghost small', textContent: '清除并模拟新安装' });
  section.replaceChildren(
    el('h2', { textContent: '开发工具' }),
    el('p', { className: 'desc', textContent: `只在开发版显示。账户服务：${AITrEnv.accountOrigin}` }),
    facts,
    el('div', { className: 'actions' }, [clearButton, reinstallButton]),
    el('p', {
      className: 'help',
      textContent: '「清除本地账户状态」只清除扩展本机的记录，服务端仍按同一网络的领取次数和浏览器标记判断，可能领到 0 点。'
        + '「清除并模拟新安装」还会让服务端重置本机网络的领取记录与浏览器标记，能领到完整的访客点数；'
        + '需要在 apps/backend/.env.local 设置 DEV_TRIAL_RESET=1 并重启后端（生产环境不能开启）。',
    }),
    message,
  );
  section.hidden = false;

  async function render() {
    const stored = await chrome.storage.local.get(KEYS);
    const session = stored.accountSession;
    const status = stored.accountStatus || {};
    const rows = [
      ['会话', session?.token ? (session.guest ? '访客会话' : '正式账户会话') : '无'],
      ['已领过访客试用', stored.guestClaimed ? '是（不会再自动领取）' : '否'],
      ['引导状态', stored.onboarding || '—'],
      ['状态缓存', status.signedIn ? `正式账户 ${status.username || ''}` : status.guest ? '访客' : '未登录'],
      ['余额', status.subscription ? '订阅：无限使用' : status.credits ? `${status.credits.balance} 点${status.credits.available ? '' : '（不可用）'}` : '—'],
      ['状态更新于', time(status.updatedAt)],
    ];
    facts.replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: String(v) })]));
  }

  const say = (text) => {
    message.textContent = text;
    message.hidden = !text;
  };

  async function clearLocal() {
    await chrome.storage.local.remove(KEYS);
    await chrome.storage.session.remove('accountLoginPending').catch(() => {});
    // 设置页与弹窗都监听 accountStatus 的变化，写入未登录状态让它们立即更新。
    await chrome.storage.local.set({ accountStatus: { signedIn: false, updatedAt: Date.now() } });
  }

  clearButton.addEventListener('click', async () => {
    clearButton.disabled = true;
    await clearLocal();
    say('已清除。使用点数翻译时会自动重新领取访客试用（不打开欢迎页）。');
    clearButton.disabled = false;
  });

  reinstallButton.addEventListener('click', async () => {
    reinstallButton.disabled = true;
    await clearLocal();
    // 与新安装相同：领取访客试用并打开欢迎页（由欢迎页识别同一浏览器的重复领取）。
    // fresh：服务端同时重置本机网络的领取记录与浏览器标记（需 DEV_TRIAL_RESET=1），因此能再领到完整的访客点数。
    const reply = await chrome.runtime.sendMessage({ type: 'account-guest', fresh: true }).catch((err) => ({ ok: false, error: String(err?.message || err) }));
    say(reply?.ok ? `已重新领取访客试用（${reply.status?.credits?.balance ?? '?'} 点），欢迎页已打开。` : `领取失败：${reply?.error || '未知错误'}`);
    reinstallButton.disabled = false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEYS.some((key) => key in changes)) render();
  });
  render();
})();

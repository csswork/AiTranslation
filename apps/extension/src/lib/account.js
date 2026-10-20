/**
 * 账户与托管翻译。只在 service worker 里加载：所有账户请求都从这里发出，
 * 只发往固定的用户端地址（API_ORIGIN），网页内容脚本不能借它代请求任意地址。
 *
 * 登录：在当前窗口的新标签页打开用户端授权页 → 确认后回到扩展自己的回调页（src/auth/callback.html），
 *       带一次性授权码 → 用 PKCE 的 code_verifier 换取扩展会话令牌。code_verifier 与 state 存在
 *       chrome.storage.session（只有扩展页面和 service worker 能读）。令牌只存在 chrome.storage.local，不同步。
 * 访客：安装后静默领取访客试用（claimGuest），不注册就能用点数翻译；同一浏览器重装由用户端欢迎页识别。
 *       登录时带上访客令牌，服务端把访客剩余点数并入正式账户。退出登录后不再自动领取。
 * 状态：用户类型、用户名、点数、订阅保存为 accountStatus，设置页和弹窗监听它的变化即时更新；
 *       令牌失效（过期或在网页端被退出）时自动回到未登录。
 * 与 lang.js 一样，不能使用 import / export。
 */
(() => {
  const t = (...args) => AITrI18n.t(...args);

  // 未打包的开发版本连本机用户端，见 env.js。
  const API_ORIGIN = AITrEnv.accountOrigin;
  const SESSION_KEY = 'accountSession';
  const STATUS_KEY = 'accountStatus';
  const PENDING_KEY = 'accountLoginPending';
  const GUEST_CLAIMED_KEY = 'guestClaimed';
  const PENDING_TTL = 30 * 60 * 1000; // 授权页上可能还要先注册、收验证码
  const CALLBACK_URL = chrome.runtime.getURL('src/auth/callback.html');
  // 网络请求可以并发；令牌与状态的检查、写入必须串行，避免旧响应覆盖新登录。
  let stateTask = Promise.resolve();
  const updateState = (task) => {
    const next = stateTask.catch(() => {}).then(task);
    stateTask = next;
    return next;
  };

  class AccountError extends Error {
    constructor(message, code, action) {
      super(message);
      this.name = 'AccountError';
      this.code = code;
      this.action = action || null;
    }
  }

  const base64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const randomString = (size = 32) => base64url(crypto.getRandomValues(new Uint8Array(size)));

  async function readSession() {
    return (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY] || null;
  }

  async function readToken() {
    return (await readSession())?.token || '';
  }

  async function readStatus() {
    return (await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY] || { signedIn: false };
  }

  async function writeStatus(status) {
    const next = { ...status, updatedAt: Date.now() };
    await chrome.storage.local.set({ [STATUS_KEY]: next });
    return next;
  }

  function signOutLocally(expectedToken) {
    return updateState(async () => {
      if (await readToken() !== expectedToken) return readStatus();
      await chrome.storage.local.remove(SESSION_KEY);
      return writeStatus({ signedIn: false });
    });
  }

  /**
   * 服务端返回的状态里只保留界面需要的字段。signedIn 只表示正式账户；访客另有 guest 标记，
   * 两者都能使用点数翻译。subscription 有值时托管翻译无限使用（界面不显示点数）。
   */
  function statusFrom(data, previous = {}) {
    const kind = data.kind ?? previous.kind ?? 'member';
    return {
      kind,
      signedIn: kind === 'member',
      guest: kind === 'guest',
      username: data.username ?? previous.username ?? '',
      credits: data.credits ?? previous.credits ?? null,
      subscription: data.subscription !== undefined ? data.subscription : previous.subscription ?? null,
      hosted: data.hosted ?? previous.hosted ?? null,
      offers: data.offers ?? previous.offers ?? null,
    };
  }

  async function call(path, { method = 'GET', body, auth = true, authToken, signal, stream = false } = {}) {
    const headers = {};
    const token = auth ? authToken ?? await readToken() : '';
    if (body) headers['content-type'] = 'application/json';
    if (auth) {
      if (!token) throw new AccountError(t('请先登录账户'), 'signed_out', 'open-options');
      headers.authorization = `Bearer ${token}`;
    }
    let response;
    try {
      response = await fetch(`${API_ORIGIN}/api/extension${path}`, {
        method, headers, body: body ? JSON.stringify(body) : undefined, signal, credentials: 'omit',
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      throw new AccountError(t('无法连接账户服务，请检查网络后重试'), 'network');
    }
    if (response.status === 401 && auth) {
      await signOutLocally(token);
      throw new AccountError(t('登录已失效，请重新登录'), 'unauthorized', 'open-options');
    }
    // 流式响应交给调用方逐段读取；错误与旧版服务端仍返回 JSON。
    if (stream && response.ok && /^text\/event-stream/.test(response.headers.get('content-type') || '')) {
      return { response, data: null, token };
    }
    const data = await response.json().catch(() => ({}));
    return { response, data, token };
  }

  /**
   * 预热到用户端的连接：用户选中文字或右键时先发一个不带内容的请求，
   * 真正翻译时就能复用已建好的 TLS 连接（跨境线路上能省下半秒到一秒多）。最多每 30 秒一次，只在使用点数翻译时发出。
   */
  const WARM_INTERVAL = 30_000;
  let warmedAt = 0;
  async function warm() {
    if (Date.now() - warmedAt < WARM_INTERVAL) return;
    warmedAt = Date.now();
    const settings = await AITrSettings.loadSettings();
    if (!AITrSettings.isHosted(settings.provider)) return;
    await fetch(`${API_ORIGIN}/api/extension/ping`, { credentials: 'omit', cache: 'no-store' }).catch(() => {});
  }

  /** 读取最新状态；未登录时不发请求。网络失败时保留上次的状态。 */
  async function refresh() {
    if (!(await readToken())) return updateState(async () => await readToken() ? readStatus() : writeStatus({ signedIn: false }));
    const { response, data, token } = await call('/me');
    if (!response.ok) throw new AccountError(t('读取账户状态失败（$1）', [response.status]), 'status');
    // 并发刷新可能在退出或另一轮登录后才完成；旧响应不能恢复已退出的缓存。
    return updateState(async () => {
      if (await readToken() !== token) return readStatus();
      return writeStatus(statusFrom(data, await readStatus()));
    });
  }

  /**
   * 开始登录：在发起页所在的窗口打开授权页，登录在回调页里完成（completeLogin）。
   * @param {{windowId?: number, tabId?: number}} from 发起登录的页面，完成后回到这里
   */
  async function login(from = {}) {
    const verifier = randomString(32);
    const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = randomString(16);
    await chrome.storage.session.set({
      [PENDING_KEY]: { verifier, state, returnTabId: from.tabId ?? null, createdAt: Date.now() },
    });
    const url = new URL(`${API_ORIGIN}/extension/authorize`);
    url.search = new URLSearchParams({
      redirect_uri: CALLBACK_URL, code_challenge: challenge, code_challenge_method: 'S256', state,
    }).toString();
    await chrome.tabs.create({ url: url.href, windowId: from.windowId, openerTabId: from.tabId });
    return { started: true };
  }

  /**
   * 回调页把自己的地址交过来：核对 state，用授权码和 code_verifier 换取令牌。
   * 每次登录请求只能完成一次。返回最新状态和发起登录的标签页。
   */
  async function completeLogin(callbackUrl) {
    const back = new URL(callbackUrl);
    const pending = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY];
    if (!pending || Date.now() - pending.createdAt > PENDING_TTL || back.searchParams.get('state') !== pending.state) {
      throw new AccountError(t('登录请求无效，请重试'), 'state');
    }
    await chrome.storage.session.remove(PENDING_KEY);
    if (back.searchParams.get('error')) throw new AccountError(t('已取消登录'), 'cancelled');
    const code = back.searchParams.get('code');
    if (!code) throw new AccountError(t('登录请求无效，请重试'), 'code');

    // 原来是访客：带上访客令牌，服务端把访客剩余点数并入这个账户。
    const session = await readSession();
    const { response, data } = await call('/token', {
      method: 'POST',
      auth: false,
      body: { code, code_verifier: pending.verifier, redirect_uri: CALLBACK_URL, guest_token: session?.guest ? session.token : undefined },
    });
    if (!response.ok || !data.token) throw new AccountError(t('登录失败，请重试'), 'token');
    await updateState(() => chrome.storage.local.set({ [SESSION_KEY]: { token: data.token } }));
    return { status: await refresh(), returnTabId: pending.returnTabId };
  }

  /**
   * 领取访客试用：只在这台浏览器从未领取、且当前没有任何登录时进行（退出登录后不会再领）。
   * 返回欢迎页地址（新安装时打开它，由用户端识别同一浏览器的重复领取）；不需要或失败时返回 null。
   */
  async function claimGuest() {
    if (await readToken()) return null;
    if ((await chrome.storage.local.get(GUEST_CLAIMED_KEY))[GUEST_CLAIMED_KEY]) return null;
    // 带上扩展界面语言（24 种语言 ID 之一），只用于运营报表的语言统计。
    const { response, data } = await call('/guest', { method: 'POST', auth: false, body: { uiLanguage: AITrI18n.locale?.() || undefined } });
    if (!response.ok || !data.token) throw new AccountError(t('无法连接账户服务，请检查网络后重试'), 'guest');
    const accepted = await updateState(async () => {
      if (await readToken()) return false;
      await chrome.storage.local.set({ [SESSION_KEY]: { token: data.token, guest: true }, [GUEST_CLAIMED_KEY]: true });
      return true;
    });
    if (!accepted) return null;
    await refresh();
    return data.welcomeUrl || null;
  }

  /**
   * 仅开发版：让服务端清除本机网络的访客领取记录与浏览器标记。服务端需设置 DEV_TRIAL_RESET=1，
   * 否则没有这个接口（生产环境不能开启）。提示文案只用于开发工具，不进入多语言目录。
   */
  async function devResetTrial() {
    if (!AITrEnv.dev) return null;
    const { response, data } = await call('/dev/reset-trial', { method: 'POST', auth: false });
    if (response.status === 404) throw new AccountError('服务端没有开启 DEV_TRIAL_RESET=1（apps/backend/.env.local），无法重置领取记录', 'dev_reset_disabled');
    if (!response.ok) throw new AccountError(`重置领取记录失败（${response.status}）`, 'dev_reset');
    return data;
  }

  async function logout() {
    const token = await readToken();
    try {
      await call('/logout', { method: 'POST', authToken: token });
    } catch {
      /* 服务端不可达也照样退出本机登录；会话会自然过期，也可在网页端退出 */
    }
    const status = await signOutLocally(token);
    // 只提示同一环境的网页自行核对服务端状态，不传账号数据、不替网页改 Cookie 或强制刷新。
    try {
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(tabs
        .filter((tab) => AITrEnv.isAccountPage(tab.url) || AITrEnv.isWebsitePage(tab.url))
        .map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'account-session-changed' }, { frameId: 0 })));
    } catch { /* 已关闭的标签页或没有内容脚本的旧页面在恢复焦点时核对 */ }
    return status;
  }

  const FAILURES = {
    402: (data) => (data.kind === 'guest'
      ? new AccountError(t('剩余点数不足以完成本次翻译，注册账户可获得更多点数'), 'insufficient_credits', 'open-options')
      : new AccountError(t('剩余点数不足以完成本次翻译，订阅后可无限使用'), 'insufficient_credits', 'open-options')),
    403: () => new AccountError(t('点数翻译已暂停使用，请联系我们'), 'frozen'),
    413: (data) => new AccountError(t('文字太长，点数翻译单次最多 $1 字', [data.maxChars ?? 6000]), 'too_long'),
    429: (data) => (data.error === 'fair_use'
      ? new AccountError(t('本月用量较高，请稍后再试'), 'fair_use')
      : new AccountError(t('请求太频繁，稍后再试'), 'rate_limited')),
    502: () => new AccountError(t('托管翻译暂时失败，本次没有扣点，请重试'), 'translation_failed'),
    503: () => new AccountError(t('点数翻译暂未开放'), 'hosted_unavailable', 'open-options'),
  };

  /** 用托管响应里的余额更新缓存；只接受当前会话的响应。 */
  async function syncCredits(data, token) {
    if (!data?.credits) return;
    await updateState(async () => {
      if (await readToken() !== token) return;
      const previous = await readStatus();
      if (previous.signedIn || previous.guest) await writeStatus(statusFrom({ credits: data.credits, subscription: data.subscription }, previous));
    });
  }

  const failure = (status, data) => (FAILURES[status] || (() => new AccountError(t('点数翻译失败（$1）', [status]), 'failed')))(data);

  /**
   * 托管请求统一处理认证、余额同步和错误。
   */
  async function hostedRequest(path, body, signal, options = {}) {
    // 新安装时离线没领到访客试用：第一次使用点数翻译时补领（不打开欢迎页）。
    if (!(await readToken())) await claimGuest().catch(() => null);
    const result = await call(path, { method: 'POST', body, signal, ...options });
    const { response, data, token } = result;
    if (!data) return result; // 流式响应由调用方读取
    await syncCredits(data, token);
    if (response.ok) return data;
    if (path === '/read-image' && response.status === 413) throw new AccountError(t('图片过大，请缩小后重试'), 'too_large');
    if (path === '/read-image' && response.status === 400) throw new AccountError(t('图片加载失败'), 'invalid_image');
    throw failure(response.status, data);
  }

  /** 逐个读取 SSE 的 data 事件（JSON）。 */
  async function* readEvents(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try { yield JSON.parse(line.slice(6)); } catch { /* 跳过不完整或无法解析的事件 */ }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  /**
   * 单段文字流式翻译（划词弹窗、翻译面板）：逐段产出译文，最后用服务端返回的余额更新缓存。
   * 服务端不支持流式时（旧版本）会一次性返回整段，同样可用。
   */
  async function* translateStream({ text, target, source, signal }) {
    const reply = await hostedRequest('/translate', { texts: [text], target, source: source || undefined, stream: true }, signal, { stream: true });
    if (!reply.response) {
      if (!Array.isArray(reply.translations)) throw new AccountError(t('点数翻译失败'), 'invalid_response');
      if (reply.translations[0]) yield reply.translations[0];
      return;
    }
    let final = null;
    for await (const event of readEvents(reply.response.body)) {
      if (typeof event.delta === 'string') yield event.delta;
      else if (event.done || event.error) { final = event; break; }
    }
    await syncCredits(final, reply.token);
    // 连接中途断开：服务端仍会结算，余额在下次刷新时更新。
    if (!final) throw new AccountError(t('无法连接账户服务，请检查网络后重试'), 'network');
    if (final.error) throw failure(502, final);
  }

  async function translate({ texts, target, source, signal }) {
    const data = await hostedRequest('/translate', { texts, target, source: source || undefined }, signal);
    if (!Array.isArray(data.translations)) throw new AccountError(t('点数翻译失败'), 'invalid_response');
    return data.translations;
  }

  async function readImageText({ image, signal }) {
    const data = await hostedRequest('/read-image', { image }, signal);
    if (typeof data.raw !== 'string') throw new AccountError(t('识别失败'), 'invalid_response');
    return data.raw;
  }

  globalThis.AITrAccount = { API_ORIGIN, STATUS_KEY, AccountError, login, completeLogin, claimGuest, devResetTrial, logout, refresh, readStatus, translate, translateStream, readImageText, warm };
})();

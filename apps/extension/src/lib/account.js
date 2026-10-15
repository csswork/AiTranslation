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

  async function signOutLocally() {
    await chrome.storage.local.remove(SESSION_KEY);
    return writeStatus({ signedIn: false });
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

  async function call(path, { method = 'GET', body, auth = true, signal } = {}) {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (auth) {
      const token = await readToken();
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
      await signOutLocally();
      throw new AccountError(t('登录已失效，请重新登录'), 'unauthorized', 'open-options');
    }
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  /** 读取最新状态；未登录时不发请求。网络失败时保留上次的状态。 */
  async function refresh() {
    if (!(await readToken())) return writeStatus({ signedIn: false });
    const { response, data } = await call('/me');
    if (!response.ok) throw new AccountError(t('读取账户状态失败（$1）', [response.status]), 'status');
    return writeStatus(statusFrom(data, await readStatus()));
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
    await chrome.storage.local.set({ [SESSION_KEY]: { token: data.token } });
    return { status: await refresh(), returnTabId: pending.returnTabId };
  }

  /**
   * 领取访客试用：只在这台浏览器从未领取、且当前没有任何登录时进行（退出登录后不会再领）。
   * 返回欢迎页地址（新安装时打开它，由用户端识别同一浏览器的重复领取）；不需要或失败时返回 null。
   */
  async function claimGuest() {
    if (await readToken()) return null;
    if ((await chrome.storage.local.get(GUEST_CLAIMED_KEY))[GUEST_CLAIMED_KEY]) return null;
    const { response, data } = await call('/guest', { method: 'POST', auth: false });
    if (!response.ok || !data.token) throw new AccountError(t('无法连接账户服务，请检查网络后重试'), 'guest');
    await chrome.storage.local.set({ [SESSION_KEY]: { token: data.token, guest: true }, [GUEST_CLAIMED_KEY]: true });
    await refresh();
    return data.welcomeUrl || null;
  }

  async function logout() {
    try {
      await call('/logout', { method: 'POST' });
    } catch {
      /* 服务端不可达也照样退出本机登录；会话会自然过期，也可在网页端退出 */
    }
    return signOutLocally();
  }

  const FAILURES = {
    402: (data) => (data.kind === 'guest'
      ? new AccountError(t('免费点数已用完，注册账户即可获得更多点数'), 'insufficient_credits', 'open-options')
      : new AccountError(t('点数已用完，订阅后可无限使用'), 'insufficient_credits', 'open-options')),
    403: () => new AccountError(t('点数翻译已暂停使用，请联系我们'), 'frozen'),
    413: (data) => new AccountError(t('文字太长，点数翻译单次最多 $1 字', [data.maxChars ?? 6000]), 'too_long'),
    429: (data) => (data.error === 'fair_use'
      ? new AccountError(t('本月用量较高，请稍后再试'), 'fair_use')
      : new AccountError(t('请求太频繁，稍后再试'), 'rate_limited')),
    502: () => new AccountError(t('托管翻译暂时失败，本次没有扣点，请重试'), 'translation_failed'),
    503: () => new AccountError(t('点数翻译暂未开放'), 'hosted_unavailable', 'open-options'),
  };

  /**
   * 托管文字翻译：一次传一段或多段。每次返回都带最新余额，顺手更新状态，界面上的点数随之变化。
   * @returns {Promise<string[]>}
   */
  async function translate({ texts, target, source, signal }) {
    // 新安装时离线没领到访客试用：第一次使用点数翻译时补领（不打开欢迎页）。
    if (!(await readToken())) await claimGuest().catch(() => null);
    const { response, data } = await call('/translate', { method: 'POST', body: { texts, target, source: source || undefined }, signal });
    if (data.credits) {
      const previous = await readStatus();
      if (previous.signedIn || previous.guest) await writeStatus(statusFrom({ credits: data.credits, subscription: data.subscription }, previous));
    }
    if (response.ok && Array.isArray(data.translations)) return data.translations;
    throw (FAILURES[response.status] || (() => new AccountError(t('点数翻译失败（$1）', [response.status]), 'failed')))(data);
  }

  globalThis.AITrAccount = { API_ORIGIN, STATUS_KEY, AccountError, login, completeLogin, claimGuest, logout, refresh, readStatus, translate };
})();

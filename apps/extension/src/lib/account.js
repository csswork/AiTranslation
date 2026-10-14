/**
 * 账户与托管翻译。只在 service worker 里加载：所有账户请求都从这里发出，
 * 只发往固定的用户端地址（API_ORIGIN），网页内容脚本不能借它代请求任意地址。
 *
 * 登录：chrome.identity.launchWebAuthFlow 打开用户端授权页 → 回调带一次性授权码 →
 *       用 PKCE 的 code_verifier 换取扩展会话令牌。令牌只存在 chrome.storage.local，不同步。
 * 状态：用户名、点数、试用、订阅保存为 accountStatus，设置页和弹窗监听它的变化即时更新；
 *       令牌失效（过期或在网页端被退出）时自动回到未登录。
 * 与 lang.js 一样，不能使用 import / export。
 */
(() => {
  const t = (...args) => AITrI18n.t(...args);

  // 商店安装的扩展带 update_url；开发者模式加载的没有，连本机的用户端。
  const API_ORIGIN = chrome.runtime.getManifest().update_url ? 'https://app.huaci.app' : 'http://localhost:8787';
  const SESSION_KEY = 'accountSession';
  const STATUS_KEY = 'accountStatus';

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

  async function readToken() {
    return (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY]?.token || '';
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

  /** 服务端返回的状态里只保留界面需要的字段。 */
  function statusFrom(data, previous = {}) {
    return {
      signedIn: true,
      username: data.username ?? previous.username ?? '',
      credits: data.credits ?? previous.credits ?? null,
      subscription: data.subscription !== undefined ? data.subscription : previous.subscription ?? null,
      hosted: data.hosted ?? previous.hosted ?? null,
      links: data.links ?? previous.links ?? null,
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

  async function login() {
    const redirectUri = chrome.identity.getRedirectURL();
    const verifier = randomString(32);
    const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = randomString(16);
    const url = new URL(`${API_ORIGIN}/extension/authorize`);
    url.search = new URLSearchParams({
      redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state,
    }).toString();

    let result;
    try {
      result = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true });
    } catch {
      throw new AccountError(t('登录窗口已关闭'), 'cancelled');
    }
    const back = new URL(result);
    if (back.searchParams.get('state') !== state) throw new AccountError(t('登录请求无效，请重试'), 'state');
    if (back.searchParams.get('error')) throw new AccountError(t('已取消登录'), 'cancelled');
    const code = back.searchParams.get('code');
    if (!code) throw new AccountError(t('登录请求无效，请重试'), 'code');

    const { response, data } = await call('/token', {
      method: 'POST', auth: false, body: { code, code_verifier: verifier, redirect_uri: redirectUri },
    });
    if (!response.ok || !data.token) throw new AccountError(t('登录失败，请重试'), 'token');
    await chrome.storage.local.set({ [SESSION_KEY]: { token: data.token } });
    return refresh();
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
    402: (data) => new AccountError(t('点数不足：本次需要 $1 点，剩余 $2 点', [data.cost ?? '?', data.credits?.balance ?? 0]), 'insufficient_credits', 'open-options'),
    413: (data) => new AccountError(t('文字太长，点数翻译单次最多 $1 字', [data.maxChars ?? 6000]), 'too_long'),
    429: () => new AccountError(t('请求太频繁，稍后再试'), 'rate_limited'),
    502: () => new AccountError(t('托管翻译暂时失败，本次没有扣点，请重试'), 'translation_failed'),
    503: () => new AccountError(t('点数翻译暂未开放'), 'hosted_unavailable', 'open-options'),
  };

  /**
   * 托管文字翻译：一次传一段或多段。每次返回都带最新余额，顺手更新状态，界面上的点数随之变化。
   * @returns {Promise<string[]>}
   */
  async function translate({ texts, target, source, signal }) {
    const { response, data } = await call('/translate', { method: 'POST', body: { texts, target, source: source || undefined }, signal });
    if (data.credits) {
      const previous = await readStatus();
      if (previous.signedIn) await writeStatus(statusFrom({ credits: data.credits, subscription: data.subscription }, previous));
    }
    if (response.ok && Array.isArray(data.translations)) return data.translations;
    throw (FAILURES[response.status] || (() => new AccountError(t('点数翻译失败（$1）', [response.status]), 'failed')))(data);
  }

  globalThis.AITrAccount = { API_ORIGIN, STATUS_KEY, AccountError, login, logout, refresh, readStatus, translate };
})();

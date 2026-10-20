/**
 * 用户管理界面（用户端，规划 app.huaci.app）的路由：U1–U8，以及界面语言与配色偏好。
 * 每个页面只读写当前登录用户自己的数据；权限在这里由服务端判断。
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { createAuthCode, extensionIdFromRedirect, isValidChallenge } from '../../src/auth/extension.js';
import { finishGoogleAuth, startGoogleAuth } from '../../src/auth/google.js';
import { issueCode, verifyCode } from '../../src/auth/email-codes.js';
import {
  createSession, listSessions, revokeOtherSessions, revokeSession, validateWebSession,
} from '../../src/auth/sessions.js';
import {
  findIdentity, findOrCreateUserByEmail, findUserByEmail, isValidEmail, linkIdentity, listIdentities,
  normalizeEmail, unlinkIdentity, updateEmail, updateUsername,
} from '../../src/auth/users.js';
import { accountState, latestSubscription } from '../../src/billing/entitlements.js';
import { creditBalance } from '../../src/credits/ledger.js';
import { linkBrowser, mergeBrowserGuest } from '../../src/guest/index.js';
import {
  clearPreference, clearSessionCookie, clearTemp, getBrowserMark, getSessionToken, getTemp, setBrowserMark,
  setPreference, setSessionCookie, setTemp,
} from '../../src/http/cookies.js';
import { clientAddress, createRateLimiter } from '../../src/http/security.js';
import { isLocale, k } from '../../src/i18n/index.js';
import { usageOverview } from '../../src/usage/overview.js';
import { creditActivity } from '../../src/usage/activity.js';
import { THEMES, safePath, uiContext } from './context.js';
import * as views from './views.js';

const ok = (key, params) => ({ kind: 'ok', key, params });
const fail = (key, params) => ({ kind: 'error', key, params });

/** 跨重定向的一次性提示，Cookie 里只放键名。 */
const FLASH = {
  signed_out: ok(k('已退出登录。')),
  code_resent: ok(k('新的验证码已发送。')),
  username_saved: ok(k('用户名已更新。')),
  email_changed: ok(k('邮箱已更换。')),
  email_taken: fail(k('该邮箱已被其他账户使用。')),
  google_linked: ok(k('已绑定 Google 账号。')),
  google_unlinked: ok(k('已解除 Google 绑定。')),
  google_failed: fail(k('Google 登录没有完成，请重试。')),
  google_unverified: fail(k('该 Google 账号没有已验证的邮箱，请改用邮箱验证码登录。')),
  google_taken: fail(k('该 Google 账号已绑定其他账户。')),
  google_already: fail(k('当前账户已绑定 Google 账号。')),
  google_conflict: fail(k('该邮箱的账户已绑定另一个 Google 账号，请用邮箱验证码登录后在账户里处理。')),
  session_revoked: ok(k('已退出该会话。')),
  others_revoked: ok(k('已退出其他全部会话。')),
  too_soon: fail(k('验证码发送太频繁，请 60 秒后再试。')),
  too_many: fail(k('该邮箱 1 小时内请求验证码次数过多，请稍后再试。')),
  rate: fail(k('请求过于频繁，请稍后再试。')),
  mail_failed: fail(k('验证码邮件暂时发不出去，请稍后再试，或改用 Google 登录。')),
  checkout_failed: fail(k('暂时无法打开结账页面，请稍后再试。')),
  portal_failed: fail(k('暂时无法打开订阅管理页面，请稍后再试。')),
  already_subscribed: ok(k('你已经订阅，可以直接无限使用。')),
  checkout_done: ok(k('付款完成。订阅确认后会自动生效，通常只需几秒；刷新页面即可看到。')),
};

const verifyError = (result) => {
  if (result.reason === 'invalid') {
    return result.remaining
      ? fail(k('验证码不正确，还可以尝试 {n} 次。'), { n: result.remaining })
      : fail(k('请输入 6 位数字验证码。'));
  }
  if (result.reason === 'locked') return fail(k('尝试次数过多，验证码已失效，请重新获取。'));
  return fail(k('验证码已过期或已失效，请重新获取。'));
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 登录后可返回的地址：站内路径（如扩展授权页），或 WEB_ORIGINS 白名单里的官网地址。 */
export function safeReturnUrl(value, config) {
  if (typeof value === 'string' && value.startsWith('/')) return safePath(value) === value ? value : null;
  try {
    const url = new URL(String(value || ''));
    return config.webOrigins.includes(url.origin) ? url.href : null;
  } catch {
    return null;
  }
}

export function accountRoutes({ config, pool, mailer, google, googleIdToken = null, settings, creem = null, log = console }) {
  const app = new Hono();
  // 每个来源地址每小时最多请求 20 次验证码（另有按邮箱的限制，见 email-codes）。
  const sendLimiter = createRateLimiter({ limit: 20, windowMs: 60 * 60 * 1000 });

  const flash = (c, key) => setTemp(c, config, 'flash', key, 60);
  const takeFlash = (c) => {
    const key = getTemp(c, 'flash');
    if (!key) return null;
    clearTemp(c, config, 'flash');
    return FLASH[key] || null;
  };
  const back = (c, key, path) => {
    flash(c, key);
    return c.redirect(path, 303);
  };
  const render = (c, view, props, status = 200) => c.html(view(uiContext(c, config), props), status);

  const sendCode = async (c, { email, purpose, userId = null }) => {
    if (!sendLimiter(clientAddress(c, config))) return { ok: false, reason: 'rate' };
    const result = await issueCode(pool, config, { email, purpose, userId });
    if (result.ok) {
      try {
        await mailer.sendCode({ to: email, code: result.code, purpose, locale: uiContext(c, config).locale.code });
      } catch (err) {
        log.warn(`验证码邮件发送失败：${err.message}`);
        return { ok: false, reason: 'mail_failed' };
      }
    }
    return result;
  };

  /** 注册赠送点数（管理员界面可调，不过期）。 */
  const signupCredits = async () => (await settings.all()).signup_credits;

  /**
   * 建立网页会话；如果是从官网进入的登录，完成后回到官网原页面。
   * 这个浏览器的扩展如果还是访客，把访客合并进刚登录的账户（剩余点数转入，扩展随之登录）。
   */
  const signIn = async (c, userId) => {
    const webSessionId = randomUUID();
    const token = await createSession(pool, config, userId, 'web', { id: webSessionId });
    await mergeBrowserGuest(pool, getBrowserMark(c, config), userId, webSessionId);
    setSessionCookie(c, config, token);
    const returnTo = safeReturnUrl(getTemp(c, 'return_to'), config);
    clearTemp(c, config, 'return_to');
    return c.redirect(returnTo || '/', 303);
  };

  app.use('*', async (c, next) => {
    const token = getSessionToken(c, config);
    const auth = await validateWebSession(pool, config, token);
    c.set('auth', auth);
    // 页面访问滚动刷新 Cookie；POST 登录与退出由各自路由设置或清除，避免重复写入。
    if (auth && c.req.method === 'GET') setSessionCookie(c, config, token);
    await next();
  });

  const requireUser = async (c, next) => {
    if (!c.get('auth')) return c.redirect('/login', 303);
    await next();
  };
  const user = (c) => c.get('auth').user;

  /* ---------- 界面偏好 ---------- */

  app.post('/preferences/lang', async (c) => {
    const body = await c.req.parseBody();
    if (isLocale(body.lang)) setPreference(c, config, 'lang', body.lang);
    return c.redirect(safePath(body.next), 303);
  });

  app.post('/preferences/theme', async (c) => {
    const body = await c.req.parseBody();
    if (THEMES.includes(body.theme)) setPreference(c, config, 'theme', body.theme);
    else clearPreference(c, config, 'theme');
    return c.redirect(safePath(body.next), 303);
  });

  /* ---------- U1 邮箱验证码登录 ---------- */

  /** 登录页的 One Tap：每次显示生成一次性 nonce，ID token 里必须带回同一个值。 */
  const oneTapFor = (c) => {
    if (!google || !googleIdToken) return null;
    const nonce = randomBytes(24).toString('base64url');
    setTemp(c, config, 'onetap_nonce', nonce);
    c.set('oneTap', true);
    return { clientId: config.google.clientId, nonce };
  };

  app.get('/login', (c) => {
    const returnTo = safeReturnUrl(c.req.query('return'), config);
    if (c.get('auth')) return c.redirect(returnTo || '/', 303);
    if (returnTo) setTemp(c, config, 'return_to', returnTo, 30 * 60);
    return render(c, views.loginPage, { googleEnabled: Boolean(google), oneTap: oneTapFor(c), notice: takeFlash(c) });
  });

  app.post('/login/email', async (c) => {
    const body = await c.req.parseBody();
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) {
      return render(c, views.loginPage, { googleEnabled: Boolean(google), email, notice: fail(k('请输入有效的邮箱地址。')) }, 400);
    }
    const result = await sendCode(c, { email, purpose: 'login' });
    if (!result.ok) return render(c, views.loginPage, { googleEnabled: Boolean(google), email, notice: FLASH[result.reason] }, 429);
    setTemp(c, config, 'pending_login', email);
    return c.redirect('/login/verify', 303);
  });

  const loginVerifyView = (c, email, notice) => views.verifyPage(uiContext(c, config), {
    title: uiContext(c, config).t('输入验证码'), email, action: '/login/verify', resendAction: '/login/resend', backHref: '/login', notice,
  });

  app.get('/login/verify', (c) => {
    const email = getTemp(c, 'pending_login');
    if (!email) return c.redirect('/login', 303);
    return c.html(loginVerifyView(c, email, takeFlash(c)));
  });

  app.post('/login/resend', async (c) => {
    const email = getTemp(c, 'pending_login');
    if (!email) return c.redirect('/login', 303);
    const result = await sendCode(c, { email, purpose: 'login' });
    return back(c, result.ok ? 'code_resent' : result.reason, '/login/verify');
  });

  app.post('/login/verify', async (c) => {
    const email = getTemp(c, 'pending_login');
    if (!email) return c.redirect('/login', 303);
    const body = await c.req.parseBody();
    const result = await verifyCode(pool, config, { email, purpose: 'login', code: body.code });
    if (!result.ok) return c.html(loginVerifyView(c, email, verifyError(result)), 400);
    const { user: account } = await findOrCreateUserByEmail(pool, await signupCredits(), email);
    clearTemp(c, config, 'pending_login');
    return signIn(c, account.id);
  });

  /* ---------- U1 / U6 Google 登录与绑定 ---------- */

  /** 授权码流程与 One Tap 共用：按 Google 用户标识找账号，否则按已验证邮箱绑定或新建。 */
  const googleSignIn = async (c, claims) => {
    let userId = (await findIdentity(pool, 'google', claims.subject))?.user_id;
    if (!userId) {
      if (!claims.emailVerified || !isValidEmail(claims.email)) return back(c, 'google_unverified', '/login');
      const existing = await findUserByEmail(pool, claims.email);
      if (existing) {
        // Google 已验证该邮箱，视为同一人，绑定到已有账户；不会重复发放试用点数。
        const result = await linkIdentity(pool, existing.id, 'google', claims.subject);
        if (result !== 'ok') return back(c, 'google_conflict', '/login');
        userId = existing.id;
      } else {
        const created = await findOrCreateUserByEmail(pool, await signupCredits(), claims.email, { provider: 'google', subject: claims.subject });
        userId = created.user.id;
      }
    }
    return signIn(c, userId);
  };

  const startGoogle = (c, intent) => {
    const { state, codeVerifier, url } = startGoogleAuth(google);
    setTemp(c, config, 'oauth_state', state);
    setTemp(c, config, 'oauth_verifier', codeVerifier);
    setTemp(c, config, 'oauth_intent', intent);
    return c.redirect(url, 302);
  };

  app.get('/auth/google', (c) => {
    if (!google) return c.notFound();
    return startGoogle(c, 'login');
  });

  app.post('/auth/google/link', requireUser, (c) => {
    if (!google) return c.notFound();
    return startGoogle(c, 'link');
  });

  app.get('/auth/google/callback', async (c) => {
    if (!google) return c.notFound();
    const storedState = getTemp(c, 'oauth_state');
    const verifier = getTemp(c, 'oauth_verifier');
    const intent = getTemp(c, 'oauth_intent') === 'link' ? 'link' : 'login';
    for (const name of ['oauth_state', 'oauth_verifier', 'oauth_intent']) clearTemp(c, config, name);
    const failPath = intent === 'link' ? '/account' : '/login';

    const { code, state, error } = c.req.query();
    if (error || !code || !state || !storedState || state !== storedState || !verifier) {
      return back(c, 'google_failed', failPath);
    }
    let claims;
    try {
      claims = await finishGoogleAuth(google, code, verifier);
    } catch (err) {
      // 只记录错误类别与 OAuth 错误码，不记录授权码、令牌或响应内容。
      // ArcticFetchError 包着 fetch 的 TypeError，真正的网络错误码（ETIMEDOUT、ENOTFOUND 等）在再下一层。
      const code = err.code || err.cause?.code || err.cause?.cause?.code || err.cause?.message || '';
      log.warn(`Google 授权码交换失败：${err.constructor?.name || err.name} ${code}`.trim());
      return back(c, 'google_failed', failPath);
    }
    if (!claims.subject) return back(c, 'google_failed', failPath);

    if (intent === 'link') {
      const auth = c.get('auth');
      if (!auth) return c.redirect('/login', 303);
      const result = await linkIdentity(pool, auth.user.id, 'google', claims.subject);
      return back(c, { ok: 'google_linked', taken: 'google_taken', already: 'google_already' }[result], '/account');
    }

    return googleSignIn(c, claims);
  });

  /* ---------- U1 Google One Tap：页面直接收到 Google 签名的 ID token ---------- */

  app.post('/auth/google/one-tap', async (c) => {
    if (!google || !googleIdToken) return c.notFound();
    const body = await c.req.parseBody();
    const nonce = getTemp(c, 'onetap_nonce');
    clearTemp(c, config, 'onetap_nonce');
    let claims;
    try {
      claims = await googleIdToken(body.credential, nonce);
    } catch (err) {
      log.warn(`Google One Tap 令牌校验失败：${err.message}`);
      return back(c, 'google_failed', '/login');
    }
    if (!claims.subject) return back(c, 'google_failed', '/login');
    return googleSignIn(c, claims);
  });

  /* ---------- 扩展登录授权：扩展打开授权页 → 确认 → 一次性授权码回到扩展的回调页 ---------- */

  const readExtensionRequest = (c) => {
    try {
      const pending = JSON.parse(getTemp(c, 'ext_auth') || 'null');
      return pending && extensionIdFromRedirect(pending.redirectUri, config) && isValidChallenge(pending.codeChallenge) ? pending : null;
    } catch {
      return null;
    }
  };
  // 授权页的 CSP 只放行这次请求的扩展来源（Node 的 URL 不给 chrome-extension: 计算 origin，按扩展 ID 拼）。
  const extensionOrigin = (pending) => `chrome-extension://${extensionIdFromRedirect(pending.redirectUri, config)}`;
  const invalidExtensionRequest = (c) => render(c, views.errorPage, {
    status: 400, user: c.get('auth')?.user, message: k('扩展登录请求无效或已过期，请回到扩展重新登录。'),
  }, 400);

  app.get('/extension/authorize', (c) => {
    const { redirect_uri: redirectUri, code_challenge: codeChallenge, code_challenge_method: method, state = '' } = c.req.query();
    if (!extensionIdFromRedirect(redirectUri, config) || !isValidChallenge(codeChallenge) || method !== 'S256' || state.length > 200) {
      return invalidExtensionRequest(c);
    }
    setTemp(c, config, 'ext_auth', JSON.stringify({ redirectUri, codeChallenge, state }));
    if (!c.get('auth')) {
      setTemp(c, config, 'return_to', '/extension/authorize/confirm', 30 * 60);
      return c.redirect('/login', 303);
    }
    return c.redirect('/extension/authorize/confirm', 303);
  });

  app.get('/extension/authorize/confirm', requireUser, (c) => {
    const pending = readExtensionRequest(c);
    if (!pending) return invalidExtensionRequest(c);
    c.set('extensionAuth', extensionOrigin(pending));
    return render(c, views.extensionConsentPage, { user: user(c) });
  });

  app.post('/extension/authorize/confirm', requireUser, async (c) => {
    const pending = readExtensionRequest(c);
    clearTemp(c, config, 'ext_auth');
    if (!pending) return invalidExtensionRequest(c);
    const body = await c.req.parseBody();
    const target = new URL(pending.redirectUri);
    if (body.decision === 'approve') {
      target.searchParams.set('code', await createAuthCode(pool, {
        userId: user(c).id, redirectUri: pending.redirectUri, codeChallenge: pending.codeChallenge,
        webSessionId: c.get('auth').session.id,
      }));
    } else {
      target.searchParams.set('error', 'access_denied');
    }
    if (pending.state) target.searchParams.set('state', pending.state);
    c.set('extensionAuth', extensionOrigin(pending));
    return c.redirect(target.href, 303);
  });

  app.post('/logout', async (c) => {
    const auth = c.get('auth');
    if (auth) await revokeSession(pool, auth.user.id, auth.session.id);
    clearSessionCookie(c, config);
    return back(c, 'signed_out', '/login');
  });

  /* ---------- 扩展安装后的欢迎页：识别同一浏览器重复领取访客点数（见 src/guest） ---------- */

  app.get('/welcome', async (c) => {
    const result = await linkBrowser(pool, { linkCode: c.req.query('link'), markValue: getBrowserMark(c, config) });
    if (result.newMark) setBrowserMark(c, config, result.newMark);
    else if (getBrowserMark(c, config)) setBrowserMark(c, config, getBrowserMark(c, config));
    const balance = result.userId ? await creditBalance(pool, result.userId) : null;
    const s = await settings.all();
    return render(c, views.welcomePage, {
      user: c.get('auth')?.user || null,
      outcome: result.outcome,
      claimOutcome: result.claim?.outcome || null,
      balance,
      signupCredits: s.signup_credits,
    });
  });

  /* ---------- U2–U5、U8 ---------- */

  app.get('/', requireUser, async (c) => render(c, views.overviewPage, {
    user: user(c), state: await accountState(pool, user(c)), notice: takeFlash(c),
    usage: await usageOverview(pool, user(c).id, { period: c.req.query('period'), kind: c.req.query('kind') }),
  }));

  const pricing = async () => {
    const s = await settings.all();
    return {
      currency: s.price_currency,
      monthly: { price: s.price_monthly, original: s.price_monthly_original },
      yearly: { price: s.price_yearly, original: s.price_yearly_original },
    };
  };

  app.get('/plans', requireUser, async (c) => render(c, views.plansPage, {
    user: user(c), state: await accountState(pool, user(c)), pricing: await pricing(), checkoutEnabled: Boolean(creem), notice: takeFlash(c),
  }));

  // 结账：在 Creem 的结账页付款，订阅由已验签的回调开通；这里只负责创建结账会话并跳转。
  app.post('/billing/checkout', requireUser, async (c) => {
    if (!creem) return c.notFound();
    const body = await c.req.parseBody();
    const plan = body.plan === 'yearly' ? 'yearly' : 'monthly';
    if ((await accountState(pool, user(c))).subscription) return back(c, 'already_subscribed', '/plans');
    try {
      const url = await creem.createCheckout({
        plan, userId: user(c).id, email: user(c).email, requestId: randomUUID(), successUrl: `${config.appOrigin}/billing/success`,
      });
      return c.redirect(url, 303);
    } catch (err) {
      log.warn(`创建 Creem 结账失败：${err.message}`);
      return back(c, 'checkout_failed', '/plans');
    }
  });

  // 付款后 Creem 跳回这里。订阅以回调为准，不信任这个地址上的参数。
  app.get('/billing/success', requireUser, (c) => back(c, 'checkout_done', '/billing'));

  // Creem 客户门户：取消订阅、更换付款方式、下载发票。
  app.post('/billing/portal', requireUser, async (c) => {
    const sub = await latestSubscription(pool, user(c).id);
    if (!creem || !sub?.provider_customer_id) return c.redirect('/billing', 303);
    try {
      return c.redirect(await creem.customerPortal(sub.provider_customer_id), 303);
    } catch (err) {
      log.warn(`打开 Creem 客户门户失败：${err.message}`);
      return back(c, 'portal_failed', '/billing');
    }
  });

  app.get('/billing', requireUser, async (c) => {
    const { rows: orders } = await pool.query(
      `SELECT plan, amount, currency, refunded_amount, status, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [user(c).id],
    );
    return render(c, views.billingPage, {
      user: user(c), subscription: await latestSubscription(pool, user(c).id), orders, portalEnabled: Boolean(creem), notice: takeFlash(c),
    });
  });
  app.get('/usage', requireUser, async (c) => render(c, views.usagePage, {
    user: user(c), activity: await creditActivity(pool, user(c).id, { period: c.req.query('period') }),
  }));
  app.get('/help', requireUser, (c) => render(c, views.helpPage, { user: user(c) }));

  /* ---------- U6 邮箱、用户名与登录方式 ---------- */

  const renderAccount = async (c, extra = {}, status = 200) => render(c, views.accountPage, {
    user: user(c),
    identities: await listIdentities(pool, user(c).id),
    googleEnabled: Boolean(google),
    ...extra,
  }, status);

  app.get('/account', requireUser, async (c) => renderAccount(c, { notice: takeFlash(c) }));

  app.post('/account/username', requireUser, async (c) => {
    const body = await c.req.parseBody();
    const result = await updateUsername(pool, user(c).id, body.username);
    if (result === 'ok') return back(c, 'username_saved', '/account');
    const notice = result === 'taken' ? fail(k('该用户名已被使用。')) : fail(k('用户名需为 3–24 位小写字母、数字、下划线或短横线。'));
    return renderAccount(c, { notice, username: String(body.username ?? '') }, 400);
  });

  app.post('/account/email', requireUser, async (c) => {
    const body = await c.req.parseBody();
    const email = normalizeEmail(body.email);
    let notice = null;
    if (!isValidEmail(email)) notice = fail(k('请输入有效的邮箱地址。'));
    else if (email === user(c).email) notice = fail(k('这已经是当前邮箱。'));
    else if (await findUserByEmail(pool, email)) notice = FLASH.email_taken;
    if (notice) return renderAccount(c, { notice, newEmail: email }, 400);

    const result = await sendCode(c, { email, purpose: 'change_email', userId: user(c).id });
    if (!result.ok) return renderAccount(c, { notice: FLASH[result.reason], newEmail: email }, 429);
    setTemp(c, config, 'pending_email', email);
    return c.redirect('/account/email/verify', 303);
  });

  const emailVerifyView = (c, email, notice) => views.verifyPage(uiContext(c, config), {
    title: uiContext(c, config).t('验证新邮箱'), email, action: '/account/email/verify', resendAction: '/account/email/resend',
    backHref: '/account', user: user(c), active: 'account', notice,
  });

  app.get('/account/email/verify', requireUser, (c) => {
    const email = getTemp(c, 'pending_email');
    if (!email) return c.redirect('/account', 303);
    return c.html(emailVerifyView(c, email, takeFlash(c)));
  });

  app.post('/account/email/resend', requireUser, async (c) => {
    const email = getTemp(c, 'pending_email');
    if (!email) return c.redirect('/account', 303);
    const result = await sendCode(c, { email, purpose: 'change_email', userId: user(c).id });
    return back(c, result.ok ? 'code_resent' : result.reason, '/account/email/verify');
  });

  app.post('/account/email/verify', requireUser, async (c) => {
    const email = getTemp(c, 'pending_email');
    if (!email) return c.redirect('/account', 303);
    const body = await c.req.parseBody();
    const result = await verifyCode(pool, config, { email, purpose: 'change_email', userId: user(c).id, code: body.code });
    if (!result.ok) return c.html(emailVerifyView(c, email, verifyError(result)), 400);
    clearTemp(c, config, 'pending_email');
    const updated = await updateEmail(pool, user(c).id, email);
    return back(c, updated === 'ok' ? 'email_changed' : 'email_taken', '/account');
  });

  app.post('/account/google/unlink', requireUser, async (c) => {
    await unlinkIdentity(pool, user(c).id, 'google');
    return back(c, 'google_unlinked', '/account');
  });

  /* ---------- U7 登录会话 ---------- */

  app.get('/sessions', requireUser, async (c) => render(c, views.sessionsPage, {
    user: user(c),
    sessions: await listSessions(pool, user(c).id),
    currentId: c.get('auth').session.id,
    notice: takeFlash(c),
  }));

  app.post('/sessions/revoke-others', requireUser, async (c) => {
    await revokeOtherSessions(pool, user(c).id, c.get('auth').session.id);
    return back(c, 'others_revoked', '/sessions');
  });

  app.post('/sessions/:id/revoke', requireUser, async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.notFound();
    await revokeSession(pool, user(c).id, id);
    if (id === c.get('auth').session.id) {
      clearSessionCookie(c, config);
      return back(c, 'signed_out', '/login');
    }
    return back(c, 'session_revoked', '/sessions');
  });

  return app;
}

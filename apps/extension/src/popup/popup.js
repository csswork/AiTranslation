(async () => {
  await AITrI18n.ready;
  const t = (...args) => AITrI18n.t(...args);
  const S = globalThis.AITrSettings;
  const C = globalThis.AITrCredits;
  const $ = (id) => document.getElementById(id);
  const el = {
    account: $('account'),
    avatar: $('avatar'),
    title: $('title'),
    subtitle: $('subtitle'),
    badge: $('badge'),
    balance: $('balance'),
    amount: $('amount'),
    unit: $('unit'),
    balanceNote: $('balanceNote'),
    cta: $('cta'),
    links: $('links'),
    modeNote: $('modeNote'),
    tip: $('tip'),
    provider: $('provider'),
    keyState: $('keyState'),
    keyText: $('keyText'),
    panel: $('panel'),
    image: $('image'),
    video: $('video'),
    open: $('open'),
  };

  const ACCOUNT_KEY = 'accountStatus'; // 与 lib/account.js 的 STATUS_KEY 一致
  const CHARS_PER_CREDIT = 500; // 与服务端一致：500 个字符 = 1 点（只用于「约可翻译多少字」的换算展示）
  const LOW_CREDITS = 20; // 低于这个点数提示「即将用完」
  let settings = S.normalize(null);
  let account = { signedIn: false };
  let ctaAction = null; // 账户卡片主按钮当前对应的动作

  /* ------------------------------------------------------------ 动作 */

  const close = () => window.close();
  const actions = {
    login: async () => { await chrome.runtime.sendMessage({ type: 'account-login' }).catch(() => {}); close(); },
    plans: () => { chrome.tabs.create({ url: AITrEnv.links.plans }); close(); },
    billing: () => { chrome.tabs.create({ url: AITrEnv.links.billing }); close(); },
    usage: () => { chrome.tabs.create({ url: AITrEnv.links.usage }); close(); },
    options: () => { chrome.runtime.openOptionsPage(); close(); },
  };

  /* ------------------------------------------------------------ 账户卡片 */

  const number = (value) => Number(value) || 0;
  const compact = (value) => new Intl.NumberFormat(AITrI18n.locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  const day = (value) => new Date(value).toLocaleDateString(AITrI18n.locale(), { year: 'numeric', month: 'short', day: 'numeric' });

  /**
   * 按账户状态得出卡片内容。每种状态只有一个主要的下一步（cta），其余放成次要链接。
   *   未登录 → 登录 / 注册；访客 → 注册再送点数；注册用户 → 余额，快用完时订阅；订阅 → 无限使用。
   */
  function cardFor(a) {
    const credits = a.credits || {};
    const balance = number(credits.balance);
    const available = C.available(credits);
    const low = available && balance < LOW_CREDITS;
    const reach = available ? t('约可翻译 $1 字', [compact(balance * CHARS_PER_CREDIT)]) : '';
    const signupBonus = C.format(a.offers?.signupCredits ?? 200);
    const points = { amount: C.format(balance), unit: t('点') };

    if (!a.signedIn && !a.guest) {
      return {
        avatar: '?', outline: true, title: t('未登录'), subtitle: t('登录后可使用点数翻译，不需要 API Key'),
        cta: { label: t('登录 / 注册'), action: 'login' },
        links: [{ label: t('使用自己的 API Key'), action: 'options' }],
      };
    }
    if (a.guest) {
      return {
        avatar: '✦', outline: true, title: t('免费试用'), subtitle: t('未注册 · 点数不过期'), badge: { label: t('访客') },
        balance: { ...points, note: available ? reach : t('免费点数已用完'), state: !available ? 'empty' : low ? 'low' : '' },
        cta: { label: available ? t('注册，再送 $1 点', [signupBonus]) : t('注册，领取 $1 点', [signupBonus]), action: 'login' },
        links: [{ label: t('已有账户？登录'), action: 'login' }],
      };
    }
    const name = a.username || '';
    const sub = a.subscription;
    if (sub) {
      const cancelled = sub.status === 'scheduled_cancel' || sub.renews === false;
      const plan = sub.plan === 'yearly' ? t('年付订阅') : sub.plan === 'monthly' ? t('月付订阅') : t('订阅中');
      return {
        avatar: (name[0] || '?').toUpperCase(), title: name, subtitle: plan,
        badge: cancelled ? { label: t('已取消续订'), tone: 'warn' } : { label: t('订阅中'), tone: 'ok' },
        balance: {
          amount: t('无限使用'), unit: '',
          note: sub.periodEnd ? (cancelled ? t('有效期至 $1', [day(sub.periodEnd)]) : t('下次续费 $1', [day(sub.periodEnd)])) : '',
        },
        links: [{ label: t('管理订阅'), action: 'billing' }, { label: t('用量记录'), action: 'usage' }],
      };
    }
    return {
      avatar: (name[0] || '?').toUpperCase(), title: name, subtitle: t('免费额度 · 点数不过期'),
      balance: {
        ...points,
        note: !available ? t('点数已用完') : low ? `${t('点数即将用完')} · ${reach}` : reach,
        state: !available ? 'empty' : low ? 'low' : '',
      },
      // 余额充足时订阅只做温和提示；快用完或用完时才成为主要按钮。
      cta: { label: t('订阅，无限使用'), action: 'plans', soft: available && !low },
      links: [{ label: t('账户与用量'), action: 'usage' }],
    };
  }

  function renderAccount() {
    const card = cardFor(account);
    // 正在用自己的 API Key：点数暂不消耗，卡片收紧，不再推订阅；未登录时登录按钮也降为次要样式。
    const ownKey = !S.isHosted(settings.provider);
    if (ownKey && card.cta) {
      if (card.cta.action === 'login' && !account.guest) card.cta.soft = true;
      else delete card.cta;
    }
    el.account.classList.toggle('compact', ownKey);
    el.avatar.textContent = card.avatar;
    el.avatar.classList.toggle('outline', Boolean(card.outline));
    el.title.textContent = card.title;
    el.subtitle.textContent = card.subtitle;

    el.badge.hidden = !card.badge;
    if (card.badge) {
      el.badge.textContent = card.badge.label;
      el.badge.className = `badge ${card.badge.tone || ''}`;
    }

    el.balance.hidden = !card.balance;
    if (card.balance) {
      el.balance.className = `balance ${card.balance.state || ''}`;
      el.amount.textContent = card.balance.amount;
      el.unit.textContent = card.balance.unit;
      el.balanceNote.textContent = card.balance.note;
      el.balanceNote.hidden = !card.balance.note;
    }

    el.cta.hidden = !card.cta;
    if (card.cta) {
      el.cta.textContent = card.cta.label;
      el.cta.className = `cta ${card.cta.soft ? 'soft' : ''}`;
      ctaAction = card.cta.action;
    }
    el.links.replaceChildren(...(card.links || []).map((link) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'link';
      button.textContent = link.label;
      button.addEventListener('click', actions[link.action]);
      return button;
    }));

    // 当前翻译方式与点数的关系：自带 Key 不消耗点数；托管服务暂停时说明原因。
    const active = account.signedIn || account.guest;
    let note = '';
    if (active && !S.isHosted(settings.provider)) note = t('当前使用自己的 API Key，不消耗点数。');
    else if (active && account.hosted && !account.hosted.available) note = t('点数翻译暂时不可用，可以先切换到自己的 API Key。');
    el.modeNote.textContent = note;
    el.modeNote.hidden = !note;
  }

  /* ------------------------------------------------------------ 翻译方式 */

  function render() {
    el.provider.replaceChildren(
      ...S.providerList().map((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        option.selected = item.id === settings.provider;
        return option;
      })
    );
    const hosted = S.isHosted(settings.provider);
    el.tip.textContent = t('选中文字，右键 → $1', [t('翻译成$1', [S.targetMenu(settings)])]);
    // 自带 Key 时在选择框下面显示 Key 与模型状态；点数翻译的状态在上面的账户卡片里。
    el.keyState.hidden = hosted;
    if (!hosted) {
      const provider = S.resolveProvider(settings);
      const configured = Boolean(provider.apiKey);
      el.keyText.textContent = configured
        ? [provider.model, t('API Key 已配置')].filter(Boolean).join(' · ')
        : t('还没有填写 API Key，点这里去设置');
      el.keyState.className = `key-state ${configured ? '' : 'warn'}`;
    }
    renderAccount();
    // 视频字幕默认关闭：没打开时连入口都不显示
    el.video.hidden = !settings.videoEnabled;
  }

  AITrI18n.onChange(() => render());

  el.provider.addEventListener('change', async () => {
    settings = await S.patchSettings({ provider: el.provider.value });
    render();
  });
  el.keyState.addEventListener('click', () => {
    if (el.keyState.classList.contains('warn')) actions.options();
  });
  el.cta.addEventListener('click', () => actions[ctaAction]?.());
  el.open.addEventListener('click', actions.options);

  el.panel.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/translate/translate.html') });
    close();
  });
  el.image.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/image/image.html') });
    close();
  });
  // 打开这个弹窗时，Chrome 已经给了当前标签页 activeTab 授权，后台截取声音靠的就是它
  el.video.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) {
      await chrome.runtime.sendMessage({ type: 'video-toggle', tabId: tab.id }).catch(() => {});
    }
    close();
  });

  // 账户状态由 service worker 更新（登录、退出、点数翻译后的余额），弹窗开着时跟着变
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[ACCOUNT_KEY]) {
      account = changes[ACCOUNT_KEY].newValue || { signedIn: false };
      render();
    }
  });

  (async () => {
    settings = await S.loadSettings();
    account = (await chrome.storage.local.get(ACCOUNT_KEY))[ACCOUNT_KEY] || { signedIn: false };
    render();
    // 先用缓存显示，再取一次最新状态（结果经 storage 变化回到上面的监听）
    chrome.runtime.sendMessage({ type: 'account-refresh' }).catch(() => {});
  })();
})();

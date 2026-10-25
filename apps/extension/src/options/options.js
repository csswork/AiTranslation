(async () => {
  await AITrI18n.ready;
  const t = (...args) => AITrI18n.t(...args);
  const S = globalThis.AITrSettings;
  const C = globalThis.AITrCredits;
  const ACCOUNT_KEY = 'accountStatus'; // 与 lib/account.js 的 STATUS_KEY 一致
  const $ = (id) => document.getElementById(id);
  // 外部链接按运行环境取；未打包的开发版本在页脚标出连接的本机用户端
  $('privacyLink').href = AITrEnv.links.privacy;
  if (AITrEnv.dev) {
    $('envBadge').textContent = `DEV · ${new URL(AITrEnv.accountOrigin).host}`;
    $('envBadge').title = AITrEnv.accountOrigin;
    $('envBadge').hidden = false;
  }
  const el = {
    cards: $('providerCards'),
    apiKey: $('apiKey'),
    toggleKey: $('toggleKey'),
    keyLink: $('keyLink'),
    model: $('model'),
    modelField: $('modelField'),
    advanced: $('advanced'),
    modelList: $('modelList'),
    modelHelp: $('modelHelp'),
    baseUrl: $('baseUrl'),
    baseUrlHelp: $('baseUrlHelp'),
    test: $('test'),
    testResult: $('testResult'),
    target: $('target'),
    uiLanguage: $('uiLanguage'),
    targetPreview: $('targetPreview'),
    stream: $('stream'),
    streamHelp: $('streamHelp'),
    showOriginal: $('showOriginal'),
    floating: $('floating'),
    shortcut: $('shortcut'),
    shortcutKey: $('shortcutKey'),
    shortcutHint: $('shortcutHint'),
    editShortcut: $('editShortcut'),
    status: $('status'),
    manage: $('manage'),
    visionNote: $('visionNote'),
    ruleCount: $('ruleCount'),
    videoEnabled: $('videoEnabled'),
    videoOptions: $('videoOptions'),
    videoLang: $('videoLang'),
    installLang: $('installLang'),
    langState: $('langState'),
    videoCloud: $('videoCloud'),
    videoTranslate: $('videoTranslate'),
    imageMode: $('imageMode'),
    videoTarget: $('videoTarget'),
    welcome: $('welcome'),
    useOwnKey: $('useOwnKey'),
    accountOut: $('accountOut'),
    accountIn: $('accountIn'),
    accountActions: $('accountActions'),
    accountAvatar: $('accountAvatar'),
    accountName: $('accountName'),
    accountCredits: $('accountCredits'),
    trialBadge: $('trialBadge'),
    planBadge: $('planBadge'),
    register: $('register'),
    accountCreditsLabel: $('accountCreditsLabel'),
    accountUpdated: $('accountUpdated'),
    accountError: $('accountError'),
    manageAccount: $('manageAccount'),
    viewPlans: $('viewPlans'),
    logout: $('logout'),
    providerSection: $('providerSection'),
    providerConfig: $('providerConfig'),
    hostedConfig: $('hostedConfig'),
    hostedState: $('hostedState'),
    hostedRate: $('hostedRate'),
    hostedActions: $('hostedActions'),
  };

  let settings = S.normalize(null);
  let statusTimer = 0;
  // 账户状态由 service worker 写进 storage（accountStatus），这里只读和监听，不直接请求账户服务
  let account = { signedIn: false };
  let onboarding = null;
  let lastRefresh = 0;

  function flash(text) {
    el.status.textContent = text;
    el.status.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.status.classList.remove('show'), 1600);
  }

  async function save(patch) {
    settings = await S.saveSettings({ ...settings, ...patch });
    flash(t("已保存"));
    renderCards();
  }

  /** 只改当前平台那一份配置。 */
  function saveProviderField(field, value) {
    const id = settings.provider;
    return save({ [id]: { ...settings[id], [field]: value } });
  }

  /* ------------------------------------------------------------- 账户 */

  const balanceOf = () => account.credits?.balance ?? 0;
  const hasCredits = () => C.available(account.credits);
  const hasOwnKey = () => S.KEY_PROVIDERS.some((id) => settings[id]?.apiKey);

  async function finishOnboarding() {
    if (onboarding === 'done') return;
    onboarding = 'done';
    await chrome.storage.local.set({ onboarding: 'done' });
    renderAccount();
  }

  function showAccountError(text) {
    el.accountError.hidden = !text;
    el.accountError.textContent = text || '';
  }

  const signupCredits = () => C.format(account.offers?.signupCredits ?? 200);
  const subscribed = () => Boolean(account.subscription);

  /** 账户卡片：正式账户、访客试用、未登录与新安装引导四种状态。 */
  function renderAccount() {
    AITrAuthUi.sync();
    const active = account.signedIn || account.guest;
    const welcome = !active && onboarding === 'pending' && !hasOwnKey();
    el.welcome.hidden = !welcome;
    el.accountOut.hidden = active || welcome;
    el.accountIn.hidden = !active;
    el.accountActions.hidden = !active;
    if (!active) return;

    const sub = account.subscription;
    if (account.guest) {
      el.accountAvatar.textContent = '✦';
      el.accountName.textContent = t('免费试用');
      el.trialBadge.textContent = t('未注册');
      el.trialBadge.className = 'badge';
      el.planBadge.hidden = true;
    } else {
      const name = account.username || '';
      el.accountAvatar.textContent = (name[0] || '?').toUpperCase();
      el.accountName.textContent = name;
      el.trialBadge.textContent = t('已注册');
      el.trialBadge.className = 'badge';
      el.planBadge.hidden = false;
      el.planBadge.textContent = sub ? t('订阅中') : t('未订阅');
      el.planBadge.className = `badge ${sub ? 'ok' : ''}`;
    }
    el.accountAvatar.classList.toggle('guest', Boolean(account.guest));
    // 订阅用户不显示点数，只显示无限使用
    el.accountCredits.textContent = sub ? t('无限') : C.format(balanceOf());
    el.accountCredits.className = sub || hasCredits() ? '' : 'empty';
    el.accountCreditsLabel.textContent = sub ? t('点数翻译') : t('剩余点数');

    el.register.hidden = !account.guest;
    el.register.textContent = t('注册 / 登录，再送 $1 点', [signupCredits()]);
    el.manageAccount.hidden = Boolean(account.guest);
    el.logout.hidden = Boolean(account.guest);
    el.viewPlans.hidden = Boolean(account.guest);
    el.viewPlans.textContent = sub ? t('管理订阅') : t('订阅无限使用');
    el.accountUpdated.textContent = account.updatedAt
      ? t('更新于 $1', [new Date(account.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })])
      : '';
  }

  /** 选中「点数翻译」时显示的说明与状态。 */
  function renderHosted() {
    el.hostedRate.textContent = subscribed()
      ? t('订阅期间不限次数，不消耗点数。')
      : t('按实际用量扣点，点数显示保留两位小数；翻译失败不扣点。');
    const state = document.createElement('p');
    const actions = [];
    const button = (label, onClick, ghost = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = ghost ? 'btn ghost' : 'btn';
      b.textContent = label;
      b.toggleAttribute('data-login', onClick === login);
      b.addEventListener('click', onClick);
      return b;
    };
    if (!account.signedIn && !account.guest) {
      state.className = 'hosted-line';
      state.textContent = t('登录后即可使用点数翻译。');
      actions.push(button(t('登录 / 注册'), login));
    } else if (account.hosted && !account.hosted.available) {
      state.className = 'hosted-line warn';
      state.textContent = t('点数翻译暂未开放，请先使用自己的 API Key。');
    } else if (subscribed()) {
      state.className = 'hosted-line big';
      state.textContent = t('无限使用');
      actions.push(button(t('管理订阅'), () => openLink('billing'), true));
    } else if (!hasCredits()) {
      state.className = 'hosted-line warn';
      if (account.guest) {
        state.textContent = t('免费点数已用完。注册即送 $1 点，或切换到自己的 API Key。', [signupCredits()]);
        actions.push(button(t('注册 / 登录'), login));
      } else {
        state.textContent = t('点数已用完。订阅后无限使用，或切换到自己的 API Key。');
        actions.push(button(t('订阅无限使用'), () => openLink('plans')));
      }
    } else {
      state.className = 'hosted-line big';
      state.textContent = t('剩余 $1 点', [C.format(balanceOf())]);
      actions.push(account.guest
        ? button(t('注册 / 登录，再送 $1 点', [signupCredits()]), login, true)
        : button(t('查看用量'), () => openLink('usage'), true));
    }
    el.hostedState.replaceChildren(state);
    el.hostedActions.replaceChildren(...actions);
    AITrAuthUi.sync();
  }

  function openLink(name) {
    const url = AITrEnv.links[name];
    if (url) chrome.tabs.create({ url });
  }

  async function refreshAccount() {
    lastRefresh = Date.now();
    const reply = await chrome.runtime.sendMessage({ type: 'account-refresh' }).catch(() => null);
    // 网络失败时保留上次的状态，只在设置页提示一下
    showAccountError(reply && !reply.ok && reply.code === 'network' ? reply.error : '');
  }

  async function login() {
    showAccountError('');
    await AITrAuthUi.login({ onError: showAccountError });
    // 授权页在新标签页打开；登录完成后 service worker 结束引导、按需切到点数翻译并切回本页，
    // 这里通过 storage 变化更新
  }

  function renderCards() {
    const current = settings.provider;
    el.cards.replaceChildren(
      ...S.providerList().map((item) => {
        const hosted = item.kind === 'hosted';
        const active = account.signedIn || account.guest;
        const configured = hosted ? active && (subscribed() || hasCredits()) : Boolean(settings[item.id]?.apiKey);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = hosted ? 'provider-card hosted' : 'provider-card';
        card.setAttribute('aria-pressed', String(item.id === current));
        card.innerHTML =
          `<b></b><i></i><em class="${configured ? 'ready' : ''}"></em>`;
        card.querySelector('b').textContent = item.label;
        card.querySelector('i').textContent = item.hint;
        card.querySelector('em').textContent = hosted
          ? (!active ? t('○ 需要登录') : subscribed() ? t('● 无限使用') : hasCredits() ? t('● 剩余 $1 点', [C.format(balanceOf())]) : t('○ 点数已用完'))
          : configured ? t("● 已配置 Key") : t("○ 未配置 Key");
        card.addEventListener('click', () => {
          if (settings.provider === item.id) return;
          save({ provider: item.id }).then(renderProviderConfig);
        });
        return card;
      })
    );
  }

  function renderProviderConfig() {
    const def = S.PROVIDERS[settings.provider];
    const hosted = S.isHosted(settings.provider);
    el.providerConfig.hidden = hosted;
    el.hostedConfig.hidden = !hosted;
    el.stream.disabled = !S.supportsStreaming(settings.provider);
    if (hosted) {
      renderHosted();
      el.streamHelp.textContent = t("$1 一次性返回全部译文，没有逐字显示。", [S.resolveProvider(settings).label]);
      return;
    }
    const conf = settings[settings.provider];

    // 传统翻译接口没有「模型」这个概念，地址也由 key 自动判断，
    // 把这两块藏起来，而不是留着让人填一个没用的值
    const isLLM = S.needsModel(settings.provider);
    el.modelField.hidden = !isLLM;
    el.advanced.hidden = !isLLM;
    el.apiKey.value = conf.apiKey;
    el.apiKey.placeholder = `${def.keyPrefix}...`;
    el.apiKey.type = 'password';
    el.toggleKey.textContent = t("显示");
    el.keyLink.href = def.keyUrl;
    el.keyLink.textContent = t("$1 控制台", [def.label]);

    el.model.value = conf.model;
    el.model.placeholder = def.defaultModel;
    el.modelHelp.textContent = t("留空则使用 $1。可以直接填任意该平台支持的模型名。", [def.defaultModel]);
    el.modelList.replaceChildren(
      ...def.models.map((name) => {
        const option = document.createElement('option');
        option.value = name;
        return option;
      })
    );

    el.baseUrl.value = conf.baseUrl;
    el.baseUrl.placeholder = def.defaultBaseUrl;
    el.baseUrlHelp.textContent =
      t("留空则使用 $1。填写代理或中转地址时，需要额外授权该域名。", [def.defaultBaseUrl]);

    el.testResult.textContent = '';
    el.testResult.className = 'test-result';

    el.visionNote.hidden = S.supportsVision(settings.provider);
    el.visionNote.textContent = t("$1 只能翻译文本，图片翻译需要切换到 ChatGPT 或 DeepSeek。", [def.label]);

    // 传统翻译接口一次性返回，流式开关在这里不起作用，
    // 与其留个没用的开关，不如禁用并说明
    const canStream = S.supportsStreaming(settings.provider);
    el.stream.disabled = !canStream;
    el.streamHelp.textContent = canStream
      ? t("译文逐字显示，等待感更低。")
      : t("$1 一次性返回全部译文，没有逐字显示。", [def.label]);
  }

  function renderBehavior() {
    const auto = document.createElement('option');
    auto.value = 'auto'; auto.textContent = t('跟随浏览器');
    el.uiLanguage.replaceChildren(auto, ...S.targetList().map((item) => {
      const option = document.createElement('option');
      option.value = item.id; option.textContent = item.nativeLabel; return option;
    }));
    el.target.replaceChildren(
      ...S.targetList().map((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        option.selected = item.id === settings.target;
        return option;
      })
    );
    el.targetPreview.textContent = t('右键菜单：$1', [t('翻译成$1', [S.targetMenu(settings)])]);
    el.uiLanguage.value = settings.uiLanguage;
    el.stream.checked = settings.stream;
    el.showOriginal.checked = settings.showOriginal;
    el.floating.checked = settings.floating;
    el.shortcut.checked = settings.shortcut;
    el.imageMode.value = settings.imageMode;
  }

  /**
   * 显示 Chrome 里实际分配到的快捷键。
   * suggested_key 只在「安装时」生效：给已装好的扩展新增命令、或建议键与别的
   * 扩展冲突时，都会是未分配状态，只能由用户到 Chrome 的快捷键页面自己设。
   */
  async function renderShortcutKey() {
    // 芯片里只放键位，解释放到下面一行，否则窄屏下芯片会被撑成两行
    const show = (key, hint) => {
      el.shortcutKey.textContent = key;
      el.shortcutKey.className = hint ? 'warn' : '';
      el.shortcutHint.hidden = !hint;
      if (hint) el.shortcutHint.textContent = hint;
    };
    try {
      const commands = await chrome.commands.getAll();
      const found = commands.find((item) => item.name === 'translate-selection');
      if (!found) {
        show(t("未注册"), t("命令没有注册成功，请到浏览器的扩展管理页重新加载扩展。"));
        return;
      }
      show(
        found.shortcut || t("未分配"),
        found.shortcut
          ? ''
          : t("建议快捷键只在扩展「安装时」生效，所以这里需要手动设置一次：点右边「修改」，在打开的页面里找到「翻译选中的文字」那一行，按下你想用的组合键。")
      );
    } catch {
      show(t("读取失败"), t("无法读取快捷键信息。"));
    }
  }

  /* ------------------------------------------------------------- 视频字幕 */

  const Speech = globalThis.AITrSpeech;
  let langPollTimer = 0;

  /** 总开关关着时，下面的细节整块收起；开关本身留着，不然没法再打开。 */
  function applyVideoVisibility() {
    el.videoOptions.hidden = !settings.videoEnabled;
  }

  function renderVideoLang() {
    el.videoEnabled.checked = settings.videoEnabled;
    applyVideoVisibility();
    el.videoLang.replaceChildren(
      ...S.videoLangList().map((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        option.selected = item.id === settings.videoLang;
        return option;
      })
    );
    el.videoCloud.checked = settings.videoCloud;
    el.videoTranslate.checked = settings.videoTranslate;
    el.videoTarget.textContent = t('字幕翻译成 $1，每行调用一次翻译接口。关闭后只显示原文。', [S.targetMenu(settings)]);
  }

  function showLangState(text, tone = '') {
    el.langState.textContent = text;
    el.langState.className = `test-result ${tone}`;
  }

  /**
   * 离线语言包的状态。语言包按源隔离：在这里装的，
   * 和做识别的 offscreen 文档（同为扩展的源）共用，所以只能在扩展自己的页面里装。
   * 非英语要连英语包一起算，见 lib/speech.js。
   */
  async function renderLangState() {
    clearTimeout(langPollTimer);
    el.installLang.hidden = true;
    // 总开关关着时不去探测语言包，界面上也没有地方显示状态
    if (!settings.videoEnabled) {
      showLangState('');
      return;
    }
    if (settings.videoCloud) {
      showLangState(t("云端识别不需要语言包"));
      return;
    }
    if (!Speech.supported()) {
      showLangState(t("当前浏览器不支持设备端语音识别，请使用受支持的浏览器版本，或改用云端识别。"), 'err');
      return;
    }
    const lang = settings.videoLang;
    let status;
    try {
      status = await Speech.packStatus(lang);
    } catch (err) {
      showLangState(t("读取语言包状态失败：$1", [err?.message || err]), 'err');
      return;
    }
    if (lang !== settings.videoLang || settings.videoCloud) return; // 等结果期间设置又变了
    switch (status) {
      case 'available':
        showLangState(t("离线语言包已就绪"), 'ok');
        break;
      case 'downloadable':
        showLangState(
          Speech.packsFor(lang).length > 1
            ? t("还没有下载离线语言包（会连同英语包一起下载，识别引擎随它附带）")
            : t("还没有下载离线语言包")
        );
        el.installLang.hidden = false;
        break;
      case 'downloading':
        showLangState(t("正在下载离线语言包…"));
        langPollTimer = setTimeout(renderLangState, 2000);
        break;
      default:
        showLangState(t("这台设备不支持该语言的离线识别，可以改用云端识别"), 'err');
    }
  }

  /** 把 Base URL 换成 chrome.permissions 认的 origin 形式；不合法则返回 null。 */
  function originOf(rawUrl) {
    if (!rawUrl) return null;
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== 'https:') return null;
      return `${url.origin}/*`;
    } catch {
      return null;
    }
  }

  /**
   * 自定义地址要额外授权域名。chrome.permissions.request 只能在用户手势里调用，
   * 而 change 事件是失焦触发的、不算手势，所以这里只做检查与提示，
   * 真正的授权弹窗放在「测试连接」的点击里。
   */
  async function missingOrigin() {
    const conf = settings[settings.provider];
    const origin = originOf(conf.baseUrl);
    if (!origin) return null;
    return (await chrome.permissions.contains({ origins: [origin] })) ? null : origin;
  }

  /* ------------------------------------------------------------- 事件 */

  el.apiKey.addEventListener('change', async () => {
    await saveProviderField('apiKey', el.apiKey.value.trim());
    if (el.apiKey.value.trim()) finishOnboarding();
  });

  document.querySelectorAll('[data-login]').forEach((button) => button.addEventListener('click', login));
  el.logout.addEventListener('click', async () => {
    el.logout.disabled = true;
    await chrome.runtime.sendMessage({ type: 'account-logout' }).catch(() => {});
    el.logout.disabled = false;
  });
  el.manageAccount.addEventListener('click', () => openLink('account'));
  el.viewPlans.addEventListener('click', () => openLink(subscribed() ? 'billing' : 'plans'));
  document.querySelectorAll('[data-guest]').forEach((button) => button.addEventListener('click', async () => {
    showAccountError('');
    button.disabled = true;
    const reply = await chrome.runtime.sendMessage({ type: 'account-guest' }).catch((err) => ({ ok: false, error: String(err?.message || err) }));
    button.disabled = false;
    if (!reply?.ok) return showAccountError(reply?.error || t('无法连接账户服务，请检查网络后重试'));
    await finishOnboarding();
    if (!S.isHosted(settings.provider)) {
      await save({ provider: 'hosted' });
      renderProviderConfig();
    }
  }));
  el.useOwnKey.addEventListener('click', async () => {
    await finishOnboarding();
    if (S.isHosted(settings.provider)) {
      await save({ provider: S.KEY_PROVIDERS[0] });
      renderProviderConfig();
    }
    el.providerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.apiKey.focus({ preventScroll: true });
  });

  // 实时更新：账户状态（登录、退出、每次点数翻译后的余额）由 service worker 写入，这里跟着刷新；
  // 弹窗里切换了平台也同步过来。
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[ACCOUNT_KEY]) {
      account = changes[ACCOUNT_KEY].newValue || { signedIn: false };
      renderAccount();
      renderCards();
      if (S.isHosted(settings.provider)) renderHosted();
    }
    if (changes.onboarding?.newValue === 'done' && onboarding !== 'done') {
      onboarding = 'done';
      renderAccount();
    }
    if (changes.settings?.newValue && changes.settings.newValue.provider !== settings.provider) {
      settings = S.normalize(changes.settings.newValue);
      renderCards();
      renderProviderConfig();
    }
  });
  el.model.addEventListener('change', () => saveProviderField('model', el.model.value.trim()));

  el.baseUrl.addEventListener('change', async () => {
    const value = el.baseUrl.value.trim().replace(/\/+$/, '');
    if (value && !originOf(value)) {
      el.baseUrlHelp.textContent = t("请填写合法的 https 地址（出于安全考虑不支持 http）。");
      el.baseUrl.value = settings[settings.provider].baseUrl;
      return;
    }
    await saveProviderField('baseUrl', value);
    renderProviderConfig();
    const origin = await missingOrigin();
    if (origin) {
      el.baseUrlHelp.textContent = t("还需要授权访问 $1：点下方「测试连接」时会弹出授权请求。", [origin]);
    }
  });

  el.toggleKey.addEventListener('click', () => {
    const hidden = el.apiKey.type === 'password';
    el.apiKey.type = hidden ? 'text' : 'password';
    el.toggleKey.textContent = hidden ? t("隐藏") : t("显示");
  });

  el.uiLanguage.addEventListener('change', async () => {
    await save({ uiLanguage: el.uiLanguage.value });
    await AITrI18n.reload();
  });
  AITrI18n.onChange(() => {
    renderAccount(); renderCards(); renderProviderConfig(); renderBehavior(); renderVideoLang();
    renderShortcutKey(); renderRuleCount(); renderLangState();
  });

  el.target.addEventListener('change', async () => {
    await save({ target: el.target.value });
    el.targetPreview.textContent = t('右键菜单：$1', [t('翻译成$1', [S.targetMenu(settings)])]);
    el.uiLanguage.value = settings.uiLanguage;
    el.videoTarget.textContent = t('字幕翻译成 $1，每行调用一次翻译接口。关闭后只显示原文。', [S.targetMenu(settings)]);
  });
  el.stream.addEventListener('change', () => save({ stream: el.stream.checked }));
  el.showOriginal.addEventListener('change', () => save({ showOriginal: el.showOriginal.checked }));
  el.floating.addEventListener('change', () => save({ floating: el.floating.checked }));
  el.shortcut.addEventListener('change', () => save({ shortcut: el.shortcut.checked }));
  el.imageMode.addEventListener('change', () => save({ imageMode: el.imageMode.value }));

  el.videoEnabled.addEventListener('change', async () => {
    await save({ videoEnabled: el.videoEnabled.checked });
    applyVideoVisibility();
    renderLangState();
  });

  el.videoLang.addEventListener('change', async () => {
    await save({ videoLang: el.videoLang.value });
    renderLangState();
  });

  el.videoTranslate.addEventListener('change', () => save({ videoTranslate: el.videoTranslate.checked }));

  el.videoCloud.addEventListener('change', async () => {
    await save({ videoCloud: el.videoCloud.checked });
    renderLangState();
  });

  el.installLang.addEventListener('click', async () => {
    // install() 要求用户手势：必须紧贴点击调用，前面不能有任何 await
    const task = Speech.installPacks(settings.videoLang);
    el.installLang.disabled = true;
    showLangState(t("正在下载离线语言包，视网速可能要等一会儿…"));
    let ok = false;
    let error = '';
    try {
      ok = await task;
    } catch (err) {
      error = String(err?.message || err);
    }
    el.installLang.disabled = false;
    if (ok) renderLangState();
    else showLangState(error ? t("下载失败：$1", [error]) : t("下载失败，稍后再试"), 'err');
  });

  el.manage.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/manage/manage.html') });
  });

  /** 顺手显示已记录多少条元素规则。 */
  async function renderRuleCount() {
    try {
      const all = await globalThis.AITrRules.loadRules();
      const hosts = Object.keys(all);
      const total = hosts.reduce((sum, host) => sum + all[host].length, 0);
      el.ruleCount.textContent = total ? t("已记录 $1 个网站、$2 条规则", [hosts.length, total]) : t("还没有规则");
    } catch {
      el.ruleCount.textContent = '';
    }
  }

  // 快捷键本身只能在 Chrome 自己的页面里改
  el.editShortcut.addEventListener('click', () => {
    chrome.tabs.create({ url: AITrEnv.extensionsShortcuts });
  });

  // 设置完切回这个标签页时，自动刷新显示，省得手动刷新
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    renderShortcutKey();
    // 切回设置页时更新账户状态（例如刚在网页端订阅或退出），30 秒内不重复请求
    if (Date.now() - lastRefresh > 30_000) refreshAccount();
  });

  el.test.addEventListener('click', async () => {
    // 授权请求必须紧贴点击手势：任何 await 都可能让手势失效，所以放在最前面。
    // 已经授权过的话 request() 会直接返回 true，不会弹窗。
    const origin = originOf(el.baseUrl.value.trim());
    if (origin && !(await chrome.permissions.request({ origins: [origin] }))) {
      el.testResult.className = 'test-result err';
      el.testResult.textContent = t("未授权访问 $1，无法使用该接口地址", [origin]);
      return;
    }

    // 再把输入框里还没提交的内容存下来
    await save({
      [settings.provider]: {
        ...settings[settings.provider],
        apiKey: el.apiKey.value.trim(),
        model: el.model.value.trim(),
      },
    });
    el.test.disabled = true;
    el.testResult.className = 'test-result';
    el.testResult.textContent = t("正在请求…");
    try {
      const reply = await chrome.runtime.sendMessage({
        type: 'test-provider',
        providerId: settings.provider,
      });
      if (reply?.ok) {
        el.testResult.className = 'test-result ok';
        el.testResult.textContent = t("连接正常（$1）：$2", [reply.model, reply.sample]);
      } else {
        el.testResult.className = 'test-result err';
        el.testResult.textContent = reply?.error || t("测试失败");
      }
    } catch (err) {
      el.testResult.className = 'test-result err';
      el.testResult.textContent = String(err?.message || err);
    } finally {
      el.test.disabled = false;
    }
  });

  /* -------------------------------------------------------------- 初始化 */

  (async () => {
    settings = await S.loadSettings();
    const stored = await chrome.storage.local.get([ACCOUNT_KEY, 'onboarding']);
    account = stored[ACCOUNT_KEY] || { signedIn: false };
    onboarding = stored.onboarding || null;
    renderAccount();
    refreshAccount();
    renderCards();
    renderProviderConfig();
    renderBehavior();
    renderShortcutKey();
    renderRuleCount();
    renderVideoLang();
    renderLangState();
  })();
})();

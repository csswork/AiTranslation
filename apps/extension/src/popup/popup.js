(async () => {
  await AITrI18n.ready;
  const t = (...args) => AITrI18n.t(...args);
  const S = globalThis.AITrSettings;
  const el = {
    provider: document.getElementById('provider'),
    model: document.getElementById('model'),
    keyState: document.getElementById('keyState'),
    panel: document.getElementById('panel'),
    image: document.getElementById('image'),
    video: document.getElementById('video'),
    targetName: document.getElementById('targetName'),
    open: document.getElementById('open'),
    modelRow: document.getElementById('modelRow'),
    keyLabel: document.getElementById('keyLabel'),
    accountIn: document.getElementById('accountIn'),
    avatar: document.getElementById('avatar'),
    username: document.getElementById('username'),
    accountMeta: document.getElementById('accountMeta'),
    credits: document.getElementById('credits'),
    login: document.getElementById('login'),
  };

  const ACCOUNT_KEY = 'accountStatus'; // 与 lib/account.js 的 STATUS_KEY 一致
  let settings = S.normalize(null);
  let account = { signedIn: false };

  function renderAccount() {
    el.accountIn.hidden = !account.signedIn;
    el.login.hidden = account.signedIn;
    if (!account.signedIn) return;
    const name = account.username || '';
    const balance = account.credits?.balance ?? 0;
    el.avatar.textContent = (name[0] || '?').toUpperCase();
    el.username.textContent = name;
    el.accountMeta.textContent = account.subscription?.name || (account.credits?.trialActive ? t('试用中') : t('暂无订阅'));
    el.credits.textContent = t('$1 点', [balance]);
    el.credits.className = `credits ${balance > 0 ? '' : 'empty'}`;
  }

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
    const provider = S.resolveProvider(settings);
    const hosted = S.isHosted(settings.provider);
    el.modelRow.hidden = hosted;
    el.model.textContent = provider.model;
    el.targetName.textContent = t('选中文字，右键 → $1', [t('翻译成$1', [S.targetMenu(settings)])]);
    if (hosted) {
      // 点数翻译：显示剩余点数或需要登录，而不是 API Key
      const balance = account.credits?.balance ?? 0;
      el.keyLabel.textContent = t('点数');
      el.keyState.textContent = account.signedIn ? t('剩余 $1 点', [balance]) : t('需要登录');
      el.keyState.className = `state ${account.signedIn && balance > 0 ? 'ok' : 'warn'}`;
    } else {
      const configured = Boolean(provider.apiKey);
      el.keyLabel.textContent = 'API Key';
      el.keyState.textContent = configured ? t("已配置") : t("未配置");
      el.keyState.className = `state ${configured ? 'ok' : 'warn'}`;
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

  el.panel.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/translate/translate.html') });
    window.close();
  });

  el.image.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/image/image.html') });
    window.close();
  });

  // 打开这个弹窗时，Chrome 已经给了当前标签页 activeTab 授权，后台截取声音靠的就是它
  el.video.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) {
      await chrome.runtime.sendMessage({ type: 'video-toggle', tabId: tab.id }).catch(() => {});
    }
    window.close();
  });

  // 授权页在当前窗口的新标签页打开，弹窗随之关闭；登录完成后回调页换成设置页
  el.login.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'account-login' }).catch(() => {});
    window.close();
  });
  el.accountIn.addEventListener('click', () => {
    chrome.tabs.create({ url: AITrEnv.links.account });
    window.close();
  });

  // 账户状态由 service worker 更新（登录、退出、点数翻译后的余额），弹窗开着时跟着变
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[ACCOUNT_KEY]) {
      account = changes[ACCOUNT_KEY].newValue || { signedIn: false };
      render();
    }
  });

  el.open.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  (async () => {
    settings = await S.loadSettings();
    account = (await chrome.storage.local.get(ACCOUNT_KEY))[ACCOUNT_KEY] || { signedIn: false };
    render();
    // 先用缓存显示，再取一次最新状态（结果经 storage 变化回到上面的监听）
    chrome.runtime.sendMessage({ type: 'account-refresh' }).catch(() => {});
  })();
})();

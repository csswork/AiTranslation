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
  };

  let settings = S.normalize(null);

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
    el.model.textContent = provider.model;
    el.targetName.textContent = t('选中文字，右键 → $1', [t('翻译成$1', [S.targetMenu(settings)])]);
    const configured = Boolean(provider.apiKey);
    el.keyState.textContent = configured ? t("已配置") : t("未配置");
    el.keyState.className = `state ${configured ? 'ok' : 'warn'}`;
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

  el.open.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  (async () => {
    settings = await S.loadSettings();
    render();
  })();
})();

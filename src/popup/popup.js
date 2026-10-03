(() => {
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
    el.targetName.textContent = S.targetMenu(settings);
    const configured = Boolean(provider.apiKey);
    el.keyState.textContent = configured ? '已配置' : '未配置';
    el.keyState.className = `state ${configured ? 'ok' : 'warn'}`;
  }

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

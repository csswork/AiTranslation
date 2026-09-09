(() => {
  const S = globalThis.AITrSettings;
  const el = {
    provider: document.getElementById('provider'),
    model: document.getElementById('model'),
    keyState: document.getElementById('keyState'),
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

  el.open.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  (async () => {
    settings = await S.loadSettings();
    render();
  })();
})();

(() => {
  const S = globalThis.AITrSettings;
  const $ = (id) => document.getElementById(id);
  const el = {
    cards: $('providerCards'),
    apiKey: $('apiKey'),
    toggleKey: $('toggleKey'),
    keyLink: $('keyLink'),
    model: $('model'),
    modelList: $('modelList'),
    modelHelp: $('modelHelp'),
    baseUrl: $('baseUrl'),
    baseUrlHelp: $('baseUrlHelp'),
    test: $('test'),
    testResult: $('testResult'),
    target: $('target'),
    targetPreview: $('targetPreview'),
    stream: $('stream'),
    showOriginal: $('showOriginal'),
    status: $('status'),
  };

  let settings = S.normalize(null);
  let statusTimer = 0;

  function flash(text) {
    el.status.textContent = text;
    el.status.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.status.classList.remove('show'), 1600);
  }

  async function save(patch) {
    settings = await S.saveSettings({ ...settings, ...patch });
    flash('已保存');
    renderCards();
  }

  /** 只改当前平台那一份配置。 */
  function saveProviderField(field, value) {
    const id = settings.provider;
    return save({ [id]: { ...settings[id], [field]: value } });
  }

  function renderCards() {
    const current = settings.provider;
    el.cards.replaceChildren(
      ...S.providerList().map((item) => {
        const configured = Boolean(settings[item.id]?.apiKey);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'provider-card';
        card.setAttribute('aria-pressed', String(item.id === current));
        card.innerHTML =
          `<b></b><i></i><em class="${configured ? 'ready' : ''}"></em>`;
        card.querySelector('b').textContent = item.label;
        card.querySelector('i').textContent = item.hint;
        card.querySelector('em').textContent = configured ? '● 已配置 Key' : '○ 未配置 Key';
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
    const conf = settings[settings.provider];
    el.apiKey.value = conf.apiKey;
    el.apiKey.placeholder = `${def.keyPrefix}...`;
    el.apiKey.type = 'password';
    el.toggleKey.textContent = '显示';
    el.keyLink.href = def.keyUrl;
    el.keyLink.textContent = `${def.label} 控制台`;

    el.model.value = conf.model;
    el.model.placeholder = def.defaultModel;
    el.modelHelp.textContent = `留空则使用 ${def.defaultModel}。可以直接填任意该平台支持的模型名。`;
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
      `留空则使用 ${def.defaultBaseUrl}。填写代理或中转地址时，需要额外授权该域名。`;

    el.testResult.textContent = '';
    el.testResult.className = 'test-result';
  }

  function renderBehavior() {
    el.target.replaceChildren(
      ...S.targetList().map((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        option.selected = item.id === settings.target;
        return option;
      })
    );
    el.targetPreview.textContent = S.targetMenu(settings);
    el.stream.checked = settings.stream;
    el.showOriginal.checked = settings.showOriginal;
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

  el.apiKey.addEventListener('change', () => saveProviderField('apiKey', el.apiKey.value.trim()));
  el.model.addEventListener('change', () => saveProviderField('model', el.model.value.trim()));

  el.baseUrl.addEventListener('change', async () => {
    const value = el.baseUrl.value.trim().replace(/\/+$/, '');
    if (value && !originOf(value)) {
      el.baseUrlHelp.textContent = '请填写合法的 https 地址（出于安全考虑不支持 http）。';
      el.baseUrl.value = settings[settings.provider].baseUrl;
      return;
    }
    await saveProviderField('baseUrl', value);
    renderProviderConfig();
    const origin = await missingOrigin();
    if (origin) {
      el.baseUrlHelp.textContent = `还需要授权访问 ${origin}：点下方「测试连接」时会弹出授权请求。`;
    }
  });

  el.toggleKey.addEventListener('click', () => {
    const hidden = el.apiKey.type === 'password';
    el.apiKey.type = hidden ? 'text' : 'password';
    el.toggleKey.textContent = hidden ? '隐藏' : '显示';
  });

  el.target.addEventListener('change', async () => {
    await save({ target: el.target.value });
    el.targetPreview.textContent = S.targetMenu(settings);
  });
  el.stream.addEventListener('change', () => save({ stream: el.stream.checked }));
  el.showOriginal.addEventListener('change', () => save({ showOriginal: el.showOriginal.checked }));

  el.test.addEventListener('click', async () => {
    // 授权请求必须紧贴点击手势：任何 await 都可能让手势失效，所以放在最前面。
    // 已经授权过的话 request() 会直接返回 true，不会弹窗。
    const origin = originOf(el.baseUrl.value.trim());
    if (origin && !(await chrome.permissions.request({ origins: [origin] }))) {
      el.testResult.className = 'test-result err';
      el.testResult.textContent = `未授权访问 ${origin}，无法使用该接口地址`;
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
    el.testResult.textContent = '正在请求…';
    try {
      const reply = await chrome.runtime.sendMessage({
        type: 'test-provider',
        providerId: settings.provider,
      });
      if (reply?.ok) {
        el.testResult.className = 'test-result ok';
        el.testResult.textContent = `连接正常（${reply.model}）：${reply.sample}`;
      } else {
        el.testResult.className = 'test-result err';
        el.testResult.textContent = reply?.error || '测试失败';
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
    renderCards();
    renderProviderConfig();
    renderBehavior();
  })();
})();

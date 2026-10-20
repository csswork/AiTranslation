/**
 * 翻译面板。刻意做成自给自足的一页：
 *   - 语言表和「上次选的目标语言」都存在本文件 / 独立的存储键里，
 *     不动 settings.js 里右键菜单那份配置；
 *   - 直接在本页调用 AITrProviders.translate()，不经过 service worker，
 *     所以完全不影响右键翻译那条链路。
 */
(async () => {
  await AITrI18n.ready;
  const t = (...args) => AITrI18n.t(...args);
  const S = globalThis.AITrSettings;
  const Lang = globalThis.AITrLang;
  const P = globalThis.AITrProviders;

  const LANGUAGES = S.targetList();
  const AUTO = 'auto';
  const STORE_KEY = 'panelTarget';

  const byId = Object.fromEntries(LANGUAGES.map((item) => [item.id, item]));
  const label = (id) => AITrLanguages.label(id);
  const prompt = (id) => byId[id]?.prompt || id;

  const $ = (id) => document.getElementById(id);
  const el = {
    target: $('target'),
    source: $('source'),
    swap: $('swap'),
    provider: $('provider'),
    detect: $('detect'),
    run: $('run'),
    shortcut: $('shortcut'),
    input: $('input'),
    count: $('count'),
    clear: $('clear'),
    out: $('out'),
    meta: $('meta'),
    copy: $('copy'),
    error: $('error'),
    errorText: $('errorText'),
    settings: $('settings'),
  };

  /** 输入停止多久后自动翻译。给得比较宽，避免边打字边烧 token。 */
  const AUTO_DELAY = 1000;

  const isMac = /Mac|iPhone|iPad/i.test(navigator.userAgent);
  let settings = S.normalize(null);
  let choice = settings.target;
  let source = AUTO;
  let controller = null;
  let translation = '';
  let autoTimer = 0;
  /** 上一次真正发出去的原文，用来避免自动翻译重复请求同一段内容。 */
  let lastSent = '';

  /** 输入停顿到 AUTO_DELAY 且内容确实变过，才自动翻译。 */
  function scheduleAuto() {
    clearTimeout(autoTimer);
    if (!el.input.value.trim()) return;
    autoTimer = setTimeout(() => {
      const text = el.input.value;
      if (!text.trim() || text === lastSent) return;
      run();
    }, AUTO_DELAY);
  }

  /* ------------------------------------------------------------ 目标语言 */

  const effectiveTarget = () => choice;

  function renderTargetOptions() {
    const options = () => LANGUAGES.map((item) => {
      const option = document.createElement('option');
      option.value = item.id; option.textContent = label(item.id);
      return option;
    });
    el.target.replaceChildren(...options());
    const auto = document.createElement('option');
    auto.value = AUTO; auto.textContent = t("自动识别");
    el.source.replaceChildren(auto, ...options());
    el.target.value = choice; el.source.value = source;
    el.swap.disabled = source === AUTO;
  }

  /* ---------------------------------------------------------------- 状态 */

  function renderStatus() {
    const text = el.input.value;
    const length = text.length;
    const over = length > Lang.MAX_TEXT_LENGTH;
    el.count.textContent = length
      ? over
        ? t("$1 字符 · 超出上限，只翻译前 $2 个", [length, Lang.MAX_TEXT_LENGTH])
        : t("$1 字符", [length])
      : '';

    el.detect.textContent = text.trim() ? t("$1 → $2", [source === AUTO ? t('自动识别') : label(source), label(choice)]) : '';

    el.run.disabled = !text.trim() && !controller;
  }

  function setBusy(busy) {
    el.out.classList.toggle('streaming', busy);
    el.run.textContent = busy ? t("停止") : t("翻译");
    if (!busy) el.run.append(el.shortcut);
    el.copy.disabled = busy || !translation.trim();
    el.target.disabled = busy;
    el.source.disabled = busy;
    el.swap.disabled = busy || source === AUTO;
    el.provider.disabled = busy;
  }

  function showError(message, action) {
    el.error.hidden = false;
    el.errorText.textContent = message || t("翻译失败");
    el.error.querySelectorAll('button').forEach((node) => node.remove());
    if (action === 'open-options') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn ghost small';
      button.textContent = t("打开设置");
      button.addEventListener('click', () => chrome.runtime.openOptionsPage());
      el.error.appendChild(button);
    }
  }

  /* ---------------------------------------------------------------- 翻译 */

  async function run() {
    const raw = el.input.value;
    if (!raw.trim()) return;

    clearTimeout(autoTimer);
    lastSent = raw;
    controller?.abort(); // 上一轮还在流就先停掉
    controller = new AbortController();
    const { signal } = controller;

    const text = raw.slice(0, Lang.MAX_TEXT_LENGTH);
    const targetId = effectiveTarget(text);
    const requestSettings = S.normalize(settings);
    const sourceId = source === AUTO ? undefined : source;
    const provider = S.resolveProvider(requestSettings);

    translation = '';
    el.out.textContent = '';
    el.out.dir = S.TARGETS[targetId].dir;
    el.error.hidden = true;
    el.meta.textContent = [provider.label, provider.model, label(targetId)].filter(Boolean).join(' · ');
    setBusy(true);
    renderStatus();

    const startedAt = Date.now();
    try {
      let received = false;
      for await (const chunk of P.translate({
        text,
        settings: requestSettings,
        sourceId,
        // LLM 收自然语言描述，DeepL 收语言代码，两者都给，由平台自己取
        targetLanguage: prompt(targetId),
        targetId,
        signal,
      })) {
        if (signal.aborted) return;
        received = true;
        translation += chunk;
        el.out.textContent = translation;
      }
      if (!received) {
        showError(t("模型没有返回任何内容，重试或换个模型试试"));
        return;
      }
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      el.meta.textContent = [provider.label, provider.model, label(targetId), `${seconds}s`].filter(Boolean).join(' · ');
    } catch (err) {
      if (signal.aborted || err?.name === 'AbortError') return;
      showError(String(err?.message || err), err?.action);
    } finally {
      if (controller?.signal === signal) {
        controller = null;
        setBusy(false);
        renderStatus();
      }
    }
  }

  async function copy() {
    const text = translation.trim();
    if (!text) return;
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }
    el.copy.textContent = ok ? t("已复制") : t("复制失败");
    setTimeout(() => {
      el.copy.textContent = t("复制");
    }, 1400);
  }

  /* ---------------------------------------------------------------- 事件 */

  el.input.addEventListener('input', () => {
    renderStatus();
    scheduleAuto();
  });
  el.input.addEventListener('keydown', (event) => {
    const combo = isMac ? event.metaKey : event.ctrlKey;
    if (combo && event.key === 'Enter') {
      event.preventDefault();
      run();
    }
  });

  el.run.addEventListener('click', () => {
    if (controller) {
      clearTimeout(autoTimer);
      controller.abort();
      controller = null;
      setBusy(false);
      renderStatus();
      return;
    }
    run();
  });

  el.clear.addEventListener('click', () => {
    clearTimeout(autoTimer);
    lastSent = '';
    controller?.abort();
    controller = null;
    el.input.value = '';
    translation = '';
    el.out.textContent = '';
    el.error.hidden = true;
    el.meta.textContent = '';
    setBusy(false);
    renderStatus();
    el.input.focus();
  });

  el.copy.addEventListener('click', copy);
  el.settings.addEventListener('click', () => chrome.runtime.openOptionsPage());

  el.target.addEventListener('change', async () => {
    choice = el.target.value;
    chrome.storage.local.set({ [STORE_KEY]: choice });
    lastSent = '';
    renderStatus();
    if (el.input.value.trim()) run();
  });

  el.source.addEventListener('change', async () => {
    source = el.source.value;
    chrome.storage.local.set({ panelSource: source });
    lastSent = '';
    renderStatus();
    el.swap.disabled = source === AUTO;
    if (el.input.value.trim()) run();
  });

  el.swap.addEventListener('click', async () => {
    if (source === AUTO || controller) return;
    [source, choice] = [choice, source];
    if (translation.trim()) el.input.value = translation;
    await chrome.storage.local.set({ [STORE_KEY]: choice, panelSource: source });
    renderTargetOptions();
    lastSent = '';
    renderStatus();
    if (el.input.value.trim()) run();
  });

  el.provider.addEventListener('change', async () => {
    settings = await S.patchSettings({ provider: el.provider.value });
    const provider = S.resolveProvider(settings);
    el.meta.textContent = `${provider.label} · ${provider.model}`;
  });

  AITrI18n.onChange(() => { renderTargetOptions(); renderStatus(); });

  /* -------------------------------------------------------------- 初始化 */

  (async () => {
    el.shortcut.textContent = isMac ? '⌘ ↩' : 'Ctrl ↩';
    settings = await S.loadSettings();
    // 打开面板与切回面板时预热到账户服务的连接（只在点数翻译时，后台限频）
    const warm = () => chrome.runtime.sendMessage({ type: 'hosted-warm' }).catch(() => {});
    warm();
    window.addEventListener('focus', warm);

    const stored = await chrome.storage.local.get([STORE_KEY, 'panelSource']);
    const saved = stored[STORE_KEY];
    choice = byId[saved] ? saved : settings.target;
    source = byId[stored.panelSource] ? stored.panelSource : AUTO;
    await chrome.storage.local.set({ [STORE_KEY]: choice, panelSource: source });

    renderTargetOptions();
    el.provider.replaceChildren(
      ...S.providerList().map((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = label(item.id);
        option.selected = item.id === settings.provider;
        return option;
      })
    );

    const provider = S.resolveProvider(settings);
    el.meta.textContent = `${provider.label} · ${provider.model}`;
    renderStatus();
    el.input.focus();
  })();
})();

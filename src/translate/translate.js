/**
 * 翻译面板。刻意做成自给自足的一页：
 *   - 语言表和「上次选的目标语言」都存在本文件 / 独立的存储键里，
 *     不动 settings.js 里右键菜单那份配置；
 *   - 直接在本页调用 AITrProviders.translate()，不经过 service worker，
 *     所以完全不影响右键翻译那条链路。
 */
(() => {
  const S = globalThis.AITrSettings;
  const Lang = globalThis.AITrLang;
  const P = globalThis.AITrProviders;

  /** 目标语言。`prompt` 是喂给模型的说法。 */
  const LANGUAGES = [
    { id: 'zh-Hans', label: '简体中文', prompt: '简体中文' },
    { id: 'zh-Hant', label: '繁體中文', prompt: '繁體中文（台灣常用譯法與用詞）' },
    { id: 'en', label: 'English', prompt: '英语（English）' },
    { id: 'ja', label: '日本語', prompt: '日语（日本語）' },
    { id: 'ko', label: '한국어', prompt: '韩语（한국어）' },
    { id: 'fr', label: 'Français', prompt: '法语（Français）' },
    { id: 'de', label: 'Deutsch', prompt: '德语（Deutsch）' },
    { id: 'es', label: 'Español', prompt: '西班牙语（Español）' },
    { id: 'pt', label: 'Português', prompt: '葡萄牙语（Português）' },
    { id: 'it', label: 'Italiano', prompt: '意大利语（Italiano）' },
    { id: 'ru', label: 'Русский', prompt: '俄语（Русский）' },
    { id: 'ar', label: 'العربية', prompt: '阿拉伯语（العربية）' },
    { id: 'th', label: 'ไทย', prompt: '泰语（ไทย）' },
    { id: 'vi', label: 'Tiếng Việt', prompt: '越南语（Tiếng Việt）' },
  ];
  const AUTO = 'auto';
  /** 独立的存储键，和 settings 那份配置互不干扰。 */
  const STORE_KEY = 'panelTarget';

  const byId = Object.fromEntries(LANGUAGES.map((item) => [item.id, item]));
  const label = (id) => byId[id]?.label || id;
  const prompt = (id) => byId[id]?.prompt || id;

  const $ = (id) => document.getElementById(id);
  const el = {
    target: $('target'),
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
  let choice = AUTO;
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

  /** 「自动」的含义：中文译成英文，其他语言译成用户设置里的中文变体。 */
  const autoTarget = (text) => (Lang.analyze(text).isChinese ? 'en' : settings.target);

  const effectiveTarget = (text) => (choice === AUTO ? autoTarget(text) : choice);

  function renderTargetOptions() {
    const auto = document.createElement('option');
    auto.value = AUTO;
    auto.textContent = '自动';
    el.target.replaceChildren(
      auto,
      ...LANGUAGES.map((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        return option;
      })
    );
    el.target.value = choice;
  }

  /* ---------------------------------------------------------------- 状态 */

  function renderStatus() {
    const text = el.input.value;
    const length = text.length;
    const over = length > Lang.MAX_TEXT_LENGTH;
    el.count.textContent = length
      ? over
        ? `${length} 字符 · 超出上限，只翻译前 ${Lang.MAX_TEXT_LENGTH} 个`
        : `${length} 字符`
      : '';

    if (!text.trim()) {
      el.detect.textContent = '';
    } else if (choice === AUTO) {
      const source = Lang.analyze(text).isChinese ? '中文' : '非中文';
      el.detect.textContent = `自动：${source} → ${label(autoTarget(text))}`;
    } else {
      el.detect.textContent = `译成 ${label(choice)}`;
    }

    el.run.disabled = !text.trim() && !controller;
  }

  function setBusy(busy) {
    el.out.classList.toggle('streaming', busy);
    el.run.textContent = busy ? '停止' : '翻译';
    if (!busy) el.run.append(el.shortcut);
    el.copy.disabled = busy || !translation.trim();
    el.target.disabled = busy;
    el.provider.disabled = busy;
  }

  function showError(message, action) {
    el.error.hidden = false;
    el.errorText.textContent = message || '翻译失败';
    el.error.querySelectorAll('button').forEach((node) => node.remove());
    if (action === 'open-options') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn ghost small';
      button.textContent = '打开设置';
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
    const provider = S.resolveProvider(settings);

    translation = '';
    el.out.textContent = '';
    el.error.hidden = true;
    el.meta.textContent = `${provider.label} · ${provider.model} · ${label(targetId)}`;
    setBusy(true);
    renderStatus();

    const startedAt = Date.now();
    try {
      let received = false;
      for await (const chunk of P.translate({
        text,
        settings,
        targetLanguage: prompt(targetId),
        signal,
      })) {
        if (signal.aborted) return;
        received = true;
        translation += chunk;
        el.out.textContent = translation;
      }
      if (!received) {
        showError('模型没有返回任何内容，重试或换个模型试试');
        return;
      }
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      el.meta.textContent =
        `${provider.label} · ${provider.model} · ${label(targetId)} · ${seconds}s`;
    } catch (err) {
      if (signal.aborted || err?.name === 'AbortError') return;
      showError(String(err?.message || err), err?.action);
    } finally {
      if (controller?.signal === signal) controller = null;
      setBusy(false);
      renderStatus();
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
    el.copy.textContent = ok ? '已复制' : '复制失败';
    setTimeout(() => {
      el.copy.textContent = '复制';
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
    await chrome.storage.local.set({ [STORE_KEY]: choice });
    renderStatus();
  });

  el.provider.addEventListener('change', async () => {
    settings = await S.patchSettings({ provider: el.provider.value });
    const provider = S.resolveProvider(settings);
    el.meta.textContent = `${provider.label} · ${provider.model}`;
  });

  /* -------------------------------------------------------------- 初始化 */

  (async () => {
    el.shortcut.textContent = isMac ? '⌘ ↩' : 'Ctrl ↩';
    settings = await S.loadSettings();

    const stored = await chrome.storage.local.get(STORE_KEY);
    const saved = stored[STORE_KEY];
    choice = saved === AUTO || byId[saved] ? saved : AUTO;

    renderTargetOptions();
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
    el.meta.textContent = `${provider.label} · ${provider.model}`;
    renderStatus();
    el.input.focus();
  })();
})();

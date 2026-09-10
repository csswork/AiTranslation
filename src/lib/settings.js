/**
 * 平台定义 + 配置读写。与 lang.js 一样，不能使用 import / export。
 */
(() => {
  /** 两个受支持的平台，都是 OpenAI 兼容接口，只有地址 / 模型不同。 */
  const PROVIDERS = {
    openai: {
      id: 'openai',
      label: 'ChatGPT',
      hint: 'OpenAI 官方接口',
      defaultBaseUrl: 'https://api.openai.com/v1',
      // 翻译是高频短任务，默认用最便宜的 luna
      defaultModel: 'gpt-5.6-luna',
      models: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra'],
      keyUrl: 'https://platform.openai.com/api-keys',
      keyPrefix: 'sk-',
    },
    deepseek: {
      id: 'deepseek',
      label: 'DeepSeek',
      hint: '国内直连，价格更低',
      // 官方文档给的 OpenAI 格式地址不带 /v1
      defaultBaseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-flash',
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      keyUrl: 'https://platform.deepseek.com/api_keys',
      keyPrefix: 'sk-',
    },
  };

  const PROVIDER_ORDER = ['openai', 'deepseek'];

  /**
   * 目标语言。`menu` 用于右键菜单标题（默认即「翻译成中文」），
   * `prompt` 是喂给模型的说法。
   */
  const TARGETS = {
    'zh-Hans': { id: 'zh-Hans', label: '简体中文', menu: '中文', prompt: '简体中文' },
    'zh-Hant': {
      id: 'zh-Hant',
      label: '繁體中文',
      menu: '繁體中文',
      prompt: '繁體中文（台灣常用譯法與用詞）',
    },
  };

  const DEFAULTS = {
    provider: 'openai',
    target: 'zh-Hans',
    stream: true,
    showOriginal: true,
    floating: true, // 划词后在选区旁显示浮动按钮
    shortcut: true, // 快捷键翻译选中文字
    openai: { apiKey: '', model: '', baseUrl: '' },
    deepseek: { apiKey: '', model: '', baseUrl: '' },
  };

  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  /** 把任意存储内容补齐成完整、可信的配置对象。 */
  function normalize(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const out = {
      provider: PROVIDERS[input.provider] ? input.provider : DEFAULTS.provider,
      target: TARGETS[input.target] ? input.target : DEFAULTS.target,
      stream: input.stream !== false,
      showOriginal: input.showOriginal !== false,
      floating: input.floating !== false,
      shortcut: input.shortcut !== false,
    };
    for (const id of PROVIDER_ORDER) {
      const conf = input[id] && typeof input[id] === 'object' ? input[id] : {};
      out[id] = {
        apiKey: str(conf.apiKey),
        model: str(conf.model),
        baseUrl: str(conf.baseUrl).replace(/\/+$/, ''),
      };
    }
    return out;
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get('settings');
    return normalize(stored.settings);
  }

  async function saveSettings(next) {
    const settings = normalize(next);
    await chrome.storage.local.set({ settings });
    return settings;
  }

  async function patchSettings(patch) {
    const current = await loadSettings();
    return saveSettings({ ...current, ...patch });
  }

  /** 把配置 + 平台默认值合成一份「可以直接发请求」的参数。 */
  function resolveProvider(settings, id) {
    const def = PROVIDERS[id] || PROVIDERS[settings.provider] || PROVIDERS[DEFAULTS.provider];
    const conf = settings[def.id] || {};
    return {
      id: def.id,
      label: def.label,
      keyUrl: def.keyUrl,
      apiKey: str(conf.apiKey),
      model: str(conf.model) || def.defaultModel,
      baseUrl: str(conf.baseUrl) || def.defaultBaseUrl,
      isCustomBaseUrl: Boolean(str(conf.baseUrl)) && str(conf.baseUrl) !== def.defaultBaseUrl,
    };
  }

  const target = (settings) => TARGETS[settings.target] || TARGETS[DEFAULTS.target];
  const targetPrompt = (settings) => target(settings).prompt;
  const targetMenu = (settings) => target(settings).menu;
  const providerList = () =>
    PROVIDER_ORDER.map((id) => ({ id, label: PROVIDERS[id].label, hint: PROVIDERS[id].hint }));
  const targetList = () => Object.values(TARGETS).map((t) => ({ id: t.id, label: t.label }));

  globalThis.AITrSettings = {
    PROVIDERS,
    PROVIDER_ORDER,
    TARGETS,
    DEFAULTS,
    normalize,
    loadSettings,
    saveSettings,
    patchSettings,
    resolveProvider,
    targetPrompt,
    targetMenu,
    providerList,
    targetList,
  };
})();

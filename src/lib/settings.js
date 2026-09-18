/**
 * 平台定义 + 配置读写。与 lang.js 一样，不能使用 import / export。
 */
(() => {
  /**
   * 平台分两种形态：
   *   llm —— OpenAI 兼容的对话接口。能流式、能识图、能用提示词控制译文风格。
   *   mt  —— 传统机器翻译接口。文本进文本出，上面这些都没有。
   * 请求形态完全不同，不少功能要按形态决定可用与否。
   */
  const PROVIDERS = {
    openai: {
      id: 'openai',
      label: 'ChatGPT',
      kind: 'llm',
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
      kind: 'llm',
      hint: '国内直连，价格更低',
      // 官方文档给的 OpenAI 格式地址不带 /v1
      defaultBaseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-flash',
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      keyUrl: 'https://platform.deepseek.com/api_keys',
      keyPrefix: 'sk-',
    },
    deepl: {
      id: 'deepl',
      label: 'DeepL',
      kind: 'mt',
      hint: '译文质量好，不用选模型',
      // 免费版和付费版域名不同，但免费 key 以 :fx 结尾，
      // 所以不让用户填地址，运行时按 key 判断（见 resolveProvider）。
      defaultBaseUrl: 'https://api-free.deepl.com',
      proBaseUrl: 'https://api.deepl.com',
      defaultModel: '',
      models: [],
      keyUrl: 'https://www.deepl.com/pro-api',
      keyPrefix: '',
    },
  };

  const PROVIDER_ORDER = ['openai', 'deepseek', 'deepl'];

  /**
   * 语言 id → DeepL 的 target_lang 代码。
   * LLM 平台收的是自然语言描述（「简体中文」），传统翻译接口只认代码。
   * 这里的 id 与 TARGETS、以及翻译面板里的语言表用的是同一套。
   */
  const DEEPL_CODES = {
    'zh-Hans': 'ZH-HANS',
    'zh-Hant': 'ZH-HANT',
    en: 'EN-US',
    ja: 'JA',
    ko: 'KO',
    fr: 'FR',
    de: 'DE',
    es: 'ES',
    pt: 'PT-BR',
    it: 'IT',
    ru: 'RU',
    ar: 'AR',
    th: 'TH',
    vi: 'VI',
  };

  /**
   * 支持图像理解的模型。识图必须用这些，普通文本模型会报错。
   * 与对话模型分开记：用户在设置里选的模型未必支持视觉。
   */
  const VISION_MODELS = {
    openai: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-astra'],
    deepseek: ['deepseek-flash'],
  };

  /** 某个平台识图该用哪个模型。 */
  function visionModel(providerId) {
    const list = VISION_MODELS[providerId] || [];
    return list[0] || '';
  }

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
      kind: def.kind || 'llm',
      model: str(conf.model) || def.defaultModel,
      // DeepL 免费 key 以 :fx 结尾，付费 key 没有；两者域名不同。
      // 用户填的地址优先，其次按 key 自动判断。
      baseUrl:
        str(conf.baseUrl) ||
        (def.proBaseUrl && !str(conf.apiKey).endsWith(':fx')&& str(conf.apiKey)
          ? def.proBaseUrl
          : def.defaultBaseUrl),
      isCustomBaseUrl: Boolean(str(conf.baseUrl)) && str(conf.baseUrl) !== def.defaultBaseUrl,
    };
  }

  const target = (settings) => TARGETS[settings.target] || TARGETS[DEFAULTS.target];
  const targetPrompt = (settings) => target(settings).prompt;
  const targetMenu = (settings) => target(settings).menu;
  const providerKind = (id) => PROVIDERS[id]?.kind || 'llm';
  /** 只有 LLM 平台能识图；传统翻译接口只能文本进文本出。 */
  const supportsVision = (id) => providerKind(id) === 'llm';
  /** 只有 LLM 平台能流式输出。 */
  const supportsStreaming = (id) => providerKind(id) === 'llm';
  /** 传统翻译接口不需要选模型。 */
  const needsModel = (id) => providerKind(id) === 'llm';
  const deeplCode = (languageId) => DEEPL_CODES[languageId] || '';

  const providerList = () =>
    PROVIDER_ORDER.map((id) => ({ id, label: PROVIDERS[id].label, hint: PROVIDERS[id].hint }));
  const targetList = () => Object.values(TARGETS).map((t) => ({ id: t.id, label: t.label }));

  globalThis.AITrSettings = {
    PROVIDERS,
    PROVIDER_ORDER,
    VISION_MODELS,
    visionModel,
    DEEPL_CODES,
    providerKind,
    supportsVision,
    supportsStreaming,
    needsModel,
    deeplCode,
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

/**
 * 平台定义 + 配置读写。与 lang.js 一样，不能使用 import / export。
 */
(() => {
  const t = (...args) => AITrI18n.t(...args);
  /** 标记稍后用 t() 翻译的文案，供提取脚本识别；运行时原样返回中文。 */
  const k = (key) => key;
  /**
   * 平台分两种形态：
   *   llm —— OpenAI 兼容的对话接口。能流式、能识图、能用提示词控制译文风格。
   *   mt  —— 传统机器翻译接口。文本进文本出，上面这些都没有。
   *   hosted —— 托管翻译：登录账户后用点数，由我们的服务完成翻译，不需要 API Key。
   *            支持文字和图片；模型及 Key 由服务端管理。
   * 请求形态完全不同，不少功能要按形态决定可用与否。
   */
  const PROVIDERS = {
    hosted: {
      id: 'hosted',
      label: k("点数翻译"),
      kind: 'hosted',
      hint: k("免费试用，或订阅后无限使用，不需要 API Key"),
      defaultBaseUrl: '',
      defaultModel: '',
      models: [],
      keyUrl: '',
      keyPrefix: '',
    },
    openai: {
      id: 'openai',
      label: 'ChatGPT',
      kind: 'llm',
      hint: k("OpenAI 官方接口"),
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
      hint: k("国内直连，价格更低"),
      // 官方文档给的 OpenAI 格式地址不带 /v1
      defaultBaseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-flash',
      models: ['deepseek-flash', 'deepseek-v4-pro'],
      keyUrl: 'https://platform.deepseek.com/api_keys',
      keyPrefix: 'sk-',
    },
    deepl: {
      id: 'deepl',
      label: 'DeepL',
      kind: 'mt',
      hint: k("译文质量好，不用选模型"),
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

  const PROVIDER_ORDER = ['hosted', 'openai', 'deepseek', 'deepl'];
  /** 需要用户自带 API Key 的平台（各自保存一份 Key / 模型 / 地址配置）。 */
  const KEY_PROVIDERS = PROVIDER_ORDER.filter((id) => PROVIDERS[id].kind !== 'hosted');

  /**
   * 语言 id → DeepL 的 target_lang 代码。
   * LLM 平台收的是自然语言描述（「简体中文」），传统翻译接口只认代码。
   * 这里的 id 与 TARGETS、以及翻译面板里的语言表用的是同一套。
   */
  const DEEPL_CODES = Object.fromEntries(Object.values(AITrLanguages.LANGUAGES).map((l) => [l.id, l.deepl]));

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
  const TARGETS = AITrLanguages.LANGUAGES;

  /**
   * 视频实时字幕的识别语言。设备端识别不会自己判断语种，只能让用户选。
   * id 直接用作 SpeechRecognition.lang（BCP 47）。
   */
  const VIDEO_LANGS = Object.fromEntries(Object.values(TARGETS).map((language) => {
    const id = ({ 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW', en: 'en-US', pt: 'pt-BR' })[language.id] || language.id;
    return [id, { id, languageId: language.id }];
  }));

  const DEFAULTS = {
    schemaVersion: 2,
    uiLanguage: 'auto',
    provider: 'openai',
    target: AITrLanguages.browserTarget(),
    stream: true,
    showOriginal: true,
    floating: true, // 划词后在选区旁显示浮动按钮
    shortcut: true, // 快捷键翻译选中文字
    // 视频字幕是实验功能，默认关闭：关着的时候入口、菜单项与设置都不出现
    videoEnabled: false,
    videoLang: 'en-US',
    // 视频字幕默认在本机识别；主动打开后声音发给浏览器云端服务（Chrome: Google；Edge: Azure）
    videoCloud: false,
    videoTranslate: true, // 把识别出的每一句翻译成目标语言，显示双语字幕
    // 图片译文的背景：默认取文字周围的相近色；也可固定深色半透明、白、黑或自定义颜色
    imageFill: 'auto',
    imageFillColor: '#ffffff',
    // 右键翻译图片：auto 直接识别整张图；select 先打开窗口让用户框选区域
    imageMode: 'auto',
    // 框选的形状：矩形，或圆形（椭圆，按住 Shift 拖出正圆）
    imageShape: 'rect',
    openai: { apiKey: '', model: '', baseUrl: '' },
    deepseek: { apiKey: '', model: '', baseUrl: '' },
  };

  const IMAGE_FILLS = ['auto', 'dark', 'white', 'black', 'custom'];

  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  /** 把任意存储内容补齐成完整、可信的配置对象。 */
  function normalize(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const legacy = input.schemaVersion !== 2 && Object.keys(input).length > 0;
    const out = {
      schemaVersion: 2,
      uiLanguage: TARGETS[input.uiLanguage] ? input.uiLanguage : 'auto',
      provider: PROVIDERS[input.provider] ? input.provider : DEFAULTS.provider,
      target: TARGETS[input.target] ? input.target : legacy ? 'zh-Hans' : AITrLanguages.browserTarget(),
      stream: input.stream !== false,
      showOriginal: input.showOriginal !== false,
      floating: input.floating !== false,
      shortcut: input.shortcut !== false,
      videoEnabled: input.videoEnabled === true,
      videoLang: VIDEO_LANGS[input.videoLang] ? input.videoLang : Object.values(VIDEO_LANGS).find((v) => v.languageId === AITrLanguages.match(input.videoLang))?.id || DEFAULTS.videoLang,
      videoCloud: input.videoCloud === true,
      videoTranslate: input.videoTranslate !== false,
      imageFill: IMAGE_FILLS.includes(input.imageFill) ? input.imageFill : DEFAULTS.imageFill,
      imageFillColor: /^#[0-9a-f]{6}$/i.test(input.imageFillColor) ? input.imageFillColor.toLowerCase() : DEFAULTS.imageFillColor,
      imageMode: input.imageMode === 'select' ? 'select' : 'auto',
      imageShape: input.imageShape === 'ellipse' ? 'ellipse' : 'rect',
    };
    for (const id of KEY_PROVIDERS) {
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
    await AITrLanguages.ready;
    const stored = await chrome.storage.local.get('settings');
    return normalize(stored.settings);
  }

  /**
   * 先读后写的改动要排队：新安装时启动迁移与「默认用点数翻译」同时进行，
   * 迁移若读到空配置、又晚一步写回，会把刚设好的平台覆盖成默认值。
   * 只对同一个上下文（service worker）有效；设置页整份保存走 saveSettings。
   */
  let writeTask = Promise.resolve();
  const queued = (task) => {
    const next = writeTask.catch(() => {}).then(task);
    writeTask = next;
    return next;
  };

  function migrateSettings() {
    return queued(async () => {
      await AITrLanguages.ready;
      const stored = await chrome.storage.local.get('settings');
      if (stored.settings?.schemaVersion === 2) return;
      await saveSettings(normalize(stored.settings));
    });
  }

  async function saveSettings(next) {
    const settings = normalize(next);
    await chrome.storage.local.set({ settings });
    return settings;
  }

  function patchSettings(patch) {
    return queued(async () => {
      const current = await loadSettings();
      return saveSettings({ ...current, ...patch });
    });
  }

  /** 把配置 + 平台默认值合成一份「可以直接发请求」的参数。 */
  function resolveProvider(settings, id) {
    const def = PROVIDERS[id] || PROVIDERS[settings.provider] || PROVIDERS[DEFAULTS.provider];
    const conf = settings[def.id] || {};
    return {
      id: def.id,
      // 品牌名（ChatGPT、DeepSeek、DeepL）原样显示；「点数翻译」是界面文案，要翻译
      label: def.kind === 'hosted' ? t(def.label) : def.label,
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
  const targetMenu = (settings) => AITrLanguages.label(target(settings).id);
  const providerKind = (id) => PROVIDERS[id]?.kind || 'llm';
  /** 只有 LLM 平台能识图；传统翻译接口只能文本进文本出。 */
  const supportsVision = (id) => ['llm', 'hosted'].includes(providerKind(id));
  /** 只有 LLM 平台能流式输出。 */
  const supportsStreaming = (id) => providerKind(id) === 'llm';
  /** 传统翻译接口不需要选模型。 */
  const needsModel = (id) => providerKind(id) === 'llm';
  const deeplCode = (languageId) => DEEPL_CODES[languageId] || '';

  const isHosted = (id) => providerKind(id) === 'hosted';

  const providerList = () => PROVIDER_ORDER.map((id) => ({
    id,
    kind: PROVIDERS[id].kind,
    label: isHosted(id) ? t(PROVIDERS[id].label) : PROVIDERS[id].label,
    hint: t(PROVIDERS[id].hint),
  }));
  const targetList = () => AITrLanguages.list();
  const videoLang = (settings) => {
    const value = VIDEO_LANGS[settings.videoLang] || VIDEO_LANGS[DEFAULTS.videoLang];
    return { ...value, label: AITrLanguages.label(value.languageId) };
  };
  const videoLangList = () => Object.values(VIDEO_LANGS).map((v) => ({ ...v, label: AITrLanguages.label(v.languageId) }));

  globalThis.AITrSettings = {
    PROVIDERS,
    PROVIDER_ORDER,
    KEY_PROVIDERS,
    isHosted,
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
    migrateSettings,
    saveSettings,
    patchSettings,
    resolveProvider,
    targetPrompt,
    targetMenu,
    providerList,
    targetList,
    VIDEO_LANGS,
    videoLang,
    videoLangList,
  };
})();

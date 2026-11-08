/**
 * 本机翻译：浏览器内置的 Translator / LanguageDetector API（Chrome 138+ 桌面版、Edge 148+）。
 * 文字不离开本机，不需要 API Key，也不消耗点数。见 docs/extension/local-translation.md。
 *
 * 与 lang.js 一样同时被 service worker（import）和扩展页面（<script src>）加载，不能用 import / export。
 *
 * - 语言包按「源语言 → 目标语言」下载。还没下载的语言对，create() 必须由页面里的点击触发；
 *   service worker 和内容脚本没有点击可用，遇到时提示用户到设置页下载。
 * - Translator 只接受明确的源语言，原文语言「自动」时先用 LanguageDetector 识别，
 *   识别不出再退回 chrome.i18n.detectLanguage。
 */
(() => {
  const t = (...args) => AITrI18n.t(...args);

  class LocalError extends Error {
    constructor(message, action = null) {
      super(message);
      this.name = 'LocalError';
      this.action = action;
    }
  }

  const supported = () => typeof globalThis.Translator === 'function';

  /** 项目语言 id 或任意 BCP 47 代码 → Translator 用的代码。简体中文是 zh，繁体中文是 zh-Hant。 */
  function code(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const id = AITrLanguages.match(raw);
    if (id === 'zh-Hans') return 'zh';
    if (id) return id;
    return raw.split(/[-_]/)[0].toLowerCase();
  }

  function name(value) {
    const id = AITrLanguages.match(value);
    if (id) return AITrLanguages.label(id);
    try {
      return new Intl.DisplayNames([AITrI18n.locale?.() || 'en'], { type: 'language' }).of(value) || value;
    } catch {
      return value;
    }
  }

  /** 低于这个置信度的识别结果不用：单词、缩写这类短文本经常认错。 */
  const MIN_CONFIDENCE = 0.5;
  let detectorTask = null;

  async function detectWithModel(text) {
    if (typeof globalThis.LanguageDetector !== 'function') return '';
    try {
      detectorTask ??= globalThis.LanguageDetector.create().catch((error) => {
        detectorTask = null;
        throw error;
      });
      const [top] = await (await detectorTask).detect(text);
      if (top && top.detectedLanguage !== 'und' && top.confidence >= MIN_CONFIDENCE) return top.detectedLanguage;
    } catch {
      /* 识别模型还没下载或不可用，退回 chrome.i18n */
    }
    return '';
  }

  async function detectWithChrome(text) {
    try {
      const result = await globalThis.chrome?.i18n?.detectLanguage?.(text);
      const top = result?.languages?.[0];
      if (result?.isReliable && top?.language && top.language !== 'und') return top.language;
    } catch {
      /* 不可用时当作识别不出 */
    }
    return '';
  }

  /** 识别原文语言，返回 Translator 用的代码；识别不出返回空字符串。 */
  async function detect(text) {
    const sample = String(text || '').slice(0, 2000);
    if (!sample.trim()) return '';
    return code((await detectWithModel(sample)) || (await detectWithChrome(sample)));
  }

  function failure(error, source, target) {
    if (error instanceof LocalError || error?.name === 'AbortError') return error;
    if (error?.name === 'NotAllowedError') {
      return new LocalError(
        t("本机还没有「$1 → $2」语言包，请到设置页的本机翻译里下载", [name(source), name(target)]),
        'open-options'
      );
    }
    return new LocalError(t("本机翻译失败：$1", [String(error?.message || error)]));
  }

  async function availability(source, target) {
    if (!supported()) return 'unsupported';
    try {
      return await globalThis.Translator.availability({ sourceLanguage: source, targetLanguage: target });
    } catch {
      return 'unavailable';
    }
  }

  function requireSupport() {
    if (!supported()) {
      throw new LocalError(t("当前浏览器不支持本机翻译，需要较新的桌面版 Chrome 或 Edge"), 'open-options');
    }
  }

  /** 同一个上下文里复用已创建的翻译器：每次创建要一两百毫秒。 */
  const translators = new Map();

  async function translator(source, target, monitor) {
    requireSupport();
    const key = `${source}>${target}`;
    let task = translators.get(key);
    if (!task) {
      // 不先 await availability：在页面里点击触发时，下载必须紧贴用户手势
      task = globalThis.Translator.create({ sourceLanguage: source, targetLanguage: target, ...(monitor ? { monitor } : {}) })
        .catch(async (error) => {
          translators.delete(key);
          if ((await availability(source, target)) === 'unavailable') {
            throw new LocalError(t("本机翻译不支持从$1翻译成$2", [name(source), name(target)]));
          }
          throw failure(error, source, target);
        });
      translators.set(key, task);
    }
    return task;
  }

  const abortError = () => new DOMException('Aborted', 'AbortError');

  /**
   * 翻译多段文字，返回等长、同序的译文。
   * @param {{texts: string[], targetId: string, sourceId?: string, signal?: AbortSignal}} args
   */
  async function translate({ texts, targetId, sourceId, signal }) {
    requireSupport();
    const target = code(targetId);
    if (!target) throw new LocalError(t("本机翻译不支持这个目标语言"));
    let fallback;
    const overall = async () => (fallback ??= detect(texts.join('\n')));
    const sources = await Promise.all(texts.map(async (text) => {
      if (!String(text || '').trim()) return '';
      if (sourceId) return code(sourceId);
      return (await detect(text)) || (await overall());
    }));
    if (signal?.aborted) throw abortError();
    return Promise.all(texts.map(async (text, i) => {
      const source = sources[i];
      if (!String(text || '').trim()) return String(text ?? '');
      if (!source) throw new LocalError(t("没能识别原文是哪种语言，请在翻译面板里手动选择原文语言"));
      // 原文已经是目标语言：照原样返回，与大模型的处理一致
      if (source === target) return text;
      const instance = await translator(source, target);
      if (signal?.aborted) throw abortError();
      try {
        return await instance.translate(text, signal ? { signal } : undefined);
      } catch (error) {
        throw failure(error, source, target);
      }
    }));
  }

  /**
   * 设置页的「下载语言包」：必须在点击处理里直接调用，不能先 await 别的东西。
   * @param {{sourceId: string, targetId: string, onProgress?: (loaded: number) => void}} args
   */
  async function prepare({ sourceId, targetId, onProgress }) {
    const source = code(sourceId);
    const target = code(targetId);
    const monitor = onProgress
      ? (m) => m.addEventListener('downloadprogress', (event) => onProgress(event.loaded))
      : undefined;
    await translator(source, target, monitor);
    pairsTask = null;
    return availability(source, target);
  }

  /* ---------------------------------------------------- 已下载的语言（下拉框只列这些） */

  /** 已下载的语言对 [[源语言 id, 目标语言 id]]，按项目语言 id。查询很快，结果缓存半分钟，下载后作废。 */
  let pairsTask = null;
  let pairsAt = 0;
  function installedPairs() {
    if (!supported()) return Promise.resolve([]);
    if (!pairsTask || Date.now() - pairsAt > 30_000) {
      pairsAt = Date.now();
      const ids = Object.keys(AITrLanguages.LANGUAGES);
      pairsTask = Promise.all(ids.flatMap((s) => ids.filter((t) => t !== s).map(async (t) => (
        (await availability(code(s), code(t))) === 'available' ? [s, t] : null
      )))).then((pairs) => pairs.filter(Boolean));
    }
    return pairsTask;
  }

  const isLocalProvider = (providerId) => globalThis.AITrSettings?.providerKind(providerId) === 'local';

  /**
   * 本机翻译时，语言下拉只保留已下载的语言；其他平台原样返回。
   * role 'target'：至少有一个语言对能翻成它；'source'：能翻成 target 的原文语言。
   * keep：当前选中的语言总是保留，免得下拉框显示空白。
   */
  async function limit(list, { providerId, role = 'target', target, keep } = {}) {
    if (!isLocalProvider(providerId) || !supported()) return list;
    const pairs = await installedPairs();
    const ids = new Set(role === 'source'
      ? pairs.filter(([, t]) => t === target).map(([s]) => s)
      : pairs.map(([, t]) => t));
    return list.filter((item) => ids.has(item.id) || item.id === keep);
  }

  /** 下拉框末尾的「下载更多语言…」：选中它就去设置页下载语言包。 */
  const MORE = '__local-download__';

  function addMoreOption(select, providerId) {
    if (!isLocalProvider(providerId) || !supported()) return;
    const option = select.ownerDocument.createElement('option');
    option.value = MORE;
    option.textContent = t("下载更多语言…");
    select.append(option);
  }

  /** 设置页的本机翻译卡片。内容脚本没有 tabs 权限，交给 service worker 打开。 */
  function openDownloads() {
    if (globalThis.chrome?.tabs?.create) {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html#local') });
    } else {
      chrome.runtime.sendMessage({ type: 'open-local-download' }).catch(() => {});
    }
  }

  /** 下拉框 change 时先调用：选的是「下载更多语言…」就打开设置页、恢复原值，返回 true。 */
  function pickedMore(select, previous) {
    if (select.value !== MORE) return false;
    select.value = previous;
    openDownloads();
    return true;
  }

  globalThis.AITrLocal = {
    supported, code, name, detect, availability, translate, prepare, LocalError,
    installedPairs, limit, addMoreOption, pickedMore, openDownloads, MORE,
  };
})();

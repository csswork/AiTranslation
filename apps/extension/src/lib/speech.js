/**
 * 设备端语音识别的语言包。与 lang.js 一样，不能使用 import / export。
 * 设置页（安装、显示状态）和 offscreen 文档（识别前检查）共用。
 *
 * 实测（Chrome 154）：识别引擎是随英语语言包一起下载的。只装日语、韩语、法语等语言包时，
 * available() 照样报 available，但一开始识别就 aborted；补装英语包后立即恢复，不用重启。
 * 所以非英语要连英语包一起检查、一起装。
 */
(() => {
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  const ENGINE_LANG = 'en-US';
  /** 从差到好。几个语言包的整体状态取最差的那个。 */
  const ORDER = ['unavailable', 'downloadable', 'downloading', 'available'];

  /** 设备端识别（离线语言包）是比较新的接口，老版本 Chrome 没有。 */
  const supported = () =>
    Boolean(SR && typeof SR.available === 'function' && typeof SR.install === 'function');

  const packsFor = (lang) => (lang === ENGINE_LANG ? [lang] : [lang, ENGINE_LANG]);

  /** 识别这个语言所需的全部语言包的整体状态：available / downloading / downloadable / unavailable。 */
  async function packStatus(lang) {
    const all = await Promise.all(
      packsFor(lang).map((id) => SR.available({ langs: [id], processLocally: true }))
    );
    return ORDER.find((status) => all.includes(status)) || 'unavailable';
  }

  /** install() 要求用户手势：必须在点击里同步调用，前面不能有任何 await。 */
  const installPacks = (lang) => SR.install({ langs: packsFor(lang), processLocally: true });

  globalThis.AITrSpeech = { supported, packsFor, packStatus, installPacks };
})();

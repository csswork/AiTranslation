// Existing provider tests use Chinese UI; localization itself is tested separately.
export function installExtensionFixture(chrome) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'zh-CN', languages: ['zh-CN'] } });
  chrome.i18n = { getUILanguage: () => 'zh-CN', getAcceptLanguages: async () => ['zh-CN'] };
  globalThis.AITrI18n = {
    t: (source, values = []) => source.replace(/\$(\d+)/g, (_, n) => String(values[Number(n) - 1] ?? '')),
    ready: Promise.resolve(), locale: () => 'zh-Hans', onChange() {},
  };
  if (chrome.runtime) chrome.runtime.onConnect ||= { addListener() {} };
}
export const deepLLanguages = [
  'ZH', 'ZH-HANS', 'ZH-HANT', 'EN', 'EN-US', 'FR', 'DE', 'JA', 'ES', 'AR',
].map((lang) => ({ lang, usable_as_source: !lang.includes('-'), usable_as_target: lang !== 'ZH' }));

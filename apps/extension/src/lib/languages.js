/** Shared language registry. Update i18n/locales.json and run the i18n build. */
(() => {
  const definitions = [{"id":"zh-Hans","chromeLocale":"zh_CN","nativeLabel":"简体中文","prompt":"Simplified Chinese","deepl":"ZH-HANS","dir":"ltr"},{"id":"zh-Hant","chromeLocale":"zh_TW","nativeLabel":"繁體中文","prompt":"Traditional Chinese (Taiwan)","deepl":"ZH-HANT","dir":"ltr"},{"id":"en","chromeLocale":"en","nativeLabel":"English","prompt":"English","deepl":"EN-US","dir":"ltr"},{"id":"es","chromeLocale":"es","nativeLabel":"Español","prompt":"Spanish","deepl":"ES","dir":"ltr"},{"id":"pt","chromeLocale":"pt_BR","nativeLabel":"Português","prompt":"Portuguese (Brazil)","deepl":"PT-BR","dir":"ltr"},{"id":"fr","chromeLocale":"fr","nativeLabel":"Français","prompt":"French","deepl":"FR","dir":"ltr"},{"id":"de","chromeLocale":"de","nativeLabel":"Deutsch","prompt":"German","deepl":"DE","dir":"ltr"},{"id":"it","chromeLocale":"it","nativeLabel":"Italiano","prompt":"Italian","deepl":"IT","dir":"ltr"},{"id":"nl","chromeLocale":"nl","nativeLabel":"Nederlands","prompt":"Dutch","deepl":"NL","dir":"ltr"},{"id":"ru","chromeLocale":"ru","nativeLabel":"Русский","prompt":"Russian","deepl":"RU","dir":"ltr"},{"id":"uk","chromeLocale":"uk","nativeLabel":"Українська","prompt":"Ukrainian","deepl":"UK","dir":"ltr"},{"id":"pl","chromeLocale":"pl","nativeLabel":"Polski","prompt":"Polish","deepl":"PL","dir":"ltr"},{"id":"tr","chromeLocale":"tr","nativeLabel":"Türkçe","prompt":"Turkish","deepl":"TR","dir":"ltr"},{"id":"ar","chromeLocale":"ar","nativeLabel":"العربية","prompt":"Arabic","deepl":"AR","dir":"rtl"},{"id":"he","chromeLocale":"he","nativeLabel":"עברית","prompt":"Hebrew","deepl":"HE","dir":"rtl"},{"id":"fa","chromeLocale":"fa","nativeLabel":"فارسی","prompt":"Persian","deepl":"FA","dir":"rtl"},{"id":"hi","chromeLocale":"hi","nativeLabel":"हिन्दी","prompt":"Hindi","deepl":"HI","dir":"ltr"},{"id":"bn","chromeLocale":"bn","nativeLabel":"বাংলা","prompt":"Bengali","deepl":"BN","dir":"ltr"},{"id":"ur","chromeLocale":null,"nativeLabel":"اردو","prompt":"Urdu","deepl":"UR","dir":"rtl"},{"id":"id","chromeLocale":"id","nativeLabel":"Bahasa Indonesia","prompt":"Indonesian","deepl":"ID","dir":"ltr"},{"id":"vi","chromeLocale":"vi","nativeLabel":"Tiếng Việt","prompt":"Vietnamese","deepl":"VI","dir":"ltr"},{"id":"th","chromeLocale":"th","nativeLabel":"ไทย","prompt":"Thai","deepl":"TH","dir":"ltr"},{"id":"ja","chromeLocale":"ja","nativeLabel":"日本語","prompt":"Japanese","deepl":"JA","dir":"ltr"},{"id":"ko","chromeLocale":"ko","nativeLabel":"한국어","prompt":"Korean","deepl":"KO","dir":"ltr"}];
  const LANGUAGES = Object.fromEntries(definitions.map((language) => [language.id, language]));
  function match(locale) {
    const code = String(locale || '').trim().replace(/_/g, '-').toLowerCase();
    if (/^zh(?:-|$)/.test(code)) {
      const parts = code.split('-');
      if (parts.includes('hans')) return 'zh-Hans';
      if (parts.includes('hant')) return 'zh-Hant';
      return parts.some((part) => ['tw', 'hk', 'mo'].includes(part)) ? 'zh-Hant' : 'zh-Hans';
    }
    return LANGUAGES[code.split('-')[0]] ? code.split('-')[0] : null;
  }
  let acceptedLanguages = [];
  // Chrome's preferred languages are available in both pages and service workers.
  // The UI locale alone can remain English despite a Chinese language preference.
  const browserTarget = () => [
    ...acceptedLanguages,
    ...(globalThis.navigator?.languages || []),
    globalThis.navigator?.language,
    globalThis.chrome?.i18n?.getUILanguage?.(),
  ].map(match).find(Boolean) || 'en';
  const ready = (async () => {
    try {
      const preferred = await globalThis.chrome?.i18n?.getAcceptLanguages?.();
      if (Array.isArray(preferred)) acceptedLanguages = preferred;
    } catch { /* Use navigator and the native UI locale if preferences are unavailable. */ }
  })();
  function label(id) {
    const language = LANGUAGES[id];
    if (!language) return id;
    try {
      return new Intl.DisplayNames([globalThis.AITrI18n?.locale?.() || browserTarget()], { type: 'language' }).of(id) || language.nativeLabel;
    } catch { return language.nativeLabel; }
  }
  const catalogPath = (id) => LANGUAGES[id]?.chromeLocale ? `_locales/${LANGUAGES[id].chromeLocale}/messages.json` : `src/locales/${id}/messages.json`;
  const list = () => definitions.map((language) => ({ ...language, label: label(language.id) }));
  globalThis.AITrLanguages = { LANGUAGES, match, browserTarget, label, list, catalogPath, ready };
})();

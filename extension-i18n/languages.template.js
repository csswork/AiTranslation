/** Shared language registry. Update extension-i18n/locales.json and run the i18n build. */
(() => {
  const definitions = __LANGUAGES__;
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

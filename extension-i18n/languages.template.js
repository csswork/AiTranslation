/** Shared language registry. Update extension-i18n/locales.json and run the i18n build. */
(() => {
  const definitions = __LANGUAGES__;
  const LANGUAGES = Object.fromEntries(definitions.map((language) => [language.id, language]));
  function match(locale) {
    const code = String(locale || '').replace(/_/g, '-').toLowerCase();
    if (/^zh(?:-|$)/.test(code)) return /(?:hant|tw|hk|mo)(?:-|$)/.test(code) ? 'zh-Hant' : 'zh-Hans';
    return LANGUAGES[code.split('-')[0]] ? code.split('-')[0] : null;
  }
  const browserTarget = () => match(globalThis.chrome?.i18n?.getUILanguage?.()) || 'en';
  function label(id) {
    const language = LANGUAGES[id];
    if (!language) return id;
    try {
      return new Intl.DisplayNames([globalThis.AITrI18n?.locale?.() || browserTarget()], { type: 'language' }).of(id) || language.nativeLabel;
    } catch { return language.nativeLabel; }
  }
  const list = () => definitions.map((language) => ({ ...language, label: label(language.id) }));
  globalThis.AITrLanguages = { LANGUAGES, match, browserTarget, label, list };
})();

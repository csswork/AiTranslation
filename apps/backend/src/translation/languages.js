/**
 * 托管翻译接受的目标 / 源语言：与扩展的 24 种语言注册表（apps/extension/i18n/locales.json）一致，
 * 值是写进模型提示词的英文名。test/hosted.test.mjs 会对照扩展注册表检查。
 */
export const LANGUAGES = {
  'zh-Hans': 'Simplified Chinese',
  'zh-Hant': 'Traditional Chinese (Taiwan)',
  en: 'English',
  es: 'Spanish',
  pt: 'Portuguese (Brazil)',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  nl: 'Dutch',
  ru: 'Russian',
  uk: 'Ukrainian',
  pl: 'Polish',
  tr: 'Turkish',
  ar: 'Arabic',
  he: 'Hebrew',
  fa: 'Persian',
  hi: 'Hindi',
  bn: 'Bengali',
  ur: 'Urdu',
  id: 'Indonesian',
  vi: 'Vietnamese',
  th: 'Thai',
  ja: 'Japanese',
  ko: 'Korean',
};

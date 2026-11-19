/**
 * 从请求头解析低基数客户端信息：浏览器家族、主版本与系统家族。
 *
 * 只用于兼容性排查和汇总统计，不保存原始 User-Agent，也不作为设备指纹或安全判断依据。
 * Chrome/Edge 的 UA 版本被冻结，通常只能可靠拿到主版本；Windows 10/11、macOS 版本无法从 UA 区分。
 */
const BROWSERS = new Set(['chrome', 'edge', 'firefox', 'other']);
const SYSTEMS = new Set(['windows', 'macos', 'linux', 'chromeos', 'other']);

export function parseUserAgent(value) {
  const ua = typeof value === 'string' ? value : '';
  if (!ua.trim()) return { browser: null, browserMajor: null, os: null };

  let browser = 'other';
  let browserMajor = null;
  let match = ua.match(/\bEdg(?:A|iOS)?\/(\d+)/i);
  if (match) {
    browser = 'edge';
    browserMajor = Number(match[1]);
  } else if ((match = ua.match(/\b(?:HeadlessChrome|Chrome|Chromium)\/(\d+)/i))) {
    browser = 'chrome';
    browserMajor = Number(match[1]);
  } else if ((match = ua.match(/\bFirefox\/(\d+)/i))) {
    browser = 'firefox';
    browserMajor = Number(match[1]);
  }
  if (!Number.isInteger(browserMajor) || browserMajor < 1 || browserMajor > 999) browserMajor = null;
  if (!BROWSERS.has(browser)) browser = 'other';

  let os = 'other';
  if (/\bCrOS\b/i.test(ua)) os = 'chromeos';
  else if (/\bWindows\b/i.test(ua)) os = 'windows';
  else if (/\b(?:Macintosh|Mac OS X)\b/i.test(ua)) os = 'macos';
  else if (/\b(?:Android|iPhone|iPad|iPod)\b/i.test(ua)) os = 'other';
  else if (/\b(?:Linux|X11)\b/i.test(ua)) os = 'linux';
  if (!SYSTEMS.has(os)) os = 'other';

  return { browser, browserMajor, os };
}

/** 当前请求的客户端信息；没有 User-Agent 时各字段为 null。 */
export function requestClient(c) {
  return parseUserAgent(c.req.header('user-agent'));
}

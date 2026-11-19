import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseUserAgent } from '../src/http/client.js';

const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const WINDOWS_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0';
const MAC_FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:142.0) Gecko/20100101 Firefox/142.0';
const CROS_CHROME = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const LINUX_CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

test('User-Agent 只解析出浏览器家族、主版本与系统家族', () => {
  assert.deepEqual(parseUserAgent(WINDOWS_CHROME), { browser: 'chrome', browserMajor: 142, os: 'windows' });
  assert.deepEqual(parseUserAgent(WINDOWS_EDGE), { browser: 'edge', browserMajor: 142, os: 'windows' });
  assert.deepEqual(parseUserAgent(MAC_FIREFOX), { browser: 'firefox', browserMajor: 142, os: 'macos' });
  assert.deepEqual(parseUserAgent(CROS_CHROME), { browser: 'chrome', browserMajor: 142, os: 'chromeos' });
  assert.deepEqual(parseUserAgent(LINUX_CHROME), { browser: 'chrome', browserMajor: 142, os: 'linux' });
});

test('未知或缺失的 User-Agent 不伪造浏览器版本', () => {
  assert.deepEqual(parseUserAgent(''), { browser: null, browserMajor: null, os: null });
  assert.deepEqual(parseUserAgent(undefined), { browser: null, browserMajor: null, os: null });
  assert.deepEqual(parseUserAgent('curl/8.0.1'), { browser: 'other', browserMajor: null, os: 'other' });
  assert.deepEqual(parseUserAgent('Mozilla/5.0 (Android 14; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0'), {
    browser: 'firefox', browserMajor: 142, os: 'other',
  });
  assert.deepEqual(parseUserAgent('Chrome/9999.0'), { browser: 'chrome', browserMajor: null, os: 'other' });
});

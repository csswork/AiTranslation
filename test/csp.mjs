/**
 * 宣传站的 CSP 只按 sha256 放行内联脚本（vercel.json）。
 * 改了 HTML 里的内联脚本却忘了更新哈希，本地预览（没有 CSP 头）一切正常，
 * 上线后脚本被静默拦掉——配色初始化失效，浅色用户每次都先闪一下深色。
 * 这里把每个页面的每段内联脚本都算一遍，和 CSP 对上。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const ROOT = new URL('..', import.meta.url).pathname;

const vercel = JSON.parse(fs.readFileSync(`${ROOT}vercel.json`, 'utf8'));
const csp = vercel.headers
  .flatMap((rule) => rule.headers)
  .find((h) => h.key.toLowerCase() === 'content-security-policy')?.value;
assert.ok(csp, 'vercel.json 里应当有 Content-Security-Policy');

const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) || '';
const allowed = new Set([...scriptSrc.matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]));
assert.ok(!/'unsafe-inline'/.test(scriptSrc), "script-src 不应放开 'unsafe-inline'");

const used = new Set();
const pages = fs.readdirSync(`${ROOT}docs`).filter((f) => f.endsWith('.html'));
assert.ok(pages.length, 'docs/ 下应当有页面');

for (const page of pages) {
  const html = fs.readFileSync(`${ROOT}docs/${page}`, 'utf8');
  // 只看没有 src 的 <script>：外链脚本走 'self'
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  for (const code of inline) {
    const hash = crypto.createHash('sha256').update(code, 'utf8').digest('base64');
    assert.ok(allowed.has(hash), `${page} 的内联脚本没被 CSP 放行，应加入 'sha256-${hash}'`);
    used.add(hash);
  }
  console.log(`✓ ${page}：${inline.length} 段内联脚本都在 CSP 白名单里`);
}

const stale = [...allowed].filter((h) => !used.has(h));
assert.deepEqual(stale, [], `CSP 里有已经没人用的哈希，应删掉：${stale.join(', ')}`);
console.log('✓ CSP 里没有过时的哈希');

console.log('\n全部通过');

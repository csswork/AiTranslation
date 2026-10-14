/** Extract only extension UI templates, explicit t('…') calls and k('…') markers, never provider prompts. */
import fs from 'node:fs';
import path from 'node:path';
export function sourceMessages(root) {
  const messages = new Set();
  const add = (s) => { const key = s.replace(/\s+/g, ' ').trim(); if (/\p{Script=Han}/u.test(key)) messages.add(key); };
  function html(source) {
    const clean = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/\$\{[^}]*\}/g, '');
    for (const m of clean.matchAll(/(?:title|aria-label|placeholder|alt)="([^"]*)"/g)) add(m[1]);
    for (const text of clean.split(/<[^>]*>/)) add(text);
  }
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) { if (item.name !== 'locales') walk(file); continue; }
      if (!/\.(html|js)$/.test(file) || ['messages.js', 'languages.js'].includes(item.name)) continue;
      const source = fs.readFileSync(file, 'utf8');
      if (file.endsWith('.html')) { html(source); continue; }
      // t('…') 是翻译调用；k('…') 只标记「这里的文案稍后用 t() 翻译」（例如平台说明），同样要进目录
      for (const m of source.matchAll(/\b[tk]\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/g)) {
        const raw = m[1] ?? m[2];
        add(raw.replace(/\\([\\'"nrt])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' })[c] || c));
      }
      for (const m of source.matchAll(/innerHTML\s*=\s*`([\s\S]*?)`/g)) html(m[1]);
    }
  }
  walk(path.join(root, 'src'));
  return messages;
}

/** Refresh catalogs locally. --watch refreshes after source/catalog changes. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (script) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'scripts', script)], { cwd: root, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (status) => status === 0 ? resolve() : reject(new Error(`${script} failed (${status})`)));
});
let busy = false, pending = false, timer;
async function sync() {
  if (busy) { pending = true; return; }
  busy = true;
  try {
    await run('translate-extension-i18n.mjs');
    await run('build-extension-i18n.mjs');
  } catch (error) {
    console.error(error.message);
    if (!process.argv.includes('--watch')) process.exitCode = 1;
  } finally {
    busy = false;
    if (pending) { pending = false; await sync(); }
  }
}
if (process.argv.includes('--watch')) {
  fs.watch(path.join(root, 'i18n'), (_event, name) => {
    if (!['en.json', 'locales.json', 'languages.template.js'].includes(String(name))) return;
    clearTimeout(timer); timer = setTimeout(sync, 400);
  });
  fs.watch(path.join(root, 'src'), { recursive: true }, (_event, name) => {
    const file = String(name || '');
    if (!/\.(html|js)$/.test(file) || /(?:^|\/)(?:messages|languages)\.js$/.test(file) || file.startsWith('locales/')) return;
    clearTimeout(timer); timer = setTimeout(sync, 400);
  });
  console.log('Watching extension source messages; refresh runs locally after edits.');
}
await sync();

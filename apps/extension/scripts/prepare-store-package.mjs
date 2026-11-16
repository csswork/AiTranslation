/** Stage a production package using only runtime files. No environment files or remote code. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function prepareStorePackage(root, staging, target = 'chrome') {
  if (!['chrome', 'edge', 'firefox'].includes(target)) throw new Error('Unknown store target');
  const blocked = new Set(['tools', 'store-assets', 'scripts', 'i18n', 'test', 'docs', 'public', 'backend', 'node_modules']);
  const filter = (source) => {
    const name = path.basename(source);
    if (name === '.DS_Store') return false;
    if (name.startsWith('.') || blocked.has(name) || fs.lstatSync(source).isSymbolicLink()) {
      throw new Error(`Non-runtime file in package source: ${path.relative(root, source)}`);
    }
    return true;
  };
  fs.mkdirSync(staging, { recursive: true });
  for (const name of ['manifest.json', 'icons', 'src', '_locales']) {
    fs.cpSync(path.join(root, name), path.join(staging, name), { recursive: true, filter });
  }
  fs.copyFileSync(path.resolve(root, '../../LICENSE'), path.join(staging, 'LICENSE'));
  const manifestFile = path.join(staging, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  // The stores manage their own update URL. Production authentication never accepts localhost.
  delete manifest.update_url;
  manifest.host_permissions = manifest.host_permissions.filter((origin) => !origin.startsWith('http://localhost'));
  for (const script of manifest.content_scripts) {
    script.matches = script.matches.filter((origin) => !origin.startsWith('http://localhost'));
  }
  for (const resource of manifest.web_accessible_resources) {
    resource.matches = resource.matches.filter((origin) => !origin.startsWith('http://localhost'));
  }
  if (target === 'firefox') {
    // Firefox store revision; the initial 2.3.0 draft was replaced before publication.
    manifest.version += '.1';
    delete manifest.minimum_chrome_version;
    manifest.background = { scripts: ['src/background.js'], type: 'module' };
    manifest.permissions = manifest.permissions.filter((permission) => !['offscreen', 'tabCapture'].includes(permission));
    manifest.browser_specific_settings = { gecko: {
      id: 'huaci@huaci.app',
      strict_min_version: '142.0',
      data_collection_permissions: { required: ['authenticationInfo', 'websiteContent'] },
    } };
    // Firefox observes the same-origin HTTPS callback and opens its own private callback page.
    delete manifest.web_accessible_resources;
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  const envFile = path.join(staging, 'src/lib/env.js');
  const marker = 'const packaged = false; // @store-package:';
  const env = fs.readFileSync(envFile, 'utf8');
  if (env.split(marker).length !== 2) throw new Error('Missing or ambiguous production package marker');
  fs.writeFileSync(envFile, env.replace(marker, 'const packaged = true; // @store-package:'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const [target, staging] = process.argv.slice(2);
  if (!staging) throw new Error('Usage: prepare-store-package.mjs chrome|edge|firefox <staging-directory>');
  prepareStorePackage(root, staging, target);
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { prepareStorePackage } from '../scripts/prepare-store-package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aitr-store-'));
const originalEnv = fs.readFileSync(path.join(root, 'src/lib/env.js'), 'utf8');
function environment(source, edge, update = false, manifest = {}) {
  const context = vm.createContext({ URL, navigator: { userAgent: edge ? 'Chrome/150 Edg/150.0' : 'Chrome/150.0' },
    chrome: { runtime: { id: 'a'.repeat(32), getManifest: () => ({ ...manifest, ...(update ? { update_url: 'https://example.test/update' } : {}) }) } },
  });
  vm.runInContext(source, context);
  return context.AITrEnv;
}
try {
  for (const target of ['chrome', 'edge', 'firefox']) {
    const staging = path.join(temp, target);
    prepareStorePackage(root, staging, target);
    assert.deepEqual(fs.readdirSync(staging).sort(), ['LICENSE', '_locales', 'icons', 'manifest.json', 'src']);
    const manifest = JSON.parse(fs.readFileSync(path.join(staging, 'manifest.json'), 'utf8'));
    assert.equal(manifest.update_url, undefined);
    assert.equal(manifest.optional_host_permissions, undefined, 'All-site access already covers custom HTTPS providers; a redundant optional permission is only a Chromium warning');
    if (target === 'firefox') {
      assert.equal(manifest.version, JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))).version + '.1');
      assert.equal(manifest.web_accessible_resources, undefined, 'Firefox callback page stays private');
      assert.deepEqual(manifest.background, { scripts: ['src/background.js'], type: 'module' });
      assert.ok(!manifest.permissions.some((p) => ['offscreen', 'tabCapture'].includes(p)));
      assert.equal(manifest.minimum_chrome_version, undefined);
      assert.equal(manifest.browser_specific_settings.gecko.id, 'huaci@huaci.app');
      assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ['authenticationInfo', 'websiteContent']);
      assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.optional, ['technicalAndInteraction']);
    } else {
      assert.equal(manifest.web_accessible_resources.length, 1);
      assert.deepEqual(manifest.web_accessible_resources[0].matches, ['https://app.huaci.app/*']);
      assert.equal(manifest.browser_specific_settings, undefined);
    }
    const accountScript = manifest.content_scripts.find((script) => script.js.includes('src/content/account.js'));
    assert.ok(accountScript.matches.every((origin) => origin.startsWith('https://')));
    const env = environment(fs.readFileSync(path.join(staging, 'src/lib/env.js'), 'utf8'), target === 'edge', false, manifest);
    assert.equal(env.dev, false, 'A store package uses production even without update_url');
    assert.equal(env.accountOrigin, 'https://app.huaci.app');
    assert.equal(env.isAccountPage('http://localhost:8787/'), false);
    assert.equal(env.extensionsShortcuts, target === 'firefox' ? 'about:addons' : `${target === 'edge' ? 'edge' : 'chrome'}://extensions/shortcuts`);
    assert.equal(fs.readFileSync(path.join(staging, 'src/vendor/pdfjs/pdf.mjs'), 'utf8'),
      fs.readFileSync(path.join(root, 'src/vendor/pdfjs/pdf.mjs'), 'utf8'), 'Vendor code stays unchanged');
  }
  assert.equal(environment(originalEnv, true).dev, true, 'Loading repository source still uses local services');
  assert.equal(environment(originalEnv, false, true).dev, false, 'Existing store manifests remain compatible');
  assert.equal(fs.readFileSync(path.join(root, 'src/lib/env.js'), 'utf8'), originalEnv, 'Packaging never edits source');
  assert.throws(() => prepareStorePackage(root, path.join(temp, 'unknown'), 'other'), /Unknown store target/);
  const fixture = path.join(temp, 'fixture/apps/extension');
  fs.mkdirSync(path.join(fixture, 'src'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'manifest.json'), '{}');
  fs.mkdirSync(path.join(fixture, 'icons'));
  fs.writeFileSync(path.join(fixture, 'src/.env.local'), 'fixture-only');
  assert.throws(() => prepareStorePackage(fixture, path.join(temp, 'reject-hidden')), /Non-runtime file/,
    'A misplaced environment file is rejected before ZIP creation');
  fs.rmSync(path.join(fixture, 'src/.env.local'));
  fs.mkdirSync(path.join(fixture, 'src/node_modules'));
  assert.throws(() => prepareStorePackage(fixture, path.join(temp, 'reject-dependencies')), /Non-runtime file/,
    'Dependencies accidentally placed inside src are rejected');
  console.log('Chrome / Edge / Firefox production packaging, environment isolation and vendor preservation passed');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

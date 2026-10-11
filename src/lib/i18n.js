/** Localize extension-owned UI. Never translate or change the direction of a website. */
(() => {
  if (globalThis.AITrI18n) return;
  const L = globalThis.AITrLanguages;
  const isWorker = typeof document === 'undefined';
  const isExtensionPage = globalThis.location?.protocol === 'chrome-extension:';
  const listeners = new Set();
  const records = new Set();
  const seen = new WeakMap();
  const hosts = new Set();
  let active = L.browserTarget();
  let catalog = null;
  let sequence = 0;

  function t(source, values = []) {
    const key = globalThis.AITrMessageIds[source];
    const native = !catalog && key && globalThis.chrome?.i18n?.getMessage?.(key, values.map(String));
    if (native) return native;
    const entry = catalog?.[key];
    const template = entry?.message?.replace(/\$([a-z][a-z\d_]*)\$/gi, (token, name) => entry.placeholders?.[name.toLowerCase()]?.content || token) || globalThis.AITrEnglish[source] || source;
    // Values are plain text. Never interpret translated messages as HTML or code.
    return template.replace(/\$(\d+)/g, (_, n) => String(values[Number(n) - 1] ?? ''));
  }
  function apply(record) {
    const value = record.original.match(/^\s*/)[0] + t(record.key) + record.original.match(/\s*$/)[0];
    if (record.attribute) record.node.setAttribute(record.attribute, value);
    else record.node.nodeValue = value;
  }
  function refresh() {
    for (const host of hosts) {
      host.lang = active;
      host.dir = L.LANGUAGES[active].dir;
    }
    for (const record of records) {
      if (record.connected && !record.node.isConnected) { records.delete(record); continue; }
      record.connected ||= record.node.isConnected;
      apply(record);
    }
    if (isExtensionPage && globalThis.document?.documentElement) {
      document.documentElement.lang = active;
      document.documentElement.dir = L.LANGUAGES[active].dir;
      document.documentElement.style.setProperty('--translation-placeholder', JSON.stringify(t('译文会显示在这里')));
    }
    for (const listener of listeners) listener();
  }
  // Register static templates before inserting source text, translated results, or user inputs.
  function localize(root) {
    const doc = root.ownerDocument || root;
    function register(node, original, attribute) {
      const key = original.replace(/\s+/g, ' ').trim();
      if (!Object.hasOwn(globalThis.AITrMessageIds, key)) return;
      let slots = seen.get(node);
      if (!slots) { slots = new Set(); seen.set(node, slots); }
      const slot = attribute || 'text';
      if (slots.has(slot)) return;
      slots.add(slot);
      const record = { node, original, key, attribute, connected: node.isConnected };
      records.add(record);
      apply(record);
    }
    const walker = doc.createTreeWalker(root, 4);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.parentElement?.closest('script, style')) register(node, node.nodeValue);
    }
    for (const node of root.querySelectorAll('[title], [aria-label], [placeholder], [alt]')) {
      for (const attribute of ['title', 'aria-label', 'placeholder', 'alt']) {
        if (node.hasAttribute(attribute)) register(node, node.getAttribute(attribute), attribute);
      }
    }
    if (root.host) { hosts.add(root.host); root.host.lang = active; root.host.dir = L.LANGUAGES[active].dir; }
  }
  async function load() {
    const token = ++sequence;
    let result;
    if (isWorker) {
      await L.ready;
      const stored = await chrome.storage.local.get('settings');
      const choice = stored.settings?.uiLanguage;
      const locale = L.LANGUAGES[choice] ? choice : L.browserTarget();
      const response = await fetch(chrome.runtime.getURL(L.catalogPath(locale)));
      if (!response.ok) throw new Error(`Missing locale: ${locale}`);
      result = { locale, messages: await response.json() };
    } else {
      // Content scripts and offscreen documents need no additional resource permissions.
      result = await chrome.runtime.sendMessage({ type: 'get-ui-messages' });
    }
    if (token !== sequence || !result?.messages) return;
    active = result.locale;
    catalog = result.messages;
    refresh();
  }
  const api = { t, locale: () => active, localize,
    snapshot: () => ({ locale: active, messages: catalog }),
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    reload: () => { api.ready = load(); return api.ready; },
  };
  globalThis.AITrI18n = api;
  api.ready = load().catch(() => { /* Native Chrome locale remains available during startup. */ });
  globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes.settings && changes.settings.newValue?.uiLanguage !== changes.settings.oldValue?.uiLanguage) {
      api.reload().catch(() => {});
    }
  });
  if (isExtensionPage) api.ready.then(() => { localize(document); refresh(); });
})();

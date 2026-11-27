/**
 * 整份视频翻译的记录（见 docs/extension/video-file-translation.md）：存在扩展自己的 IndexedDB，
 * 只在这个浏览器里，不上传、不同步。service worker 写记录、offscreen 写视频文件、「视频翻译」页读，三者同属扩展来源。
 *
 *   entries { id, srcUrl, pageUrl, title, titleTr（标题译文，旧记录没有）, createdAt, duration, cues, lang, target, provider, resultKey, warning, size }
 *   files   { id, blob }   下载下来的视频文件：原网址失效或防盗链时也能在「视频翻译」页播放
 *
 * 只留最近 MAX_ENTRIES 条、文件合计不超过 MAX_BYTES，超出时删最旧的。无痕窗口里的翻译不记。
 * 与 lang.js 一样不能使用 import / export。
 */
(() => {
  if (globalThis.AITrVideoLibrary) return;
  const DB_NAME = 'aitr-videos';
  const VERSION = 1;
  const MAX_ENTRIES = 30;
  const MAX_BYTES = 500 * 1024 * 1024;
  let opening = null;

  function open() {
    opening ||= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' }).createIndex('srcUrl', 'srcUrl');
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      request.onerror = () => { opening = null; reject(request.error); };
    });
    return opening;
  }

  function run(stores, mode, work) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result;
      Promise.resolve(work(tx)).then((value) => { result = value; }, reject);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('aborted'));
    }));
  }

  const wrap = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  /** 新到旧。 */
  const list = () => run(['entries'], 'readonly', (tx) => wrap(tx.objectStore('entries').getAll()))
    .then((all) => all.sort((a, b) => b.createdAt - a.createdAt));

  const get = (id) => run(['entries'], 'readonly', (tx) => wrap(tx.objectStore('entries').get(String(id))));

  const getFile = (id) => run(['files'], 'readonly', (tx) => wrap(tx.objectStore('files').get(String(id))))
    .then((row) => row?.blob || null);

  const putFile = (id, blob) => run(['files'], 'readwrite', (tx) => wrap(tx.objectStore('files').put({ id: String(id), blob })));

  const removeFile = (id) => run(['files'], 'readwrite', (tx) => wrap(tx.objectStore('files').delete(String(id))));

  const remove = (id) => run(['entries', 'files'], 'readwrite', (tx) => Promise.all([
    wrap(tx.objectStore('entries').delete(String(id))),
    wrap(tx.objectStore('files').delete(String(id))),
  ]));

  /** 同一个视频、同样的设置（平台、目标语言、识别语言）翻过的最新一条。 */
  const find = (srcUrl, resultKey) => run(['entries'], 'readonly', (tx) => wrap(tx.objectStore('entries').index('srcUrl').getAll(String(srcUrl))))
    .then((rows) => rows.filter((row) => row.resultKey === resultKey).sort((a, b) => b.createdAt - a.createdAt)[0] || null);

  /** 只留最近 MAX_ENTRIES 条、文件合计不超过 MAX_BYTES。 */
  async function prune({ maxEntries = MAX_ENTRIES, maxBytes = MAX_BYTES } = {}) {
    const all = await list();
    let bytes = 0;
    const drop = all.filter((entry, i) => {
      bytes += entry.size || 0;
      return i >= maxEntries || (i > 0 && bytes > maxBytes);
    });
    for (const entry of drop) await remove(entry.id);
    return drop.length;
  }

  /** 写入一条记录，然后按上限清理旧的。 */
  async function put(entry) {
    await run(['entries'], 'readwrite', (tx) => wrap(tx.objectStore('entries').put(entry)));
    await prune();
  }

  globalThis.AITrVideoLibrary = { list, get, getFile, put, putFile, remove, removeFile, find, prune, MAX_ENTRIES, MAX_BYTES };
})();

/**
 * 双语阅读的「已保存」文章：存在扩展自己的 IndexedDB（只在这个浏览器里，不上传、不经 Chrome 账号同步）。
 * chrome.storage.local 默认只有 10MB、还和设置共用，整篇文章连同译文放不下几篇，所以用 IndexedDB。
 *
 *   meta    { id, url, title, siteName, target, provider, savedAt, updatedAt, chars }  列表只读这一张
 *   content { id, article, target, outs, machines }                                    打开时再读
 *
 * article 与阅读页内存里的结构相同（纯文字块与 http(s) 图片地址）；outs 是当前译文（含换过的说法），
 * machines 是平台给的原译文，下标与阅读页的翻译单元一一对应。
 */
(() => {
  if (globalThis.AITrLibrary) return;
  const DB_NAME = 'aitr-reader';
  const VERSION = 1;
  let opening = null;

  function open() {
    opening ||= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' }).createIndex('url', 'url');
        if (!db.objectStoreNames.contains('content')) db.createObjectStore('content', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
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

  /** 全部已保存的文章（只有列表信息），最近保存的在前。 */
  async function list() {
    const items = await run(['meta'], 'readonly', (tx) => wrap(tx.objectStore('meta').getAll()));
    return (items || []).sort((a, b) => b.savedAt - a.savedAt);
  }

  async function get(id) {
    return run(['meta', 'content'], 'readonly', async (tx) => {
      const [meta, content] = await Promise.all([wrap(tx.objectStore('meta').get(id)), wrap(tx.objectStore('content').get(id))]);
      return meta && content ? { meta, content } : null;
    });
  }

  async function findByUrl(url) {
    if (!url) return null;
    const items = await run(['meta'], 'readonly', (tx) => wrap(tx.objectStore('meta').index('url').getAll(url)));
    return (items || []).sort((a, b) => b.savedAt - a.savedAt)[0] || null;
  }

  /** 新建或更新一篇（同一 id 覆盖）。savedAt 只在第一次保存时写入，之后按更新时间记 updatedAt。 */
  async function save({ id, article, target, provider, outs, machines, savedAt }) {
    const now = Date.now();
    const chars = article.blocks.reduce((sum, block) => sum + String(block.text || '').length, 0);
    const meta = {
      id, url: article.url || '', title: article.title || '', siteName: article.siteName || '',
      target, provider, savedAt: savedAt || now, updatedAt: now, chars,
    };
    await run(['meta', 'content'], 'readwrite', (tx) => {
      tx.objectStore('meta').put(meta);
      tx.objectStore('content').put({ id, article, target, outs, machines });
    });
    return meta;
  }

  async function remove(id) {
    await run(['meta', 'content'], 'readwrite', (tx) => {
      tx.objectStore('meta').delete(id);
      tx.objectStore('content').delete(id);
    });
  }

  globalThis.AITrLibrary = { list, get, findByUrl, save, remove };
})();

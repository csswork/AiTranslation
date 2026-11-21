/**
 * 本机译文缓存（见 docs/extension/local-cache.md）：用户自带 Key 的大模型平台与 DeepL 的结果存在扩展自己的 IndexedDB，
 * 同样的请求再来时直接用，不再花用户的钱和时间。service worker 与扩展页面同属扩展来源，共用同一个库；
 * 内容脚本不加载这个文件（它们的请求都经 service worker 发出）。
 *
 * - 只在本机，不同步、不上传；托管（点数）与本机翻译不走这里（见 providers.js 的 cacheFor）。
 * - 不保存原文：查找键是带本机随机密钥的 HMAC；值用由「密钥 + 原文请求」派生的密钥做 AES-GCM 加密，
 *   没有原文就还原不了译文。密钥是不可导出的 CryptoKey，只存在同一个库里。
 * - 条目 IDLE_MS 没被用到就删除；条数超过 MAX_ENTRIES 时删掉最久没用的。命中时最多一天更新一次使用时间，免得每次命中都写库。
 * - 读写失败一律当作没命中，缓存出问题不能影响翻译。
 * - 与 lang.js 等一样不能使用 import / export。
 */
(() => {
  if (globalThis.AITrCache) return;

  /** 缓存键的格式版本：改了存值的形状或解析逻辑时加一，旧条目自然不再命中。提示词变化不用改：完整提示词本身就在键里。 */
  const FORMAT = 1;
  const MAX_ENTRIES = 30000;
  const IDLE_MS = 30 * 86400_000;
  const TOUCH_MS = 86400_000;
  const PRUNE_MS = 10 * 60_000;
  const DB_NAME = 'aitr-cache';

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const newSecret = () => crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  /** IndexedDB 存储：entries（id → { id, iv, data, used }，按 used 建索引）与 meta（secret）。 */
  function idbBackend(name = DB_NAME) {
    let dbTask = null;
    const open = () => (dbTask ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('entries', { keyPath: 'id' }).createIndex('used', 'used');
        db.createObjectStore('meta');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); dbTask = null; };
        db.onclose = () => { dbTask = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch((error) => { dbTask = null; throw error; }));

    /** 一个事务：fn 在请求回调里把结果写进 out.value，事务完成后返回。 */
    async function run(stores, mode, fn) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        const out = { value: undefined };
        tx.oncomplete = () => resolve(out.value);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new DOMException('Aborted', 'AbortError'));
        fn(tx, out);
      });
    }

    return {
      async secret() {
        // 先生成好再进事务（事务里不能等别的异步操作）；两个上下文同时首次使用时，后进事务的那个沿用已存的
        const fresh = await newSecret();
        return run(['meta'], 'readwrite', (tx, out) => {
          const store = tx.objectStore('meta');
          const found = store.get('secret');
          found.onsuccess = () => {
            if (found.result) { out.value = found.result; return; }
            store.put(fresh, 'secret');
            out.value = fresh;
          };
        });
      },
      read(ids) {
        return run(['entries'], 'readonly', (tx, out) => {
          const store = tx.objectStore('entries');
          out.value = new Map();
          for (const id of ids) {
            const request = store.get(id);
            request.onsuccess = () => { if (request.result) out.value.set(id, request.result); };
          }
        });
      },
      write(records) {
        return run(['entries'], 'readwrite', (tx) => {
          const store = tx.objectStore('entries');
          for (const record of records) store.put(record);
        });
      },
      touch(ids, used) {
        return run(['entries'], 'readwrite', (tx) => {
          const store = tx.objectStore('entries');
          for (const id of ids) {
            const request = store.get(id);
            request.onsuccess = () => { if (request.result) store.put({ ...request.result, used }); };
          }
        });
      },
      prune({ maxEntries, before }) {
        return run(['entries'], 'readwrite', (tx, out) => {
          const store = tx.objectStore('entries');
          const index = store.index('used');
          out.value = 0;
          const expired = index.openCursor(IDBKeyRange.upperBound(before, true));
          expired.onsuccess = () => {
            const cursor = expired.result;
            if (cursor) { cursor.delete(); out.value += 1; cursor.continue(); return; }
            const counting = store.count();
            counting.onsuccess = () => {
              if (counting.result <= maxEntries) return;
              // 一次多删一些（留一成余量），免得之后每次写入都要清理
              let extra = counting.result - Math.floor(maxEntries * 0.9);
              const oldest = index.openCursor();
              oldest.onsuccess = () => {
                const next = oldest.result;
                if (!next || extra <= 0) return;
                next.delete();
                out.value += 1;
                extra -= 1;
                next.continue();
              };
            };
          };
        });
      },
      count() {
        return run(['entries'], 'readonly', (tx, out) => {
          const request = tx.objectStore('entries').count();
          request.onsuccess = () => { out.value = request.result; };
        });
      },
      clear() {
        return run(['entries'], 'readwrite', (tx) => { tx.objectStore('entries').clear(); });
      },
    };
  }

  /** 内存存储，语义与 idbBackend 相同，测试用。 */
  function memoryBackend() {
    const entries = new Map();
    let secret = null;
    return {
      entries,
      async secret() { return (secret ??= await newSecret()); },
      async read(ids) { return new Map(ids.filter((id) => entries.has(id)).map((id) => [id, entries.get(id)])); },
      async write(records) { for (const record of records) entries.set(record.id, record); },
      async touch(ids, used) { for (const id of ids) if (entries.has(id)) entries.set(id, { ...entries.get(id), used }); },
      async prune({ maxEntries, before }) {
        let removed = 0;
        for (const [id, record] of entries) if (record.used < before) { entries.delete(id); removed += 1; }
        if (entries.size > maxEntries) {
          const oldest = [...entries.values()].sort((a, b) => a.used - b.used);
          for (const record of oldest.slice(0, entries.size - Math.floor(maxEntries * 0.9))) {
            entries.delete(record.id);
            removed += 1;
          }
        }
        return removed;
      },
      async count() { return entries.size; },
      async clear() { entries.clear(); },
    };
  }

  /**
   * @param {object} [options]
   * @param {object|null} [options.backend] 存储；为空时缓存不可用（例如没有 IndexedDB 的环境）
   */
  function create({ backend = null, now = Date.now, maxEntries = MAX_ENTRIES, idleMs = IDLE_MS } = {}) {
    let secretTask = null;
    let lastPrune = 0;
    const pending = new Set();
    const secret = () => (secretTask ??= backend.secret().catch((error) => { secretTask = null; throw error; }));
    const derive = async (label, material) =>
      new Uint8Array(await crypto.subtle.sign('HMAC', await secret(), encoder.encode(`${label}\0${material}`)));
    const idOf = async (material) => toBase64(await derive('id', material));
    const keyOf = async (material) => crypto.subtle.importKey('raw', await derive('key', material), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const track = (task) => {
      pending.add(task);
      task.finally(() => pending.delete(task));
      return task;
    };

    /** 这次请求能不能用缓存：有存储且设置里没关。 */
    const usable = (settings) => Boolean(backend) && settings?.cache !== false;

    /** 把影响结果的所有因素拼成查找材料（只在内存里，进库前会变成 HMAC）。 */
    const material = (...parts) => JSON.stringify([FORMAT, ...parts]);

    /** 返回与 materials 等长的数组：命中的是保存的值，没命中的是 undefined。 */
    async function getMany(materials) {
      const misses = materials.map(() => undefined);
      if (!backend || !materials.length) return misses;
      try {
        const ids = await Promise.all(materials.map(idOf));
        const found = await backend.read(ids);
        if (!found.size) return misses;
        const time = now();
        const stale = [];
        const values = await Promise.all(materials.map(async (item, i) => {
          const record = found.get(ids[i]);
          if (!record) return undefined;
          try {
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, await keyOf(item), record.data);
            if (time - record.used > TOUCH_MS) stale.push(ids[i]);
            return JSON.parse(decoder.decode(plain));
          } catch {
            return undefined;
          }
        }));
        if (stale.length) track(backend.touch(stale, time).catch(() => {}));
        return values;
      } catch {
        return misses;
      }
    }

    /** 写入 [[material, value], ...]。不用等它完成：失败时什么都不做。 */
    function setMany(entries) {
      if (!backend || !entries.length) return Promise.resolve();
      return track((async () => {
        try {
          const time = now();
          const records = await Promise.all(entries.map(async ([item, value]) => {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyOf(item), encoder.encode(JSON.stringify(value)));
            return { id: await idOf(item), iv, data, used: time };
          }));
          await backend.write(records);
          if (time - lastPrune > PRUNE_MS) {
            lastPrune = time;
            await backend.prune({ maxEntries, before: time - idleMs });
          }
        } catch {
          /* 写不进去就算了，不影响翻译 */
        }
      })());
    }

    /** 图片等大块内容先取摘要再放进查找材料。 */
    async function digest(text) {
      return toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(String(text)))));
    }

    return {
      FORMAT,
      usable,
      material,
      getMany,
      setMany,
      digest,
      /** 等所有后台写入完成（测试用）。 */
      flush: () => Promise.all([...pending]),
      prune: () => (backend ? backend.prune({ maxEntries, before: now() - idleMs }) : Promise.resolve(0)),
      count: () => (backend ? backend.count() : Promise.resolve(0)),
      clear: () => (backend ? backend.clear() : Promise.resolve()),
    };
  }

  const available = typeof indexedDB !== 'undefined' && Boolean(globalThis.crypto?.subtle);
  globalThis.AITrCache = { ...create({ backend: available ? idbBackend() : null }), create, memoryBackend, idbBackend };
})();

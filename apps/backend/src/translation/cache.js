/**
 * 托管文字翻译的进程内缓存：完全相同的请求（目标语言、源语言、用词偏好与全部原文都一致）直接返回上次的译文，
 * 不再调用模型。只在本进程内存里，不查库、不走网络，命中与未命中都只多一次 HMAC（微秒级），不拖慢响应；
 * 重启即清空，提示词或模型随部署变化时也就自然失效。
 *
 * 不保存原文：查找键是带进程随机密钥的 HMAC 摘要；译文用从「密钥 + 原文请求」派生的密钥做 AES-256-GCM 加密，
 * 没有原文就无法还原。条目最多保留 ttlMs（到期由定时清理删除，命中不延长），总大小超过 maxBytes 时淘汰最久未用的。
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const ENTRY_OVERHEAD = 160; // Map 条目、IV、认证标签与对象本身的粗略开销（字节）

export function createTranslationCache({ maxBytes, ttlMs, now = Date.now, sweepMs = 60_000 } = {}) {
  if (!(maxBytes > 0) || !(ttlMs > 0)) return null;
  const secret = randomBytes(32);
  /** id → { iv, tag, data, expires, size }；Map 的顺序即最近使用顺序（最早的在前）。 */
  const entries = new Map();
  let bytes = 0;

  const derive = (label, material) => createHmac('sha256', secret).update(label).update('\0').update(material).digest();
  const remove = (id) => {
    const entry = entries.get(id);
    if (!entry) return;
    bytes -= entry.size;
    entries.delete(id);
  };
  const sweep = () => {
    const t = now();
    for (const [id, entry] of entries) if (entry.expires <= t) remove(id);
  };
  const timer = setInterval(sweep, sweepMs);
  timer.unref?.();

  return {
    /** 命中返回保存的值（JSON 可序列化），未命中或已过期返回 null。 */
    get(material) {
      const id = derive('id', material).toString('base64url');
      const entry = entries.get(id);
      if (!entry) return null;
      if (entry.expires <= now()) {
        remove(id);
        return null;
      }
      entries.delete(id);
      entries.set(id, entry);
      try {
        const decipher = createDecipheriv('aes-256-gcm', derive('key', material), entry.iv);
        decipher.setAuthTag(entry.tag);
        return JSON.parse(Buffer.concat([decipher.update(entry.data), decipher.final()]).toString('utf8'));
      } catch {
        remove(id);
        return null;
      }
    },
    set(material, value) {
      const id = derive('id', material).toString('base64url');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', derive('key', material), iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      const size = data.length + id.length + ENTRY_OVERHEAD;
      remove(id);
      if (size > maxBytes) return;
      entries.set(id, { iv, tag: cipher.getAuthTag(), data, expires: now() + ttlMs, size });
      bytes += size;
      for (const oldest of entries.keys()) {
        if (bytes <= maxBytes) break;
        remove(oldest);
      }
    },
    sweep,
    clear() {
      entries.clear();
      bytes = 0;
    },
    close() {
      clearInterval(timer);
      entries.clear();
      bytes = 0;
    },
    get size() { return entries.size; },
    get bytes() { return bytes; },
  };
}

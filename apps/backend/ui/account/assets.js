/**
 * 用户界面的静态资源：启动时读入内存，页面引用带内容哈希的地址（/assets/x.css?v=hash），
 * 内容变化后地址随之变化，浏览器可以长期缓存。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');
const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };

export const assets = new Map();
for (const name of fs.readdirSync(DIR)) {
  const type = TYPES[path.extname(name)];
  if (!type) continue;
  const body = fs.readFileSync(path.join(DIR, name));
  assets.set(name, { type, body, version: createHash('sha256').update(body).digest('hex').slice(0, 12) });
}

export const assetUrl = (name) => `/assets/${name}?v=${assets.get(name).version}`;

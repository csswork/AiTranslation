#!/usr/bin/env node
/**
 * 翻译质量评测：用同一批样本跑若干方案，再让评审模型两两盲评。
 * 用法见 docs/extension/translation-eval.md。只在开发时运行，不进扩展安装包。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import { variants as VARIANTS } from './variants.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repo = path.resolve(root, '../..');

/* ------------------------------------------------------------ 参数与配置 */

const argv = process.argv.slice(2);
const arg = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const flag = (name) => argv.includes(name);
const list = (value) => (value ? value.split(',').map((item) => item.trim()).filter(Boolean) : []);

if (flag('--help') || flag('-h')) {
  console.log([
    '用法：node apps/extension/eval/run.mjs [选项]',
    '  --variants a,b     要跑的方案，第一个是对照组（默认 baseline）',
    '  --list             列出可用方案',
    '  --from ja|en       只跑某个源语言',
    '  --genre a,b        只跑某些体裁',
    '  --ids a,b          只跑指定样本',
    '  --limit N          最多跑 N 条',
    '  --target zh-Hans   目标语言（默认简体中文）',
    '  --samples 文件      换一份样本',
    '  --no-judge         只翻译，不评审',
    '  --fresh            不用缓存，全部重新请求',
    '  --concurrency N    并发数（默认 4）',
  ].join('\n'));
  process.exit(0);
}
if (flag('--list')) {
  for (const [id, variant] of Object.entries(VARIANTS)) console.log(`${id.padEnd(12)} ${variant.note || ''}`);
  process.exit(0);
}

// 环境文件按文本解析，不执行；与界面译文生成器的查找顺序一致
const config = { ...process.env };
const envPath = arg('--env') || [path.join(root, '.env.local'), path.join(repo, '.env.local')].find((file) => fs.existsSync(file));
if (envPath) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) continue;
    config[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const apiKey = config.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error('需要 DEEPSEEK_API_KEY（.env.local 或进程环境）。');
  process.exit(1);
}
const judge = {
  key: config.JUDGE_API_KEY || apiKey,
  baseUrl: (config.JUDGE_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
  model: config.JUDGE_MODEL || 'deepseek-flash',
};

const variantIds = list(arg('--variants'));
if (!variantIds.length) variantIds.push('baseline');
for (const id of variantIds) {
  if (!VARIANTS[id]) {
    console.error(`没有方案「${id}」。可用：${Object.keys(VARIANTS).join('、')}`);
    process.exit(1);
  }
}
const control = variantIds[0];
const candidates = variantIds.slice(1);
const targetId = arg('--target') || 'zh-Hans';
const concurrency = Math.max(1, Number(arg('--concurrency')) || 4);
const shouldJudge = candidates.length > 0 && !flag('--no-judge');

let samples = JSON.parse(fs.readFileSync(arg('--samples') ? path.resolve(arg('--samples')) : path.join(here, 'samples.json'), 'utf8'));
const only = { from: arg('--from'), genres: list(arg('--genre')), ids: list(arg('--ids')) };
samples = samples.filter((sample) =>
  (!only.from || sample.from === only.from)
  && (!only.genres.length || only.genres.includes(sample.genre))
  && (!only.ids.length || only.ids.includes(sample.id)));
if (arg('--limit')) samples = samples.slice(0, Number(arg('--limit')));
if (!samples.length) {
  console.error('没有符合条件的样本。');
  process.exit(1);
}

/* ------------------------------------------------------------ 带缓存的请求 */

const outRoot = path.join(repo, 'dist', 'eval');
fs.mkdirSync(outRoot, { recursive: true });
const cachePath = path.join(outRoot, 'cache.json');
// --fresh 只是不读缓存：新结果照常写回，其他方案的缓存保留
const fresh = flag('--fresh');
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
const stats = { requests: 0, cached: 0 };
const realFetch = globalThis.fetch;

/** 发一次 /chat/completions。相同地址与请求体直接用上次的结果，重跑不花钱，评审也更稳定。 */
async function chat(url, init) {
  const key = crypto.createHash('sha256').update(`${url}\n${init.body}`).digest('hex');
  if (!fresh && cache[key]) {
    stats.cached += 1;
    return new Response(JSON.stringify(cache[key]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  stats.requests += 1;
  let response;
  for (let attempt = 0; ; attempt += 1) {
    response = await realFetch(url, init);
    if (response.status !== 429 && response.status < 500) break;
    if (attempt >= 3) break;
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  if (!response.ok) return response;
  const data = await response.json();
  cache[key] = data;
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// 扩展代码发请求时，按当前方案改写请求体
const current = new AsyncLocalStorage();
globalThis.fetch = async (url, init) => {
  const run = current.getStore();
  if (!run) return realFetch(url, init);
  const body = run.variant.patch(JSON.parse(init.body), run.ctx);
  run.sent = body;
  return chat(String(url), { ...init, body: JSON.stringify(body) });
};

/* ------------------------------------------------------------ 加载扩展的翻译层 */

globalThis.chrome = {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  runtime: { sendMessage: async () => ({}), onConnect: { addListener() {} } },
  i18n: { getUILanguage: () => 'zh-CN', getAcceptLanguages: async () => ['zh-CN'] },
};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'zh-CN', languages: ['zh-CN'] } });
globalThis.AITrI18n = {
  t: (source, values = []) => source.replace(/\$(\d+)/g, (_, n) => String(values[Number(n) - 1] ?? '')),
  ready: Promise.resolve(), locale: () => 'zh-Hans', onChange() {},
};
for (const file of ['languages.js', 'lang.js', 'settings.js', 'providers.js']) {
  new Function(fs.readFileSync(path.join(root, 'src/lib', file), 'utf8'))();
}
const { AITrSettings: S, AITrProviders: P } = globalThis;
if (!S.TARGETS[targetId]) {
  console.error(`没有目标语言「${targetId}」。`);
  process.exit(1);
}
const targetName = S.TARGETS[targetId].prompt;
const settings = S.normalize({
  provider: 'deepseek',
  target: targetId,
  stream: false,
  deepseek: { apiKey, model: config.DEEPSEEK_MODEL || '', baseUrl: '' },
});

/* ------------------------------------------------------------ 翻译 */

async function pool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

const isBatch = (sample) => sample.mode === 'batch';

async function translateOne(sample, variantId) {
  const run = { variant: VARIANTS[variantId], ctx: { mode: isBatch(sample) ? 'batch' : 'single', sample, target: targetName } };
  try {
    const output = await current.run(run, async () => {
      if (isBatch(sample)) return P.translateBatch({ texts: sample.texts, settings, targetId });
      let text = '';
      for await (const piece of P.translate({ text: sample.text, settings, targetId })) text += piece;
      return text.trim();
    });
    return { output, request: describe(run.sent) };
  } catch (err) {
    return { error: String(err?.message || err), request: describe(run.sent) };
  }
}

/** 报告里用来说明一个方案实际发了什么参数。 */
function describe(body) {
  if (!body) return null;
  const { messages, stream, ...rest } = body;
  return rest;
}

/* ------------------------------------------------------------ 评审 */

const show = (sample, value) => (isBatch(sample) ? value.map((item, index) => `${index + 1}. ${item}`).join('\n') : value);

function judgePrompt() {
  return [
    `你是资深的译文审校，母语是目标语言（${targetName}）。下面有一段原文和两份译文（A、B），请比较它们。`,
    '分两项打分，每项 1–5 分（5 分最好）：',
    '- faithful（忠实）：意思是否准确完整，有没有漏译、错译、擅自增删，专有名词与数字是否正确。',
    '- natural（地道）：读起来是否像母语者写的，用词搭配、语序、语气是否符合目标语言的习惯，有没有翻译腔。',
    '打分要严格：natural 的 5 分只给找不出翻译痕迹的译文；照搬原文句式、能读懂但母语者不会这么说的，最多 3 分。',
    '语体要与原文相称：口语不要译成书面语，新闻、技术文档不要译得随意。',
    '如果原文是编了号的若干片段，它们来自同一个网页，是逐项翻译的；译文必须条数相同、一一对应。片段可能是被切开的半句话，读者看到的是按顺序连起来的效果，请连起来读再判断是否通顺。',
    'winner 表示整体上哪份更好：意思有明显错误的一份不能赢；两份差不多就填 "tie"，不要勉强分高下。',
    '只输出一个 JSON 对象，不要输出别的内容：',
    '{"a":{"faithful":1-5,"natural":1-5},"b":{"faithful":1-5,"natural":1-5},"winner":"A"|"B"|"tie","reason":"一两句话说明关键差别"}',
  ].join('\n');
}

function parseVerdict(content) {
  let text = String(content || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('评审没有返回 JSON');
  const data = JSON.parse(text.slice(start, end + 1));
  const score = (value) => {
    const number = Number(value);
    if (!(number >= 1 && number <= 5)) throw new Error('评审分数不在 1–5 之间');
    return number;
  };
  const winner = String(data.winner || '').toLowerCase();
  if (!['a', 'b', 'tie'].includes(winner)) throw new Error('评审没有给出 winner');
  return {
    a: { faithful: score(data.a?.faithful), natural: score(data.a?.natural) },
    b: { faithful: score(data.b?.faithful), natural: score(data.b?.natural) },
    winner,
    reason: String(data.reason || ''),
  };
}

/** 对照组与候选方案盲评：A、B 的顺序按样本固定打乱，评审不知道哪份是哪个方案。 */
async function judgePair(sample, candidateId, controlOut, candidateOut) {
  const same = JSON.stringify(controlOut) === JSON.stringify(candidateOut);
  if (same) return { winner: 'tie', identical: true, reason: '两份译文完全相同' };
  const flip = crypto.createHash('sha256').update(`${sample.id}|${candidateId}`).digest()[0] % 2 === 1;
  const [a, b] = flip ? [candidateOut, controlOut] : [controlOut, candidateOut];
  const user = [
    `【原文】\n${show(sample, isBatch(sample) ? sample.texts : sample.text)}`,
    `【译文 A】\n${show(sample, a)}`,
    `【译文 B】\n${show(sample, b)}`,
  ].join('\n\n');
  const body = { model: judge.model, stream: false, messages: [{ role: 'system', content: judgePrompt() }, { role: 'user', content: user }] };
  // 评审要的是判断质量，不赶时间：DeepSeek 上显式开启思考
  if (/deepseek/i.test(judge.baseUrl)) body.thinking = { type: 'enabled' };
  try {
    const response = await chat(`${judge.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${judge.key}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`评审请求失败（${response.status}）${(await response.text()).slice(0, 200)}`);
    const verdict = parseVerdict((await response.json())?.choices?.[0]?.message?.content);
    const [control_, candidate_] = flip ? [verdict.b, verdict.a] : [verdict.a, verdict.b];
    const winner = verdict.winner === 'tie' ? 'tie' : (verdict.winner === 'a') !== flip ? 'control' : 'candidate';
    // 理由里的 A、B 换回方案名，读报告时不用再对照
    const label = (letter) => ((letter === 'A') !== flip ? control : candidateId);
    const reason = verdict.reason.replace(/(?<![A-Za-z])([AB])(?![A-Za-z])/g, (_, letter) => `「${label(letter)}」`);
    return { winner, control: control_, candidate: candidate_, reason };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}

/* ------------------------------------------------------------ 运行 */

console.log(`样本 ${samples.length} 条 → ${targetName}；方案：${variantIds.join('、')}${shouldJudge ? `；评审：${judge.model}` : ''}`);

const jobs = samples.flatMap((sample) => variantIds.map((variantId) => ({ sample, variantId })));
let done = 0;
const translated = await pool(jobs, async ({ sample, variantId }) => {
  const result = await translateOne(sample, variantId);
  done += 1;
  process.stdout.write(`\r翻译 ${done}/${jobs.length}`);
  return result;
});
process.stdout.write('\n');
fs.writeFileSync(cachePath, JSON.stringify(cache));

const rows = samples.map((sample, index) => ({
  sample,
  outputs: Object.fromEntries(variantIds.map((variantId, offset) => [variantId, translated[index * variantIds.length + offset]])),
  verdicts: {},
}));

if (shouldJudge) {
  const pairs = rows.flatMap((row) => candidates
    .filter((id) => !row.outputs[control].error && !row.outputs[id].error)
    .map((id) => ({ row, id })));
  let judged = 0;
  await pool(pairs, async ({ row, id }) => {
    row.verdicts[id] = await judgePair(row.sample, id, row.outputs[control].output, row.outputs[id].output);
    judged += 1;
    process.stdout.write(`\r评审 ${judged}/${pairs.length}`);
  });
  process.stdout.write('\n');
  fs.writeFileSync(cachePath, JSON.stringify(cache));
}

/* ------------------------------------------------------------ 汇总与报告 */

const mean = (values) => (values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2) : '—');

function tally(subset, id) {
  const verdicts = subset.map((row) => row.verdicts[id]).filter((verdict) => verdict && !verdict.error);
  const scored = verdicts.filter((verdict) => verdict.control);
  return {
    n: verdicts.length,
    win: verdicts.filter((verdict) => verdict.winner === 'candidate').length,
    tie: verdicts.filter((verdict) => verdict.winner === 'tie').length,
    loss: verdicts.filter((verdict) => verdict.winner === 'control').length,
    identical: verdicts.filter((verdict) => verdict.identical).length,
    faithful: [mean(scored.map((verdict) => verdict.control.faithful)), mean(scored.map((verdict) => verdict.candidate.faithful))],
    natural: [mean(scored.map((verdict) => verdict.control.natural)), mean(scored.map((verdict) => verdict.candidate.natural))],
  };
}

const groups = [['全部', () => true]];
for (const from of [...new Set(samples.map((sample) => sample.from))]) groups.push([`源语言 ${from}`, (sample) => sample.from === from]);
for (const genre of [...new Set(samples.map((sample) => sample.genre))]) groups.push([`体裁 ${genre}`, (sample) => sample.genre === genre]);
for (const mode of ['single', 'batch']) {
  if (samples.some((sample) => (sample.mode || 'single') === mode)) groups.push([mode === 'batch' ? '网页片段（批量）' : '整段', (sample) => (sample.mode || 'single') === mode]);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(outRoot, `${stamp}-${variantIds.join('+')}`.slice(0, 120));
fs.mkdirSync(outDir, { recursive: true });

const md = [];
md.push(`# 翻译评测 ${stamp}`, '');
md.push(`- 样本：${samples.length} 条，目标语言 ${targetName}`);
md.push(`- 对照组：\`${control}\`${candidates.length ? `；候选：${candidates.map((id) => `\`${id}\``).join('、')}` : ''}`);
if (shouldJudge) md.push(`- 评审模型：\`${judge.model}\`（盲评，A/B 顺序按样本打乱）`);
md.push('', '| 方案 | 说明 | 实际请求参数 | 失败 |', '| --- | --- | --- | --- |');
for (const id of variantIds) {
  const sent = rows.map((row) => row.outputs[id].request).find(Boolean);
  const failed = rows.filter((row) => row.outputs[id].error).length;
  md.push(`| \`${id}\` | ${VARIANTS[id].note || ''} | \`${JSON.stringify(sent)}\` | ${failed} |`);
}

const summary = {};
for (const id of candidates) {
  if (!shouldJudge) break;
  summary[id] = {};
  md.push('', `## \`${id}\` 对比 \`${control}\``, '');
  md.push('胜 / 平 / 负 是候选方案相对对照组的结果；分数列是「对照组 → 候选」，不含译文完全相同的样本。', '');
  md.push('| 范围 | 样本 | 胜 | 平 | 负 | 译文相同 | 忠实 | 地道 |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [name, match] of groups) {
    const result = tally(rows.filter((row) => match(row.sample)), id);
    summary[id][name] = result;
    md.push(`| ${name} | ${result.n} | ${result.win} | ${result.tie} | ${result.loss} | ${result.identical} | ${result.faithful.join(' → ')} | ${result.natural.join(' → ')} |`);
  }
  const worse = rows.filter((row) => row.verdicts[id]?.control && row.verdicts[id].candidate.faithful < row.verdicts[id].control.faithful);
  if (worse.length) md.push('', `忠实度下降的样本（优先人工复核）：${worse.map((row) => `\`${row.sample.id}\``).join('、')}`);
  const failed = rows.filter((row) => row.verdicts[id]?.error);
  if (failed.length) md.push('', `评审失败 ${failed.length} 条：${failed.map((row) => `\`${row.sample.id}\``).join('、')}`);
}

md.push('', '## 逐条译文', '');
const quote = (text) => String(text).split('\n').map((line) => `> ${line}`).join('\n');
for (const row of rows) {
  const { sample } = row;
  md.push(`### ${sample.id}`, '');
  if (sample.watch) md.push(`留意：${sample.watch}`, '');
  md.push(quote(show(sample, isBatch(sample) ? sample.texts : sample.text)), '');
  for (const id of variantIds) {
    const result = row.outputs[id];
    md.push(`**${id}**`, '', result.error ? `（失败：${result.error}）` : quote(show(sample, result.output)), '');
  }
  for (const id of candidates) {
    const verdict = row.verdicts[id];
    if (!verdict) continue;
    if (verdict.error) md.push(`评审 \`${id}\`：失败（${verdict.error}）`, '');
    else {
      const word = { candidate: `\`${id}\` 更好`, control: `\`${control}\` 更好`, tie: '持平' }[verdict.winner];
      const scores = verdict.control ? `（忠实 ${verdict.control.faithful} → ${verdict.candidate.faithful}，地道 ${verdict.control.natural} → ${verdict.candidate.natural}）` : '';
      md.push(`评审 \`${id}\`：${word}${scores}　${verdict.reason}`, '');
    }
  }
}

fs.writeFileSync(path.join(outDir, 'report.md'), `${md.join('\n')}\n`);
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ stamp, target: targetId, control, candidates, judge: shouldJudge ? judge.model : null, summary, rows }, null, 2));

for (const id of candidates) {
  const result = summary[id]?.['全部'];
  if (result) console.log(`${id} 对比 ${control}：胜 ${result.win} / 平 ${result.tie} / 负 ${result.loss}；忠实 ${result.faithful.join(' → ')}，地道 ${result.natural.join(' → ')}`);
}
const failures = rows.flatMap((row) => variantIds.filter((id) => row.outputs[id].error).map((id) => `${row.sample.id}/${id}: ${row.outputs[id].error}`));
if (failures.length) console.log(`翻译失败 ${failures.length} 条：\n  ${failures.slice(0, 8).join('\n  ')}`);
console.log(`请求 ${stats.requests} 次，命中缓存 ${stats.cached} 次`);
console.log(`报告：${path.relative(repo, path.join(outDir, 'report.md'))}`);

#!/usr/bin/env node
/**
 * 义项提示筛选：给一批候选词（如日语同形异义词）自动写样本、测现版错误率、加提示复测，
 * 输出哪些值得落地到 providers.js 与后台 hosted.js 的 senseHints。只在开发时运行，不进扩展安装包。
 *
 * 流程（详见 docs/extension/translation-eval.md）：
 *   1. 由 deepseek-flash 为每个候选写正例（容易译错的义项）、网页片段和反例（照字面译本来就对的义项）；
 *   2. 调 run.mjs 用现版翻译，再逐条请评审只判断这个词译对没有；
 *   3. 现版错得够多的候选，调 run.mjs 对比「加这条提示」与现版（整句盲评），再判一次词义；
 *   4. 写报告：建议落地 / 不需要 / 无效 / 有副作用，并给出可粘贴的代码行。落地仍由人决定。
 * 所有请求都带缓存（样本生成与词义判断在 dist/eval/sense-cache.json，翻译与盲评在 run.mjs 的缓存），重跑不花钱。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repo = path.resolve(root, '../..');

const argv = process.argv.slice(2);
const arg = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const flag = (name) => argv.includes(name);
const list = (value) => (value ? value.split(',').map((item) => item.trim()).filter(Boolean) : []);

if (flag('--help') || flag('-h')) {
  console.log([
    '用法：npm run eval:sense -- [选项]',
    '  --candidates 文件   候选清单（默认 apps/extension/eval/sense-candidates.json）',
    '  --ids a,b           只跑指定候选',
    '  --limit N           最多跑 N 个候选',
    '  --positives N       每个候选的整段正例条数（默认 4，另有 1 组网页片段）',
    '  --min-errors N      现版在正例里至少错几条才试提示（默认 2）',
    '  --concurrency N     并发数（默认 6）',
  ].join('\n'));
  process.exit(0);
}

/* ------------------------------------------------------------ 配置与缓存 */

// 环境文件按文本解析，不执行；查找顺序与 run.mjs 相同
const config = { ...process.env };
const envPath = [path.join(root, '.env.local'), path.join(repo, '.env.local')].find((file) => fs.existsSync(file));
if (envPath) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) continue;
    config[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
if (!config.DEEPSEEK_API_KEY) {
  console.error('需要 DEEPSEEK_API_KEY（.env.local 或进程环境）。');
  process.exit(1);
}
// 写样本与判词义都用评审模型（默认 deepseek-flash，不用 deepseek-v4-pro）
const judge = {
  key: config.JUDGE_API_KEY || config.DEEPSEEK_API_KEY,
  baseUrl: (config.JUDGE_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
  model: config.JUDGE_MODEL || 'deepseek-flash',
};
const positives = Math.max(1, Number(arg('--positives')) || 4);
const minErrors = arg('--min-errors') === undefined ? 2 : Math.max(0, Number(arg('--min-errors')) || 0);
const concurrency = Math.max(1, Number(arg('--concurrency')) || 6);

const outRoot = path.join(repo, 'dist', 'eval');
fs.mkdirSync(outRoot, { recursive: true });
const cachePath = path.join(outRoot, 'sense-cache.json');
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
const stats = { requests: 0, cached: 0 };

async function ask(system, user, { thinking = false, temperature } = {}) {
  const body = { model: judge.model, stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
  if (/deepseek/i.test(judge.baseUrl)) body.thinking = { type: thinking ? 'enabled' : 'disabled' };
  if (temperature !== undefined) body.temperature = temperature;
  const text = JSON.stringify(body);
  const key = crypto.createHash('sha256').update(`${judge.baseUrl}\n${text}`).digest('hex');
  if (cache[key]) {
    stats.cached += 1;
    return cache[key];
  }
  stats.requests += 1;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${judge.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${judge.key}` },
      body: text,
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new Error(`请求失败（${response.status}）${(await response.text()).slice(0, 200)}`);
    const content = String((await response.json())?.choices?.[0]?.message?.content || '');
    cache[key] = content;
    return content;
  }
}

function json(content) {
  const text = String(content || '').replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('没有返回 JSON');
  return JSON.parse(text.slice(start, end + 1));
}

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

/* ------------------------------------------------------------ 候选 */

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let candidates = JSON.parse(fs.readFileSync(path.resolve(arg('--candidates') || path.join(here, 'sense-candidates.json')), 'utf8'));
const onlyIds = list(arg('--ids'));
if (onlyIds.length) candidates = candidates.filter((candidate) => onlyIds.includes(candidate.id));
if (arg('--limit')) candidates = candidates.slice(0, Number(arg('--limit')));
if (!candidates.length) {
  console.error('没有符合条件的候选。');
  process.exit(1);
}
for (const candidate of candidates) {
  for (const field of ['id', 'from', 'word', 'sense', 'trap']) {
    if (!candidate[field]) throw new Error(`候选 ${candidate.id || candidate.word} 缺少 ${field}`);
  }
  candidate.regex = new RegExp(candidate.pattern || escape(candidate.word), 'u');
  // 提示词默认按模板写；候选里写了 hint 就用候选的
  candidate.hint ||= candidate.negative
    ? `${candidate.word} 在日语里多指「${candidate.sense}」，不是中文的「${candidate.trap}」；表示「${candidate.negative}」时照常译。按上下文判断。`
    : `${candidate.word} 在日语里是「${candidate.sense}」的意思，不是中文的「${candidate.trap}」。按上下文判断。`;
}

/* ------------------------------------------------------------ 1. 写样本 */

const LANG = { ja: '日语', en: '英语', ko: '韩语' };

function samplePrompt(candidate) {
  const lang = LANG[candidate.from] || candidate.from;
  return [
    `你在为翻译评测写${lang}例句。例句要像真实的网页、商品说明、新闻、论坛帖子、聊天或工作邮件，自然、口语或书面都可以，一到两句话。`,
    `每句都必须原样包含「${candidate.word}」这几个字（可以带活用或后缀），不要解释这个词，不要夹带中文。不同例句换不同的场景和体裁。`,
    '只输出一个 JSON 对象，不要输出别的内容。',
  ].join('\n');
}

function sampleRequest(candidate) {
  const parts = [
    `词：${candidate.word}`,
    `positives：写 ${positives} 句，「${candidate.word}」在句中的意思是「${candidate.sense}」。`,
    `fragments：再写 1 句同样意思的句子，按网页上被链接或加粗切开的样子拆成 2 到 3 段，「${candidate.word}」落在其中一段里，各段按顺序连起来正好是原句。`,
  ];
  if (candidate.negative) parts.push(`negatives：写 2 句，「${candidate.word}」在句中的意思是「${candidate.negative}」。`);
  parts.push(`格式：{"positives":[{"genre":"shop|news|forum|chat|email","text":"..."}],"fragments":["...","..."]${candidate.negative ? ',"negatives":[{"genre":"...","text":"..."}]' : ''}}`);
  return parts.join('\n');
}

async function writeSamples(candidate) {
  const data = json(await ask(samplePrompt(candidate), sampleRequest(candidate), { temperature: 1.0 }));
  const has = (text) => typeof text === 'string' && candidate.regex.test(text);
  const out = [];
  const add = (polarity, item, index) => {
    if (!has(item?.text)) return;
    out.push({ id: `${candidate.id}-${polarity === 'pos' ? 'p' : 'n'}${index + 1}`, from: candidate.from, genre: item.genre || 'misc', text: item.text.trim(),
      candidate: candidate.id, polarity, sense: polarity === 'pos' ? candidate.sense : candidate.negative,
      watch: `${candidate.word}：${polarity === 'pos' ? candidate.sense : candidate.negative}` });
  };
  (data.positives || []).slice(0, positives).forEach((item, index) => add('pos', item, index));
  const fragments = Array.isArray(data.fragments) ? data.fragments.filter((item) => typeof item === 'string' && item) : [];
  if (fragments.length >= 2 && has(fragments.join(''))) {
    out.push({ id: `${candidate.id}-f1`, from: candidate.from, genre: 'web', mode: 'batch', texts: fragments,
      candidate: candidate.id, polarity: 'pos', sense: candidate.sense, watch: `${candidate.word}：${candidate.sense}（网页片段）` });
  }
  if (candidate.negative) (data.negatives || []).slice(0, 2).forEach((item, index) => add('neg', item, index));
  return out;
}

/* ------------------------------------------------------------ 2. 调 run.mjs 翻译与盲评 */

function runEval(samplesFile, variants, ids, extraEnv = {}) {
  const args = [path.join(here, 'run.mjs'), '--samples', samplesFile, '--variants', variants, '--concurrency', String(concurrency)];
  if (ids) args.push('--ids', ids.join(','));
  if (!variants.includes(',')) args.push('--no-judge');
  const result = spawnSync(process.execPath, args, { cwd: repo, env: { ...process.env, ...extraEnv }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const report = result.stdout.match(/报告：(.+report\.md)/)?.[1];
  if (result.status !== 0 || !report) {
    console.error(result.stdout.slice(-2000), result.stderr.slice(-2000));
    throw new Error(`run.mjs 失败（${variants}）`);
  }
  const lines = result.stdout.split('\n').filter((line) => /请求|对比|失败/.test(line) && !/^翻译 /.test(line));
  for (const line of lines) console.log(`  ${line.replace(/^.*\r/, '')}`);
  return { ...JSON.parse(fs.readFileSync(path.join(repo, path.dirname(report), 'results.json'), 'utf8')), report };
}

/* ------------------------------------------------------------ 3. 判词义 */

const CHECK_PROMPT = [
  '你是日译中审校。下面给出一段原文、其中一个词在这里的意思，以及中文译文。',
  '只判断这个词的意思在译文里有没有译对，不管译文其他地方好不好。',
  '把它译成中文里字形相同或相近、但意思不同的词（例如把「手紙」译成“手纸”、把「検討」译成“检讨”），算错。',
  '意思译对了，即使换了说法、意译，或者融进句子里没有单独对应的词，也算对。',
  '只输出一个 JSON 对象：{"ok":true|false,"rendering":"译文里对应的说法","reason":"一句话"}',
].join('\n');

const showSource = (sample) => (sample.mode === 'batch' ? sample.texts.map((item, index) => `${index + 1}. ${item}`).join('\n') : sample.text);
const showOutput = (sample, output) => (Array.isArray(output) ? output.map((item, index) => `${index + 1}. ${item}`).join('\n') : String(output));

// 判断失败（评审没返回可用的 JSON）的不算错也不算对，在报告里单列
const wrong = (result) => !result.ok && !result.failed;

async function check(sample, candidate, output) {
  if (output === undefined || output === null) return { ok: false, rendering: '', reason: '翻译失败', failed: true };
  const user = [`【原文】\n${showSource(sample)}`, `【词】${candidate.word}`, `【在这里的意思】${sample.sense}`, `【译文】\n${showOutput(sample, output)}`].join('\n\n');
  try {
    const data = json(await ask(CHECK_PROMPT, user, { thinking: true }));
    return { ok: data.ok === true, rendering: String(data.rendering || ''), reason: String(data.reason || '') };
  } catch (err) {
    return { ok: false, rendering: '', reason: `判断失败：${err.message}`, failed: true };
  }
}

/* ------------------------------------------------------------ 运行 */

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(outRoot, 'sense', stamp);
fs.mkdirSync(outDir, { recursive: true });
const saveCache = () => fs.writeFileSync(cachePath, JSON.stringify(cache));

console.log(`候选 ${candidates.length} 个；写样本…`);
const written = await pool(candidates, async (candidate) => {
  try {
    return await writeSamples(candidate);
  } catch (err) {
    console.log(`  ${candidate.id}：写样本失败（${err.message}）`);
    return [];
  }
});
saveCache();
const samples = written.flat();
const samplesFile = path.join(outDir, 'samples.json');
fs.writeFileSync(samplesFile, JSON.stringify(samples.map(({ candidate, polarity, sense, ...rest }) => ({ ...rest, candidate, polarity, sense })), null, 2));
console.log(`样本 ${samples.length} 条（${path.relative(repo, samplesFile)}）；现版翻译…`);

const byId = Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate]));
const base = runEval(samplesFile, 'baseline');
const baseOut = Object.fromEntries(base.rows.map((row) => [row.sample.id, row.outputs.baseline]));
console.log('判断现版词义…');
const baseCheck = Object.fromEntries(await pool(samples, async (sample) =>
  [sample.id, await check(sample, byId[sample.candidate], baseOut[sample.id]?.output)]));
saveCache();

const results = candidates.map((candidate) => {
  const own = samples.filter((sample) => sample.candidate === candidate.id);
  const pos = own.filter((sample) => sample.polarity === 'pos');
  const neg = own.filter((sample) => sample.polarity === 'neg');
  return { candidate, own, pos, neg, baseErrors: pos.filter((sample) => wrong(baseCheck[sample.id])).length };
});

const trying = results.filter((result) => result.pos.length && result.baseErrors >= minErrors);
let hinted = null;
const hintCheck = {};
if (trying.length) {
  console.log(`现版正例错 ${minErrors} 条及以上的候选 ${trying.length} 个，加提示对比…`);
  const rulesFile = path.join(outDir, 'hints.json');
  fs.writeFileSync(rulesFile, JSON.stringify(Object.fromEntries(trying.map(({ candidate }) =>
    [candidate.id, { pattern: candidate.regex.source, hint: candidate.hint }])), null, 2));
  hinted = runEval(samplesFile, 'baseline,sense-candidate', trying.flatMap((result) => result.own.map((sample) => sample.id)), { SENSE_HINTS_FILE: rulesFile });
  const rows = Object.fromEntries(hinted.rows.map((row) => [row.sample.id, row]));
  console.log('判断加提示后的词义…');
  await pool(trying.flatMap((result) => result.own), async (sample) => {
    const row = rows[sample.id];
    hintCheck[sample.id] = { output: row.outputs['sense-candidate'], verdict: row.verdicts['sense-candidate'],
      check: await check(sample, byId[sample.candidate], row.outputs['sense-candidate']?.output) };
  });
  saveCache();
}

for (const result of results) {
  const { pos, neg } = result;
  if (!pos.length) { result.status = '样本不足'; continue; }
  if (result.baseErrors < minErrors) { result.status = '不需要'; continue; }
  result.hintErrors = pos.filter((sample) => wrong(hintCheck[sample.id].check)).length;
  result.negBase = neg.filter((sample) => wrong(baseCheck[sample.id])).length;
  result.negHint = neg.filter((sample) => wrong(hintCheck[sample.id].check)).length;
  const verdicts = result.own.map((sample) => hintCheck[sample.id].verdict).filter((verdict) => verdict && !verdict.error);
  result.duel = {
    win: verdicts.filter((verdict) => verdict.winner === 'candidate').length,
    tie: verdicts.filter((verdict) => verdict.winner === 'tie').length,
    loss: verdicts.filter((verdict) => verdict.winner === 'control').length,
  };
  if (result.negHint > result.negBase || result.duel.loss > result.duel.win) result.status = '有副作用';
  else if (result.hintErrors < result.baseErrors && result.hintErrors <= 1) result.status = '建议落地';
  else result.status = '无效';
}

/* ------------------------------------------------------------ 报告 */

const regexLiteral = (regex) => `/${regex.source.replace(/\//g, '\\/')}/`;
const quote = (text) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const md = [`# 义项提示筛选 ${stamp}`, ''];
md.push(`- 候选 ${candidates.length} 个，样本 ${samples.length} 条（每个候选 ${positives} 条整段正例、1 组网页片段，有反例义项的另加 2 条反例）`);
md.push(`- 翻译走扩展的自带 Key 路径（DeepSeek，目标简体中文），写样本、判词义与整句盲评用 \`${judge.model}\``);
md.push(`- 现版在正例里错 ${minErrors} 条及以上才试提示；「建议落地」要求加提示后正例最多错 1 条且比现版少、反例不变差、整句盲评负不多于胜`);
md.push(`- 翻译明细：现版 \`${base.report}\`${hinted ? `，加提示对比 \`${hinted.report}\`` : ''}`, '');
md.push('| 候选 | 词 | 正例 | 现版错 | 加提示后错 | 反例错（现版 → 提示） | 盲评 胜/平/负 | 判断失败 | 结论 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
const order = { 建议落地: 0, 有副作用: 1, 无效: 2, 不需要: 3, 样本不足: 4 };
const sorted = [...results].sort((a, b) => order[a.status] - order[b.status] || b.baseErrors - a.baseErrors);
for (const result of sorted) {
  const { candidate } = result;
  const tried = result.hintErrors !== undefined;
  const unsure = result.own.filter((sample) => baseCheck[sample.id].failed || hintCheck[sample.id]?.check.failed).length;
  md.push(`| \`${candidate.id}\` | ${candidate.word} | ${result.pos.length} | ${result.baseErrors} | ${tried ? result.hintErrors : '—'} | ${tried && result.neg.length ? `${result.negBase} → ${result.negHint}` : '—'} | ${tried ? `${result.duel.win} / ${result.duel.tie} / ${result.duel.loss}` : '—'} | ${unsure || ''} | ${result.status} |`);
}
const landing = sorted.filter((result) => result.status === '建议落地');
if (landing.length) {
  md.push('', '## 建议落地', '', '逐条读下面的译文确认后，把这几行同时加到扩展 `providers.js` 与后台 `hosted.js` 的 `senseHints`：', '', '```js');
  for (const { candidate } of landing) md.push(`      [${regexLiteral(candidate.regex)}, ${quote(candidate.hint)}],`);
  md.push('```');
}
md.push('', '## 逐条', '');
for (const result of sorted) {
  const { candidate } = result;
  md.push(`### ${candidate.word}（\`${candidate.id}\`）：${result.status}`, '');
  md.push(`- 易错义项：${candidate.sense}；不是：${candidate.trap}${candidate.negative ? `；反例义项：${candidate.negative}` : ''}`);
  md.push(`- 提示：${candidate.hint}`, '');
  for (const sample of result.own) {
    const b = baseCheck[sample.id];
    md.push(`**${sample.id}**（${sample.polarity === 'pos' ? '正例' : '反例'}）`, '', showSource(sample).split('\n').map((line) => `> ${line}`).join('\n'), '');
    md.push(`- 现版${b.ok ? '✓' : b.failed ? '?' : '✗'}：${showOutput(sample, baseOut[sample.id]?.output ?? '（失败）').replace(/\n/g, ' / ')}　〔${b.rendering}〕${b.ok ? '' : b.reason}`);
    const h = hintCheck[sample.id];
    if (h) {
      const word = { candidate: '提示更好', control: '现版更好', tie: '持平' }[h.verdict?.winner] || '评审失败';
      md.push(`- 提示${h.check.ok ? '✓' : h.check.failed ? '?' : '✗'}：${showOutput(sample, h.output?.output ?? '（失败）').replace(/\n/g, ' / ')}　〔${h.check.rendering}〕${h.check.ok ? '' : h.check.reason}`);
      md.push(`- 盲评：${word}${h.verdict?.reason ? `　${h.verdict.reason}` : ''}`);
    }
    md.push('');
  }
}
fs.writeFileSync(path.join(outDir, 'report.md'), `${md.join('\n')}\n`);
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(sorted.map((result) => ({
  id: result.candidate.id, word: result.candidate.word, status: result.status, baseErrors: result.baseErrors, hintErrors: result.hintErrors,
  negBase: result.negBase, negHint: result.negHint, duel: result.duel, hint: result.candidate.hint, pattern: result.candidate.regex.source,
})), null, 2));

const count = (status) => results.filter((result) => result.status === status).length;
console.log(`建议落地 ${count('建议落地')}，有副作用 ${count('有副作用')}，无效 ${count('无效')}，不需要 ${count('不需要')}，样本不足 ${count('样本不足')}`);
console.log(`写样本与判词义：请求 ${stats.requests} 次，命中缓存 ${stats.cached} 次`);
console.log(`报告：${path.relative(repo, path.join(outDir, 'report.md'))}`);

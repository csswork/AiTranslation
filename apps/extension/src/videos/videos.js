/**
 * 「视频翻译」页（见 docs/extension/video-file-translation.md）：翻好的视频列表、播放器和整篇双语字幕，
 * 以及正在翻的视频与进度。记录来自 lib/video-library.js（本机 IndexedDB），进度问后台（video-file-jobs）。
 * 地址里的 #id 选中那一条（右下角卡片、浮层的「新页面看」都这样打开）。
 */
(() => {
  const t = (...args) => AITrI18n.t(...args);
  const Library = globalThis.AITrVideoLibrary;
  const $ = (id) => document.getElementById(id);
  const el = {
    runningWrap: $('runningWrap'), running: $('running'), list: $('list'), empty: $('empty'),
    detail: $('detail'), placeholder: $('placeholder'), video: $('video'),
    caption: $('caption'), captionTr: $('captionTr'), captionOrig: $('captionOrig'),
    title: $('title'), titleOrig: $('titleOrig'), info: $('info'), source: $('source'), warning: $('warning'), fileNote: $('fileNote'),
    remove: $('remove'), cues: $('cues'),
  };

  // 粘在顶部的播放器有多高：字幕列表滚到当前句时留出这段（见 videos.css 的 scroll-margin-top）
  new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty('--stage-h', `${Math.round(entry.target.getBoundingClientRect().height)}px`);
  }).observe($('stage'));

  let entries = [];
  let current = null;
  let objectUrl = '';
  let lastCue = -2;
  let runningIds = '';

  const clock = (ms) => {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const safeUrl = (url) => (/^https?:\/\//i.test(String(url || '')) ? url : '');
  /** 标题有译文且与原文不同时：译文为主，原文在下面小字。 */
  const titles = (entry) => {
    const orig = entry.title || '';
    const tr = entry.titleTr && entry.titleTr !== orig ? entry.titleTr : '';
    return { main: tr || orig || t("视频"), orig: tr ? orig : '' };
  };
  const node = (tag, className, text) => {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text != null) { item.textContent = text; item.dir = 'auto'; }
    return item;
  };

  function renderList() {
    el.empty.hidden = entries.length > 0;
    el.list.replaceChildren(...entries.map((entry) => {
      const li = document.createElement('li');
      const button = node('button', 'item');
      button.type = 'button';
      button.setAttribute('aria-current', String(entry.id === current?.id));
      const when = new Date(entry.createdAt).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const name = titles(entry);
      button.title = name.orig;
      button.append(node('span', 'name', name.main),
        node('span', 'when', t("$1 · $2 · $3 句", [when, clock(entry.duration), entry.cues?.length || 0])));
      button.addEventListener('click', () => { location.hash = entry.id; });
      li.append(button);
      return li;
    }));
  }

  /** 正在翻的视频：每秒问一次后台；有一条翻完了就重读列表。 */
  function progressText(p) {
    if (!p) return t("准备中…");
    switch (p.phase) {
      case 'download': return t("正在读取视频…");
      case 'decode': return t("正在提取声音…");
      case 'recognize':
        return p.mode === 'audio' ? t("正在由 OpenAI 识别语音…")
          : t("正在按$1识别语音（$2 / $3 秒）…", [p.lang || '', Math.round((p.done || 0) / 1000), Math.round((p.total || 0) / 1000)]);
      case 'detect': return t("正在判断视频说的是什么语言（试听：$1）…", [(p.langs || []).join('、')]);
      case 'translate': return t("正在翻译字幕…");
      default: return t("准备中…");
    }
  }

  /** 等用户选语言的那一路：装了语言包的可选，没装的灰掉。 */
  function picker(job) {
    const wrap = node('div', 'pick');
    const select = document.createElement('select');
    select.setAttribute('aria-label', t("视频说的语言"));
    const { options = [], guess = '' } = job.needLang;
    for (const item of options) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.installed ? item.label : t("$1（还没下载语言包）", [item.label]);
      option.disabled = !item.installed;
      select.append(option);
    }
    const usable = options.filter((item) => item.installed);
    select.value = usable.some((item) => item.id === guess) ? guess : usable[0]?.id || '';
    const go = node('button', 'btn small primary', t("开始识别"));
    go.type = 'button';
    go.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'video-file-choose', id: job.id, lang: select.value }).then(pollRunning, () => {}));
    const more = node('a', 'more', t("下载更多语言包"));
    more.href = '../options/options.html#video';
    more.target = '_blank';
    wrap.append(select, go, more);
    return wrap;
  }

  /** 正在翻的每一条只在状态变了时重画，免得每秒刷新把用户正在选的下拉框冲掉。 */
  const jobRows = new Map();
  function jobRow(job) {
    const p = job.progress;
    const sig = JSON.stringify([job.title, Boolean(job.needLang), p?.phase, p?.langs, p?.lang, Math.round((p?.done || 0) / 1000), Math.round((p?.loaded || 0) / 1e5)]);
    const known = jobRows.get(job.id);
    if (known && known.sig === sig) return known.li;
    const li = document.createElement('li');
    const box = node('div', 'item job');
    const row = node('div', 'row');
    const cancel = node('button', 'btn small', t("取消"));
    cancel.type = 'button';
    cancel.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'video-file-cancel', id: job.id }).then(pollRunning, () => {}));
    row.append(node('span', 'name', job.title || t("视频")), cancel);
    box.append(row);
    if (job.needLang) {
      box.append(node('span', 'state', t("听不出视频说的是什么语言，请选一个：")), picker(job));
    } else {
      const track = node('div', 'track');
      const fill = document.createElement('i');
      const ratio = (p?.phase === 'recognize' || p?.phase === 'detect') && p.mode !== 'audio' && p.total ? p.done / p.total
        : p?.phase === 'download' && p.total ? p.loaded / p.total : p?.phase === 'translate' ? 1 : 0;
      fill.style.width = `${Math.round(Math.min(1, ratio) * 100)}%`;
      track.append(fill);
      box.append(node('span', 'state', progressText(p)), track);
    }
    li.append(box);
    jobRows.set(job.id, { sig, li });
    return li;
  }

  async function pollRunning() {
    let jobs = [];
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'video-file-jobs' });
      jobs = reply?.jobs || [];
    } catch {
      /* 后台正在重启 */
    }
    el.runningWrap.hidden = jobs.length === 0;
    const rows = jobs.map(jobRow);
    for (const id of [...jobRows.keys()]) if (!jobs.some((job) => job.id === id)) jobRows.delete(id);
    if (rows.length !== el.running.children.length || rows.some((li, i) => el.running.children[i] !== li)) el.running.replaceChildren(...rows);
    const ids = jobs.map((job) => job.id).join(',');
    if (ids !== runningIds) {
      const finished = runningIds && runningIds.split(',').some((id) => !ids.includes(id));
      runningIds = ids;
      if (finished) await load();
    }
  }

  function showCaption() {
    if (!current) return;
    const ms = el.video.currentTime * 1000;
    const index = current.cues.findIndex((cue) => ms >= cue.start && ms < cue.end);
    if (index === lastCue) return;
    lastCue = index;
    const cue = current.cues[index];
    el.caption.hidden = !cue;
    el.captionTr.textContent = cue?.tr || '';
    el.captionOrig.textContent = cue && cue.text !== cue.tr ? cue.text : '';
    [...el.cues.children].forEach((li, i) => li.firstChild.classList.toggle('on', i === index));
    // 播放时让当前句留在列表可见处
    if (cue && !el.video.paused) el.cues.children[index]?.firstChild.scrollIntoView({ block: 'nearest' });
  }

  async function select(id) {
    const entry = entries.find((item) => item.id === id) || null;
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = ''; }
    current = entry;
    lastCue = -2;
    renderList();
    el.detail.hidden = !entry;
    el.placeholder.hidden = Boolean(entry);
    if (!entry) { el.video.removeAttribute('src'); el.video.load(); return; }

    const name = titles(entry);
    document.title = `${name.main} · ${t("视频翻译")}`;
    el.title.textContent = name.main;
    el.titleOrig.textContent = name.orig;
    el.titleOrig.hidden = !name.orig;
    el.info.textContent = t("$1 · 共 $2 句", [clock(entry.duration), entry.cues.length]);
    const page = safeUrl(entry.pageUrl) || safeUrl(entry.srcUrl);
    el.source.hidden = !page;
    if (page) el.source.href = page;
    el.warning.hidden = !entry.warning;
    el.warning.textContent = entry.warning || '';

    const blob = await Library.getFile(entry.id).catch(() => null);
    if (current !== entry) return;
    objectUrl = blob ? URL.createObjectURL(blob) : '';
    el.fileNote.hidden = Boolean(blob);
    el.video.src = objectUrl || safeUrl(entry.srcUrl);

    el.cues.replaceChildren(...entry.cues.map((cue) => {
      const li = document.createElement('li');
      const button = node('button', 'cue');
      button.type = 'button';
      const text = node('span', 'body');
      text.append(node('div', 'tr', cue.tr));
      if (cue.text && cue.text !== cue.tr) text.append(node('div', 'orig', cue.text));
      button.append(node('span', 't', clock(cue.start)), text);
      button.addEventListener('click', () => {
        el.video.currentTime = cue.start / 1000;
        el.video.play().catch(() => {});
      });
      li.append(button);
      return li;
    }));
    showCaption();
  }

  async function load() {
    entries = await Library.list().catch(() => []);
    const id = decodeURIComponent(location.hash.slice(1));
    await select(entries.some((entry) => entry.id === id) ? id : current?.id && entries.some((e) => e.id === current.id) ? current.id : entries[0]?.id || '');
  }

  // 删除要点两下：第一下变成「确定删除」，几秒内再点才删
  let confirmTimer = 0;
  el.remove.addEventListener('click', async () => {
    if (!current) return;
    if (!el.remove.classList.contains('danger')) {
      el.remove.classList.add('danger');
      el.remove.textContent = t("确定删除");
      confirmTimer = setTimeout(() => { el.remove.classList.remove('danger'); el.remove.textContent = t("删除"); }, 4000);
      return;
    }
    clearTimeout(confirmTimer);
    el.remove.classList.remove('danger');
    el.remove.textContent = t("删除");
    await Library.remove(current.id).catch(() => {});
    current = null;
    history.replaceState(null, '', location.pathname);
    await load();
  });

  el.video.addEventListener('timeupdate', showCaption);
  el.video.addEventListener('seeked', showCaption);
  const tick = () => { if (!el.video.paused) showCaption(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.addEventListener('hashchange', () => select(decodeURIComponent(location.hash.slice(1))));

  AITrI18n.ready.then(async () => {
    await load();
    await pollRunning();
    setInterval(pollRunning, 1000);
  });
})();

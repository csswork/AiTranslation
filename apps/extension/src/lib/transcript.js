/**
 * 整份视频翻译（见 docs/extension/video-file-translation.md）的文稿工具：不碰网络与浏览器界面的纯函数，
 * offscreen 文档（取文件、识别）与 service worker（切字幕句、翻译）共用，便于单独测试。
 * 与 lang.js 等一样不能使用 import / export。
 *
 * 文稿统一成「带时间的词」：[{ text, start, end? }]，时间是视频里的毫秒。
 * 设备端识别没有词级时间，按每个词第一次出现在中间结果里的时刻推算（timedTokens）；
 * OpenAI 转写自带词级时间（fromWhisper）。
 */
(() => {
  if (globalThis.AITrTranscript) return;

  /** 书写时词与词之间不加空格的语言。 */
  const UNSPACED = /^(zh|ja|th|lo|km|my|bo)\b/i;
  const unspaced = (lang) => UNSPACED.test(String(lang || ''));
  /** 设备端识别从听到到出字的延迟（2026-10 实测首字约 0.76 秒）。 */
  const LATENCY_MS = 700;

  const segmenters = new Map();
  /** 拆成词：有 Intl.Segmenter 时按语言分词（中日文按词，不按空格），否则按空白切。 */
  function tokenize(text, lang) {
    const value = String(text || '').trim();
    if (!value) return [];
    if (typeof Intl?.Segmenter === 'function') {
      const key = String(lang || 'en');
      let seg = segmenters.get(key);
      if (!seg) {
        try { seg = new Intl.Segmenter(key, { granularity: 'word' }); } catch { seg = new Intl.Segmenter('en', { granularity: 'word' }); }
        segmenters.set(key, seg);
      }
      return [...seg.segment(value)].filter((s) => s.isWordLike).map((s) => s.segment);
    }
    return value.split(/\s+/).filter(Boolean);
  }

  /** 把一段词拼回文字：有空格的语言用空格连，中日文直接相连。 */
  function joinTokens(tokens, lang) {
    return tokens.map((t) => (typeof t === 'string' ? t : t.text)).join(unspaced(lang) ? '' : ' ').trim();
  }

  /**
   * 由设备端识别的中间结果还原每个词的时间。
   * log 按到达顺序排列，每项 [round, index, t, text]：round 是识别器重启的轮次，index 是这一轮里的结果序号，
   * t 是从开始播放算起的毫秒，text 是这条结果当前的整句。rate 是播放倍速（目前只用 1）。
   */
  function timedTokens(log, { lang = 'en', latency = LATENCY_MS, rate = 1 } = {}) {
    const hyp = new Map();
    const counts = new Map();
    const times = [];
    let total = 0;
    for (const [round, index, t, text] of log) {
      const key = `${round}:${index}`;
      hyp.set(key, String(text || ''));
      const count = tokenize(text, lang).length;
      total += count - (counts.get(key) || 0);
      counts.set(key, count);
      const at = Math.max(0, (Number(t) - latency) * rate);
      while (times.length < total) times.push(at);
    }
    const order = [...hyp.keys()].sort((a, b) => {
      const [r1, i1] = a.split(':').map(Number);
      const [r2, i2] = b.split(':').map(Number);
      return r1 - r2 || i1 - i2;
    });
    const words = order.flatMap((key) => tokenize(hyp.get(key), lang));
    let last = 0;
    return words.map((text, i) => {
      // 识别器改口时词数会忽多忽少，取不到时间的沿用前一个词的
      const start = Math.max(last, times[i] ?? last);
      last = start;
      return { text, start };
    });
  }

  /** 每个词的结束时间：有就用，没有就到下一个词开始（最多 0.8 秒）。 */
  function endOf(tokens, i, duration) {
    const token = tokens[i];
    if (Number.isFinite(token.end)) return token.end;
    const next = tokens[i + 1]?.start;
    return Math.min(next ?? Infinity, token.start + 800, duration ?? Infinity);
  }

  const SENTENCE_END = /[.!?。！？…]["'”’）)]?$/;

  /**
   * 不靠模型的切句（DeepL、本机翻译、点数翻译用）：词间停顿超过 gapMs、句末标点、或到了长度上限就切。
   * 返回 [{ from, to }]（含两端的词序号）。
   */
  function splitCues(tokens, { lang = 'en', gapMs = 900, maxWords } = {}) {
    if (!tokens.length) return [];
    const limit = maxWords || (unspaced(lang) ? 18 : 12);
    const cues = [];
    let from = 0;
    for (let i = 1; i <= tokens.length; i += 1) {
      const size = i - from;
      const end = i === tokens.length
        || tokens[i].start - tokens[i - 1].start > gapMs
        || SENTENCE_END.test(tokens[i - 1].text)
        || size >= limit;
      if (end) {
        cues.push({ from, to: i - 1 });
        from = i;
      }
    }
    // 只有一两个词的尾巴并进前一句（不超过上限的一半多一点）
    const merged = [];
    for (const cue of cues) {
      const prev = merged[merged.length - 1];
      const size = cue.to - cue.from + 1;
      if (prev && size <= 2 && prev.to - prev.from + 1 + size <= limit + 3
        && tokens[cue.from].start - tokens[prev.to].start <= gapMs * 2) prev.to = cue.to;
      else merged.push({ ...cue });
    }
    return merged;
  }

  /**
   * 字幕句的显示时间：从第一个词开始，到下一句开始或最后一个词结束后 0.8 秒；至少显示 1.2 秒，不越过下一句。
   * 识别器在音频放完后才吐出的词时间会落在片尾之后，这类句子挪回片尾前 1.2 秒内，否则永远播不到。
   */
  function cueTimes(tokens, ranges, duration) {
    const total = Number.isFinite(duration) ? duration : Infinity;
    const latest = Math.max(0, total - 1200);
    const starts = [];
    for (const range of ranges) {
      const prev = starts.length ? starts[starts.length - 1] + 1 : 0;
      starts.push(Math.max(prev, Math.min(tokens[range.from].start, latest)));
    }
    return ranges.map((range, i) => {
      const start = starts[i];
      const next = i + 1 < starts.length ? starts[i + 1] : total;
      const last = endOf(tokens, range.to, total);
      const end = Math.min(next, total, Math.max(last + 800, start + 1200));
      return { ...range, start, end: Math.max(end, start + 1) };
    });
  }

  /**
   * 交给模型的文稿：[[序号, 词], …]，模型按序号范围切句，不用抄原文，对齐不会错位。
   * 不带时间：设备端识别的词时间按结果到达的批次推算，词间的「停顿」大多是识别器的节奏而不是说话的停顿
   * （探针里 0.6–0.9 秒的间隔一半落在句子中间），给模型只会误导。
   */
  const promptTokens = (tokens) => tokens.map((t, i) => [i, t.text]);

  const shapeError = (message) => Object.assign(new Error(message), { shape: true });

  function stripJson(content) {
    let text = String(content || '').trim();
    const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (fence) text = fence[1].trim();
    const start = text.search(/[[{]/);
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    return start >= 0 && end > start ? text.slice(start, end + 1) : text;
  }

  /**
   * 解析模型切句 + 翻译的回复：{ lang, garbled, cues: [{ from, to, text, tr }] }。
   * 序号必须是整数、在范围内、按顺序且互不重叠（中间可以跳过语气词）；不合格就抛 shape 错误，由调用方退回不靠模型的切句。
   * lang、garbled 是模型对说话语言与识别结果是否读不通的判断，缺了不算错。
   */
  function parseCueReply(content, count) {
    let data;
    try { data = JSON.parse(stripJson(content)); } catch { throw shapeError('Reply is not JSON'); }
    const list = Array.isArray(data) ? data : data?.cues;
    if (!Array.isArray(list) || !list.length) throw shapeError('Reply has no cues');
    let prev = -1;
    const cues = list.map((item) => {
      const from = Number(item?.from);
      const to = Number(item?.to);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from > to || from <= prev || to >= count) {
        throw shapeError('Cue range is invalid');
      }
      prev = to;
      const tr = typeof item.tr === 'string' ? item.tr.trim() : '';
      if (!tr) throw shapeError('Cue has no translation');
      return { from, to, text: typeof item.text === 'string' ? item.text.trim() : '', tr };
    });
    const lang = typeof data?.lang === 'string' && /^[a-z]{2,3}$/i.test(data.lang.trim()) ? data.lang.trim().toLowerCase() : '';
    return { cues, lang, garbled: typeof data?.garbled === 'boolean' ? data.garbled : undefined };
  }

  /** 按词数把长文稿切成几段分别请求：切在停顿最长的地方，每段不超过 max 个词。 */
  function chunkTokens(tokens, max = 600) {
    const chunks = [];
    let from = 0;
    while (tokens.length - from > max) {
      let cut = from + max;
      let best = -1;
      for (let i = from + Math.floor(max * 0.6); i < from + max; i += 1) {
        const gap = tokens[i].start - tokens[i - 1].start;
        if (gap > best) { best = gap; cut = i; }
      }
      chunks.push([from, cut]);
      from = cut;
    }
    chunks.push([from, tokens.length]);
    return chunks;
  }

  /** Whisper 的语言名（verbose_json 返回英文全名）→ 语言代码，只用来决定拼接时加不加空格。 */
  const WHISPER_LANGS = { chinese: 'zh', japanese: 'ja', thai: 'th', lao: 'lo', khmer: 'km', burmese: 'my', myanmar: 'my', tibetan: 'bo' };

  /**
   * OpenAI 转写（whisper-1，verbose_json，词级 + 段级时间）→ 带时间的词。
   * 纯音乐、噪声上 Whisper 常编出整句（如 "Thanks for watching"）：段落的无语音概率高且置信度低、
   * 或压缩率过高（反复同一句）时，整段丢掉。阈值沿用 Whisper 自己的默认值。
   */
  function fromWhisper(data) {
    const name = String(data?.language || '').toLowerCase();
    const lang = WHISPER_LANGS[name] || (name.length <= 3 ? name : 'en') || 'en';
    const segments = Array.isArray(data?.segments) ? data.segments : [];
    const bad = segments.filter((s) => (Number(s.no_speech_prob) > 0.6 && Number(s.avg_logprob) < -1)
      || Number(s.compression_ratio) > 2.4 || Number(s.avg_logprob) < -1.5);
    const inBad = (t) => bad.some((s) => t >= Number(s.start) && t < Number(s.end));
    const words = Array.isArray(data?.words) ? data.words : [];
    const tokens = words
      .filter((w) => typeof w?.word === 'string' && w.word.trim() && !inBad(Number(w.start)))
      .map((w) => ({ text: w.word.trim(), start: Math.round(Number(w.start) * 1000), end: Math.round(Number(w.end) * 1000) }))
      .filter((t) => Number.isFinite(t.start));
    return { tokens, lang };
  }

  /** 16 位单声道 WAV（OpenAI 转写接口收得下，16 kHz 时每分钟约 1.9 MB）。 */
  function encodeWav(samples, sampleRate) {
    const bytes = new Uint8Array(44 + samples.length * 2);
    const view = new DataView(bytes.buffer);
    const ascii = (at, s) => { for (let i = 0; i < s.length; i += 1) bytes[at + i] = s.charCodeAt(i); };
    ascii(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, 'data'); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i += 1) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return bytes;
  }

  /** 按文件头认出能取音轨的容器；认不出就不解码（网页、JSON、播放列表等都在这里挡掉）。 */
  function sniffMedia(bytes) {
    const at = (i, list) => list.every((b, k) => bytes[i + k] === b);
    const ascii = (i, s) => at(i, [...s].map((c) => c.charCodeAt(0)));
    if (['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip'].some((box) => ascii(4, box))) return 'video/mp4';
    if (at(0, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
    if (ascii(0, 'OggS')) return 'video/ogg';
    if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav';
    if (ascii(0, 'fLaC')) return 'audio/flac';
    if (ascii(0, 'ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
    return null;
  }

  /** 整段的均方根音量；低于约 -55 dBFS 当作没有声音。 */
  function isSilent(samples, threshold = 0.0018) {
    if (!samples.length) return true;
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length) < threshold;
  }

  /**
   * 不靠模型判断视频说的是哪种语言（DeepL、本机翻译、点数翻译用）：按哪种语言听，识别出的词最密就是哪种。
   * 听错语言时识别器多半只吐出零星几个词（探针：英语视频按中文听，116 秒只出 15 个词，按英语听 371 个）。
   * 最密的也不到每秒 minRate 个词（听不出人说话）、或和第二名差不多，都算判断不了。heard: [{ lang, words }]，ms 是听了多久。
   */
  function judgeByDensity(heard, ms, { minRate = 0.6, margin = 1.5 } = {}) {
    const seconds = Math.max(1, ms / 1000);
    const ranked = heard.map((item) => ({ lang: item.lang, rate: (item.words || 0) / seconds })).sort((a, b) => b.rate - a.rate);
    const [best, second] = ranked;
    if (!best || best.rate < minRate) return '';
    if (second && best.rate < second.rate * margin) return '';
    return best.lang;
  }

  globalThis.AITrTranscript = {
    LATENCY_MS, unspaced, tokenize, joinTokens, timedTokens, splitCues, cueTimes, promptTokens,
    parseCueReply, parseJson: stripJson, chunkTokens, fromWhisper, encodeWav, sniffMedia, isSilent, judgeByDensity,
  };
})();

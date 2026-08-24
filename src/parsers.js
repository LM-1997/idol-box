/**
 * parsers.js — 多格式歌词 / 字幕解析器
 *
 * 统一入口 parseLyrics(text, {format, filename, textInterval})
 * 所有解析器都输出统一的歌词行结构，供 main.js 直接消费：
 *   {
 *     line_id: 'L001',
 *     seconds: 12.34,          // 数值，唯一时间真相
 *     time: '00:12.340',       // 派生显示字段
 *     text: '整行文本',
 *     segments: [{ text, member_id: null }],
 *     sourceLine: <原文件行号>
 *   }
 *
 * 支持格式：
 *   LRC（网易云/酷狗标准歌词，含元数据与 offset）
 *   SRT（SubRip）
 *   VTT（WebVTT）
 *   ASS / SSA（SubStation Alpha）
 *   SCC（Scenarist Closed Caption，CC 字幕）
 *   TTML / DFXP（XML 定时文本）
 *   SMI / SAMI（Windows Media 字幕）
 *   TXT（无时间戳纯文本，按间隔顺排）
 */

// ---------------------------------------------------------------------------
// 时间工具
// ---------------------------------------------------------------------------

/** 秒数值 → 'mm:ss.xxx'（<1h）或 'h:mm:ss.xxx'（≥1h） */
export function formatTime(seconds) {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const totalMs = Math.round(s * 1000);
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const sec = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');
  return h > 0 ? `${h}:${mm}:${ss}.${mmm}` : `${mm}:${ss}.${mmm}`;
}

/** 'mm:ss.xxx' 或 'h:mm:ss.xxx' → 秒数值 */
export function timeToSeconds(time) {
  const parts = String(time).trim().split(':');
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  return NaN;
}

/** 字节缓冲按指定编码解码为文本，非法编码名回退 UTF-8 */
export function decodeLrc(buffer, encoding = 'utf-8') {
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(buffer);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  }
}

// ---------------------------------------------------------------------------
// 统一输出
// ---------------------------------------------------------------------------

function makeLines(entries) {
  const sorted = entries
    .filter(e => e && Number.isFinite(e.seconds) && String(e.text).trim() !== '')
    .sort((a, b) => a.seconds - b.seconds);
  return sorted.map((e, i) => {
    const text = String(e.text).trim();
    const next = sorted[i + 1];
    const endSeconds = next ? next.seconds : e.seconds + 3;
    return {
      line_id: `L${String(i + 1).padStart(3, '0')}`,
      seconds: e.seconds,
      time: formatTime(e.seconds),
      end_seconds: endSeconds,
      end_time: formatTime(endSeconds),
      text,
      segments: [{ text, member_id: null }],
      sourceLine: e.sourceLine ?? i + 1,
    };
  });
}

// ---------------------------------------------------------------------------
// LRC
// ---------------------------------------------------------------------------

function parseLrcToken(token) {
  const parts = token.split(':');
  let h = 0, min = 0, secStr;
  if (parts.length === 3) { h = Number(parts[0]); min = Number(parts[1]); secStr = parts[2]; }
  else if (parts.length === 2) { min = Number(parts[0]); secStr = parts[1]; }
  else return NaN;
  return h * 3600 + min * 60 + Number(secStr);
}

export function parseLrc(text) {
  const meta = {};
  const entries = [];
  const rawLines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  rawLines.forEach((raw, index) => {
    const trimmed = raw.trim();
    const metaMatch = trimmed.match(/^\[(ti|ar|al|by|offset|re|ve|length|au):(.*)\]\s*$/i);
    if (metaMatch) { meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim(); return; }
    const tokenRe = /\[(\d{1,3}:\d{1,2}(?::\d{1,2})?(?:[.:]\d{1,3})?)\]/g;
    const tokens = [...trimmed.matchAll(tokenRe)];
    if (!tokens.length) return;
    const lyric = trimmed.slice(tokens[tokens.length - 1].index + tokens[tokens.length - 1][0].length).trim();
    if (!lyric) return;
    tokens.forEach(tok => {
      const seconds = parseLrcToken(tok[1]);
      if (Number.isFinite(seconds)) entries.push({ seconds, text: lyric, sourceLine: index + 1 });
    });
  });
  return { lines: makeLines(entries), meta };
}

// ---------------------------------------------------------------------------
// SRT
// ---------------------------------------------------------------------------

export function parseSrt(text) {
  const entries = [];
  const blocks = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim() !== '');
    if (!lines.length) continue;
    const timeIdx = lines.findIndex(l => /-->/.test(l));
    if (timeIdx < 0) continue;
    const m = lines[timeIdx].match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*\S+/);
    if (!m) continue;
    const startSec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    const content = lines.slice(timeIdx + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').trim();
    if (!content) continue;
    entries.push({ seconds: startSec, text: content });
  }
  return { lines: makeLines(entries), meta: {} };
}

// ---------------------------------------------------------------------------
// VTT
// ---------------------------------------------------------------------------

export function parseVtt(text) {
  const entries = [];
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (/^(WEBVTT|STYLE|NOTE|REGION|X-TIMESTAMP-MAP)/i.test(line) || line === '') { i++; continue; }
    const m = line.match(/(?:(\d{1,2}):)?(\d{2}):(\d{2})\.(\d{3})\s*-->/);
    if (m) {
      const h = m[1] ? Number(m[1]) : 0;
      const startSec = h * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
      i++;
      const parts = [];
      while (i < lines.length && lines[i].trim() !== '') { parts.push(lines[i].trim()); i++; }
      const content = parts.join(' ').replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').trim();
      if (content) entries.push({ seconds: startSec, text: content });
    } else {
      i++;
    }
  }
  return { lines: makeLines(entries), meta: {} };
}

// ---------------------------------------------------------------------------
// ASS / SSA
// ---------------------------------------------------------------------------

function assTimeToSeconds(t) {
  const parts = t.trim().split(':');
  if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  return NaN;
}

export function parseAss(text) {
  const entries = [];
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let inEvents = false;
  let colCount = 10;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\[Events\]/i.test(line)) { inEvents = true; continue; }
    if (/^\[/i.test(line)) { inEvents = false; continue; }
    if (!inEvents) continue;
    if (/^Format:/i.test(line)) { colCount = line.slice(7).split(',').length || 10; continue; }
    if (!/^Dialogue:/i.test(line)) continue;
    const body = line.slice(line.indexOf(':') + 1).trim();
    const parts = body.split(',');
    if (parts.length < colCount) continue;
    const start = parts[1].trim();
    const textRaw = parts.slice(colCount - 1).join(',');
    const content = textRaw
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N|\\n|\\h/g, ' ')
      .trim();
    if (!content) continue;
    const seconds = assTimeToSeconds(start);
    if (!Number.isFinite(seconds)) continue;
    entries.push({ seconds, text: content });
  }
  return { lines: makeLines(entries), meta: {} };
}

// ---------------------------------------------------------------------------
// SCC（Scenarist Closed Caption，CC 字幕）
// ---------------------------------------------------------------------------

function sccChar(c) {
  if (c === 0x7f) return '\u266A';       // 音符
  if (c === 0x2a) return '\u00E1';       // á
  if (c >= 0x20) return String.fromCharCode(c);
  return '';
}

function decodeSccWords(line) {
  const words = line.match(/[0-9a-fA-F]{4}/g) || [];
  const out = [];
  let loading = false;
  for (const w of words) {
    const hi = parseInt(w.slice(0, 2), 16);
    const lo = parseInt(w.slice(2, 4), 16);
    if (hi >= 0x91 && hi <= 0x97) {
      const code = (hi << 8) | lo;
      if (code === 0x9420) loading = true;          // RCL：开始加载文本
      else if (code === 0x942f) loading = false;     // EOC：结束
      else if (code === 0x9425) out.push(' ');       // 制表
      continue;
    }
    if (hi >= 0x10 && hi <= 0x1f) {
      if (loading && lo >= 0x20) out.push(sccChar(lo & 0x7f));
      continue;
    }
    if (loading) {
      out.push(sccChar(hi & 0x7f));
      out.push(sccChar(lo & 0x7f));
    }
  }
  return out;
}

function sccTimeToSeconds(h, min, s, f) {
  // NTSC 29.97fps，drop-frame 误差对歌词可忽略
  return h * 3600 + min * 60 + s + f * (1001 / 30000);
}

export function parseScc(text) {
  const entries = [];
  const rawLines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  let currentTime = null;
  let caption = [];
  const flush = () => {
    if (currentTime !== null && caption.length) {
      const content = caption.join('').replace(/\s+/g, ' ').trim();
      if (content) entries.push({ seconds: currentTime, text: content });
    }
  };
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d{2}):(\d{2}):(\d{2})[:;](\d{2})\s+/);
    if (m) {
      flush();
      currentTime = sccTimeToSeconds(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]));
      caption = decodeSccWords(line.slice(m[0].length));
    } else if (currentTime !== null) {
      caption = caption.concat(decodeSccWords(line));
    }
  }
  flush();
  return { lines: makeLines(entries), meta: {} };
}

// ---------------------------------------------------------------------------
// TTML / DFXP
// ---------------------------------------------------------------------------

function decodeXmlEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'");
}

function parseTimeExpression(expr) {
  const s = String(expr).trim();
  if (/ms$/i.test(s)) return Number(s.slice(0, -2)) / 1000;
  if (/s$/i.test(s)) return Number(s.slice(0, -1));
  const t = s.replace(',', '.');
  const parts = t.split(':');
  if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  return Number(t);
}

export function parseTtml(text) {
  const entries = [];
  const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = pRe.exec(text))) {
    const attrs = m[1];
    const begin = (attrs.match(/\bbegin=["']([^"']+)["']/i) || [])[1];
    const content = decodeXmlEntities(
      m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
    ).replace(/\s+/g, ' ').trim();
    if (!begin || !content) continue;
    const seconds = parseTimeExpression(begin);
    if (!Number.isFinite(seconds)) continue;
    entries.push({ seconds, text: content });
  }
  return { lines: makeLines(entries), meta: {} };
}

// ---------------------------------------------------------------------------
// SMI / SAMI
// ---------------------------------------------------------------------------

export function parseSmi(text) {
  const entries = [];
  const re = /<SYNC\s+Start\s*=\s*["']?(\d+)["']?[^>]*>/gi;
  let m;
  const positions = [];
  while ((m = re.exec(text))) positions.push({ start: Number(m[1]), index: m.index, endIdx: m.index + m[0].length });
  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i];
    const next = positions[i + 1];
    const chunk = text.slice(cur.endIdx, next ? next.index : text.length);
    const pm = chunk.match(/<P[^>]*>([\s\S]*)/i);
    const content = decodeXmlEntities((pm ? pm[1] : chunk).replace(/<[^>]+>/g, ''))
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (content) entries.push({ seconds: cur.start / 1000, text: content });
  }
  return { lines: makeLines(entries), meta: {} };
}

// ---------------------------------------------------------------------------
// 纯文本（无时间戳）
// ---------------------------------------------------------------------------

export function parseText(text, { interval = 3 } = {}) {
  const entries = [];
  const rawLines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  let idx = 0;
  rawLines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    entries.push({ seconds: idx * interval, text: line, sourceLine: i + 1 });
    idx++;
  });
  return { lines: makeLines(entries), meta: {} };
}

// ---------------------------------------------------------------------------
// 格式检测 + 统一入口
// ---------------------------------------------------------------------------

const EXT_MAP = {
  lrc: 'lrc',
  srt: 'srt',
  vtt: 'vtt',
  ass: 'ass',
  ssa: 'ass',
  scc: 'scc',
  ttml: 'ttml',
  dfxp: 'ttml',
  xml: 'ttml',
  smi: 'smi',
  sami: 'smi',
  txt: 'text',
};

export function detectFormat(text, filename = '') {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (EXT_MAP[ext]) return EXT_MAP[ext];
  const head = String(text).replace(/^\uFEFF/, '').slice(0, 2000);
  if (/^WEBVTT/m.test(head)) return 'vtt';
  if (/Scenarist_SCC/i.test(head)) return 'scc';
  if (/\[Script Info\]/i.test(head)) return 'ass';
  if (/<tt\b/i.test(head) || /xmlns=['"]http:\/\/www\.w3\.org\/ns\/ttml/i.test(head)) return 'ttml';
  if (/<SAMI\b/i.test(head) || /<SYNC\b/i.test(head)) return 'smi';
  if (/-->/.test(head)) return 'srt';
  if (/\[\d{1,3}:\d{1,2}/.test(head)) return 'lrc';
  return 'text';
}

/**
 * 统一解析入口。
 * @param {string} text 已解码的文本
 * @param {object} opts { format, filename, textInterval }
 * @returns {{ lines: Array, meta: Object, format: string }}
 */
export function parseLyrics(text, { format, filename = '', textInterval = 3 } = {}) {
  const fmt = (format || detectFormat(text, filename)).toLowerCase();
  const clean = String(text).replace(/^\uFEFF/, '');
  let result;
  switch (fmt) {
    case 'lrc': result = parseLrc(clean); break;
    case 'srt': result = parseSrt(clean); break;
    case 'vtt': result = parseVtt(clean); break;
    case 'ass':
    case 'ssa': result = parseAss(clean); break;
    case 'scc': result = parseScc(clean); break;
    case 'ttml':
    case 'xml':
    case 'dfxp': result = parseTtml(clean); break;
    case 'smi':
    case 'sami': result = parseSmi(clean); break;
    case 'text': default: result = parseText(clean, { interval: textInterval }); break;
  }
  // LRC offset：正数表示歌词整体提前（秒数减去 offset/1000）
  if (result.meta?.offset) {
    const off = Number(result.meta.offset);
    if (Number.isFinite(off)) {
      result.lines.forEach(line => { line.seconds = Math.max(0, line.seconds - off / 1000); line.time = formatTime(line.seconds); });
      result.lines.sort((a, b) => a.seconds - b.seconds);
      // 重排序后需重新推导 end_time（默认 = 下一句 time）
      result.lines.forEach((line, i) => {
        const next = result.lines[i + 1];
        const endSeconds = next ? next.seconds : line.seconds + 3;
        line.end_seconds = endSeconds;
        line.end_time = formatTime(endSeconds);
      });
    }
  }
  return { ...result, format: fmt };
}

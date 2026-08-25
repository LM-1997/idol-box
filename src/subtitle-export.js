import { assFontName } from './font-map.js';

const GREY = '#999999';
export function exportSubtitle(format, state) {
  if (!state.lines.length) throw new Error('请先导入 LRC 或完整工程');
  const content = format === 'ass' ? buildAss(state) : format === 'srt-color' ? buildSrt(state, true) : format === 'srt-text' ? buildSrt(state, false) : buildVtt(state);
  const ext = format === 'ass' ? 'ass' : format.startsWith('srt') ? 'srt' : 'vtt';
  const base = (state.mvName || state.songTitle || 'song').replace(/\.[^.]+$/, '');
  download(content, `${base}_${format === 'ass' ? '字幕' : ext}.${ext}`, 'text/plain;charset=utf-8');
}
export {buildAss, buildSrt, buildVtt};
function segMemberList(seg, members) {
  const ids = Array.isArray(seg.member_ids) ? seg.member_ids : (seg.member_id ? [seg.member_id] : []);
  return ids.map(id => members.get(id)).filter(Boolean);
}

function buildAss(state) {
  const showName = !!state.player?.show_member_name;
  const alignment = state.player?.subtitle_position === 'top' ? 8 : 2;
  const fontName = assFontName(state.player?.font_family || '思源黑体');
  // 预览 px → ASS 1080p 坐标换算（预览默认 30px ≈ ASS 54）
  const fontSize = Math.round(Number(state.player?.font_size || 30) * 1.8);
  const fx = effectToAssStyle(state.player?.font_effect || 'none');
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${fontName},${fontSize},&H00FFFFFF,&H00FFFFFF,${fx.outlineColour},&H80000000,-1,0,0,0,100,100,0,0,1,${fx.outline},${fx.shadow},${alignment},80,80,65,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return header + eventRows(state, (segment, member) => `{\\c&H${assColor(member?.color || GREY)}&}${showName && member?.name ? `${member.name}：` : ''}${escapeAss(segment.text)}`).join('\n') + '\n';
}

/** 把播放层 font_effect 映射为 ASS Style 的 OutlineColour / Outline / Shadow */
function effectToAssStyle(effect) {
  const black = '&H00151515';
  const white = '&H00FFFFFF';
  const gold = '&H0000D9FF'; // BGR 顺序：#FFD900 → &H0000D9FF
  switch (effect) {
    case 'stroke-white': return { outlineColour: white, outline: 2, shadow: 0 };
    case 'stroke-black': return { outlineColour: black, outline: 2, shadow: 0 };
    case 'glow-white':   return { outlineColour: white, outline: 1, shadow: 2 };
    case 'glow-black':   return { outlineColour: black, outline: 1, shadow: 2 };
    case 'shadow':       return { outlineColour: black, outline: 1, shadow: 2 };
    case 'stroke-gold':  return { outlineColour: gold, outline: 2, shadow: 0 };
    case 'none': default: return { outlineColour: black, outline: 2, shadow: 0 };
  }
}
function buildSrt(state, colored) { const members = new Map(state.members.map(member => [member.id, member])); const showName = !!state.player?.show_member_name; const shift = Number(state.player?.subtitle_delay || 0); const cues = state.lines.map((line, index) => { const startSeconds = Math.max(0, line.seconds + shift); const endSeconds = Math.max(startSeconds + .1, (Number.isFinite(line.end_seconds) ? line.end_seconds : (state.lines[index + 1]?.seconds ?? line.seconds + 3)) + shift); const start = srtTime(startSeconds); const finish = srtTime(endSeconds); const body = line.segments.map(segment => { const segMembers = segMemberList(segment, members); const names = (showName && segMembers.length) ? segMembers.map(m => m.name).join('·') + '：' : ''; const text = escapeText(segment.text); const color = segMembers[0]?.color || GREY; return colored ? `<font color="${color}">${names}${text}</font>` : `${names}${text}`; }).join(''); return `${start} --> ${finish}\n${body}`; }); return cues.map((text, i) => `${i + 1}\n${text}`).join('\n\n') + '\n'; }
function buildVtt(state) { const members = new Map(state.members.map(member => [member.id, member])); const showName = !!state.player?.show_member_name; const shift = Number(state.player?.subtitle_delay || 0); const position = state.player?.subtitle_position === 'top' ? ' position:10% align:center' : ''; const rows = state.lines.map((line, index) => { const start = Math.max(0, line.seconds + shift); const finish = Math.max(start + .1, (Number.isFinite(line.end_seconds) ? line.end_seconds : (state.lines[index + 1]?.seconds ?? line.seconds + 3)) + shift); const text = line.segments.map(segment => { const segMembers = segMemberList(segment, members); const names = (showName && segMembers.length) ? segMembers.map(m => m.name).join('·') + '：' : ''; return `${names}${escapeText(segment.text)}`; }).join(''); return `${vttTime(start)} --> ${vttTime(finish)}${position}\n${text}`; }); return 'WEBVTT\n\n' + rows.join('\n\n') + '\n'; }
function eventRows(state, render, srt = false) { const members = new Map(state.members.map(member => [member.id, member])); const shift = Number(state.player?.subtitle_delay || 0); const rows = []; state.lines.forEach((line, index) => { const startSeconds = Math.max(0, line.seconds + shift); const finishSeconds = Math.max(startSeconds + .1, (Number.isFinite(line.end_seconds) ? line.end_seconds : (state.lines[index + 1]?.seconds ?? line.seconds + 3)) + shift); const start = srt ? srtTime(startSeconds) : assTime(startSeconds); const finish = srt ? srtTime(finishSeconds) : assTime(finishSeconds); line.segments.forEach(segment => { const segMembers = segMemberList(segment, members); const member = segMembers[0]; const body = render(segment, member); rows.push(srt ? `${start} --> ${finish}\n${body}` : `Dialogue: 0,${start},${finish},Default,,0,0,0,,${body}`); }); }); return rows; }
function assTime(seconds) { const centiseconds = Math.round(seconds * 100); const h = Math.floor(centiseconds / 360000); const m = Math.floor(centiseconds / 6000) % 60; const s = Math.floor(centiseconds / 100) % 60; const cs = centiseconds % 100; return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`; }
function srtTime(seconds) { const ms = Math.round((seconds % 1) * 1000); const total = Math.floor(seconds); return `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')},${String(ms).padStart(3, '0')}`; }
function vttTime(seconds) { const totalMs = Math.round(seconds * 1000); const h = Math.floor(totalMs / 3600000); const m = Math.floor(totalMs / 60000) % 60; const s = Math.floor(totalMs / 1000) % 60; const ms = totalMs % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`; }
function assColor(hex) { const clean = (hex || GREY).replace('#', '').padEnd(6, '9'); return clean.slice(4, 6) + clean.slice(2, 4) + clean.slice(0, 2); }
function escapeAss(text) { return String(text).replace(/[{}]/g, ''); }
function escapeText(text) { return String(text).replace(/\r?\n/g, ' '); }
function download(content, name, type) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], {type})); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 500); }

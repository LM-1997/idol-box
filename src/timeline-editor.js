/**
 * timeline-editor.js — 歌词时间轴编辑器（剪映式可拖拽时间轴 + 可编辑列表）
 *
 * 纯 DOM 自绘时间轴：
 *   1. 顶部刻度尺（按可见时长自适应步长）
 *   2. 每句歌词渲染为一个色块，left/width 由 [seconds, end_seconds] 映射
 *      - 拖动色块主体：整句平移（同时改起止）
 *      - 拖动左右边缘：微调开始 / 结束时间
 *      - 点击（无拖动）：选中并跳转到该句
 *   3. 播放头随视频 timeupdate 实时移动
 *   4. 可编辑列表：每句显示开始/结束时间、歌词文本、演唱成员下拉（可二次修改），
 *      拖拽手柄排序（SortableJS），删除按钮
 *   5. 缩放（类似 Premiere）：Alt + 鼠标滚轮缩放，右下角按钮 +/−/适应
 *
 * 说明：色块上不再叠加成员名文本（避免与列表下拉里的成员名重复显示）；
 * 成员身份由色块「应援色」表达，悬浮色块会以 title 提示成员名与歌词。
 * 成员名的显示统一由播放台的「显示演唱成员」开关控制。
 *
 * 依赖（CDN 全局加载，见 index.html）：window.Sortable
 */
import { state } from './store.js';
import { timeToSeconds, formatTime } from './parsers.js';
import { memberChipsHtml, bindMemberChips, segMemberIds } from './member-chips.js';

const $ = id => document.getElementById(id);
const TIME_RE = /^\d{2}:\d{2}\.\d{3}$/; // mm:ss.xxx

let getVideo = null;
let onChanged = null;       // 轻量回调：写回 state 后通知 main 刷新
let onSubtitleEdit = null;  // 编辑文本/时间后即时重绘视频内字幕层（不重建列表，避免打断输入）
let sortable = null;
let pendingDelete = null;   // 待确认删除的行 line_id
let warnTimer = null;
let dragging = null;        // { mode: 'move'|'start'|'end', lineId, startX, startSeconds, endSeconds, laneWidth, moved }
let duration = 5;           // 时间轴总时长（秒）
let zoom = 1;               // 缩放：1 = 适应宽度（时间轴铺满可视区），>1 放大
let following = false;      // 是否正在跟随播放（播放时自动滚动到当前时间）
let selectedIndex = -1;     // 当前选中的行（用于拆句按钮）
let hideTime = false;       // 是否隐藏时间列
const ZOOM_MIN = 1, ZOOM_MAX = 32;

function esc(v) { return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function memberById(id) { return state.members.find(m => m.id === id); }
function memberColor(memberId) { return memberById(memberId)?.color || '#999999'; }
function memberName(memberId) { return memberById(memberId)?.name || ''; }

/** segment 的成员列表（归一化） */
function segMembers(seg) {
  return segMemberIds(seg).map(memberById).filter(Boolean);
}

/** 根据背景色亮度返回可读的文字颜色（白色应援色用深色字，深色应援色用白字） */
function contrastColor(hex) {
  const clean = String(hex || '#999999').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : (clean || '999999');
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#1a1420' : '#ffffff';
}

function warn(msg) {
  const el = $('timelineStatus');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('warn');
  clearTimeout(warnTimer);
  warnTimer = setTimeout(() => { el.textContent = ''; el.classList.remove('warn'); }, 4200);
}

function blockEl(line) { return $('tlBlocks')?.querySelector(`.tl-block[data-id="${line.line_id}"]`); }

// ---------------------------------------------------------------------------
// 时长 / 刻度
// ---------------------------------------------------------------------------

function computeDuration() {
  const video = getVideo?.();
  const vd = Number.isFinite(video?.duration) ? video.duration : 0;
  let maxEnd = 0;
  state.lines.forEach(l => { const e = Number(l.end_seconds); if (Number.isFinite(e)) maxEnd = Math.max(maxEnd, e); });
  const raw = Math.max(vd, maxEnd, 5);
  duration = raw * 1.06; // 右侧留余量
  return duration;
}

function pct(sec) { return duration ? Math.max(0, Math.min(100, (sec / duration) * 100)) : 0; }

function niceStep(visibleDuration) {
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 3600];
  const target = visibleDuration / 10;
  for (const c of candidates) if (c >= target) return c;
  return 3600;
}

// ---------------------------------------------------------------------------
// 缩放
// ---------------------------------------------------------------------------

function applyZoom() {
  const ruler = $('timelineRuler');
  const lane = $('timelineLane');
  const w = `${zoom * 100}%`;
  if (ruler) ruler.style.width = w;
  if (lane) lane.style.width = w;
  const lvl = $('zoomLevel');
  if (lvl) lvl.textContent = `${Math.round(zoom * 100)}%`;
  renderRuler();
  updatePlayhead();
}

/** 以可视区中心为锚点缩放 */
function zoomCenter(factor) {
  const scroll = $('timelineScroll');
  if (!scroll) return;
  const centerX = scroll.clientWidth / 2;
  const contentWidth = zoom * scroll.clientWidth;
  const t = ((scroll.scrollLeft + centerX) / contentWidth) * duration;
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
  applyZoom();
  const newContentWidth = zoom * scroll.clientWidth;
  scroll.scrollLeft = (t / duration) * newContentWidth - centerX;
}

/** 以鼠标位置为锚点缩放 */
function zoomAt(factor, clientX) {
  const scroll = $('timelineScroll');
  if (!scroll) return;
  const scrollRect = scroll.getBoundingClientRect();
  const cursorX = clientX - scrollRect.left;
  const contentWidth = zoom * scroll.clientWidth;
  const t = ((scroll.scrollLeft + cursorX) / contentWidth) * duration;
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
  applyZoom();
  const newContentWidth = zoom * scroll.clientWidth;
  scroll.scrollLeft = (t / duration) * newContentWidth - cursorX;
}

function zoomFit() { zoom = ZOOM_MIN; const scroll = $('timelineScroll'); applyZoom(); if (scroll) scroll.scrollLeft = 0; }

function onWheel(e) {
  if (!e.altKey) return; // 只有按住 Alt 才缩放，普通滚轮保留页面滚动
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  zoomAt(factor, e.clientX);
}

// ---------------------------------------------------------------------------
// 刻度尺
// ---------------------------------------------------------------------------

function renderRuler() {
  const el = $('timelineRuler');
  if (!el) return;
  const step = niceStep(duration / zoom);
  let html = '';
  for (let t = 0; t <= duration + step * 0.5; t += step) {
    html += `<span class="ruler-tick" style="left:${pct(t)}%"><i></i><em>${formatTime(t)}</em></span>`;
  }
  el.innerHTML = html;
}

// ---------------------------------------------------------------------------
// 色块
// ---------------------------------------------------------------------------

function renderBlocks() {
  const box = $('tlBlocks');
  if (!box) return;
  const empty = $('timelineEmpty');
  if (!state.lines.length) {
    box.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  box.innerHTML = state.lines.map(line => {
    const start = Math.max(0, Number.isFinite(line.seconds) ? line.seconds : 0);
    const end = Math.max(start + 0.05, Number.isFinite(line.end_seconds) ? line.end_seconds : start + 3);
    const members = segMembers(line.segments[0]);
    const color = members[0]?.color || '#999999';
    const bg = members.length > 1 ? `linear-gradient(90deg, ${members.map(m => m.color).join(',')})` : color;
    const ids = [...new Set(line.segments.flatMap(s => segMemberIds(s)))].filter(Boolean);
    const names = ids.length ? ids.map(memberName).join('·') : '未分配';
    const textColor = contrastColor(color);
    return `<div class="tl-block" data-id="${esc(line.line_id)}" title="${esc(names)} · ${esc(line.text)}" style="left:${pct(start)}%;width:${Math.max(0.4, pct(end) - pct(start))}%;background:${bg};color:${textColor}">
      <span class="tl-resize tl-resize-l" title="拖动调整开始时间"></span>
      <span class="tl-block-body"><b>${esc(line.text)}</b></span>
      <span class="tl-resize tl-resize-r" title="拖动调整结束时间"></span>
    </div>`;
  }).join('');
}

function updateBlock(line) {
  const block = blockEl(line);
  if (!block) return;
  const start = Math.max(0, Number.isFinite(line.seconds) ? line.seconds : 0);
  const end = Math.max(start + 0.05, Number.isFinite(line.end_seconds) ? line.end_seconds : start + 3);
  block.style.left = `${pct(start)}%`;
  block.style.width = `${Math.max(0.4, pct(end) - pct(start))}%`;
  const members = segMembers(line.segments[0]);
  const color = members[0]?.color || '#999999';
  const bg = members.length > 1 ? `linear-gradient(90deg, ${members.map(m => m.color).join(',')})` : color;
  block.style.background = bg;
  block.style.color = contrastColor(color);
  const ids = [...new Set(line.segments.flatMap(s => segMemberIds(s)))].filter(Boolean);
  const names = ids.length ? ids.map(memberName).join('·') : '未分配';
  block.title = `${names} · ${line.text}`;
  const b = block.querySelector('.tl-block-body b');
  if (b) b.textContent = line.text;
}

// ---------------------------------------------------------------------------
// 播放头
// ---------------------------------------------------------------------------

function updatePlayhead() {
  const ph = $('tlPlayhead');
  if (!ph) return;
  const t = getVideo?.()?.currentTime || 0;
  ph.style.left = `${pct(t)}%`;
  if (following) scrollToTime(t);
}

/** 滚动时间轴，使指定时间（播放头）居中/可见 */
function scrollToTime(t, center = true) {
  const scroll = $('timelineScroll');
  if (!scroll) return;
  const playheadPx = (pct(t) / 100) * (zoom * scroll.clientWidth);
  const target = center ? playheadPx - scroll.clientWidth / 2 : playheadPx - scroll.clientWidth * 0.8;
  scroll.scrollLeft = Math.max(0, target);
}

function setFollowing(on) {
  following = on;
  if (on) { const t = getVideo?.()?.currentTime || 0; scrollToTime(t); }
}

// ---------------------------------------------------------------------------
// 拖拽 / 点击
// ---------------------------------------------------------------------------

function onPointerDown(e) {
  const lane = $('timelineLane');
  if (!lane) return;
  const block = e.target.closest('.tl-block');
  if (!block) { seekFromEvent(e); return; }
  const lineId = block.dataset.id;
  const line = state.lines.find(l => l.line_id === lineId);
  if (!line) return;
  e.preventDefault();
  const handle = e.target.closest('.tl-resize');
  const mode = handle ? (handle.classList.contains('tl-resize-l') ? 'start' : 'end') : 'move';
  const rect = lane.getBoundingClientRect();
  dragging = {
    mode, lineId,
    startX: e.clientX,
    startSeconds: line.seconds,
    endSeconds: line.end_seconds,
    laneWidth: rect.width || 1,
    moved: false,
  };
  selectLine(state.lines.indexOf(line));
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(e) {
  if (!dragging) return;
  const line = state.lines.find(l => l.line_id === dragging.lineId);
  if (!line) return;
  const dx = e.clientX - dragging.startX;
  const dSec = (dx / dragging.laneWidth) * duration;
  if (Math.abs(dx) > 2) dragging.moved = true;
  let ns = dragging.startSeconds, ne = dragging.endSeconds;
  if (dragging.mode === 'move') {
    ns = Math.max(0, dragging.startSeconds + dSec);
    ne = dragging.endSeconds + dSec;
  } else if (dragging.mode === 'start') {
    ns = Math.min(Math.max(0, dragging.startSeconds + dSec), dragging.endSeconds - 0.05);
    ne = dragging.endSeconds;
  } else {
    ne = Math.max(dragging.endSeconds + dSec, dragging.startSeconds + 0.05);
    ns = dragging.startSeconds;
  }
  line.seconds = ns; line.time = formatTime(ns);
  line.end_seconds = ne; line.end_time = formatTime(ne);
  updateBlock(line); syncRowTime(line);
  onSubtitleEdit?.(); // 拖动时即时重绘视频内字幕层
}

function onPointerUp() {
  if (!dragging) return;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  const d = dragging;
  dragging = null;
  const line = state.lines.find(l => l.line_id === d.lineId);
  if (!line) return;
  if (d.moved) {
    onChanged?.();
    checkOverlap(state.lines.indexOf(line));
  } else {
    focusLine(state.lines.indexOf(line));
  }
}

function seekFromEvent(e) {
  const lane = $('timelineLane');
  if (!lane || !duration) return;
  const rect = lane.getBoundingClientRect();
  const t = Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration));
  const video = getVideo?.();
  if (video) { try { video.currentTime = t; } catch { /* 忽略 */ } }
}

// ---------------------------------------------------------------------------
// 列表渲染
// ---------------------------------------------------------------------------

function renderList() {
  const box = $('lyricsList');
  if (!box) return;
  if (!state.lines.length) {
    box.innerHTML = '<div class="empty-state">导入歌词 / 字幕或完整工程后，时间轴会在这里展开。</div>';
    $('lineCount').textContent = '0 LINES';
    destroySortable();
    return;
  }
  const scrollTop = box.scrollTop;
  box.innerHTML = state.lines.map((line, index) => {
    const segCells = line.segments.map((seg, si) => {
      return `<span class="seg-cell"><input class="seg-input" data-seg="${si}" value="${esc(seg.text)}" aria-label="歌词文本">${memberChipsHtml(seg)}</span>`;
    }).join('');
    return `<div class="lyric-row timeline-row" data-index="${index}" data-id="${esc(line.line_id)}">
      <span class="drag-handle" title="拖拽排序">⠿</span>
      <input class="t-start" value="${esc(line.time)}" aria-label="开始时间" spellcheck="false">
      <input class="t-end" value="${esc(line.end_time || line.time)}" aria-label="结束时间" spellcheck="false">
      <span class="seg-wrap">${segCells}</span>
      <button class="del-line" title="删除这一句">×</button>
    </div>`;
  }).join('');
  $('lineCount').textContent = `${state.lines.length} LINES`;
  box.scrollTop = scrollTop;
  applyHideTime();
  bindListEvents(box);
  initSortable(box);
  selectLine(selectedIndex);
}

function applyHideTime() {
  const box = $('lyricsList');
  if (!box) return;
  box.classList.toggle('hide-time', hideTime);
}

function bindListEvents(box) {
  box.querySelectorAll('.timeline-row').forEach(row => {
    const index = Number(row.dataset.index);
    const line = state.lines[index];
    if (!line) return;

    row.querySelector('.t-start').addEventListener('input', e => {
      const v = e.target.value.trim();
      if (!TIME_RE.test(v)) return; // 输入未完整，暂不处理
      const sec = timeToSeconds(v);
      if (!(sec < line.end_seconds)) return;
      line.seconds = sec; line.time = v;
      updateBlock(line); onSubtitleEdit?.(); // 即时重绘视频内字幕层（不重建列表）
    });
    row.querySelector('.t-start').addEventListener('change', e => {
      const v = e.target.value.trim();
      if (!TIME_RE.test(v)) { warn('时间格式应为 mm:ss.xxx'); e.target.value = line.time; return; }
      const sec = timeToSeconds(v);
      if (!(sec < line.end_seconds)) { warn('开始时间必须小于结束时间'); e.target.value = line.time; return; }
      line.seconds = sec; line.time = v;
      updateBlock(line); checkOverlap(index); onSubtitleEdit?.(); onChanged?.();
    });

    row.querySelector('.t-end').addEventListener('input', e => {
      const v = e.target.value.trim();
      if (!TIME_RE.test(v)) return;
      const sec = timeToSeconds(v);
      if (!(sec > line.seconds)) return;
      line.end_seconds = sec; line.end_time = v;
      updateBlock(line); onSubtitleEdit?.();
    });
    row.querySelector('.t-end').addEventListener('change', e => {
      const v = e.target.value.trim();
      if (!TIME_RE.test(v)) { warn('时间格式应为 mm:ss.xxx'); e.target.value = line.end_time || line.time; return; }
      const sec = timeToSeconds(v);
      if (!(sec > line.seconds)) { warn('结束时间必须大于开始时间'); e.target.value = line.end_time || line.time; return; }
      line.end_seconds = sec; line.end_time = v;
      updateBlock(line); checkOverlap(index); onSubtitleEdit?.(); onChanged?.();
    });

    row.querySelectorAll('.seg-input').forEach(input => {
      const si = Number(input.dataset.seg);
      input.addEventListener('input', () => {
        const seg = line.segments[si];
        if (!seg) return;
        seg.text = input.value;
        line.text = line.segments.map(s => s.text).join('');
        const b = blockEl(line)?.querySelector('.tl-block-body b');
        if (b) b.textContent = line.text;
        onSubtitleEdit?.(); // 即时重绘视频内字幕层
      });
    });

    row.querySelectorAll('.seg-cell').forEach(cell => {
      const si = Number(cell.querySelector('.seg-input')?.dataset.seg);
      const seg = line.segments[si];
      if (!seg) return;
      bindMemberChips(cell, seg, () => { onChanged?.(); });
    });

    row.addEventListener('click', e => {
      if (e.target.closest('input') || e.target.closest('button') || e.target.closest('select') || e.target.closest('.drag-handle') || e.target.closest('.member-chip')) return;
      focusLine(index);
    });

    row.querySelector('.del-line').addEventListener('click', () => {
      if (pendingDelete === line.line_id) {
        confirmDelete(line.line_id);
      } else {
        const prev = pendingDelete;
        pendingDelete = line.line_id;
        if (prev) {
          const prevRow = box.querySelector(`[data-id="${prev}"] .del-line`);
          if (prevRow) { prevRow.classList.remove('confirm'); prevRow.textContent = '×'; }
        }
        const btn = row.querySelector('.del-line');
        btn.classList.add('confirm'); btn.textContent = '确认?';
        setTimeout(() => {
          if (pendingDelete === line.line_id) { pendingDelete = null; btn.classList.remove('confirm'); btn.textContent = '×'; }
        }, 3000);
      }
    });
  });
}

function confirmDelete(lineId) {
  const index = state.lines.findIndex(l => l.line_id === lineId);
  if (index < 0) return;
  state.lines.splice(index, 1);
  pendingDelete = null;
  renderList();
  renderBlocks();
  onChanged?.();
}

// ---------------------------------------------------------------------------
// 拖拽排序
// ---------------------------------------------------------------------------

function destroySortable() { if (sortable) { sortable.destroy(); sortable = null; } }

function initSortable(box) {
  destroySortable();
  if (!window.Sortable || !state.lines.length) return;
  sortable = new window.Sortable(box, {
    handle: '.drag-handle',
    animation: 150,
    ghostClass: 'sort-ghost',
    onEnd: () => {
      const order = [...box.querySelectorAll('.timeline-row')].map(r => r.dataset.id);
      const map = new Map(state.lines.map(l => [l.line_id, l]));
      state.lines = order.map(id => map.get(id)).filter(Boolean);
      box.querySelectorAll('.timeline-row').forEach((r, i) => { r.dataset.index = i; });
      onChanged?.();
    },
  });
}

// ---------------------------------------------------------------------------
// 选中 / 校验
// ---------------------------------------------------------------------------

function selectLine(index) {
  selectedIndex = index;
  document.querySelectorAll('.timeline-row').forEach((r, i) => r.classList.toggle('selected', i === index));
  document.querySelectorAll('.tl-block').forEach(b => {
    const li = state.lines.findIndex(l => l.line_id === b.dataset.id);
    b.classList.toggle('selected', li === index);
  });
  const splitBtn = $('splitLine');
  if (splitBtn) splitBtn.disabled = index < 0 || index >= state.lines.length;
  const mergeBtn = $('mergeLine');
  if (mergeBtn) mergeBtn.disabled = index < 0 || index >= state.lines.length - 1;
}

/** 把选中这句拆成两段（中点对半拆，两段各继承原文，成员都归第一段，第二段未分配） */
function splitSelectedLine() {
  const line = state.lines[selectedIndex];
  if (!line) return;
  if (line.segments.length < 1) { warn('当前句没有可拆的文本'); return; }
  // 若已有多个分段，直接提醒用「添加分段」；否则按文本中点为基准拆分
  const seg = line.segments[0];
  const text = String(seg.text || '');
  if (line.segments.length === 1 && text.length > 1) {
    const mid = Math.ceil(text.length / 2);
    line.segments = [
      { text: text.slice(0, mid), member_ids: segMemberIds(seg).slice(), member_id: seg.member_id, remark: seg.remark || '' },
      { text: text.slice(mid), member_ids: [], member_id: null, remark: '' },
    ];
  } else {
    // 已有分段：追加一个空段，由用户自行填写
    line.segments.push({ text: '', member_ids: [], member_id: null, remark: '' });
  }
  line.text = line.segments.map(s => s.text).join('');
  renderList();
  renderBlocks();
  onChanged?.();
}

/** 把选中句与下一句合并 */ 
function mergeSelectedLines() {
  const line = state.lines[selectedIndex];
  const next = state.lines[selectedIndex + 1];
  if (!line || !next) return;
  line.segments = [...line.segments, ...next.segments];
  line.text = line.segments.map(s => s.text).join('');
  line.end_time = next.end_time;
  line.end_seconds = next.end_seconds;
  state.lines.splice(selectedIndex + 1, 1);
  renderList();
  renderBlocks();
  onChanged?.();
}

function focusLine(index) {
  const line = state.lines[index];
  if (!line) return;
  selectLine(index);
  const video = getVideo?.();
  if (video) { try { video.currentTime = Math.max(0, line.seconds); } catch { /* 忽略 */ } }
  const row = document.querySelector(`.timeline-row[data-id="${line.line_id}"]`);
  if (row?.scrollIntoView) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function syncRowTime(line) {
  const row = document.querySelector(`.timeline-row[data-id="${line.line_id}"]`);
  if (!row) return;
  const start = row.querySelector('.t-start');
  const end = row.querySelector('.t-end');
  if (start) start.value = line.time;
  if (end) end.value = line.end_time || line.time;
}

function checkOverlap(index) {
  const line = state.lines[index];
  if (!line) return;
  const overlaps = [];
  state.lines.forEach((other, i) => {
    if (i === index) return;
    if (line.seconds < other.end_seconds && other.seconds < line.end_seconds) overlaps.push(other.line_id);
  });
  if (overlaps.length) warn(`⚠ ${line.line_id} 与 ${overlaps.join('、')} 时间区间重叠`);
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export function initTimelineEditor({ getVideo: gv, onChanged: oc, onSubtitleEdit: os }) {
  getVideo = gv;
  onChanged = oc;
  onSubtitleEdit = os;
  const video = getVideo?.();
  const onTime = () => updatePlayhead();
  const onMeta = () => { computeDuration(); applyZoom(); renderBlocks(); updatePlayhead(); };
  const onPlay = () => setFollowing(true);
  const onPause = () => setFollowing(false);
  if (video) {
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('durationchange', onMeta);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onPause);
  }
  const lane = $('timelineLane');
  if (lane) lane.addEventListener('pointerdown', onPointerDown);

  const scroll = $('timelineScroll');
  if (scroll) {
    scroll.addEventListener('wheel', onWheel, { passive: false });
    // 用户手动横向滚动时间轴时，暂停“跟随播放”
    scroll.addEventListener('pointerdown', () => { if (following) setFollowing(false); });
  }
  $('zoomIn')?.addEventListener('click', () => zoomCenter(1.25));
  $('zoomOut')?.addEventListener('click', () => zoomCenter(0.8));
  $('zoomReset')?.addEventListener('click', zoomFit);
  $('splitLine')?.addEventListener('click', splitSelectedLine);
  $('mergeLine')?.addEventListener('click', mergeSelectedLines);
  $('hideTimeCol')?.addEventListener('change', e => { hideTime = e.target.checked; applyHideTime(); });

  computeDuration();
  renderList();
  applyZoom();
  renderBlocks();
  updatePlayhead();

  return {
    /** 结构变化（导入/加载/成员变化/Excel 回收/分段保存）后全量重建列表 + 色块 */
    refresh() {
      computeDuration();
      renderList();
      applyZoom();
      renderBlocks();
      updatePlayhead();
    },
    /** MV 上传后重载（总时长可能变化） */
    reload() {
      computeDuration();
      applyZoom();
      renderBlocks();
      updatePlayhead();
    },
    /** MV 被清空（导入工程 resetMv）时按歌词时长重建 */
    resetMedia() {
      computeDuration();
      applyZoom();
      renderBlocks();
      updatePlayhead();
    },
    destroy() {
      destroySortable();
      if (video) {
        video.removeEventListener('timeupdate', onTime);
        video.removeEventListener('loadedmetadata', onMeta);
        video.removeEventListener('durationchange', onMeta);
        video.removeEventListener('play', onPlay);
        video.removeEventListener('pause', onPause);
        video.removeEventListener('ended', onPause);
      }
      if (scroll) scroll.removeEventListener('wheel', onWheel);
    },
  };
}

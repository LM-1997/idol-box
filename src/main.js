import { parseLyrics, decodeLrc, timeToSeconds, formatTime } from './parsers.js';
import { state, serialize } from './store.js';
import { exportAssignments, importAssignments } from './excel-export.js';
import { setupPlayer } from './player.js';
import { exportSubtitle } from './subtitle-export.js';
import { renderBurnGuide } from './burn-guide.js';
import { importProject } from './project-import.js';
import { initStage2 } from './stage2.js';
import { initTimelineEditor } from './timeline-editor.js';
import { setDsApiKey, setDsModel } from './glm.js';
import { initStepFlow } from './step-flow.js';

import { toast } from './toast.js';

const $ = id => document.getElementById(id);
let lastBuffer = null;
let lastFilename = '';
let currentFormat = '';
let mvReady = false;

const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function status(message, error = false) { toast(message, error ? 'error' : 'ok'); }
function download(data, name, type) { const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([data], { type })); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 500); }

function renderMembers() {
  const box = $('membersList');
  box.innerHTML = state.members.map((member, index) => `<div class="member-row"><input type="text" data-n="${index}" value="${esc(member.name)}" aria-label="成员姓名"><input type="text" data-h="${index}" value="${member.color}" maxlength="7" aria-label="HEX 应援色"><input type="color" data-c="${index}" value="${member.color}" aria-label="颜色选择器"><button class="remove-member" data-r="${index}" aria-label="删除成员">×</button></div>`).join('');
  box.querySelectorAll('[data-n]').forEach(input => { input.oninput = () => { state.members[+input.dataset.n].name = input.value; sync(); }; input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); addMember(); requestAnimationFrame(() => box.querySelector(`[data-n="${state.members.length - 1}"]`)?.focus()); } }; });
  box.querySelectorAll('[data-h]').forEach(input => input.oninput = () => { if (/^#[0-9a-f]{6}$/i.test(input.value)) { state.members[+input.dataset.h].color = input.value.toUpperCase(); box.querySelector(`[data-c="${input.dataset.h}"]`).value = input.value; sync(); } });
  box.querySelectorAll('[data-c]').forEach(input => input.oninput = () => { state.members[+input.dataset.c].color = input.value.toUpperCase(); box.querySelector(`[data-h="${input.dataset.c}"]`).value = input.value.toUpperCase(); sync(); });
  box.querySelectorAll('[data-r]').forEach(button => button.onclick = () => {
    const idx = +button.dataset.r;
    if (state.members.length <= 1) return;
    const member = state.members[idx];
    // 检查该成员是否已被分配到歌词中
    const assigned = state.lines.some(line => line.segments.some(seg => (seg.member_ids || []).includes(member.id)));
    if (assigned) {
      const ok = confirm(`成员「${member.name}」已被分配到歌词中，删除后相关分配将失效。确定删除吗？`);
      if (!ok) return;
    }
    state.members.splice(idx, 1);
    renderMembers();
    sync();
  });
}
function addMember() { state.members.push({ id: `m${Date.now()}${state.members.length}`, name: '新成员', color: '#C084FC' }); renderMembers(); sync(); }

function renderUnassigned(lines) { const box = $('unassignedList'); if (!box) return; if (!lines.length) { box.hidden = true; box.innerHTML = ''; return; } box.hidden = false; box.innerHTML = `<strong>未分配歌词清单（${lines.length} 行）</strong><ul>${lines.map(line => `<li><code>${line.line_id}</code> ${esc(line.text)}</li>`).join('')}</ul>`; }
function applyPlayerSettings() { $('lyricsLayer').classList.toggle('position-top', state.player.subtitle_position === 'top'); $('lyricsLayer').classList.toggle('position-bottom', state.player.subtitle_position !== 'top'); if (document.activeElement !== $('subtitleDelay')) $('subtitleDelay').value = fmtDelay(state.player.subtitle_delay); $('delayMeaning').textContent = state.player.subtitle_delay > 0 ? `延后 ${fmtDelay(state.player.subtitle_delay)} 秒` : state.player.subtitle_delay < 0 ? `提前 ${fmtDelay(Math.abs(state.player.subtitle_delay))} 秒` : '同步'; document.querySelectorAll('[data-position]').forEach(button => button.classList.toggle('active', button.dataset.position === state.player.subtitle_position)); $('showMemberName').checked = !!state.player.show_member_name; $('showRomaji').checked = !!state.player.show_romaji; $('showTranslation').checked = !!state.player.show_translation; $('fontFamily').value = state.player.font_family || '思源黑体'; $('fontSize').value = state.player.font_size || 30; $('fontEffect').value = state.player.font_effect || 'none'; playerApi.applyFontStyle(); }

function updateHeroMeta() {
  const parts = [`${state.language.toUpperCase()}`, `${state.lines.length} lines`];
  if (currentFormat) parts.push(currentFormat);
  if (mvReady) parts.push('MV ready');
  $('heroMeta').textContent = parts.join(' · ');
}

function resetMv() {
  state.mvName = '';
  if (state.mvUrl) { URL.revokeObjectURL(state.mvUrl); state.mvUrl = ''; }
  const video = $('video');
  video.removeAttribute('src');
  video.load();
  mvReady = false;
  $('videoEmpty').style.display = '';
  timelineEditor.resetMedia();
}

function sync() {
  const members = new Map(state.members.map(member => [member.id, member]));
  state.lines.forEach(line => {
    line.segments.forEach(segment => {
      if (!Array.isArray(segment.member_ids)) segment.member_ids = segment.member_id ? [segment.member_id] : [];
      segment.member_ids = segment.member_ids.filter(id => members.has(id));
      const segMembers = segment.member_ids.map(id => members.get(id)).filter(Boolean);
      segment.member_id = segMembers[0]?.id || null;
      segment.member_name = segMembers.map(m => m.name).join('·');
      segment.color = segMembers[0]?.color || '#999999';
      segment.colors = segMembers.map(m => m.color);
    });
    line.color = line.segments[0]?.color || '#999999';
  });
  timelineEditor.refresh(); applyPlayerSettings();
  $('exportExcel').disabled = !state.lines.length;
  $('exportPrint').disabled = !state.lines.length;
  $('downloadIdol').disabled = !state.lines.length;
  const exportIdolBtn = $('exportIdolBtn'); if (exportIdolBtn) exportIdolBtn.disabled = !state.lines.length;
  const exportXlsxBtn = $('exportXlsxBtn'); if (exportXlsxBtn) exportXlsxBtn.disabled = !state.lines.length;
  const exportSubBtn = $('exportSubBtn'); if (exportSubBtn) exportSubBtn.disabled = !state.lines.length;
  $('downloadBurnAss').disabled = !state.lines.length || !state.mvName;
  if (state.mvName) renderBurnGuide(state);
  stage2.refresh(); playerApi.render(video.currentTime || 0); updateHeroMeta();
}

function validateMembersConfig(value) { if (!Array.isArray(value) || !value.length) throw new Error('成员配置必须是非空数组'); const ids = new Set(), names = new Set(); return value.map((member, index) => { if (!member || typeof member.name !== 'string' || !member.name.trim() || !/^#[0-9a-f]{6}$/i.test(member.color || '')) throw new Error(`第 ${index + 1} 个成员缺少有效 name 或 color`); const id = String(member.id || `m${index + 1}`); if (ids.has(id) || names.has(member.name.trim())) throw new Error('成员 id 和姓名不能重复'); ids.add(id); names.add(member.name.trim()); return { id, name: member.name.trim(), color: member.color.toUpperCase() }; }); }

function setProject(project, message) {
  state.songTitle = project.song_title;
  state.language = project.language;
  state.members = project.members;
  state.furigana = project.furigana || {};
  state.romaji = project.romaji || {};
  state.translations = project.translations || {};
  state.player = { subtitle_delay: 0, subtitle_position: 'bottom', show_member_name: false, show_furigana: true, font_family: '思源黑体', font_size: 30, show_romaji: true, show_translation: false, font_effect: 'none', ...(project.player || {}) };
  state.lines = project.lines.map(line => {
    const seconds = timeToSeconds(line.time);
    const endRaw = line.end_time ? timeToSeconds(line.end_time) : NaN;
    const endSeconds = Number.isFinite(endRaw) ? endRaw : seconds + 3;
    const segments = (line.segments || []).map(seg => ({ text: seg.text, member_id: seg.member_id, member_ids: Array.isArray(seg.member_ids) ? seg.member_ids : (seg.member_id ? [seg.member_id] : []), remark: seg.remark || '' }));
    return { ...line, seconds, end_seconds: endSeconds, end_time: line.end_time || formatTime(endSeconds), text: segments.map(segment => segment.text).join(''), segments };
  });
  resetMv();
  currentFormat = '';
  $('songTitle').value = state.songTitle;
  $('language').value = state.language;
  $('heroSong').textContent = state.songTitle;
  document.title = `${state.songTitle} · 地下偶像分词器`;
  renderMembers(); sync(); status(message);
}
function setDelay(value) { state.player.subtitle_delay = Math.round(Math.max(-10, Math.min(10, Number(value) || 0)) * 1000) / 1000; sync(); }
function fmtDelay(v) { return String(Math.round(v * 1000) / 1000); }

/** 截断过长的歌名显示（保留前 30 字符，超出加 …） */
function truncateTitle(title) {
  const t = String(title || '').trim();
  if (t.length <= 30) return t;
  return t.slice(0, 30) + '…';
}

/** 解析歌名：元数据曲名 → 艺术家 → 文件名（去扩展名）→ 兜底 */
function resolveSongTitle(meta, filename) {
  const base = (filename || '').replace(/\.[^.]+$/, '');
  // 优先使用元数据中的曲名，其次艺术家，再其次文件名
  const raw = meta?.ti || meta?.ar || base || '未命名歌曲';
  // 尝试解码可能的 URL 编码（如 %E6%…）
  try { return decodeURIComponent(raw); } catch { return raw; }
}

function handleLyricsText(text, filename) {
  const { lines, meta, format } = parseLyrics(text, { filename });
  if (!lines.length) { status('未能解析出任何歌词行，请确认文件格式', true); return; }
  state.lines = lines;
  state.furigana = {};
  state.romaji = {};
  state.translations = {};
  renderUnassigned([]);
  state.songTitle = $('songTitle').value = resolveSongTitle(meta, filename);
  $('heroSong').textContent = truncateTitle(state.songTitle) || '未命名歌曲';
  const fmtLabel = { lrc: 'LRC', srt: 'SRT', vtt: 'VTT', ass: 'ASS', scc: 'SCC', ttml: 'TTML', smi: 'SMI', text: 'TXT' }[format] || format.toUpperCase();
  currentFormat = fmtLabel;
  document.title = `${state.songTitle || '未命名歌曲'} · 地下偶像分词器`;
  stage2.reset();
  sync();
  status(`已导入 ${truncateTitle(filename || '歌词')}（${fmtLabel} · ${state.lines.length} 行）`);
}

// 文件导入
$('lrcFile').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  lastBuffer = await file.arrayBuffer();
  lastFilename = file.name;
  const encoding = $('encoding').value || 'utf-8';
  try {
    handleLyricsText(decodeLrc(lastBuffer, encoding), file.name);
    $('redecodeBtn').disabled = false;
  } catch {
    status('解码失败，请尝试切换编码', true);
  }
};
$('encoding').onchange = () => { if (lastBuffer) { try { handleLyricsText(decodeLrc(lastBuffer, $('encoding').value || 'utf-8'), lastFilename); } catch { status('编码不可用', true); } } };
$('redecodeBtn').onclick = () => { if (!lastBuffer) return; try { handleLyricsText(decodeLrc(lastBuffer, $('encoding').value || 'gbk'), lastFilename); } catch { status('编码不可用', true); } };
$('language').onchange = event => { state.language = event.target.value; sync(); };
$('songTitle').oninput = event => { state.songTitle = event.target.value; $('heroSong').textContent = truncateTitle(state.songTitle) || '未命名歌曲'; document.title = `${state.songTitle || '未命名歌曲'} · 地下偶像分词器`; };
$('addMember').onclick = addMember;
$('subtitleDelay').oninput = event => setDelay(event.target.value);
$('subtitleDelay').onblur = () => { $('subtitleDelay').value = fmtDelay(state.player.subtitle_delay); };
$('subtitleDelayMinus').onclick = () => setDelay(state.player.subtitle_delay - 0.1);
$('subtitleDelayPlus').onclick = () => setDelay(state.player.subtitle_delay + 0.1);
document.querySelectorAll('[data-position]').forEach(button => button.onclick = () => { state.player.subtitle_position = button.dataset.position; sync(); });
$('showFurigana').onchange = event => { state.player.show_furigana = event.target.checked; sync(); };
$('showMemberName').onchange = event => { state.player.show_member_name = event.target.checked; sync(); };
$('showRomaji').onchange = event => { state.player.show_romaji = event.target.checked; sync(); };
$('showTranslation').onchange = event => { state.player.show_translation = event.target.checked; sync(); };
$('fontFamily').onchange = event => { state.player.font_family = event.target.value; applyPlayerSettings(); };
$('fontSize').onchange = event => { state.player.font_size = Math.max(12, Math.min(96, Number(event.target.value) || 30)); event.target.value = state.player.font_size; applyPlayerSettings(); };
$('fontEffect').onchange = event => { state.player.font_effect = event.target.value; applyPlayerSettings(); };
$('fontSizeMinus').onclick = () => { state.player.font_size = Math.max(12, (state.player.font_size || 30) - 2); $('fontSize').value = state.player.font_size; applyPlayerSettings(); };
$('fontSizePlus').onclick = () => { state.player.font_size = Math.min(96, (state.player.font_size || 30) + 2); $('fontSize').value = state.player.font_size; applyPlayerSettings(); };
$('refreshSubtitleBtn').onclick = () => { playerApi.render(video.currentTime || 0); };

// 导出 Excel 分配表
$('exportExcel').onclick = () => { try { exportAssignments(state.lines, state.members, state.songTitle, 'assignment'); } catch (error) { status(error.message, true); } };
// 导出打印/分词表
$('exportPrint').onclick = () => { try { exportAssignments(state.lines, state.members, state.songTitle, 'print'); } catch (error) { status(error.message, true); } };
$('excelPick').onclick = () => $('excelFile').click();
$('excelFile').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const result = await importAssignments(file, state.members, state.lines);
    if (result.errors.length) return status(result.errors.join('；'), true);
    const ids = new Map(state.members.map(member => [member.name, member.id]));
    const groups = new Map();
    result.assignments.forEach(assignment => { const rows = groups.get(assignment.base_id) || []; const memberNames = (assignment.member || '').split('·').map(s => s.trim()).filter(Boolean); const memberIds = memberNames.map(name => ids.get(name)).filter(Boolean); rows.push({ ...assignment, member_id: memberIds[0] || null, member_ids: memberIds }); groups.set(assignment.base_id, rows); });
    state.lines.forEach(line => { const rows = groups.get(line.line_id) || []; if (!rows.length) return; line.segments = rows.map(row => ({ text: row.text || line.text, member_id: row.member_id, member_ids: row.member_ids, remark: row.remark || '' })); line.text = line.segments.map(s => s.text).join(''); });
    sync(); renderUnassigned(state.lines.filter(line => line.segments.some(segment => !(Array.isArray(segment.member_ids) ? segment.member_ids.length : segment.member_id)))); status('分配表已回收');
  } catch (error) { status(error.message, true); }
  event.target.value = '';
};

// 工程文件导出
$('downloadIdol').onclick = () => { download(JSON.stringify(serialize(), null, 2), `${state.songTitle || 'song'}.idol.json`, 'application/json'); status('完整工程已保存'); };
$('idolPick').onclick = () => $('idolFile').click();
$('idolFile').onchange = async event => { const file = event.target.files[0]; if (!file) return; try { setProject(await importProject(file), '已加载完整 .idol.json 工程'); } catch (error) { status(error.message, true); } event.target.value = ''; };

// 成员配置导入导出
const exportMembers = () => download(JSON.stringify({ version: 1, members: state.members.map(({ id, name, color }) => ({ id, name, color })) }, null, 2), `${state.songTitle || 'members'}.members.json`, 'application/json');
$('exportMembers').onclick = exportMembers;
$('membersFile').onchange = async event => { const file = event.target.files[0]; if (!file) return; try { const data = JSON.parse(await file.text()); state.members = validateMembersConfig(data.members || data); renderMembers(); sync(); status(`已导入 ${state.members.length} 名成员配置`); } catch (error) { status(error.message, true); } event.target.value = ''; };

// MV 上传
$('mvFile').onchange = event => {
  const file = event.target.files[0];
  if (!file) return;
  const video = $('video');
  state.mvName = file.name;
  if (state.mvUrl) URL.revokeObjectURL(state.mvUrl);
  state.mvUrl = URL.createObjectURL(file);
  video.src = state.mvUrl; video.load();
  mvReady = false;
  $('videoEmpty').style.display = '';
  timelineEditor.reload();
  renderBurnGuide(state); sync();
  const hideWhenReady = () => {
    if (video.readyState >= 1 || (video.videoWidth && video.videoHeight) || !Number.isNaN(video.duration)) {
      mvReady = true;
      $('videoEmpty').style.display = 'none';
      updateHeroMeta();
    }
  };
  video.onloadedmetadata = hideWhenReady;
  video.onloadeddata = hideWhenReady;
  video.oncanplay = hideWhenReady;
  video.onplay = hideWhenReady;
  video.ondurationchange = () => { hideWhenReady(); updateHeroMeta(); };
  video.onerror = () => status(`MV 无法在网页预览：${video.error?.message || '浏览器不支持该视频编码'}；压制指南仍可使用。`, true);
};
$('mvPick').onclick = () => $('mvFile').click();

// 压制用 ASS 下载
$('downloadBurnAss').onclick = () => { try { exportSubtitle('ass', state); } catch (error) { status(error.message, true); } };

// 播放器
const video = $('video');
const playerApi = setupPlayer({
  video,
  layer: $('lyricsLayer'),
  list: $('lyricsList'),
  currentTime: $('currentTime'),
  duration: $('duration'),
  fill: $('timelineFill'),
  getLines: () => state.lines,
  getFurigana: () => state.furigana,
  getRomaji: () => state.romaji,
  getTranslations: () => state.translations,
  getDelaySec: () => state.player.subtitle_delay,
  getShowMemberName: () => state.player.show_member_name,
  getPlayer: () => state.player,
});

const stage2 = initStage2({ onChanged: sync });
const timelineEditor = initTimelineEditor({ getVideo: () => video, onChanged: sync, onSubtitleEdit: () => playerApi.render(video.currentTime || 0) });

renderBurnGuide(state); renderMembers(); applyPlayerSettings();

// ---------------------------------------------------------------------------
// 步骤流：导出成品（第六步）
// ---------------------------------------------------------------------------
initStepFlow('exportFlow');

// 工程文件导出按钮
const exportIdolBtn = $('exportIdolBtn');
if (exportIdolBtn) {
  exportIdolBtn.onclick = () => {
    download(JSON.stringify(serialize(), null, 2), `${state.songTitle || 'song'}.idol.json`, 'application/json');
    status('工程文件已导出');
  };
}

// 分配表导出按钮
const exportXlsxBtn = $('exportXlsxBtn');
if (exportXlsxBtn) {
  exportXlsxBtn.onclick = () => {
    try { exportAssignments(state.lines, state.members, state.songTitle); status('分配表已导出'); } catch (e) { status(e.message, true); }
  };
}

// 字幕导出按钮
const exportSubBtn = $('exportSubBtn');
if (exportSubBtn) {
  exportSubBtn.onclick = () => {
    const fmt = $('subExportFormat')?.value || 'ass';
    try { exportSubtitle(fmt, state); status('字幕已导出'); } catch (e) { status(e.message, true); }
  };
}

// 顶栏合并导出（已移除，导出按钮移至导出歌词分配表区域）

// ---------------------------------------------------------------------------
// 步骤流：压制 MV（第七步）
// ---------------------------------------------------------------------------
initStepFlow('burnFlow');

// ---------------------------------------------------------------------------
// DeepSeek API Key 与模型绑定
// ---------------------------------------------------------------------------
$('dsKey').oninput = () => setDsApiKey($('dsKey').value.trim());
$('dsModel').onchange = () => setDsModel($('dsModel').value);


function bindDrop(target, input, accept) { ['dragenter', 'dragover'].forEach(type => target.addEventListener(type, event => { event.preventDefault(); target.classList.add('dragover'); })); ['dragleave', 'drop'].forEach(type => target.addEventListener(type, event => { event.preventDefault(); target.classList.remove('dragover'); })); target.addEventListener('drop', event => { const file = [...event.dataTransfer.files].find(candidate => !accept || accept(candidate)); if (!file) return; const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); }); }
bindDrop($('lrcDrop'), $('lrcFile'), file => /\.(lrc|txt|srt|vtt|ass|ssa|scc|ttml|dfxp|smi|sami|xml)$/i.test(file.name));
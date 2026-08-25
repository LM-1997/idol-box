import {formatTime} from './parsers.js';
import {renderRuby, escapeHtml} from './furigana.js';
import {FONT_FAMILY_MAP} from './font-map.js';

function renderLineText(text, reading, romaji, showRomaji, translation, showTranslation) {
  // 同轨道副字幕：罗马音紧跟在主歌词正下方一行小字（与主字幕同一层，永不重叠）
  const hasReading = reading && reading !== text;
  const hasRomaji = showRomaji && romaji;
  const hasTranslation = showTranslation && translation;
  const ruby = hasReading ? renderRuby(text, reading) : escapeHtml(text);
  const romajiSpan = hasRomaji ? `<span class="romaji">${escapeHtml(romaji)}</span>` : '';
  const translationSpan = hasTranslation ? `<span class="translation">${escapeHtml(translation)}</span>` : '';
  return `${ruby}${romajiSpan}${translationSpan}`;
}

/**
 * setupPlayer — 绑定原生 <video> 的事件，驱动歌词高亮与覆盖层渲染。
 *
 * 关键点：render 每次调用都通过 getLines() 实时读取最新的歌词数组，
 * 而不是在 setup 时闭包捕获快照。这样当 state.lines 被整体替换
 * （导入 LRC / 加载工程）后，无需重建监听，也无需 MutationObserver。
 *
 * @param {object} opts
 *   video, layer, list, currentTime, duration, fill  — DOM 元素
 *   getLines       — () => 最新歌词行数组
 *   getFurigana    — () => 假名词典对象（可选）
 *   getDelaySec    — () => 字幕延迟秒数
 *   onActive       — (line, index) 回调
 */
export function setupPlayer({video, layer, list, currentTime, duration, fill, getLines, getFurigana = () => ({}), getRomaji = () => ({}), getTranslations = () => ({}), getDelaySec = () => 0, getShowMemberName = () => false, getPlayer = () => ({}), onActive}) {
  if (video._lyricCleanup) video._lyricCleanup();

  // 渲染节流：缓存上一次 active 索引，仅变化时才重建歌词覆盖层 DOM；
  // timeupdate 高频触发时用 rAF 合并，避免长歌词每秒数十次全量 innerHTML。
  let lastActive = -2;       // -2 表示尚未渲染过（区别于 active=-1 的空状态）
  let scheduledFrame = 0;

  const render = rawTime => {
    const lines = getLines() || [];
    const furigana = getFurigana() || {};
    const romaji = getRomaji() || {};
    const translations = getTranslations() || {};
    const player = getPlayer() || {};
    const lyricTime = Math.max(0, rawTime - Number(getDelaySec() || 0));
    let active = -1;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const start = Number(ln.seconds);
      const end = Number.isFinite(ln.end_seconds) ? ln.end_seconds : start + 3;
      if (lyricTime >= start && lyricTime < end) active = i;
    }
    // 列表 active 高亮：每帧更新（轻量，仅切换 class）
    list.querySelectorAll('.lyric-row').forEach((row, index) => row.classList.toggle('active', index === active));
    // 歌词覆盖层：仅当 active 变化时重建（避免高频 DOM 重建）
    if (active !== lastActive) {
      lastActive = active;
      const line = lines[active];
      const segments = line?.segments || [];
      const showName = getShowMemberName();
      const showRomaji = !!player.show_romaji;
      const showTranslation = !!player.show_translation;
      layer.innerHTML = line
        ? `<span class="layer-line">${segments.map(segment => renderSegment(segment, line, showName, showRomaji, showTranslation, furigana, romaji, translations)).join('')}</span>`
        : '';
      if (active >= 0) onActive?.(line, active);
    }
    // 时间与进度条：每帧轻量更新
    currentTime.textContent = formatTime(rawTime);
    if (video.duration) fill.style.width = `${Math.min(100, rawTime / video.duration * 100)}%`;
  };

  /** 强制重建覆盖层（外部主动调用 render 时已走 render；此函数用于 settings 变更后清缓存） */
  const invalidate = () => { lastActive = -2; };

  /**
   * 渲染单个演唱分段：
   *  - 单成员：该成员应援色 + 成员名前缀（若开启）
   *  - 多成员（合唱）：渐变文字 + 成员名用「·」连接
   *  - 分段之间由外层 join('') 紧凑拼接；文本自带空隙由内容决定。
   */
  const renderSegment = (segment, line, showName, showRomaji, showTranslation, furigana, romaji, translations) => {
    const colors = Array.isArray(segment.colors) && segment.colors.length ? segment.colors : [segment.color || line.color || '#999999'];
    const name = (showName && segment.member_name) ? `${escapeHtml(segment.member_name)}：` : '';
    const body = renderLineText(segment.text, furigana[segment.text], romaji[segment.text], showRomaji, translations[segment.text], showTranslation);
    if (colors.length > 1) {
      // 合唱：多成员渐变文字（背景裁剪）
      const grad = `linear-gradient(90deg, ${colors.join(',')})`;
      return `<span class="layer-seg layer-seg-chorus" style="--seg-grad:${grad}">${name}${body}</span>`;
    }
    return `<span class="layer-seg" style="color:${colors[0]}">${name}${body}</span>`;
  };

  const applyFontStyle = () => {
    const player = getPlayer() || {};
    const family = FONT_FAMILY_MAP[player.font_family] || player.font_family || 'Noto Sans SC';
    layer.style.fontFamily = `"${family}", "PingFang SC", "Microsoft YaHei", sans-serif`;
    layer.style.setProperty('--lyric-size', `${player.font_size || 30}px`);
    layer.dataset.fx = player.font_effect || 'none';
    // 字体/字号/特效变更后，强制下次渲染重建覆盖层（应用新样式）
    invalidate();
  };

  video._idolRender = render;
  // timeupdate 高频触发，用 rAF 合并为每帧一次
  const onTime = () => {
    if (scheduledFrame) return;
    scheduledFrame = requestAnimationFrame(() => { scheduledFrame = 0; render(video.currentTime); });
  };
  const onMeta = () => { duration.textContent = formatTime(video.duration); };
  video.addEventListener('timeupdate', onTime);
  video.addEventListener('loadedmetadata', onMeta);
  applyFontStyle();
  video._lyricCleanup = () => {
    if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
    video.removeEventListener('timeupdate', onTime);
    video.removeEventListener('loadedmetadata', onMeta);
  };
  return { render, applyFontStyle, invalidate };
}

import {formatTime} from './parsers.js';
import {renderRuby, escapeHtml} from './furigana.js';

/**
 * 下拉选项值（中文名）→ 真实 font-family 名。
 * 开源字体通过 CDN 加载（见 index.html），系统字体直接可用；
 * 无法免费加载的字体映射到相近的开源/系统字体，保证切换必有可见变化。
 */
const FONT_FAMILY_MAP = {
  '思源黑体': '"Noto Sans SC"',
  '思源宋体': '"Noto Serif SC"',
  '霞鹜文楷': '"LXGW WenKai"',
  '霞鹜文楷轻便版': '"LXGW WenKai Mono"',
};

function renderLineText(text, reading, romaji, showRomaji) {
  // 同轨道副字幕：罗马音紧跟在主歌词正下方一行小字（与主字幕同一层，永不重叠）
  const hasReading = reading && reading !== text;
  const hasRomaji = showRomaji && romaji;
  if (hasReading && hasRomaji) {
    return `<ruby>${escapeHtml(text)}<rt>${escapeHtml(reading)}</rt></ruby><span class="romaji">${escapeHtml(romaji)}</span>`;
  }
  if (hasReading) return renderRuby(text, reading);
  if (hasRomaji) return `${escapeHtml(text)}<span class="romaji">${escapeHtml(romaji)}</span>`;
  return escapeHtml(text);
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
export function setupPlayer({video, layer, list, currentTime, duration, fill, getLines, getFurigana = () => ({}), getRomaji = () => ({}), getDelaySec = () => 0, getShowMemberName = () => false, getPlayer = () => ({}), onActive}) {
  if (video._lyricCleanup) video._lyricCleanup();

  const render = rawTime => {
    const lines = getLines() || [];
    const furigana = getFurigana() || {};
    const romaji = getRomaji() || {};
    const player = getPlayer() || {};
    const lyricTime = Math.max(0, rawTime - Number(getDelaySec() || 0));
    let active = -1;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const start = Number(ln.seconds);
      const end = Number.isFinite(ln.end_seconds) ? ln.end_seconds : start + 3;
      if (lyricTime >= start && lyricTime < end) active = i;
    }
    list.querySelectorAll('.lyric-row').forEach((row, index) => row.classList.toggle('active', index === active));
    const line = lines[active];
    const segments = line?.segments || [];
    const showName = getShowMemberName();
    const showRomaji = !!player.show_romaji;
    layer.innerHTML = line
      ? `<span class="layer-line">${segments.map(segment => renderSegment(segment, line, showName, showRomaji, furigana, romaji)).join('')}</span>`
      : '';
    currentTime.textContent = formatTime(rawTime);
    if (video.duration) fill.style.width = `${Math.min(100, rawTime / video.duration * 100)}%`;
    if (active >= 0) onActive?.(line, active);
  };

  /**
   * 渲染单个演唱分段：
   *  - 单成员：该成员应援色 + 成员名前缀（若开启）
   *  - 多成员（合唱）：渐变文字 + 成员名用「·」连接
   *  - 分段之间由外层 join('') 紧凑拼接；文本自带空隙由内容决定。
   */
  const renderSegment = (segment, line, showName, showRomaji, furigana, romaji) => {
    const colors = Array.isArray(segment.colors) && segment.colors.length ? segment.colors : [segment.color || line.color || '#999999'];
    const name = (showName && segment.member_name) ? `${escapeHtml(segment.member_name)}：` : '';
    const body = renderLineText(segment.text, furigana[segment.text], romaji[segment.text], showRomaji);
    if (colors.length > 1) {
      // 合唱：多成员渐变文字（背景裁剪）
      const grad = `linear-gradient(90deg, ${colors.join(',')})`;
      return `<span class="layer-seg layer-seg-chorus" style="--seg-grad:${grad}">${name}${body}</span>`;
    }
    return `<span class="layer-seg" style="color:${colors[0]}">${name}${body}</span>`;
  };

  const applyFontStyle = () => {
    const player = getPlayer() || {};
    const family = FONT_FAMILY_MAP[player.font_family] || `"${player.font_family}"`;
    layer.style.fontFamily = `${family}, "PingFang SC", "Microsoft YaHei", sans-serif`;
    layer.style.setProperty('--lyric-size', `${player.font_size || 30}px`);
    layer.dataset.fx = player.font_effect || 'none';
  };

  video._idolRender = render;
  const onTime = () => render(video.currentTime);
  const onMeta = () => { duration.textContent = formatTime(video.duration); };
  video.addEventListener('timeupdate', onTime);
  video.addEventListener('loadedmetadata', onMeta);
  applyFontStyle();
  video._lyricCleanup = () => {
    video.removeEventListener('timeupdate', onTime);
    video.removeEventListener('loadedmetadata', onMeta);
  };
  return { render, applyFontStyle };
}

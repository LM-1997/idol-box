/**
 * font-map.js — 字体名映射共享常量。
 *
 * 下拉选项值（中文名）→ ASS / CSS 可用的真实 font-family 名。
 * 开源字体通过 CDN 加载（见 index.html），系统字体直接可用。
 * player.js 与 subtitle-export.js 共用此映射，保证预览与导出一致。
 */
export const FONT_FAMILY_MAP = {
  '思源黑体': 'Noto Sans SC',
  '思源宋体': 'Noto Serif SC',
  '霞鹜文楷': 'LXGW WenKai',
  '霞鹜文楷轻便版': 'LXGW WenKai Mono',
};

/**
 * 将中文下拉值映射为 ASS 可用字体名（直接用英文名，ASS 不需要引号）。
 */
export function assFontName(displayName) {
  return FONT_FAMILY_MAP[displayName] || 'Noto Sans SC';
}

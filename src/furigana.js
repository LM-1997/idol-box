/**
 * furigana.js — 假名 / 罗马音渲染辅助。
 *
 * 注：本地 kuroshiro 词典引擎已弃用，注音改为智谱 GLM-4.7-Flash（见 glm.js）。
 * 本模块仅保留渲染用辅助函数（escapeHtml / renderRuby）。
 */

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function renderRuby(text, reading) {
  return reading && reading !== text
    ? `<ruby>${escapeHtml(text)}<rt>${escapeHtml(reading)}</rt></ruby>`
    : escapeHtml(text);
}

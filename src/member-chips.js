/**
 * member-chips.js — 成员多选 chips 组件（支持一句/一段多个成员「合唱」）。
 *
 * 数据模型：segment.member_ids 为成员 id 数组（空数组 = 未分配）。
 * 兼容旧字段：若仍是 segment.member_id（单值），归一化为 [member_id]。
 */

import { state } from './store.js';

function esc(v) { return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/** 归一化 segment 的成员 id 数组 */
export function segMemberIds(seg) {
  if (Array.isArray(seg.member_ids)) return seg.member_ids.filter(Boolean);
  if (seg.member_id) return [seg.member_id];
  return [];
}

/** 生成成员多选 chips 的 HTML */
export function memberChipsHtml(seg) {
  const ids = new Set(segMemberIds(seg));
  return `<span class="member-chips">${state.members.map(m => {
    const on = ids.has(m.id);
    return `<button type="button" class="member-chip${on ? ' on' : ''}" data-member="${esc(m.id)}" title="${esc(m.name)}"><i style="background:${esc(m.color)}"></i>${esc(m.name)}</button>`;
  }).join('')}</span>`;
}

/** 绑定 chips 点击：切换成员、写回 seg.member_ids、触发 onChange */
export function bindMemberChips(container, seg, onChange) {
  container.querySelectorAll('.member-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.member;
      let ids = seg.member_ids;
      if (!Array.isArray(ids)) ids = seg.member_ids = segMemberIds(seg);
      const i = ids.indexOf(id);
      if (i >= 0) ids.splice(i, 1); else ids.push(id);
      chip.classList.toggle('on', i < 0);
      onChange?.(id);
    });
  });
}

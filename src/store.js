/**
 * store.js — 单一状态源
 *
 * state 是唯一真源：所有模块通过 `import { state }` 读取同一对象，
 * 直接修改 state 后各自触发渲染。
 *
 * 说明：原先的「自动保存 + 上次未保存工程恢复」机制已移除——它只能恢复
 * 歌词/成员/设置，无法恢复 MV 视频（blob 不持久化），且每次刷新后都会
 * 弹出误导性的「未保存」提示，实际价值很低。工程请通过「导出完整工程
 * （.idol.json）」显式保存。
 */

export const state = {
  lines: [],
  members: [
    { id: 'm1', name: '小唯', color: '#FFFFFF' },
    { id: 'm2', name: '楠城', color: '#008CFF' },
    { id: 'm3', name: 'kyaku', color: '#C084FC' },
    { id: 'm4', name: '小次', color: '#00FF2A' },
  ],
  language: 'ja',
  songTitle: '',
  mvName: '',
  mvUrl: '',
  furigana: {},
  romaji: {},
  translations: {},
  player: { subtitle_delay: 0, subtitle_position: 'bottom', show_member_name: false, font_family: '思源黑体', font_size: 30, show_romaji: true, show_translation: false, font_effect: 'none' },
};

/** 完整工程数据（用于导出 .idol.json；不含运行时 blob） */
export function serialize() {
  return {
    version: 2,
    song_title: state.songTitle || '未命名歌曲',
    language: state.language,
    members: state.members.map(({ id, name, color }) => ({ id, name, color })),
    lines: state.lines.map(line => ({
      line_id: line.line_id,
      time: line.time,
      end_time: line.end_time || null,
      segments: line.segments.map((seg, index) => ({
        segment_id: `${line.line_id}${String.fromCharCode(97 + index)}`,
        text: seg.text,
        member_id: seg.member_id,
        member_ids: seg.member_ids || (seg.member_id ? [seg.member_id] : []),
        remark: seg.remark || '',
      })),
    })),
    furigana: state.furigana,
    romaji: state.romaji,
    translations: state.translations || {},
    player: { ...state.player },
  };
}

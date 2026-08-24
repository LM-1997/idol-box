const LANGUAGES = new Set(['ja', 'zh', 'en']);
const POSITIONS = new Set(['top', 'bottom']);

export async function importProject(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('无法解析 .idol.json：文件不是有效 JSON'); }
  validateProject(data);
  return normalizeProject(data);
}

export function validateProject(data) {
  if (!data || ![1, 2].includes(data.version)) throw new Error('仅支持 version: 1 或 2 的 .idol.json');
  if (typeof data.song_title !== 'string' || !LANGUAGES.has(data.language)) throw new Error('项目缺少有效的 song_title 或 language');
  if (!Array.isArray(data.members) || !Array.isArray(data.lines) || typeof data.furigana !== 'object' || data.furigana === null) throw new Error('项目结构不符合 members / lines / furigana 契约');
  if (data.version === 2 && data.player !== undefined) validatePlayer(data.player);
  const memberIds = new Set();
  data.members.forEach(member => {
    if (!member.id || typeof member.name !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(member.color)) throw new Error('成员数据必须包含 id、name 和 #RRGGBB color');
    if (memberIds.has(member.id)) throw new Error(`成员 id 重复：${member.id}`);
    memberIds.add(member.id);
  });
  const lineIds = new Set();
  data.lines.forEach(line => {
    if (!line.line_id || !/^\d{2}:\d{2}\.\d{3}$/.test(line.time) || !Array.isArray(line.segments) || !line.segments.length) throw new Error('歌词行不符合 line_id / time / segments 契约');
    if (line.end_time !== undefined && line.end_time !== null && !/^\d{2}:\d{2}\.\d{3}$/.test(line.end_time)) throw new Error(`歌词 ${line.line_id} 的 end_time 不符合 mm:ss.xxx`);
    if (lineIds.has(line.line_id)) throw new Error(`歌词 line_id 重复：${line.line_id}`);
    lineIds.add(line.line_id);
    line.segments.forEach(segment => {
      if (typeof segment.text !== 'string') throw new Error(`歌词 ${line.line_id} 包含无效 segment.text`);
      const segIds = Array.isArray(segment.member_ids) ? segment.member_ids : (segment.member_id ? [segment.member_id] : []);
      if (segIds.some(id => id !== null && id !== undefined && !memberIds.has(id))) throw new Error(`歌词 ${line.line_id} 包含无效 member_id`);
      if (segment.member_id !== undefined && segment.member_id !== null && !memberIds.has(segment.member_id)) throw new Error(`歌词 ${line.line_id} 包含无效 member_id`);
    });
  });
}

export function normalizeProject(data) {
  const p = data.player || {};
  return {
    ...data,
    version: 2,
    player: {
      subtitle_delay: normalizeDelay(data.player),
      subtitle_position: POSITIONS.has(data.player?.subtitle_position) ? data.player.subtitle_position : 'bottom',
      show_member_name: !!data.player?.show_member_name,
      font_family: typeof p.font_family === 'string' ? p.font_family : '思源黑体',
      font_size: Number.isFinite(Number(p.font_size)) ? Math.max(12, Math.min(96, Number(p.font_size))) : 30,
      show_romaji: p.show_romaji !== false,
      font_effect: typeof p.font_effect === 'string' ? p.font_effect : 'none',
    }
  };
}

export function timeToSeconds(time) { const [minutes, rest] = time.split(':'); return Number(minutes) * 60 + Number(rest); }

function validatePlayer(player) {
  if (!player || typeof player !== 'object') throw new Error('player 必须是对象');
  if (player.subtitle_delay !== undefined && (!Number.isFinite(Number(player.subtitle_delay)) || Math.abs(Number(player.subtitle_delay)) > 10)) throw new Error('字幕延迟必须在 -10 到 10 秒之间');
  if (player.subtitle_delay_ms !== undefined && (!Number.isFinite(Number(player.subtitle_delay_ms)) || Math.abs(Number(player.subtitle_delay_ms)) > 10000)) throw new Error('旧版字幕延迟字段无效');
  if (player.subtitle_position !== undefined && !POSITIONS.has(player.subtitle_position)) throw new Error('字幕位置必须为 top 或 bottom');
}

function normalizeDelay(player = {}) {
  const seconds = player.subtitle_delay !== undefined ? Number(player.subtitle_delay) : Number(player.subtitle_delay_ms || 0) / 1000;
  return Math.max(-10, Math.min(10, Number.isFinite(seconds) ? seconds : 0));
}

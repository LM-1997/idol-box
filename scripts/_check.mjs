import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
function has(rel, ...subs) {
  const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  return subs.map(x => `  ${x}: ${s.includes(x) ? 'OK' : 'MISS'}`);
}
const groups = [
  ['--- server.js ---', 'server.js', ['scanLyrics', 'LYRICS_ROOT', '/api/lyrics']],
  ['--- main.js ---', 'src/main.js', ['f.rel', 'f.song', 'lyricsFiles.find', 'setDsApiKey', 'setDsModel', 'lyricsReqId', 'truncateTitle', 'resolveSongTitle']],
  ['--- glm.js ---', 'src/glm.js', ['DeepSeek', 'DEEPSEEK_ENDPOINT', 'classifyHttpError', 'classifyError']],
  ['--- step-flow.js ---', 'src/step-flow.js', ['initStepFlow', 'sf-progress', 'showStep', 'renderProgress']],
  ['--- timeline-editor.css ---', 'src/styles/timeline-editor.css', ['.lyrics-list.hide-time']],
  ['--- player.js ---', 'src/player.js', ['renderSegment', 'layer-seg-chorus', 'FONT_FAMILY_MAP']],
  ['--- main.css ---', 'src/styles/main.css', ['.layer-seg-chorus']],
  ['--- index.html ---', 'index.html', ['dsKey', 'dsModel', 'deepseek-v4-pro', 'deepseek-v4-flash', 'step-flow', 'sf-confirm', 'sf-progress']],
  ['--- stage2.css ---', 'src/styles/stage2.css', ['ds-settings', 'ds-hint', 'ds-link']],
  ['--- stage3.css ---', 'src/styles/stage3.css', ['text-shadow:-1px -1px 0']],
  ['--- burn-guide.js ---', 'src/burn-guide.js', ['renderBurnGuide', 'burnMeta', 'burnOutput', 'burnFfmpeg']],
  ['--- step-flow.css ---', 'src/styles/step-flow.css', ['sf-progress', 'sf-progress-dot', 'sf-confirm']],
];
for (const [title, f, subs] of groups) {
  console.log(title);
  console.log(has(f, ...subs).join('\n'));
}
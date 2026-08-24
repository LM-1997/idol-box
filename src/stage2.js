import { state } from './store.js';
import { generateReadings, toFuriganaMap, toRomajiMap, translateLyrics, toTranslationMap } from './glm.js';

const $ = id => document.getElementById(id);

function esc(v) { return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/** 收集所有需要注音的"词"（每段歌词文本去重后作为注音单位，与播放层 lookup 对齐） */
function collectWords() {
  const words = [];
  const seen = new Set();
  state.lines.forEach(line => {
    line.segments.forEach(seg => {
      const text = String(seg.text || '').trim();
      if (text && !seen.has(text)) { seen.add(text); words.push(text); }
    });
  });
  return words;
}

/**
 * initStage2 — 假名 / 罗马音注音入口。
 * 句中分段已迁移到时间轴编辑器的「拆句」功能，这里不再提供分段编辑器。
 * 由 main.js 调用初始化；onChanged 在「生成假名」这类需要全量重渲染的操作后回调
 * （即 main 的 sync）。假名逐词修正只更新数据层，播放层 ruby 会随 timeupdate 自然反映。
 * @param {{ onChanged: Function }} deps
 * @returns {{ refresh: Function, reset: Function }}
 */
export function initStage2({ onChanged }) {
  function renderFurigana() {
    const box = $('furiganaEditor');
    const romaji = state.romaji || {};
    const keys = [...new Set([...Object.keys(state.furigana), ...Object.keys(romaji)])];
    box.innerHTML = keys.length ? keys.map(k => `<div class="furigana-row"><span>${esc(k)}</span><input data-f="${esc(k)}" value="${esc(state.furigana[k] || '')}" placeholder="假名" aria-label="假名"><input data-r="${esc(k)}" value="${esc(romaji[k] || '')}" placeholder="罗马音" aria-label="罗马音"></div>`).join('') : '<span class="editor-empty">尚未生成注音。点击上方按钮用 AI 生成假名 / 罗马音。</span>';
    box.querySelectorAll('[data-f]').forEach(x => x.oninput = () => { if (x.value.trim()) state.furigana[x.dataset.f] = x.value.trim(); else delete state.furigana[x.dataset.f]; });
    box.querySelectorAll('[data-r]').forEach(x => x.oninput = () => { if (x.value.trim()) state.romaji[x.dataset.r] = x.value.trim(); else delete state.romaji[x.dataset.r]; });
  }

  function refresh() {
    const isJa = state.language === 'ja';
    $('furiganaTool').hidden = false;
    const buttons = [$('generateFurigana'), $('generateRomaji'), $('generateTranslation')];
    buttons.forEach(b => { b.disabled = !isJa; });
    const hint = $('furiganaHint');
    if (hint) hint.textContent = isJa ? '' : '仅支持日语字幕生成假名注音和罗马音';
    renderFurigana();
  }

  // ---- 进度 UI 辅助（大模型生成时展示，避免用户以为卡住） ----
  const BATCH = 24;
  function showProgress(on) { const wrap = $('aiProgressWrap'); if (wrap) wrap.hidden = !on; }
  function setProgress(done, total, label) {
    const fill = $('aiProgressFill'); const text = $('aiProgressText');
    const pct = total ? Math.round(done / total * 100) : 0;
    if (fill) fill.style.width = `${pct}%`;
    if (text) text.textContent = label || `${done}/${total}（${pct}%）`;
  }

  /** 生成入口（假名 / 罗马音共用）：分批请求 + 进度展示，结果写回对应词典 */
  async function runGeneration(kind) {
    const isFurigana = kind === 'furigana';
    const label = isFurigana ? '假名注音' : '罗马音';
    if (state.language !== 'ja') { $('importStatus').textContent = `仅支持日语字幕生成${label}`; $('importStatus').className = 'status error'; return; }
    $('generateFurigana').disabled = true; $('generateRomaji').disabled = true;
    showProgress(true);
    try {
      const words = collectWords();
      if (!words.length) { setProgress(0, 0, '没有可标注的歌词'); $('importStatus').textContent = '没有可标注的歌词'; $('importStatus').className = 'status error'; return; }
      const batches = [];
      for (let i = 0; i < words.length; i += BATCH) batches.push(words.slice(i, i + BATCH));
      let done = 0;
      const allReadings = [];
      for (let b = 0; b < batches.length; b++) {
        setProgress(done, words.length, `正在生成${label}… 第 ${b + 1}/${batches.length} 批（${done}/${words.length}）`);
        const { readings } = await generateReadings(batches[b], { language: state.language });
        allReadings.push(...readings);
        done += batches[b].length;
        setProgress(done, words.length, `已生成 ${done}/${words.length}`);
      }
      if (isFurigana) Object.assign(state.furigana, toFuriganaMap(allReadings));
      else Object.assign(state.romaji, toRomajiMap(allReadings));
      renderFurigana();
      onChanged();
      setProgress(words.length, words.length, '完成 ✓');
      $('importStatus').textContent = `已生成 ${allReadings.filter(r => (isFurigana ? r.hiragana : r.romaji)).length} 条${label}`;
      $('importStatus').className = 'status ok';
    } catch (e) {
      $('importStatus').textContent = e.message;
      $('importStatus').className = 'status error';
    } finally {
      $('generateFurigana').disabled = false; $('generateRomaji').disabled = false;
      setTimeout(() => showProgress(false), 1200);
    }
  }

  $('generateFurigana').onclick = () => runGeneration('furigana');
  $('generateRomaji').onclick = () => runGeneration('romaji');
  $('generateTranslation').onclick = () => runTranslation();

  async function runTranslation() {
    const label = '简体中文翻译';
    $('generateFurigana').disabled = true; $('generateRomaji').disabled = true; $('generateTranslation').disabled = true;
    showProgress(true);
    try {
      const words = collectWords();
      if (!words.length) { setProgress(0, 0, '没有可翻译的歌词'); $('importStatus').textContent = '没有可翻译的歌词'; $('importStatus').className = 'status error'; return; }
      const batches = [];
      for (let i = 0; i < words.length; i += BATCH) batches.push(words.slice(i, i + BATCH));
      let done = 0;
      const allTranslations = [];
      for (let b = 0; b < batches.length; b++) {
        setProgress(done, words.length, `正在生成${label}… 第 ${b + 1}/${batches.length} 批（${done}/${words.length}）`);
        const { translations } = await translateLyrics(batches[b], { language: state.language });
        allTranslations.push(...translations);
        done += batches[b].length;
        setProgress(done, words.length, `已翻译 ${done}/${words.length}`);
      }
      // 初始化 translations 词典
      if (!state.translations) state.translations = {};
      Object.assign(state.translations, toTranslationMap(allTranslations));
      renderFurigana();
      onChanged();
      setProgress(words.length, words.length, '完成 ✓');
      $('importStatus').textContent = `已翻译 ${allTranslations.filter(r => r.translation).length} 条`;
      $('importStatus').className = 'status ok';
    } catch (e) {
      $('importStatus').textContent = e.message;
      $('importStatus').className = 'status error';
    } finally {
      $('generateFurigana').disabled = false; $('generateRomaji').disabled = false; $('generateTranslation').disabled = false;
      setTimeout(() => showProgress(false), 1200);
    }
  }

  refresh();
  return { refresh, reset: () => {} };
}
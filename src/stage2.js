import { state } from './store.js';
import { generateReadings, toFuriganaMap, toRomajiMap, translateLyrics, toTranslationMap } from './glm.js';
import { toast } from './toast.js';

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
    const translations = state.translations || {};
    const keys = [...new Set([...Object.keys(state.furigana), ...Object.keys(romaji), ...Object.keys(translations)])];
    box.innerHTML = keys.length ? keys.map(k => `<div class="furigana-row"><span>${esc(k)}</span><input data-f="${esc(k)}" value="${esc(state.furigana[k] || '')}" placeholder="假名" aria-label="假名"><input data-r="${esc(k)}" value="${esc(romaji[k] || '')}" placeholder="罗马音" aria-label="罗马音"><input data-t="${esc(k)}" value="${esc(translations[k] || '')}" placeholder="翻译" aria-label="翻译"></div>`).join('') : '<span class="editor-empty">尚未生成注音。点击上方按钮用 AI 生成假名 / 罗马音 / 翻译。</span>';
    box.querySelectorAll('[data-f]').forEach(x => x.oninput = () => { if (x.value.trim()) state.furigana[x.dataset.f] = x.value.trim(); else delete state.furigana[x.dataset.f]; });
    box.querySelectorAll('[data-r]').forEach(x => x.oninput = () => { if (x.value.trim()) state.romaji[x.dataset.r] = x.value.trim(); else delete state.romaji[x.dataset.r]; });
    box.querySelectorAll('[data-t]').forEach(x => x.oninput = () => { if (!state.translations) state.translations = {}; if (x.value.trim()) state.translations[x.dataset.t] = x.value.trim(); else delete state.translations[x.dataset.t]; });
  }

  function refresh() {
    const isJa = state.language === 'ja';
    const isZh = state.language === 'zh';
    $('furiganaTool').hidden = false;
    // 假名和罗马音仅日语可用
    $('generateFurigana').disabled = !isJa;
    $('generateRomaji').disabled = !isJa;
    // 翻译仅中文不可用（中文已是目标语言）
    $('generateTranslation').disabled = isZh;
    const hint = $('furiganaHint');
    if (hint) {
      if (isZh) hint.textContent = '当前歌词已是中文，无需翻译';
      else if (!isJa) hint.textContent = '';
      else hint.textContent = '';
    }
    renderFurigana();
  }

  // ---- 进度 UI（toast 进度通知，右上角固定浮层） ----
  const BATCH = 24;

  /** 生成入口（假名 / 罗马音共用）：分批请求 + toast 进度，结果写回对应词典 */
  async function runGeneration(kind) {
    const isFurigana = kind === 'furigana';
    const label = isFurigana ? '假名注音' : '罗马音';
    if (state.language !== 'ja') { toast(`仅支持日语字幕生成${label}`, 'error'); return; }
    $('generateFurigana').disabled = true; $('generateRomaji').disabled = true;
    const progress = toast.progress(`正在生成${label}…`);
    try {
      const words = collectWords();
      if (!words.length) { progress.error('没有可标注的歌词'); return; }
      const batches = [];
      for (let i = 0; i < words.length; i += BATCH) batches.push(words.slice(i, i + BATCH));
      let done = 0;
      const allReadings = [];
      for (let b = 0; b < batches.length; b++) {
        progress.update(done, words.length, `第 ${b + 1}/${batches.length} 批  ·  ${done}/${words.length} 条`);
        const { readings, log } = await generateReadings(batches[b], { language: state.language });
        if (log?.length) console.log(`[${label} 第${b + 1}批]`, log.join('\n'));
        allReadings.push(...readings);
        done += batches[b].length;
        progress.update(done, words.length, `第 ${b + 1}/${batches.length} 批  ·  ${done}/${words.length} 条`);
      }
      if (isFurigana) Object.assign(state.furigana, toFuriganaMap(allReadings));
      else Object.assign(state.romaji, toRomajiMap(allReadings));
      renderFurigana();
      onChanged();
      const count = allReadings.filter(r => (isFurigana ? r.hiragana : r.romaji)).length;
      progress.ok(`已生成 ${count} 条${label}`);
    } catch (e) {
      progress.error(e.message);
    } finally {
      $('generateFurigana').disabled = false; $('generateRomaji').disabled = false;
    }
  }

  $('generateFurigana').onclick = () => runGeneration('furigana');
  $('generateRomaji').onclick = () => runGeneration('romaji');
  $('generateTranslation').onclick = () => runTranslation();

  async function runTranslation() {
    const label = '简体中文翻译';
    if (state.language === 'zh') { toast('当前歌词已是中文，无需翻译', 'warn'); return; }
    $('generateFurigana').disabled = true; $('generateRomaji').disabled = true; $('generateTranslation').disabled = true;
    const progress = toast.progress(`正在生成${label}…`);
    try {
      const words = collectWords();
      if (!words.length) { progress.error('没有可翻译的歌词'); return; }
      const batches = [];
      for (let i = 0; i < words.length; i += BATCH) batches.push(words.slice(i, i + BATCH));
      let done = 0;
      const allTranslations = [];
      for (let b = 0; b < batches.length; b++) {
        progress.update(done, words.length, `第 ${b + 1}/${batches.length} 批  ·  ${done}/${words.length} 条`);
        const { translations, log } = await translateLyrics(batches[b], { language: state.language });
        if (log?.length) console.log(`[翻译 第${b + 1}批]`, log.join('\n'));
        allTranslations.push(...translations);
        done += batches[b].length;
        progress.update(done, words.length, `第 ${b + 1}/${batches.length} 批  ·  ${done}/${words.length} 条`);
      }
      // 初始化 translations 词典
      if (!state.translations) state.translations = {};
      Object.assign(state.translations, toTranslationMap(allTranslations));
      renderFurigana();
      onChanged();
      const count = allTranslations.filter(r => r.translation).length;
      if (count > 0) {
        progress.ok(`已翻译 ${count} 条`);
      } else {
        progress.error(`翻译完成但未获取到有效结果（0/${allTranslations.length} 条），请打开浏览器控制台查看 API 返回详情`);
      }
    } catch (e) {
      progress.error(e.message);
    } finally {
      $('generateFurigana').disabled = false; $('generateRomaji').disabled = false; $('generateTranslation').disabled = false;
    }
  }

  refresh();
  return {
    refresh,
    /** 导入新歌词时重置：刷新编辑器 */
    reset() {
      renderFurigana();
    },
  };
}
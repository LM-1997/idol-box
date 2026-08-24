/**
 * glm.js — DeepSeek 注音服务（假名 + 罗马音），纯前端直连。
 *
 * 变更说明：
 *   - 仅支持 DeepSeek，不再支持多服务商、自定义 API 地址
 *   - API Key 仅存当前页面 JS 内存变量，不写入 localStorage/sessionStorage/cookie
 *   - 页面刷新或关闭后 Key 清空，下次使用需重新填写
 *   - 前端直接 fetch https://api.deepseek.com/chat/completions
 *   - 明确区分 CORS 错误、Key 无效、余额不足、网络错误等异常
 */

// ---------------------------------------------------------------------------
// DeepSeek API 配置（仅存内存，不持久化）
// ---------------------------------------------------------------------------

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

let dsApiKey = '';
let dsModel = 'deepseek-v4-flash';

/** 设置 DeepSeek API Key（仅存当前会话内存） */
export function setDsApiKey(key) {
  dsApiKey = String(key || '').trim();
}

/** 获取当前 DeepSeek API Key */
export function getDsApiKey() {
  return dsApiKey;
}

/** 设置 DeepSeek 模型 */
export function setDsModel(model) {
  dsModel = String(model || 'deepseek-v4-flash').trim();
}

/** 获取当前 DeepSeek 模型 */
export function getDsModel() {
  return dsModel;
}

// ---------------------------------------------------------------------------
// 错误分类
// ---------------------------------------------------------------------------

function classifyError(err) {
  const msg = String(err.message || err || '');
  // CORS / 网络错误（fetch 级别的 TypeError，通常带 "Failed to fetch"）
  if (err.name === 'TypeError' && /fetch|network|failed to fetch/i.test(msg)) {
    return '当前功能受浏览器跨域限制无法直接调用 DeepSeek API，请联系开发者处理 CORS 问题';
  }
  return null;
}

function classifyHttpError(status, body) {
  // 尝试从响应体中提取错误信息
  let detail = '';
  try {
    if (body?.error?.message) detail = body.error.message;
  } catch { /* 忽略 */ }

  if (status === 401) {
    return 'API Key 无效或已过期，请检查 Key 是否正确';
  }
  if (status === 402) {
    return 'DeepSeek 账户余额不足，请前往 platform.deepseek.com 充值';
  }
  if (status === 429) {
    return '请求频率过高，请稍后重试';
  }
  if (status === 403) {
    return 'API Key 无权访问该资源，请检查账户权限';
  }
  if (status >= 500) {
    return `DeepSeek 服务器错误（HTTP ${status}），请稍后重试`;
  }
  return `DeepSeek API 请求失败（HTTP ${status}）${detail ? '：' + detail : ''}`;
}

// ---------------------------------------------------------------------------
// 核心：生成注音
// ---------------------------------------------------------------------------

/**
 * 生成指定词的假名 + 罗马音
 * @param {string[]} words - 需要注音的歌词片段
 * @param {{ language: string }} options
 * @returns {Promise<{ readings: Array<{text,hiragana,romaji}>, log: string[] }>}
 */
export async function generateReadings(words, { language = 'ja' } = {}) {
  const clean = words.map(w => String(w).trim()).filter(Boolean);
  const log = [];
  const t0 = Date.now();
  const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

  if (!clean.length) return { readings: [], log: ['没有可标注的片段'] };

  if (!dsApiKey) {
    throw new Error('请先在上方填写 DeepSeek API Key');
  }

  const langHint = language === 'ja' ? '日语（返回平假名与罗马音）'
    : language === 'zh' ? '中文（返回汉语拼音作为 romaji）'
    : '英语（romaji 原样）';

  const system = '你是歌词注音助手。严格只输出 JSON，不要任何解释、不要 markdown 代码块。格式：{"readings":[{"text":"原片段","hiragana":"平假名","romaji":"罗马音"}]}。text 必须与输入片段逐字完全一致。对每个片段整体注音：hiragana 是该片段整体的平假名、romaji 是该片段整体的罗马音。不要把一个片段拆成多个词分别输出，每个输入片段只输出一条。不要增删片段。';
  const user = `请为以下${langHint}歌词片段逐段注音（每段整体注音，不要拆分）：\n${clean.join('\n')}`;

  log.push(`[${stamp()}] 发起 DeepSeek 注音请求`);
  log.push(`模型：${dsModel}；语言：${language}；片段数：${clean.length}`);

  let res;
  try {
    res = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dsApiKey}`,
      },
      body: JSON.stringify({
        model: dsModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err) {
    // fetch 级别的错误（网络断开、CORS 等）
    log.push(`[${stamp()}] fetch 出错：${err.message || err}`);
    const corsMsg = classifyError(err);
    if (corsMsg) throw new Error(corsMsg);
    throw new Error(`网络请求失败：${err.message || '未知错误'}`);
  }

  log.push(`DeepSeek 响应：HTTP ${res.status}`);

  let body = null;
  try {
    body = await res.json();
  } catch {
    // 响应体不是 JSON（极少见）
    const text = await res.text();
    log.push(`非 JSON 响应（前 300 字）：${String(text || '').slice(0, 300)}`);
    throw new Error(`DeepSeek API 返回了非预期的响应格式（HTTP ${res.status}）`);
  }

  if (!res.ok) {
    const errMsg = classifyHttpError(res.status, body);
    log.push(`错误详情：${errMsg}`);
    // 尝试记录更多信息
    if (body?.error?.message) log.push(`DeepSeek 返回：${body.error.message}`);
    throw new Error(errMsg);
  }

  const raw = body?.choices?.[0]?.message?.content;
  log.push(`原始返回（前 600 字）：${String(raw || '').slice(0, 600)}`);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 尝试从文本中提取 JSON
    const m = String(raw || '').match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : null;
  }

  const list = Array.isArray(parsed?.readings) ? parsed.readings : [];
  log.push(`解析到 readings：${list.length} 条`);

  const result = alignReadings(clean, list);
  const emptyCount = result.filter(r => !r.hiragana && !r.romaji).length;
  log.push(`对齐完成：${result.length} 条，其中 ${emptyCount} 条未获得注音（hiragana/romaji 均空）`);
  log.push(`耗时：${Date.now() - t0} ms`);

  return { readings: result, log };
}

// ---------------------------------------------------------------------------
// 对齐：把模型返回的 readings 对齐到请求的每个片段
// ---------------------------------------------------------------------------

function alignReadings(words, list) {
  const used = new Set();
  const exact = new Map(list.map(r => [String(r?.text || ''), r]));
  return words.map(w => {
    const r = exact.get(w);
    if (r && !used.has(w)) { used.add(w); return { text: w, hiragana: r.hiragana || '', romaji: r.romaji || '' }; }
    // 兜底：模型拆词了，把 text 是 w 子串的词按返回顺序拼接
    const parts = list.filter(p => { const t = String(p?.text || ''); return t && w.includes(t) && !used.has(t); });
    if (!parts.length) return { text: w, hiragana: '', romaji: '' };
    parts.forEach(p => used.add(String(p.text)));
    return {
      text: w,
      hiragana: parts.map(p => p.hiragana || '').join(''),
      romaji: parts.map(p => p.romaji || '').join(''),
    };
  });
}

// ---------------------------------------------------------------------------
// 便捷转换
// ---------------------------------------------------------------------------

/** 把 readings 列表转换成假名词典 { 原词: 假名 } */
export function toFuriganaMap(readings) {
  const map = {};
  readings.forEach(r => { if (r.hiragana) map[r.text] = r.hiragana; });
  return map;
}

/** 把 readings 列表转换成罗马音词典 { 原词: 罗马音 } */
export function toRomajiMap(readings) {
  const map = {};
  readings.forEach(r => { if (r.romaji) map[r.text] = r.romaji; });
  return map;
}

// ---------------------------------------------------------------------------
// 翻译功能：将歌词翻译为简体中文
// ---------------------------------------------------------------------------

/**
 * 将歌词片段翻译为简体中文
 * @param {string[]} texts - 需要翻译的歌词片段
 * @param {{ language: string }} options
 * @returns {Promise<{ translations: Array<{text,translation}>, log: string[] }>}
 */
export async function translateLyrics(texts, { language = 'ja' } = {}) {
  const clean = texts.map(w => String(w).trim()).filter(Boolean);
  const log = [];
  const t0 = Date.now();
  const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

  if (!clean.length) return { translations: [], log: ['没有可翻译的片段'] };

  if (!dsApiKey) {
    throw new Error('请先在上方填写 DeepSeek API Key');
  }

  const langName = language === 'ja' ? '日语' : language === 'zh' ? '中文' : '英语';

  const system = '你是歌词翻译助手。严格只输出 JSON，不要任何解释、不要 markdown 代码块。格式：{"translations":[{"text":"原片段","translation":"简体中文翻译"}]}。text 必须与输入片段逐字完全一致。每个输入片段只输出一条翻译，不要拆分。将原文翻译为自然流畅的简体中文，保留歌词的意境和韵律。';
  const user = `请将以下${langName}歌词片段翻译为简体中文（每段整体翻译，不要拆分）：\n${clean.join('\n')}`;

  log.push(`[${stamp()}] 发起 DeepSeek 翻译请求`);
  log.push(`模型：${dsModel}；语言：${language}；片段数：${clean.length}`);

  let res;
  try {
    res = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dsApiKey}`,
      },
      body: JSON.stringify({
        model: dsModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err) {
    log.push(`[${stamp()}] fetch 出错：${err.message || err}`);
    const corsMsg = classifyError(err);
    if (corsMsg) throw new Error(corsMsg);
    throw new Error(`网络请求失败：${err.message || '未知错误'}`);
  }

  log.push(`DeepSeek 响应：HTTP ${res.status}`);

  let body = null;
  try {
    body = await res.json();
  } catch {
    const text = await res.text();
    log.push(`非 JSON 响应（前 300 字）：${String(text || '').slice(0, 300)}`);
    throw new Error(`DeepSeek API 返回了非预期的响应格式（HTTP ${res.status}）`);
  }

  if (!res.ok) {
    const errMsg = classifyHttpError(res.status, body);
    log.push(`错误详情：${errMsg}`);
    if (body?.error?.message) log.push(`DeepSeek 返回：${body.error.message}`);
    throw new Error(errMsg);
  }

  const raw = body?.choices?.[0]?.message?.content;
  log.push(`原始返回（前 600 字）：${String(raw || '').slice(0, 600)}`);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = String(raw || '').match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : null;
  }

  const list = Array.isArray(parsed?.translations) ? parsed.translations : [];
  log.push(`解析到 translations：${list.length} 条`);

  const result = alignTranslations(clean, list);
  const emptyCount = result.filter(r => !r.translation).length;
  log.push(`对齐完成：${result.length} 条，其中 ${emptyCount} 条未获得翻译`);
  log.push(`耗时：${Date.now() - t0} ms`);

  return { translations: result, log };
}

function alignTranslations(texts, list) {
  const used = new Set();
  const exact = new Map(list.map(r => [String(r?.text || ''), r]));
  return texts.map(w => {
    const r = exact.get(w);
    if (r && !used.has(w)) { used.add(w); return { text: w, translation: r.translation || '' }; }
    return { text: w, translation: '' };
  });
}

/** 把 translations 列表转换成翻译词典 { 原词: 简体中文翻译 } */
export function toTranslationMap(translations) {
  const map = {};
  translations.forEach(r => { if (r.translation) map[r.text] = r.translation; });
  return map;
}
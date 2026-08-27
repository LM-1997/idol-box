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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
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
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      log.push(`[${stamp()}] 注音请求超时（60秒）`);
      throw new Error('注音请求超时（60秒），请稍后重试');
    }
    // fetch 级别的错误（网络断开、CORS 等）
    log.push(`[${stamp()}] fetch 出错：${err.message || err}`);
    const corsMsg = classifyError(err);
    if (corsMsg) throw new Error(corsMsg);
    throw new Error(`网络请求失败：${err.message || '未知错误'}`);
  }
  clearTimeout(timeout);

  log.push(`DeepSeek 响应：HTTP ${res.status}`);

  let body = null;
  let rawText = '';
  try {
    rawText = await res.text();
    body = JSON.parse(rawText);
  } catch {
    // 响应体不是 JSON（极少见），保留原始文本用于日志
    log.push(`非 JSON 响应（前 300 字）：${String(rawText || '').slice(0, 300)}`);
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

  // 诊断：记录解析后的顶层结构
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    log.push(`解析后顶层键：${Object.keys(parsed).join(', ') || '(空对象)'}`);
  }

  const list = Array.isArray(parsed?.readings) ? parsed.readings
    : Array.isArray(parsed) ? parsed
    : [];
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

  if (language === 'zh') {
    throw new Error('当前歌词已是中文，无需翻译');
  }

  const langName = language === 'ja' ? '日语' : '英语';

  const system = '你是歌词翻译助手。严格只输出 JSON，不要任何解释、不要 markdown 代码块。格式：{"translations":[{"text":"原片段","translation":"简体中文翻译"}]}。text 必须与输入片段逐字完全一致。每个输入片段只输出一条翻译，不要拆分。将原文翻译为自然流畅的简体中文，保留歌词的意境和韵律。';
  const user = `请将以下${langName}歌词片段翻译为简体中文（每段整体翻译，不要拆分）：\n${clean.join('\n')}`;

  log.push(`[${stamp()}] 发起 DeepSeek 翻译请求`);
  log.push(`模型：${dsModel}；语言：${language}；片段数：${clean.length}`);

  let res;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
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
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      log.push(`[${stamp()}] 翻译请求超时（60秒）`);
      throw new Error('翻译请求超时（60秒），请稍后重试');
    }
    log.push(`[${stamp()}] fetch 出错：${err.message || err}`);
    const corsMsg = classifyError(err);
    if (corsMsg) throw new Error(corsMsg);
    throw new Error(`网络请求失败：${err.message || '未知错误'}`);
  }
  clearTimeout(timeout);

  log.push(`DeepSeek 响应：HTTP ${res.status}`);

  let body = null;
  let rawText = '';
  try {
    rawText = await res.text();
    body = JSON.parse(rawText);
  } catch {
    log.push(`非 JSON 响应（前 300 字）：${String(rawText || '').slice(0, 300)}`);
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
  console.log('[歌词翻译诊断] API 原始响应 response.choices[0].message.content:', raw);

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      const m = String(raw || '').match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    } catch {
      parsed = null;
    }
  }

  // 诊断：记录解析后的顶层结构，便于排查模型返回格式
  if (parsed && typeof parsed === 'object') {
    log.push(`解析后顶层键：${Object.keys(parsed).join(', ') || '(空对象)'}`);
    if (Array.isArray(parsed)) log.push(`注意：模型返回了数组而非对象，长度=${parsed.length}`);
  }

  // 尝试多种可能的键名（模型可能不按 system prompt 返回）
  let list = Array.isArray(parsed?.translations) ? parsed.translations
    : Array.isArray(parsed?.translation) ? parsed.translation
    : Array.isArray(parsed?.translated) ? parsed.translated
    : Array.isArray(parsed?.results) ? parsed.results
    : Array.isArray(parsed) ? parsed  // 模型直接返回了数组
    : [];

  // 如果 list 有数据但字段名不是 text/translation，尝试做字段映射
  if (list.length > 0) {
    const first = list[0];
    if (first && typeof first === 'object') {
      const keys = Object.keys(first);
      log.push(`模型返回的每条记录键名：${keys.join(', ')}`);
      // 自动映射常见替代字段名
      if (!('text' in first) || !('translation' in first)) {
        const textKey = keys.find(k => /text|original|source|input|origin/i.test(k)) || keys[0];
        const transKey = keys.find(k => /translat|target|output|result|chinese/i.test(k)) || (keys.length > 1 ? keys[1] : keys[0]);
        log.push(`字段映射：text←${textKey}, translation←${transKey}`);
        list = list.map(item => ({
          text: item[textKey] || '',
          translation: item[transKey] || '',
        }));
      }
    }
  }

  // 兼容模型把整批歌词压进单个 text/translation 字段的响应格式。
  // 仅在两字段按换行拆分后行数一致时展开，避免把普通文本误当成逐行结果。
  if (list.length === 1) {
    const merged = list[0];
    const sourceLines = String(merged?.text || '').split(/\r?\n/).map(line => line.trim());
    const translationLines = String(merged?.translation || '').split(/\r?\n/).map(line => line.trim());
    if (sourceLines.length > 1 && sourceLines.length === translationLines.length) {
      list = sourceLines.map((text, index) => ({
        text,
        translation: translationLines[index],
      }));
      log.push(`检测到单对象多行响应，已展开为 ${list.length} 条逐行翻译`);
      console.log('[歌词翻译诊断] 单对象多行响应展开结果:', list);
    }
  }

  log.push(`解析到 translations：${list.length} 条`);

  const invalidRecord = list.some(item => !item || typeof item !== 'object'
    || !String(item.text || '').trim()
    || !String(item.translation || '').trim());
  const hasMatch = list.some(item => {
    const text = String(item?.text || '').trim();
    return text && clean.some(line => line === text || line.includes(text));
  });
  const parseFailed = !Array.isArray(list) || list.length === 0 || invalidRecord || !hasMatch;

  let result;
  if (parseFailed) {
    const reason = !Array.isArray(list) || list.length === 0
      ? '未解析出逐行翻译数组'
      : invalidRecord
        ? '存在缺少原文或翻译字段的记录'
        : '返回记录无法与任何输入歌词行对应';
    const detail = `翻译响应解析失败：${reason}；原始响应：${String(raw || '')}`;
    console.error('[歌词翻译诊断]', detail);
    log.push(detail);
    result = createTranslationFailures(clean);
  } else {
    result = alignTranslations(clean, list);
    if (result.some(r => r.failed)) {
      const detail = `翻译响应解析失败：无法为批次中的每一行建立对应关系；原始响应：${String(raw || '')}`;
      console.error('[歌词翻译诊断]', detail);
      log.push(detail);
      result = createTranslationFailures(clean);
    }
  }
  const failedCount = result.filter(r => r.failed).length;
  log.push(`对齐完成：${result.length} 条，其中 ${failedCount} 条翻译失败`);
  log.push(`耗时：${Date.now() - t0} ms`);

  return { translations: result, log };
}

function createTranslationFailures(texts) {
  return texts.map(text => ({
    text,
    translation: '翻译失败，可重试',
    failed: true,
  }));
}

function alignTranslations(texts, list) {
  const used = new Set();
  const exact = new Map(list.map(r => [String(r?.text || ''), r]));
  const result = texts.map((w, i) => {
    const r = exact.get(w);
    if (r && !used.has(w)) { used.add(w); return { text: w, translation: r.translation || '' }; }
    // 兜底1：模型拆词了，把 text 是 w 子串的词按返回顺序拼接
    const parts = list.filter(p => { const t = String(p?.text || ''); return t && w.includes(t) && !used.has(t); });
    if (parts.length) {
      parts.forEach(p => used.add(String(p.text)));
      return { text: w, translation: parts.map(p => p.translation || '').join('') };
    }
    // 无法匹配当前行时保留当前下标，禁止把其他行的结果顺序挪过来
    return { text: w, translation: '翻译失败，可重试', failed: true };
  });
  console.groupCollapsed('[歌词翻译诊断] alignTranslations() 返回数组');
  result.forEach((item, index) => console.log({ index, text: item.text, translation: item.translation }));
  console.groupEnd();
  return result;
}

/** 把 translations 列表转换成翻译词典 { 原词: 简体中文翻译 } */
export function toTranslationMap(translations) {
  const map = {};
  const seenKeys = new Set();
  translations.forEach((r, index) => {
    const key = r.text;
    if (r.translation) {
      if (seenKeys.has(key)) {
        console.warn('[歌词翻译诊断] toTranslationMap() 重复 key，将覆盖此前值:', { index, key, previous: map[key], next: r.translation });
      }
      console.log('[歌词翻译诊断] toTranslationMap() 写入:', { index, key, value: r.translation });
      seenKeys.add(key);
      map[key] = r.translation;
    } else {
      console.log('[歌词翻译诊断] toTranslationMap() 跳过空翻译:', { index, key });
    }
  });
  console.log('[歌词翻译诊断] toTranslationMap() 最终字典对象:', map);
  return map;
}
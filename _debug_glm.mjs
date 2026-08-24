/**
 * _debug_glm.mjs — DeepSeek 注音接口调试脚本
 * 用法：设置 DEEPSEEK_KEY 环境变量后运行 node _debug_glm.mjs
 */
const apiKey = process.env.DEEPSEEK_KEY || '';
if (!apiKey) { console.error('请设置 DEEPSEEK_KEY 环境变量'); process.exit(1); }

const endpoint = 'https://api.deepseek.com/chat/completions';
const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

const system = '你是歌词注音助手。严格只输出 JSON，不要任何解释、不要 markdown 代码块。格式：{"readings":[{"text":"原词","hiragana":"假名","romaji":"罗马音"}]}。text 必须与输入词完全一致，逐词一一对应。';
const user = '请为以下日语歌词片段逐词注音：\n夢に向かって走る\n';

const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, response_format: { type: 'json_object' } };

console.log('=== endpoint ===', endpoint);
console.log('=== model ===', model);

try {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  console.log(`\n=== HTTP ${r.status} ===`);
  console.log(text.slice(0, 2000));
} catch (e) {
  console.log(`\n=== ERROR ===`, e.message);
}
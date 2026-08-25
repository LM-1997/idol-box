/**
 * server.js — Idol Cue 本地服务器（Node 零依赖）
 *
 * 职责：
 *   1. 静态文件服务（替代 python -m http.server）
 *   2. /api/lyrics —— 歌词库：列出 / 搜索 / 读取 lyrics/ 目录下的歌词文件
 *
 * 启动：node server.js  （或双击「启动预览.bat」）
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8000;
const LYRICS_DIR = path.join(ROOT, 'lyrics');

fs.mkdirSync(LYRICS_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

const LYRICS_EXT = /\.(lrc|txt|srt|vtt|ass|ssa|scc|ttml|dfxp|smi|sami|xml)$/i;

/** 歌词库根目录（可包含子文件夹，如「歌曲名/歌曲名.lrc」） */
const LYRICS_ROOT = path.join(ROOT, 'lyrics');

// ---------------------------------------------------------------------------
// 文本解码（UTF-8 优先，含替换符则回退 GBK）
// ---------------------------------------------------------------------------

function decodeBuf(buf) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    const gbk = new TextDecoder('gbk', { fatal: false }).decode(buf);
    if (!gbk.includes('\uFFFD')) return gbk;
  } catch { /* 忽略 */ }
  return utf8;
}

// ---------------------------------------------------------------------------
// 歌词库（递归扫描 lyrics/ 目录，支持「歌曲名/歌曲名.lrc」子文件夹）
// ---------------------------------------------------------------------------

/** 递归收集 lyrics/ 下所有歌词文件，返回 [{ rel, name, song }] */
function scanLyrics() {
  const out = [];
  const walk = dir => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of entries) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) { walk(full); continue; }
      if (!d.isFile() || !LYRICS_EXT.test(d.name)) continue;
      const rel = path.relative(LYRICS_ROOT, full).split(path.sep).join('/');
      const dirName = path.basename(path.dirname(full));
      const song = (dirName && dirName !== 'lyrics') ? dirName : d.name.replace(LYRICS_EXT, '');
      out.push({ rel, name: d.name, song, dir: dirName && dirName !== 'lyrics' ? dirName : '' });
    }
  };
  walk(LYRICS_ROOT);
  return out.sort((a, b) => a.rel.localeCompare(b.rel, 'zh'));
}

/** 搜索：关键字优先匹配「歌曲名」（目录名/文件名），其次匹配相对路径 */
function listLyrics(q) {
  const files = scanLyrics();
  if (!q) return files;
  const kw = String(q).toLowerCase();
  return files.filter(f => f.song.toLowerCase().includes(kw) || f.rel.toLowerCase().includes(kw));
}

function readLyrics(name) {
  const safe = path.basename(String(name));
  // 允许按相对路径（子目录）读取，但必须仍在 lyrics/ 内
  const full = path.resolve(LYRICS_ROOT, String(name));
  const rel = path.relative(LYRICS_ROOT, full);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(full)) {
    // 回退：仅在歌词目录里按文件名查找
    const byName = scanLyrics().find(f => f.name === safe || f.rel === String(name));
    if (!byName) throw new Error(`歌词文件不存在：${safe}`);
    return decodeBuf(fs.readFileSync(path.join(LYRICS_ROOT, byName.rel)));
  }
  return decodeBuf(fs.readFileSync(full));
}

// ---------------------------------------------------------------------------
// HTTP 服务器
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const sendJson = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (pathname === '/api/lyrics' && req.method === 'GET') {
      const file = url.searchParams.get('file');
      if (file) {
        try {
          const content = readLyrics(file);
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end(content);
        } catch {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('Not found');
        }
      }
      const q = url.searchParams.get('q') || '';
      return sendJson(200, { files: listLyrics(q) });
    }

    // 静态文件
    let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const base = path.basename(rel);
    // 黑名单：服务端脚本、调试脚本、依赖描述、工程元数据
    if (base === 'server.js' || base === '_check.mjs' || base === '_debug_glm.mjs'
        || base === 'package.json' || base === 'package-lock.json' || base === 'members.json') {
      res.writeHead(404); return res.end('Not found');
    }
    // 路径穿越加固：resolve 后校验相对路径不得跳出 ROOT
    const filePath = path.resolve(ROOT, rel);
    const fileRel = path.relative(ROOT, filePath);
    if (fileRel.startsWith('..') || path.isAbsolute(fileRel) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    return res.end(fs.readFileSync(filePath));
  } catch (e) {
    return sendJson(500, { error: e.message || String(e) });
  }
});

// 仅绑定回环地址，避免局域网意外暴露（如需局域网访问可改为 '0.0.0.0'）
const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`Idol Cue server → http://localhost:${PORT}`);
  console.log(`  歌词库目录：${LYRICS_DIR}`);
  console.log(`  监听：${HOST}（仅本机可访问）`);
});

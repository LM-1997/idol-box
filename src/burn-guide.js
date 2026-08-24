/**
 * burn-guide.js — 压制指南（填充折叠步骤卡片内容）
 *
 * 根据当前 state 动态更新第七步「压制成品 MV」中各卡片的内容：
 *   - 步骤 2：显示字幕设置摘要 + 下载按钮
 *   - 步骤 3：显示输出文件名 + ffmpeg 备选命令
 *   - 步骤 4：显示完成提示
 */

const $ = id => document.getElementById(id);

export function renderBurnGuide(state) {
  if (!state.mvName) {
    // 无 MV 时隐藏压制相关动态内容
    const meta = $('burnMeta'); if (meta) meta.textContent = '请先上传 MV 文件';
    const burnOut = $('burnOutput'); if (burnOut) burnOut.textContent = '';
    const burnDone = $('burnDone'); if (burnDone) burnDone.textContent = '';
    const ffmpeg = $('burnFfmpeg'); if (ffmpeg) ffmpeg.textContent = '';
    return;
  }

  const base = state.mvName.replace(/\.[^.]+$/, '');
  const assName = `${base}_字幕.ass`;
  const outputName = `${base}_压制版.mp4`;
  const filterPath = assName.replace(/([\\:'",])/g, '\\$1');
  const ffmpegCmd = `ffmpeg -i "${state.mvName}" -vf "ass=${filterPath}" -c:a copy "${outputName}"`;

  const delay = Math.round(Number(state.player?.subtitle_delay || 0) * 1000) / 1000;
  const delayText = delay > 0 ? `延后 ${delay} 秒` : delay < 0 ? `提前 ${Math.abs(delay)} 秒` : '无偏移';
  const positionText = state.player?.subtitle_position === 'top' ? '上方' : '下方';

  // 步骤 2：字幕设置摘要
  const meta = $('burnMeta');
  if (meta) {
    meta.innerHTML = `<strong>MV 文件：</strong>${escHtml(state.mvName)}<br><strong>字幕文件：</strong>${escHtml(assName)}<br><strong>字幕设置：</strong>${delayText} · 位置在视频${positionText}`;
  }

  // 步骤 3：输出文件名 + ffmpeg 命令
  const burnOut = $('burnOutput');
  if (burnOut) {
    burnOut.innerHTML = `<strong>输出文件：</strong>${escHtml(outputName)}<br><strong>预计位置：</strong>与 MV 文件同目录`;
  }

  const ffmpeg = $('burnFfmpeg');
  if (ffmpeg) {
    ffmpeg.textContent = ffmpegCmd;
  }

  // 步骤 4：完成提示
  const burnDone = $('burnDone');
  if (burnDone) {
    burnDone.innerHTML = `<strong>成品文件：</strong>${escHtml(outputName)}<br>你可以在 MV 文件所在的文件夹中找到它。`;
  }
}

function escHtml(v) { return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
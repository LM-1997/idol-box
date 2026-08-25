const TOAST_DURATION = 5000;

function ensureContainer() {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

const ICONS = { ok: '\u2713', error: '\u2715', warn: '\u26A0', progress: '\uD83C\uDF00' };

function dismissToast(el, delay = 0) {
  const remove = () => {
    el.classList.add('toast--dismiss');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  };
  if (delay > 0) {
    const timer = setTimeout(remove, delay);
    el._dismissTimer = timer;
  } else {
    remove();
  }
}

/**
 * 普通 toast 通知（ok / error / warn）
 * @param {string} message
 * @param {'ok'|'error'|'warn'} type
 */
export function toast(message, type = 'ok') {
  const container = ensureContainer();
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  const icon = ICONS[type] || '';
  el.innerHTML = icon
    ? `<span class="toast-icon">${icon}</span><span>${String(message)}</span>`
    : `<span>${String(message)}</span>`;
  container.appendChild(el);

  const timer = setTimeout(() => dismissToast(el), TOAST_DURATION);
  el.addEventListener('click', () => {
    clearTimeout(timer);
    dismissToast(el);
  });
}

/**
 * 进度 toast —— 持久显示，可实时更新进度，完成后切换为 ok/error
 * @param {string} label - 初始标签（如「正在生成假名注音…」）
 * @returns {{ update: Function, ok: Function, error: Function, dismiss: Function }}
 *
 * 用法：
 *   const p = toast.progress('正在生成假名注音…');
 *   p.update(16, 24, '第 2/3 批');
 *   p.ok('已生成 24 条假名注音');        // 成功结束
 *   p.error('翻译请求超时（60秒）');      // 异常结束
 *   p.dismiss();                         // 直接关闭
 */
toast.progress = function (label) {
  const container = ensureContainer();
  const el = document.createElement('div');
  el.className = 'toast toast--progress';
  el.innerHTML = `
    <span class="toast-icon">${ICONS.progress}</span>
    <div class="toast-body">
      <span class="toast-label">${String(label)}</span>
      <div class="toast-progress-bar">
        <div class="toast-progress-fill" style="width:0%"></div>
      </div>
      <span class="toast-progress-text"></span>
    </div>
  `;
  container.appendChild(el);

  const fill = el.querySelector('.toast-progress-fill');
  const text = el.querySelector('.toast-progress-text');
  let finished = false;

  /** 切换到普通 toast 样式（ok / error）并自动消失 */
  function finish(type, message) {
    if (finished) return;
    finished = true;
    // 移除进度条，换上最终消息
    const icon = ICONS[type] || '';
    el.className = `toast toast--${type}`;
    el.innerHTML = icon
      ? `<span class="toast-icon">${icon}</span><span>${String(message)}</span>`
      : `<span>${String(message)}</span>`;
    const timer = setTimeout(() => dismissToast(el), TOAST_DURATION);
    el.addEventListener('click', () => {
      clearTimeout(timer);
      dismissToast(el);
    });
  }

  return {
    /** 更新进度
     * @param {number} done   - 已完成数
     * @param {number} total  - 总数
     * @param {string} [detail] - 副标题（如「第 2/3 批」）
     */
    update(done, total, detail) {
      if (finished) return;
      const pct = total ? Math.round(done / total * 100) : 0;
      if (fill) fill.style.width = `${pct}%`;
      if (text) text.textContent = detail || `${done}/${total}（${pct}%）`;
    },

    /** 成功结束，自动消失 */
    ok(message) { finish('ok', message); },

    /** 异常结束，自动消失 */
    error(message) { finish('error', message); },

    /** 直接关闭（不显示任何结果） */
    dismiss() {
      if (finished) return;
      finished = true;
      dismissToast(el);
    },
  };
};
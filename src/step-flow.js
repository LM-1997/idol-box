/**
 * step-flow.js — Claude 风格向导式步骤流
 *
 * 每次只显示一个步骤卡片。用户点击「确认」按钮后推进到下一步。
 * 已完成步骤以精简摘要显示在顶部进度条中。
 *
 * 规则：
 *   - 初始时只显示第 1 步
 *   - 点击确认 → 当前步骤收起，下一步展开
 *   - 已完成步骤可点击标题回到该步（但不可跳过未完成步骤）
 *   - 最后一步无确认按钮，显示完成状态
 */

/**
 * 初始化向导式步骤流
 * @param {string} containerId
 * @returns {{ reset: Function }}
 */
export function initStepFlow(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return { reset: () => {} };

  const cards = [...container.querySelectorAll('.sf-card')];
  if (!cards.length) return { reset: () => {} };

  let current = 0;
  const total = cards.length;
  let initialized = false;

  // ---- 构建进度条 ----
  const progressEl = document.createElement('div');
  progressEl.className = 'sf-progress';
  container.insertBefore(progressEl, cards[0]);

  function renderProgress() {
    progressEl.innerHTML = cards.map((card, i) => {
      const title = card.querySelector('strong')?.textContent || '';
      let cls = 'sf-progress-dot';
      if (i < current) cls += ' done';
      else if (i === current) cls += ' active';
      return `<span class="${cls}" data-idx="${i}" title="${title}">${i < current ? '✓' : i + 1}</span>`;
    }).join('');
    // 点击已完成步骤可回退
    progressEl.querySelectorAll('.sf-progress-dot.done').forEach(dot => {
      dot.addEventListener('click', () => showStep(parseInt(dot.dataset.idx)));
    });
  }

  // ---- 显示指定步骤 ----
  function showStep(index) {
    if (index < 0 || index >= total) return;
    const prev = current;
    current = index;

    // 隐藏当前步骤
    if (cards[prev]) {
      const prevBody = cards[prev].querySelector('.sf-card-body');
      const prevFooter = cards[prev].querySelector('.sf-card-footer');
      if (prevBody) { prevBody.classList.remove('expanded'); prevBody.hidden = true; }
      if (prevFooter) { prevFooter.classList.remove('expanded'); prevFooter.hidden = true; }
    }

    // 显示目标步骤
    const card = cards[current];
    card.style.display = '';
    const body = card.querySelector('.sf-card-body');
    const footer = card.querySelector('.sf-card-footer');
    if (body) { body.hidden = false; void body.offsetHeight; body.classList.add('expanded'); }
    if (footer) {
      const isLast = current === total - 1 && !footer.querySelector('.sf-confirm');
      if (!isLast) { footer.hidden = false; void footer.offsetHeight; footer.classList.add('expanded'); }
    }

    // 隐藏其他步骤
    cards.forEach((c, i) => {
      if (i !== current) c.style.display = 'none';
    });

    renderProgress();
    if (initialized) {
      cards[current].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // ---- 绑定确认按钮 ----
  cards.forEach((card, i) => {
    const btn = card.querySelector('.sf-confirm');
    if (btn) {
      btn.addEventListener('click', () => {
        if (current === i && current < total - 1) {
          showStep(current + 1);
        }
      });
    }
  });

  // ---- 初始化 ----
  showStep(0);
  initialized = true;

  return {
    reset() {
      showStep(0);
    },
  };
}
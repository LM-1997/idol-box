/**
 * mobile.js — 移动端 / macOS / Linux 跨平台增强
 *
 * 职责：
 *   1. iOS Safari 视频播放兼容（playsinline + 手势恢复）
 *   2. 移动端键盘弹出时视口自适应
 *   3. 触摸滚动性能优化（passive listeners）
 *   4. 移动端检测与平台标记
 *   5. macOS / Linux 字体回退检测
 */

const $ = id => document.getElementById(id);

// ---------------------------------------------------------------------------
// 平台检测
// ---------------------------------------------------------------------------

const UA = navigator.userAgent || '';
const platform = {
  isIOS: /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  isAndroid: /Android/.test(UA),
  isMac: /Macintosh|MacIntel|MacPPC|Mac68K/.test(UA) && !/(iPhone|iPad|iPod)/.test(UA),
  isLinux: /Linux/.test(UA) && !/Android/.test(UA),
  isMobile: /Mobi|Android|iPhone|iPad|iPod/.test(UA) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024),
  isTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
};

// 在 body 上打平台标记，CSS 可据此做针对性调整
document.documentElement.classList.add(
  platform.isIOS ? 'platform-ios' : '',
  platform.isAndroid ? 'platform-android' : '',
  platform.isMac ? 'platform-mac' : '',
  platform.isLinux ? 'platform-linux' : '',
  platform.isMobile ? 'platform-mobile' : 'platform-desktop',
  platform.isTouch ? 'platform-touch' : '',
);

// ---------------------------------------------------------------------------
// iOS Safari 视频播放增强
// ---------------------------------------------------------------------------

if (platform.isIOS) {
  const video = $('video');
  if (video) {
    // iOS 10+ 需要 playsinline
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    // 预加载元数据以加快响应
    video.setAttribute('preload', 'metadata');
    // 禁用 iOS 画中画（保持字幕叠加层可见）
    video.setAttribute('disablePictureInPicture', '');
    // iOS 全屏退出后恢复内联播放
    video.addEventListener('webkitendfullscreen', () => {
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.play().catch(() => {});
    });
  }
}

// ---------------------------------------------------------------------------
// 移动端键盘弹出时视口自适应
// ---------------------------------------------------------------------------

if (platform.isMobile) {
  let keyboardOpen = false;

  // 监听输入框聚焦，在 iOS 上延迟滚动确保输入框可见
  document.addEventListener('focusin', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      keyboardOpen = true;
      // iOS Safari 键盘弹出后，延迟滚动使输入框可见
      if (platform.isIOS) {
        setTimeout(() => {
          e.target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 350);
      }
    }
  });

  document.addEventListener('focusout', () => {
    keyboardOpen = false;
    // 键盘收起后恢复页面位置
    if (platform.isIOS) {
      setTimeout(() => window.scrollTo(0, 0), 100);
    }
  });
}

// ---------------------------------------------------------------------------
// 被动触摸事件监听器（提升滚动性能）
// ---------------------------------------------------------------------------

if (platform.isTouch) {
  // 为所有可滚动区域添加 passive 触摸监听
  const scrollElements = document.querySelectorAll('.lyrics-list, .timeline-scroll, .furigana-editor, .lyrics-library-select');
  scrollElements.forEach(el => {
    el.addEventListener('touchstart', () => {}, { passive: true });
    el.addEventListener('touchmove', () => {}, { passive: true });
  });
}

// ---------------------------------------------------------------------------
// 移动端按钮点击反馈（消除 300ms 延迟）
// ---------------------------------------------------------------------------

if (platform.isTouch) {
  document.addEventListener('touchstart', e => {
    const btn = e.target.closest('button, .button, [role="button"], .member-chip');
    if (btn) {
      btn.classList.add('touch-active');
      const remove = () => {
        btn.classList.remove('touch-active');
        btn.removeEventListener('touchend', remove);
        btn.removeEventListener('touchcancel', remove);
      };
      btn.addEventListener('touchend', remove);
      btn.addEventListener('touchcancel', remove);
    }
  }, { passive: true });
}

// ---------------------------------------------------------------------------
// macOS / Linux 字体回退检测
// ---------------------------------------------------------------------------

if (platform.isMac || platform.isLinux) {
  // 检测字体是否可用，不可用时添加回退类
  const testFonts = ['Noto Sans SC', 'Noto Serif SC', 'LXGW WenKai'];
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      testFonts.forEach(font => {
        if (!document.fonts.check(`12px "${font}"`)) {
          document.documentElement.classList.add(`font-missing-${font.replace(/\s+/g, '-').toLowerCase()}`);
        }
      });
    });
  }
}

// ---------------------------------------------------------------------------
// 导出供其他模块使用
// ---------------------------------------------------------------------------

export { platform };
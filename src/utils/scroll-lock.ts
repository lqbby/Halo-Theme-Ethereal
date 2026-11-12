// 弹层滚动锁：锁 <html>，不要锁 <body>。
// 本主题的自定义滚动条（OverlayScrollbars）接管后 <html> 才是滚动视口
// （html 的 overflow-y 由 --os-viewport-overflow-y 控制）；此时给 body 设
// overflow:hidden 会让 body 自成滚动容器（内部 scrollTop 恒 0），背景页瞬间回顶。
// 用法：打开弹层前 lockPageScroll()，关闭后 unlockPageScroll()；
// Swup 换页调 resetPageScrollLock()，避免残留锁死滚动。
// 移植自上游 v2.1.0（3d54813），与上游实现保持一致。
const LOCK_CLASS = "modal-scroll-locked";

let locked = false;

export function lockPageScroll(): void {
  if (locked) return;
  locked = true;
  document.documentElement.classList.add(LOCK_CLASS);
}

export function unlockPageScroll(): void {
  if (!locked) return;
  locked = false;
  document.documentElement.classList.remove(LOCK_CLASS);
}

/** 换页复位：弹层随页面失效，直接清掉锁（不依赖调用方成对 unlock） */
export function resetPageScrollLock(): void {
  locked = false;
  document.documentElement.classList.remove(LOCK_CLASS);
}

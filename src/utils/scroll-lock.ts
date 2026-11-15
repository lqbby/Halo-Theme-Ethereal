// 弹层滚动锁：锁 <html>，不要锁 <body>。
// 本主题的自定义滚动条（OverlayScrollbars）接管后 <html> 才是滚动视口
// （html 的 overflow-y 由 --os-viewport-overflow-y 控制）；此时给 body 设
// overflow:hidden 会让 body 自成滚动容器（内部 scrollTop 恒 0），背景页瞬间回顶。
// 用法：打开弹层前 lockPageScroll()，关闭后 unlockPageScroll()；
// Swup 换页调 resetPageScrollLock()，避免残留锁死滚动。
// 移植自上游 v2.1.0（3d54813）。与上游的一处刻意差异：锁改为引用计数——
// 本站有两个独立持锁方（导航抽屉 navbar、外链跳转模态框 external-link-redirect），
// 上游的单个布尔会被共用：两个弹层同时打开时关掉一个就把锁整个放开，
// 另一个弹层还开着、背景却能滚了。计数归零才真正解锁。
const LOCK_CLASS = "modal-scroll-locked";

let lockCount = 0;

export function lockPageScroll(): void {
  lockCount += 1;
  if (lockCount === 1) {
    document.documentElement.classList.add(LOCK_CLASS);
  }
}

export function unlockPageScroll(): void {
  if (lockCount === 0) return;
  lockCount -= 1;
  if (lockCount === 0) {
    document.documentElement.classList.remove(LOCK_CLASS);
  }
}

/** 换页复位：弹层随页面失效，直接清掉锁（不依赖调用方成对 unlock） */
export function resetPageScrollLock(): void {
  lockCount = 0;
  document.documentElement.classList.remove(LOCK_CLASS);
}

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
//
// ⚠️ 计数必须挂在 window 上共享，不能用模块级变量：经典脚本由
// build-assets.mjs 逐入口独立打包，本模块会被内联进每个 bundle 各一份，
// 模块级计数在跨 bundle 场景下互不可见——抽屉（navbar bundle）开的锁，
// 模态框（外链 bundle）那份计数读到的仍是 0，引用计数语义直接失效。
// 挂 window 后所有 bundle 读同一份计数，引用计数才真正成立。
const LOCK_CLASS = "modal-scroll-locked";
const STATE_KEY = "__etherealScrollLockCount";

function getLockCount(): number {
  const n = (window as unknown as Record<string, unknown>)[STATE_KEY];
  return typeof n === "number" && n > 0 ? n : 0;
}

function setLockCount(n: number): void {
  (window as unknown as Record<string, unknown>)[STATE_KEY] = n;
}

export function lockPageScroll(): void {
  const next = getLockCount() + 1;
  setLockCount(next);
  if (next === 1) {
    document.documentElement.classList.add(LOCK_CLASS);
  }
}

export function unlockPageScroll(): void {
  const current = getLockCount();
  if (current === 0) return;
  setLockCount(current - 1);
  if (current - 1 === 0) {
    document.documentElement.classList.remove(LOCK_CLASS);
  }
}

/** 换页复位：弹层随页面失效，直接清掉锁（不依赖调用方成对 unlock） */
export function resetPageScrollLock(): void {
  setLockCount(0);
  document.documentElement.classList.remove(LOCK_CLASS);
}

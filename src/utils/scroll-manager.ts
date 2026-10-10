// 滚动 & 窗口调整处理（back-to-top、TOC、导航栏）。
// banner/波浪/is-home 同步逻辑在 banner-sync.ts（含 resize 重算延伸高度）。
import {
  BANNER_HEIGHT,
  MAIN_PANEL_OVERLAPS_BANNER_HEIGHT,
} from "../constants/constants";
import { bannerHomeHeight } from "./banner-sync";
import { readDurBannerMs } from "./dur-banner";

// 语义化常量，替代硬编码魔法数字
// 导航栏高度（4.5rem × 16px），与 CSS 变量 --navbar-height 对应（variables.css）
const NAVBAR_HEIGHT_PX = 72;
const BASE_SPACING_PX = 16; // 基础间距（1rem = 16px）
// 移动/平板（<1024px / lg）共用抽屉菜单，导航栏不随滚动隐藏；
// 桌面端（≥lg）才启用导航栏滚动隐藏
const MOBILE_BREAKPOINT = 1024;

const bannerEnabled = Boolean(document.getElementById("banner-wrapper"));

// 缓存 DOM 引用，避免每次 scroll 帧重复 getElementById
// 使用 isConnected 自动检测 Swup 页面切换后的失效引用
let _backToTopBtn: HTMLElement | null = null;
let _toc: HTMLElement | null = null;
let _navbar: HTMLElement | null = null;
let _grid: HTMLElement | null = null;
// 上次滚动位置，用于导航栏滚动方向感知显隐（delta = scrollY - lastScrollY）
let lastScrollY = window.scrollY;

function getBackToTopBtn() {
  if (!_backToTopBtn?.isConnected)
    _backToTopBtn = document.getElementById("back-to-top-btn");
  return _backToTopBtn;
}
function getToc() {
  if (!_toc?.isConnected) _toc = document.getElementById("toc-wrapper");
  return _toc;
}
function getNavbar() {
  if (!_navbar?.isConnected)
    _navbar = document.getElementById("navbar-wrapper");
  return _navbar;
}
function getGrid() {
  if (!_grid?.isConnected) _grid = document.getElementById("main-grid");
  return _grid;
}

function scrollFunction() {
  const backToTopBtn = getBackToTopBtn();
  const toc = getToc();
  const navbar = getNavbar();
  const currentBannerHeight = document.body.classList.contains("is-home")
    ? bannerHomeHeight()
    : BANNER_HEIGHT;
  const bannerHeightPx = window.innerHeight * (currentBannerHeight / 100);
  const tocRevealHeightPx = window.innerHeight * (BANNER_HEIGHT / 100);

  // 先读后写分离：所有布局读取（scrollY）在脚本最前一次性完成，之后仅写
  // class/属性——避免每帧「读 scrollTop → 写 class → 再读」的交错强制重排。
  // window.scrollY 在标准滚动容器（html/body）下等价于双 scrollTop 读取
  const scrollY = window.scrollY;

  if (backToTopBtn) {
    backToTopBtn.classList.toggle("hide", scrollY <= bannerHeightPx);
  }

  // 目录门控仅横幅/全屏模式启用（与 components.css 的
  // html[data-banner-display=...]:not(.toc-revealed) #toc-wrapper 同源）：
  // 视口在顶部横幅区（≤35vh）隐藏，滚动超过后给 <html> 加 .toc-revealed 解除；
  // disabled/transparent 模式目录恒显，清除两处隐藏状态（切回横幅模式时
  // 由 bannerModeChange 监听立即重算）
  if (toc) {
    const bannerDisplay = document.documentElement.dataset.bannerDisplay;
    const tocGated =
      bannerDisplay === "banner" || bannerDisplay === "fullscreen";
    const atTop = scrollY <= tocRevealHeightPx;
    toc.classList.toggle("toc-hide", tocGated && atTop);
    document.documentElement.classList.toggle(
      "toc-revealed",
      tocGated && !atTop,
    );
  }

  if (window.innerWidth < MOBILE_BREAKPOINT) return;
  if (!bannerEnabled || !navbar) return;
  // 固定导航栏模式：跳过隐藏逻辑，始终显示
  if (document.documentElement.dataset.navbarFixed === "true") return;
  // threshold = bannerHeightPx - navbarHeight - panelOverlap(rem→px) - baseSpacing
  const threshold =
    bannerHeightPx -
    NAVBAR_HEIGHT_PX -
    MAIN_PANEL_OVERLAPS_BANNER_HEIGHT * BASE_SPACING_PX -
    BASE_SPACING_PX;
  // 滚动方向感知：上滑（delta<0）或仍在顶部（scrollY<=threshold）显示，
  // 下滑且离开顶部（delta>0 && scrollY>threshold）隐藏（对齐 firefly dynamic 模式）
  const delta = scrollY - lastScrollY;
  lastScrollY = scrollY;
  if (delta < 0 || scrollY <= threshold) {
    navbar.classList.remove("navbar-hidden");
  } else if (delta > 0 && scrollY > threshold) {
    navbar.classList.add("navbar-hidden");
  }
  // 导航栏隐藏时给 body 加类，供侧边栏吸顶位置回退（Layout.astro 消费）
  document.body.classList.toggle(
    "dynamic-navbar-hidden",
    navbar.classList.contains("navbar-hidden"),
  );
}

// 全屏首页向下箭头（#scroll-down-indicator）点击目标：手算平滑滚动到内容区。
// 落点 = 网格顶边 − 首页间距（--banner-home-content-gap）− 固定导航栏高度，
// 使"页面背景顶部边缘"（banner 底边，100vh）对齐视口顶部而非网格顶边。
// Chrome 平滑 scrollIntoView 会忽略 scroll-margin，故必须手算；间距直接读
// CSS 变量（rem）按根字号换算 px，不再借用 scroll-margin-top 传值（语义扭曲）。
// 固定导航栏（html[data-navbar-fixed="true"]）常驻顶部且滚动后不隐藏，落点需
// 再上移导航栏高度使"导航栏底边"对齐页面背景顶部边缘；高度动态测量（移动端
// 强制固定，断点间可能不同），非固定模式为 0（导航栏滚动后自动隐藏，无需让位）
export function scrollDownToContent(): void {
  const grid = getGrid();
  if (!grid) return;
  const cs = getComputedStyle(document.documentElement);
  const gap =
    (parseFloat(cs.getPropertyValue("--banner-home-content-gap")) || 0) *
    (parseFloat(cs.fontSize) || 16);
  const navbarOffset =
    document.documentElement.dataset.navbarFixed === "true"
      ? getNavbar()?.getBoundingClientRect().height || 0
      : 0;
  // 向下箭头：从 banner 到内容约 65vh，属跳转类滚动 ⇒ 走距离门控（短则平滑）
  smartScrollTo(
    window.scrollY + grid.getBoundingClientRect().top - gap - navbarOffset,
  );
}

/** 距离门控滚动（全站统一范式）：长距离（>1.5 屏）瞬时到位，短距离保留平滑。
 *  长距离平滑滚动是明显的「拉扯感」（实测 1836px 平滑拉回耗时 ~2.2s），而短距离
 *  平滑（如侧边格切换、小段滚动）才是用户期待的顺滑。阈值与 lockstepScrollToTop 一致。
 *  ⚠️ prefer-reduced-motion 时一律瞬时。
 *  ⚠️ 改阈值/判据时三处需同步：BackToTop.astro / comment-locate.ts 的内联
 *     __smartScrollTo（is:inline / 独立 bundle 无法 import，故各手抄一份，
 *     同步由 scripts/test-smart-scroll.mjs 锁死）。 */
export function smartScrollTo(top: number): void {
  const reduce =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dist = Math.abs(top - window.scrollY);
  const threshold = (window.innerHeight || 800) * 1.5;
  window.scrollTo({
    top,
    behavior: dist > threshold || reduce ? "auto" : "smooth",
  });
}

let scrollTicking = false;
// passive: 本监听只读滚动位置，不 preventDefault —— 声明 passive 后浏览器不必在
// 滚动派发时等待 JS 返回（滚动事件每帧触发，省掉的是主线程握手开销）
window.addEventListener(
  "scroll",
  function () {
    if (!scrollTicking) {
      requestAnimationFrame(function () {
        scrollFunction();
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  },
  { passive: true },
);

// 访客切换壁纸模式（setting-utils 的 applyBannerDisplay 派发）后立即重算
// 目录显隐：切到横幅/全屏模式且视口在顶部时需补挂隐藏（toc-hide + 无
// toc-revealed），切到 disabled/transparent 时清除隐藏状态
window.addEventListener("bannerModeChange", scrollFunction);

export { scrollFunction };

/* ── 换页回顶（与 is-home 位移锁步，随上游 v2.0.0 commit b7e94d7 移植） ──
   首页↔非首页（横幅 / 全屏：内容区随 is-home 位移）的换页里，回顶与 grid translate
   / panel top 的位移是两段反向运动：原生平滑滚动的时长与曲线不可控，异步叠加会
   形成「先下后上」往复。此处改 rAF 逐帧插值，与位移同曲线（0.4,0,0.2,1）同时长
   （--dur-banner），合成位移恢复单调；仅换页时由 app.ts 在 content:scroll 处调用
   （纯色 / 全屏透明无位移，保持原生平滑）。 ── */

let lockstepToken = 0;

/** 打断进行中的锁步回顶（新一轮导航、用户主动滚动时让位） */
export function cancelLockstepScrollToTop(): void {
  lockstepToken++;
}

const PAGE_SWITCH_EASE = createBezierEasing(0.4, 0, 0.2, 1);

/** 与 is-home 位移动画锁步的换页回顶。用户主动滚动（滚轮/触摸）即取消让位。
 *  syncEl（v1.7.19，is-home 切换场景传 #main-grid）：滚动不再 ease 自走，
 *  改为**跟随目标元素 translate 的实时进度**——每帧 getComputedStyle 读
 *  translate 当前值，按「位移已走过比例」写滚动位置。
 *  背景：CSS transition 的启动延迟 / 合成器提交相位不可控（实测 1~2 帧），
 *  ease 自走时滚动与位移互相超前滞后：位移先启（page:view 比 content:scroll
 *  早 ~37ms）→「先上后下」反向段 ~25px（上下抖动）；同帧触发则滚动超前→
 *  反向段换向且更大（ease 前段陡，首 2 帧可走 8%×1749≈140px，实测 49~83px）。
 *  跟随模式下合成位置 = f(tr) 的单调函数（tr 本身单调），与 CSS 启动延迟、
 *  曲线细节完全解耦——数学上保证无反向段。 */
export function lockstepScrollToTop(syncEl?: HTMLElement | null): void {
  const startY = window.scrollY;
  if (startY <= 0) return;
  // v1.7.18：取消「>1.5 屏瞬时截断」，任意距离统一走锁步动画——非宽屏下首页
  //    单列堆叠、页底距顶常达 5000+px（>1.5 屏），瞬时截断让「拉到底部点卡片」
  //    变成一帧瞬移数千 px 的裸跳（无过渡遮罩，用户感知为「瞬间跳转 bug」）；
  //    锁步动画时长恒为 --dur-banner（与距离无关），长距离只是扫过更快，运动
  //    仍连续单调，各屏幕尺寸观感一致。瞬时路径时代的「1836px 平滑 ~2.2s 拉扯」
  //    针对的是浏览器原生 smooth（时长随距离缩放），锁步固定时长不受此限。
  // prefers-reduced-motion 保持瞬时到位（与 smartScrollTo 口径一致）。
  const reduce =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    window.scrollTo(0, 0);
    return;
  }
  const duration = readDurBannerMs(document.documentElement);
  const token = ++lockstepToken;
  const startTime = performance.now();
  // 包一层刻意为之：每次调用持有独立的监听器引用，unbind 只摘自己注册的
  // 这一对（监听器注册去重 / 移除都按引用判定，直接引用多轮之间会互相误摘）
  const cancelOnUserInput = () => cancelLockstepScrollToTop();
  const unbindUserInputGuard = () => {
    window.removeEventListener("wheel", cancelOnUserInput);
    window.removeEventListener("touchstart", cancelOnUserInput);
  };
  window.addEventListener("wheel", cancelOnUserInput, { passive: true });
  window.addEventListener("touchstart", cancelOnUserInput, { passive: true });
  // 位移基准：--banner-height-extend（is-home 侧 translate-y 的 px 值，
  // global.css @utility is-home 与 components.css 基值 0 同源）；读不到 /
  // 为 0 ⇒ 该视口无位移，退回 ease 自走
  const extendPx = syncEl
    ? parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--banner-height-extend",
        ),
      )
    : NaN;
  const el = syncEl || null;
  if (el && Number.isFinite(extendPx) && extendPx > 1) {
    const grid = el;
    const readTr = (): number => {
      const v = getComputedStyle(grid).translate;
      if (!v || v === "none") return 0;
      const parts = v.trim().split(/\s+/);
      const n = parseFloat(parts.length > 1 ? parts[1] : parts[0]);
      return Number.isFinite(n) ? n : 0;
    };
    // 调用前 app.ts 已在同帧翻转 is-home——tr 现值靠近哪端即刚离开哪端：
    // 离开首页 tr extendPx→0 / 进入首页 tr 0→extendPx
    const leavingHome = readTr() > extendPx / 2;
    const followStep = (now: number) => {
      if (token !== lockstepToken) {
        unbindUserInputGuard();
        return;
      }
      const tr = readTr();
      const progress = leavingHome ? 1 - tr / extendPx : tr / extendPx;
      const clamped = Math.min(Math.max(progress, 0), 1);
      window.scrollTo(0, Math.round(startY * (1 - clamped)));
      const done = leavingHome ? tr <= 0.5 : tr >= extendPx - 0.5;
      if (done || now - startTime > duration + 250) {
        // transition 异常（未启动/被打断）时超时兜底，终点恒为顶
        window.scrollTo(0, 0);
        unbindUserInputGuard();
        return;
      }
      requestAnimationFrame(followStep);
    };
    requestAnimationFrame(followStep);
    return;
  }
  const step = (now: number) => {
    if (token !== lockstepToken) {
      unbindUserInputGuard();
      return;
    }
    const progress = Math.min((now - startTime) / duration, 1);
    window.scrollTo(0, Math.round(startY * (1 - PAGE_SWITCH_EASE(progress))));
    if (progress < 1) requestAnimationFrame(step);
    else unbindUserInputGuard();
  };
  requestAnimationFrame(step);
}

/** cubic-bezier(x1,y1,x2,y2) 的 JS 求值（牛顿迭代，二分兜底），与 CSS 过渡同曲线 */
function createBezierEasing(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const dx = sampleX(t) - x;
      if (Math.abs(dx) < 1e-6) return sampleY(t);
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= dx / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 24; i++) {
      const dx = sampleX(t);
      if (Math.abs(dx - x) < 1e-6) break;
      if (dx < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

// 滚动 & 窗口调整处理（back-to-top、TOC、导航栏）。
// banner/波浪/is-home 同步逻辑在 banner-sync.ts（含 resize 重算延伸高度）。
// 导航栏滚动行为按模式分流（两模式互不干扰，2026-11-16 用户定规）：
// floating_pill 下只收菜单胶囊、整条永不滑走，见 navbar-collapse.ts
// （aemeath 机制）；classic 下整条滑走（navbar-hidden，banner 阈值约半屏，
// 旧实现，df49578 误删后于第四轮恢复），见下方 scrollFunction 末尾。
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
// 移动/平板（<1441px）共用抽屉菜单，导航栏不随滚动隐藏；
// 桌面端（≥1441px）才启用 classic 整条滑走（胶囊收拢的 1441px 桌面断点
// 在 navbar-collapse.ts 内自管）
const MOBILE_BREAKPOINT = 1441;

const bannerEnabled = Boolean(document.getElementById("banner-wrapper"));

// 上次滚动位置，用于 classic 滑走的方向感知（delta = scrollY - lastScrollY）
let lastScrollY = window.scrollY;

// 缓存 DOM 引用，避免每次 scroll 帧重复 getElementById
// 使用 isConnected 自动检测 Swup 页面切换后的失效引用
let _backToTopBtn: HTMLElement | null = null;
let _toc: HTMLElement | null = null;
let _navbar: HTMLElement | null = null;
let _grid: HTMLElement | null = null;
// 滚动进度环（rainzt ScrollProgress 移植）：元素可能被后台开关关掉，
// 不存在时静默跳过；isConnected 守卫同上（Swup 换页后引用失效自动重取）
let _scrollProgressCircle: HTMLElement | null = null;
let _scrollProgressValue: HTMLElement | null = null;
let _scrollProgressLabel: HTMLElement | null = null;
let _lastScrollProgress = -1;
let _lastScrollProgressPercent = -1;
let _lastScrollProgressUpdateAt = Number.NEGATIVE_INFINITY;
// 位置同步：可见按钮集合的 key（id 拼接），变化时立即重算位置
let _lastScrollProgressBtnKey = "";
// 尾刷定时器（A8）：节流窗口内最后一次调用，80ms 后再跑一次
let _scrollProgressTrailingTimer = 0;
// 终态对齐定时器（ocr 真 bug B1）：按钮堆显隐切换时 sibling 的 bottom 过渡
// --dur-float（350/450ms）远长于 80ms 尾刷；尾刷读到的 rect 仍在过渡中途，
// 停手后无 scroll 事件再触发重算，环停在中途值、最多偏一格。可见集合变化时
// 按 --dur-float 计时再同步一次位置，过渡走完才定档。
let _scrollProgressSettleTimer = 0;

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

function getScrollProgressEls() {
  if (!_scrollProgressCircle?.isConnected)
    _scrollProgressCircle = document.getElementById("scroll-progress-circle");
  if (!_scrollProgressValue?.isConnected)
    _scrollProgressValue = document.getElementById(
      "scroll-progress-circle-value",
    );
  if (!_scrollProgressLabel?.isConnected)
    _scrollProgressLabel = document.getElementById(
      "scroll-progress-circle-label",
    );
  return {
    circle: _scrollProgressCircle,
    value: _scrollProgressValue,
    label: _scrollProgressLabel,
  };
}

// 可见按钮集合的 key（id 拼接）：只读选择器不读布局，每调用都算、便宜；
// 变化即按钮显隐切换，位置必须立即重算（A8：不能被节流跳过）。
function visibleFloatingBtnKey(): string {
  const btns = document.querySelectorAll(
    ".floating-controls .floating-btn:not(.hide)",
  );
  let key = "";
  for (let i = 0; i < btns.length; i++) {
    key += `${(btns[i] as HTMLElement).id}|`;
  }
  return key;
}

// 环位置跟随按钮堆（ocr 真 bug A9）：不用“可见按钮数 × 4.25rem”——
// .hide 只改透明度/指针、不改布局占位，中间一颗藏掉后上面的按钮仍在原槽位，
// 数数会少算一格、环正好盖住最上面那颗。改为从最上方可见按钮的 rect 推：
// 环底边 = 容器底边 − 最上方可见按钮顶边 + 0.75rem 间距。
// 读 rect 会强制重排，只在可见集合变化 / 节流通过 / 尾刷时跑，不逐帧读。
function syncScrollProgressPosition(circle: HTMLElement): void {
  const controls = document.querySelector(".floating-controls");
  if (!controls) return;
  const btns = controls.querySelectorAll(".floating-btn:not(.hide)");
  if (btns.length === 0) {
    circle.style.bottom = "0px";
    return;
  }
  const controlsRect = controls.getBoundingClientRect();
  let top = Number.POSITIVE_INFINITY;
  for (let i = 0; i < btns.length; i++) {
    const t = (btns[i] as HTMLElement).getBoundingClientRect().top;
    if (t < top) top = t;
  }
  if (!Number.isFinite(top)) return;
  const rootFontSize =
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
    16;
  const gapPx = 0.75 * rootFontSize;
  const bottomPx = Math.max(0, controlsRect.bottom - top + gapPx);
  circle.style.bottom = `${bottomPx}px`;
}

// 终态对齐（ocr 真 bug B1）：可见集合变化意味着有按钮开始 bottom 过渡
// （--dur-float，默认 350ms、宽松档 450ms、减动效 1ms）；过渡走完后强制再
// 同步一次位置。多次快速切换时只留最后一个定时器。回调走
// syncScrollProgress(true)：复用 isConnected 守卫与节流旁路，位置一定落盘。
function scheduleScrollProgressSettle(): void {
  if (_scrollProgressSettleTimer) {
    window.clearTimeout(_scrollProgressSettleTimer);
  }
  const durRaw = getComputedStyle(document.documentElement).getPropertyValue(
    "--dur-float",
  );
  const durMs = Number.parseFloat(durRaw) || 350;
  _scrollProgressSettleTimer = window.setTimeout(() => {
    _scrollProgressSettleTimer = 0;
    syncScrollProgress(true);
  }, durMs + 50);
}

// 滚动进度环（rainzt ScrollProgress 移植）：滚动比 = scrollY / (文档高 −
// 视口高)，环用 stroke-dashoffset 填充（pathLength=100，offset 100−进度×100），
// 中央写百分比；约 12 次/秒节流（读文档高 + 写 SVG 每帧跑在长文上贵），
// 进度变化 <0.0005 时不写样式。位置：环在按钮堆最上方，从最上方可见按钮
// 的 rect 推 bottom（syncScrollProgressPosition），按钮显隐变化时立即
// 重算（移出节流），节流窗口内被丢掉的调用由尾刷补一次。
function syncScrollProgress(force = false) {
  const { circle, value, label } = getScrollProgressEls();
  if (!circle) return;
  // B6：行内脚本在解析期把环藏起来（解析期 TOC 计数算不准，见 BackToTop.astro
  // 的注释）；bundle 第一次同步即显示——位置在同任务内按 rect 重算、同一帧
  // 绘制，错位不露脸。
  if (circle.style.visibility === "hidden") circle.style.visibility = "";
  // 位置同步移出节流（ocr 真 bug A8）：按钮显隐变化时立即重算，不等节流窗口。
  const btnKey = visibleFloatingBtnKey();
  if (btnKey !== _lastScrollProgressBtnKey) {
    _lastScrollProgressBtnKey = btnKey;
    syncScrollProgressPosition(circle);
    // B1：过渡走完后再定档一次（见 scheduleScrollProgressSettle）。
    scheduleScrollProgressSettle();
  }
  const now = performance.now();
  if (!force && now - _lastScrollProgressUpdateAt < 80) {
    // 尾刷（ocr 真 bug A8）：节流只有前缘没有尾刷，最后一次 scroll 事件常
    // 落在窗口内被丢掉，环停在 99% 直到下次滚动。窗口内有调用被丢时，80ms
    // 后强制再跑一次（force），最终滚动位置一定落盘。
    if (!_scrollProgressTrailingTimer) {
      _scrollProgressTrailingTimer = window.setTimeout(() => {
        _scrollProgressTrailingTimer = 0;
        syncScrollProgress(true);
      }, 80);
    }
    return;
  }
  _lastScrollProgressUpdateAt = now;
  const scrollingElement =
    document.scrollingElement || document.documentElement;
  const maxScroll = Math.max(
    0,
    scrollingElement.scrollHeight - window.innerHeight,
  );
  const scrollTop = Math.max(
    0,
    window.scrollY || scrollingElement.scrollTop || 0,
  );
  const nextProgress = maxScroll > 0 ? Math.min(1, scrollTop / maxScroll) : 0;
  if (Math.abs(nextProgress - _lastScrollProgress) >= 0.0005) {
    _lastScrollProgress = nextProgress;
    const percent = Math.round(nextProgress * 100);
    if (value)
      value.style.setProperty(
        "stroke-dashoffset",
        `${(100 - nextProgress * 100).toFixed(2)}`,
      );
    if (label && _lastScrollProgressPercent !== percent) {
      _lastScrollProgressPercent = percent;
      label.textContent = `${percent}%`;
      circle.setAttribute("aria-label", `页面滚动进度 ${percent}%`);
    }
  }
  // 节流通过时也重算一次位置：按钮显隐过渡动画（350ms）期间 rect 在变，
  // 每 80ms 追一次，终态一定对齐（A9）。
  syncScrollProgressPosition(circle);
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

  // 滚动进度百分比环（rainzt ScrollProgress 移植）：每帧同步一次
  // （内部 80ms 节流 + 变化阈值），与回顶按钮同帧跑，两模式都生效。
  syncScrollProgress();

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

  // classic 模式整条滑走（旧实现，df49578 误删后恢复）：每帧按方向重算显隐，
  // 上滑（delta<0）或仍在顶部（scrollY<=threshold）显示，下滑且离开顶部
  // （delta>0 && scrollY>threshold）隐藏（对齐 firefly dynamic 模式）。
  // threshold = banner 高 − 导航栏高 − 主面板重叠 − 基础间距（约半屏）。
  // floating_pill 下本段整段早退（胶囊收拢由 navbar-collapse.ts 的单一
  // 控制器独占，整条永不滑走；早退在任何阈值计算之前，且不碰 back-to-top /
  // 目录逻辑——那两段在上方已跑完）；固定导航栏模式（always）跳过，
  // 始终显示；移动端跳过。
  // 导航栏隐藏时给 body 加类，供侧边栏吸顶位置回退（Layout.astro 消费）。
  const navbarEl = document.getElementById("navbar");
  const isPill =
    navbarEl?.classList.contains("navbar-style-floating-pill") ?? false;
  if (isPill) {
    // 胶囊永不滑走：顺手清掉任何残留的经典滑走态（切模式要重载主题，
    // 正常走不到这里；守卫失效即清，不留残留类）
    clearClassicHiddenState();
    lastScrollY = scrollY;
    return;
  }
  const delta = scrollY - lastScrollY;
  lastScrollY = scrollY;
  if (
    window.innerWidth >= MOBILE_BREAKPOINT &&
    bannerEnabled &&
    navbar &&
    document.documentElement.dataset.navbarFixed !== "true"
  ) {
    const threshold =
      bannerHeightPx -
      NAVBAR_HEIGHT_PX -
      MAIN_PANEL_OVERLAPS_BANNER_HEIGHT * BASE_SPACING_PX -
      BASE_SPACING_PX;
    if (delta < 0 || scrollY <= threshold) {
      navbar.classList.remove("navbar-hidden");
    } else if (delta > 0 && scrollY > threshold) {
      navbar.classList.add("navbar-hidden");
    }
    document.body.classList.toggle(
      "dynamic-navbar-hidden",
      navbar.classList.contains("navbar-hidden"),
    );
  } else {
    // 守卫失效（缩到移动端 / 切 always / 无 banner）：滑走态不再成立，
    // 清掉两个类——否则 body.dynamic-navbar-hidden 残留会把 about 顶部
    // 导航吸到 1rem（守望 #1），且下次回到桌面时首帧状态是脏的
    clearClassicHiddenState();
  }
}

// 全屏首页向下箭头（#scroll-down-indicator）点击目标：手算平滑滚动到内容区。
// 落点 = 网格顶边 − 首页间距（--banner-home-content-gap）− 固定导航栏高度，
// 使"页面背景顶部边缘"（banner 底边，100vh）对齐视口顶部而非网格顶边。
// Chrome 平滑 scrollIntoView 会忽略 scroll-margin，故必须手算；间距直接读
// CSS 变量（rem）按根字号换算 px，不再借用 scroll-margin-top 传值（语义扭曲）。
// 落点是否让位给导航栏按模式分流：classic + auto_hide 时导航栏滚动后会滑走
// （无需让位，偏移 0）；其余情况（floating_pill / always / 移动端）导航栏
// 常驻顶部，落点再上移导航栏高度使"导航栏底边"对齐页面背景顶部边缘；
// 高度动态测量（移动端强制固定，断点间可能不同）
export function scrollDownToContent(): void {
  const grid = getGrid();
  if (!grid) return;
  const cs = getComputedStyle(document.documentElement);
  const gap =
    (parseFloat(cs.getPropertyValue("--banner-home-content-gap")) || 0) *
    (parseFloat(cs.fontSize) || 16);
  const navbarEl = document.getElementById("navbar");
  const classicHides =
    window.innerWidth >= MOBILE_BREAKPOINT &&
    navbarEl &&
    !navbarEl.classList.contains("navbar-style-floating-pill") &&
    document.documentElement.dataset.navbarFixed !== "true";
  const navbarOffset = classicHides
    ? 0
    : getNavbar()?.getBoundingClientRect().height || 0;
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

/** 经典滑走残留清理（守望 #1）：navbar-hidden / body.dynamic-navbar-hidden
 *  只在 classic + 桌面 + auto_hide + 有 banner 的守卫内才有意义；守卫失效
 *  （窗口缩到 1441px 以下、切 always、banner 消失）时立即清掉——scroll
 *  事件不触发时（如只改窗口尺寸）靠下方 resize 监听补清。单一归属：
 *  这两个类只由本模块写（scroll-manager 是 classic 滑走的唯一控制器），
 *  清理也只在这里，不往 navbar-collapse 的量宽监听上打补丁。 */
function clearClassicHiddenState(): void {
  getNavbar()?.classList.remove("navbar-hidden");
  document.body.classList.remove("dynamic-navbar-hidden");
}

// 窗口尺寸变化不触发 scroll：守卫失效（缩到移动端 / 切 always / 切胶囊）
// 时只靠 scroll 帧里的 else 分支清不掉残留类，resize 帧补清一次
let resizeRaf = 0;
window.addEventListener(
  "resize",
  () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      if (
        window.innerWidth < MOBILE_BREAKPOINT ||
        !bannerEnabled ||
        document
          .getElementById("navbar")
          ?.classList.contains("navbar-style-floating-pill") ||
        document.documentElement.dataset.navbarFixed === "true"
      ) {
        clearClassicHiddenState();
      }
    });
  },
  { passive: true },
);

// 访客切换壁纸模式（setting-utils 的 applyBannerDisplay 派发）后立即重算
// 目录显隐：切到横幅/全屏模式且视口在顶部时需补挂隐藏（toc-hide + 无
// toc-revealed），切到 disabled/transparent 时清除隐藏状态
window.addEventListener("bannerModeChange", scrollFunction);

export { scrollFunction, syncScrollProgress };

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

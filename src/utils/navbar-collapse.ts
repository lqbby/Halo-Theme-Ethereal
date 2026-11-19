// 导航栏「滚动收缩」（aemeath 机制，仅 floating_pill 模式）。
// 收拢机制参考 Firefly（MIT）aemeath 导航栏实现，按本站结构改写：
// rainzt.cn 线上实测 —— 下滚超 50px 后整条导航栏不滑走，只收中间菜单胶囊，
// 仅剩当前页那一项（Logo / 搜索 / 工具组原地不动）；上滚超 2px 临时全展开，
// 5 秒不碰自动再收回；悬停 / 聚焦收拢后的胶囊也展开；下滚时临时展开态
// 立即收回（旧 scroll-manager 的方向重算，见 onScrollFrame）。
// classic 模式不走本模块：整条滑走（navbar-hidden，banner 阈值约半屏），
// 见 scroll-manager.ts——两模式滚动行为互不干扰（2026-11-16 用户定规）。
// 门控：仅桌面端（≥1441px，菜单本身 1441px 才可见）+ auto_hide 模式
// （html[data-navbar-fixed]="false"）；always 模式（"true"）永不收拢。
// 宽度与位置用 JS 实测：expanded 宽 / compact 宽 / 每项偏移量
// （--nav-item-expanded-offset）写进 CSS 变量，菜单胶囊绝对定位居中，
// 各项按偏移量绝对定位，宽过渡 .32s cubic-bezier(.6,0,.4,1)（见 components.css）。
// 换页后由 onPageView 重量（navbar.ts 的 updateDesktopNavActive 先跑，
// 保证 .nav-link-active 已更新）；访客切换滚动模式时 setNavbarScroll 派发
// navbarBehaviorChange，本模块监听后复位。
//
// 单一滚动控制器（第五轮，2026-11-16）：pill 下本模块是唯一写导航栏滚动
// 状态的地方——scroll-manager 在显隐段顶部遇 pill 即早退，navbar.js 只
// 保留 html.navbar-scrolled 阴影/玻璃类、不参与显隐决策。状态是四态机，
// 每帧（rAF 节流的 passive scroll 监听）按 (y, 方向, 悬停/聚焦, 定时器)
// 重算期望态并应用：
//   expanded（y≤40，全展开）/ collapsed（y>60 且下滚或静止，仅剩当前页）/
//   temp-expanded（已收拢 + 上滚超 2px / 悬停 / 聚焦，临时全展开）/
//   disabled（always / 移动端 / 换页过渡，复位、不写状态）。
// 回滞：收拢阈值 60、展开阈值 40（20px 死区），y≈50 附近不振荡。
// 收回定时器全局唯一：进入 TEMP_EXPANDED 才起，任何一次状态离开都清；
// 重起按 5000 − (now − lastKeepAliveAt) 算余量；胶囊内 pointermove 只
// 刷新 lastKeepAliveAt 不重启定时器；pointerleave / focusout 走 5 秒后
// 收回路径（非立即）。
import { onPageView } from "./once";

// ── 常量（与 rainzt aemeath-navbar.js 同值）──
/** 收拢阈值（回滞上沿）：滚动超过 60px 即收 */
const COLLAPSE_THRESHOLD_PX = 60;
/** 展开阈值（回滞下沿）：回到 40px 以下即全展开；与收拢阈值留 20px 死区 */
const EXPAND_THRESHOLD_PX = 40;
/** 临时展开态下滚立即收回的 y 下限（px）：已过收拢区才立即收 */
const TEMP_COLLAPSE_MIN_Y_PX = 50;
/** 上滚展开的最小位移（px）：delta < -2 才临时展开 */
const SCROLL_UP_DELTA_PX = -2;
/** 临时展开后无人操作（无 hover/focus）自动再收回的时间（ms） */
const RECOLLAPSE_DELAY_MS = 5000;
/** 折叠 WAAPI 动画时长（ms） */
const FOLD_DURATION_MS = 320;
/** 折叠动画中段关键帧位置（其余项淡出完成的时刻占比） */
const FOLD_FADE_END = 0.54;
/** 桌面端断点：与 Navbar.astro 的 1441px 断点一致，菜单 <1441px 不可见 */
const DESKTOP_MIN_WIDTH = 1441;
/** 折叠 WAAPI 动画仅在宽屏启用（rainzt 同值；窄屏只走 CSS 类切换） */
const FOLD_MIN_WIDTH = 1440;

/** 四态机当前态（单一真相源；类名只是它的投影） */
type NavbarCollapseState =
  "expanded" | "collapsed" | "temp-expanded" | "disabled";
let collapseState: NavbarCollapseState = "expanded";

const navbar = (): HTMLElement | null => document.getElementById("navbar");
const navLinks = (): HTMLElement | null =>
  document.querySelector<HTMLElement>("#navbar .nav-links");

// 折叠动画进行中列表 + 当前折叠容器（rainzt F/A 同源）
let foldingAnimations: Animation[] = [];
let foldingEl: HTMLElement | null = null;
// 临时展开后自动收回的定时器（rainzt S）
let recollapseTimer: number | undefined;
// 折叠动画结束时刻（performance.now 毫秒；供子菜单揭示延迟用，rainzt E）
let foldEndAt = 0;
// 量宽自纠：盯住菜单各项尺寸的 ResizeObserver（字体/图标度量一变就重测）
// 与 rAF 节流标记；jsdom 无 ResizeObserver，守卫跳过。
let menuSizeObserver: ResizeObserver | null = null;
let menuSizeRaf = 0;
let fontReloadRaf = 0;

/** 把当前各项交给 ResizeObserver（已观察过的重复 observe 是空操作）。
 *  项宽现为 max-content（见 components.css 防竖排），尺寸只随内容/字体变，
 *  不随收拢变量变——回调里重测不会自循环。 */
function observeMenuItems(): void {
  if (!menuSizeObserver) return;
  const links = navLinks();
  if (!links) return;
  links
    .querySelectorAll<HTMLElement>(".dropdown-container")
    .forEach((g) => menuSizeObserver!.observe(g));
}

function cancelFoldingAnimations(): void {
  foldingAnimations.forEach((a) => {
    try {
      // 先摘掉回调再 cancel：cancel 会触发 oncancel，不摘会重入本函数
      a.onfinish = null;
      a.oncancel = null;
      a.cancel();
    } catch {
      /* 动画已结束时 cancel 可能抛错，忽略 */
    }
  });
  foldingAnimations = [];
  foldingEl?.classList.remove("is-module-folding");
  foldingEl = null;
}

/** 折叠 / 展开的 WAAPI 动画（rainzt F）：当前页项滑向中心、其余项淡出/淡入。
 *  宽屏（>1440px）且非减动效时才播；否则直接跑回调（纯 CSS 类切换兜底）。
 *  @param links 菜单胶囊；@param expand true=展开、false=收拢；@param done 动画后回调 */
function foldAnimate(
  links: HTMLElement,
  expand: boolean,
  done: () => void,
): void {
  const items = Array.from(
    links.querySelectorAll<HTMLElement>(".dropdown-container"),
  );
  const activeItem = links.querySelector<HTMLElement>(".nav-compact-active");
  const activeIndex = activeItem ? items.indexOf(activeItem) : -1;
  if (
    !links.classList.contains("is-layout-ready") ||
    !activeItem ||
    activeIndex < 0 ||
    window.innerWidth <= FOLD_MIN_WIDTH ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    typeof activeItem.animate !== "function"
  ) {
    cancelFoldingAnimations();
    done();
    return;
  }
  const linksRect = links.getBoundingClientRect();
  const centerX = linksRect.left + linksRect.width / 2;
  const itemCenters = items.map((g) => {
    const r = g.getBoundingClientRect();
    return r.left + r.width / 2 - centerX;
  });
  const itemOpacities = items.map((g) =>
    Number.parseFloat(getComputedStyle(g).opacity),
  );
  const itemOffsets = items.map(
    (g) =>
      Number.parseFloat(
        g.style.getPropertyValue("--nav-item-expanded-offset"),
      ) || 0,
  );
  const activeCenter = itemCenters[activeIndex];
  const activeOffset = itemOffsets[activeIndex];
  // 先取消旧动画并跑回调（rainzt 顺序：A(), o() 在先），再判是否已在位：
  // 已在位时无需起 WAAPI，但类切换（回调）必须已发生，否则收拢后
  // is-hover-expanded 残留会把胶囊宽度顶回展开态
  cancelFoldingAnimations();
  done();
  if (
    Math.abs(activeCenter - (expand ? activeOffset : 0)) < 2 &&
    items.every(
      (_item, i) =>
        Math.abs(itemCenters[i] - (expand ? itemOffsets[i] : 0)) < 2,
    )
  ) {
    return;
  }
  const leftAt = (px: number): string => `calc(50% + ${px}px)`;
  const translateAt = (px: number): string =>
    `translate(-50%, -50%) translateX(${px}px)`;
  const ease = "cubic-bezier(0.4, 0, 0.2, 1)";
  const opts: KeyframeAnimationOptions = {
    duration: FOLD_DURATION_MS,
    easing: "linear",
    fill: "forwards",
  };
  links.classList.add("is-module-folding");
  foldingEl = links;
  const activeKeyframes: Keyframe[] = expand
    ? [
        {
          left: leftAt(activeOffset),
          transform: translateAt(activeCenter - activeOffset),
          offset: 0,
          easing: ease,
        },
        {
          left: leftAt(activeOffset),
          transform: translateAt(0),
          offset: 0.46,
          easing: ease,
        },
        { left: leftAt(activeOffset), transform: translateAt(0), offset: 1 },
      ]
    : [
        {
          left: leftAt(0),
          transform: translateAt(activeCenter),
          offset: 0,
          easing: ease,
        },
        {
          left: leftAt(0),
          transform: translateAt(activeCenter),
          offset: FOLD_FADE_END,
          easing: ease,
        },
        { left: leftAt(0), transform: translateAt(0), offset: 1 },
      ];
  const activeAnim = activeItem.animate(activeKeyframes, opts);
  foldingAnimations = [
    activeAnim,
    ...items.flatMap((g, i) => {
      if (i === activeIndex) return [];
      const dist = Math.abs(i - activeIndex);
      const fadePoint = Math.min(0.51, 0.29 + dist * 0.03);
      const keyframes: Keyframe[] = expand
        ? [
            {
              left: leftAt(itemCenters[i]),
              opacity: itemOpacities[i],
              offset: 0,
              easing: ease,
            },
            { left: leftAt(activeOffset), opacity: 0, offset: 0.46 },
            {
              left: leftAt(activeOffset),
              opacity: 0.12,
              offset: 1 - fadePoint,
              easing: ease,
            },
            { left: leftAt(itemOffsets[i]), opacity: 1, offset: 1 },
          ]
        : [
            {
              left: leftAt(itemCenters[i]),
              opacity: itemOpacities[i],
              offset: 0,
              easing: ease,
            },
            { left: leftAt(activeCenter), opacity: 0.12, offset: fadePoint },
            {
              left: leftAt(activeCenter),
              opacity: 0,
              offset: FOLD_FADE_END,
              easing: ease,
            },
            { left: leftAt(0), opacity: 0, offset: 1 },
          ];
      return [g.animate(keyframes, opts)];
    }),
  ];
  activeAnim.onfinish = () => {
    if (foldingAnimations[0] === activeAnim) cancelFoldingAnimations();
  };
  // 动画中途被取消（新一轮折叠 / 量宽 / 复位打断）时也强制落到终态：
  // done() 已先把目标态的类写好，取消后 WAAPI 内联值丢弃、CSS 值接管即终态；
  // 这里只需清掉进行中标记与动画表（与 onfinish 同口径）。
  activeAnim.oncancel = () => {
    if (foldingAnimations[0] === activeAnim) cancelFoldingAnimations();
  };
}

/** 其余项揭示延迟（rainzt z）：按胶囊当前宽度在展开/收拢区间的进度算，
 *  宽度越接近收拢态、延迟越大（最长 200ms），避免展开瞬间其余项抢先出现。 */
function updateRevealDelay(links: HTMLElement): void {
  const firstHidden = links.querySelector(
    ".dropdown-container:not(.nav-compact-active)",
  );
  if (!firstHidden) return;
  if (Number.parseFloat(getComputedStyle(firstHidden).opacity) > 0.08) {
    links.style.setProperty("--nav-item-reveal-delay", "0ms");
    return;
  }
  const cs = getComputedStyle(links);
  const compact = Number.parseFloat(
    cs.getPropertyValue("--nav-links-compact-width"),
  );
  const expanded = Number.parseFloat(
    cs.getPropertyValue("--nav-links-expanded-width"),
  );
  const span = expanded - compact;
  const progress =
    span > 0
      ? Math.min(
          1,
          Math.max(0, (links.getBoundingClientRect().width - compact) / span),
        )
      : 0;
  const delay = Math.round(200 * (1 - Math.min(1, progress / 0.85)));
  links.style.setProperty("--nav-item-reveal-delay", `${delay}ms`);
}

/** 子菜单展开跟踪（rainzt h）：悬停/聚焦到带子菜单的顶级项时标记
 *  .nav-submenu-open，离开时清除；揭示延迟按折叠动画剩余时间算。 */
function trackSubmenuOpen(links: HTMLElement, target: Element | null): void {
  const open =
    target?.matches(".dropdown-container") &&
    links.contains(target) &&
    target.querySelector(":scope > .submenu-panel")
      ? target
      : null;
  const current = links.querySelector(".dropdown-container.nav-submenu-open");
  if (current === open) return;
  if (current) current.classList.remove("nav-submenu-open");
  if (!open) return;
  const delay = Math.max(0, foldEndAt - performance.now());
  links.style.setProperty("--nav-submenu-reveal-delay", `${delay}ms`);
  open.classList.add("nav-submenu-open");
}

/** 临时展开菜单（rainzt R 的展开半边）：悬停 / 聚焦 / 上滚时调用。
 *  收回不走这里——收回由状态机 setState("collapsed") 统一应用（foldAnimate +
 *  收拢类），保证收拢态类集合只有一份 canonical 写法。
 *  withSubmenu=true 时同时打开子菜单态（悬停 / 聚焦）；=false 时为滚动揭示态。 */
function revealMenu(nav: HTMLElement, withSubmenu = false): void {
  if (!nav.classList.contains("scrolled")) return;
  const links = nav.querySelector<HTMLElement>(".nav-links");
  if (!links || !links.querySelector(".nav-compact-active .nav-link")) return;
  // 未展开时起折叠动画（宽屏 WAAPI，窄屏直接加类）；已展开则只刷新子菜单态
  if (!links.classList.contains("is-hover-expanded")) {
    foldEndAt = performance.now() + FOLD_DURATION_MS;
    updateRevealDelay(links);
    foldAnimate(links, true, () => links.classList.add("is-hover-expanded"));
  }
  if (withSubmenu) {
    const delay = Math.max(0, foldEndAt - performance.now());
    links.style.setProperty("--nav-submenu-reveal-delay", `${delay}ms`);
    links.classList.remove("is-scroll-revealed");
    links.classList.add("is-active-submenu-open");
  } else {
    links.classList.add("is-scroll-revealed");
    links.classList.remove("is-active-submenu-open");
  }
}

/** 给当前页项的容器打 .nav-compact-active（与 remeasure 内同一口径）。
 *  单独抽出：init 时先打一次，量宽失败时 CSS 兜底（scrolled 且未
 *  layout-ready 时非当前项 display:none）仍有当前项可留。
 *  三级回退（防呆 5b：标记缺失时收拢态 CSS 会把全部项藏掉、胶囊变空）：
 *  ① 已标当前页的链接（navbar.js 的 .nav-link-active）；② 按当前路径
 *  匹配（与 navbar.js 的 updateDesktopNavActive 同口径：顶级链接精确命中，
 *  或任一子项命中则父项亮）——换页后重测跑在高亮更新之前时仍能标对；
 *  ③ 首个 .dropdown-container。打完仍无标记时强制补打首项，永不为空。 */
function markCompactActive(links: HTMLElement): void {
  links.querySelectorAll(".nav-compact-active").forEach((el) => {
    el.classList.remove("nav-compact-active");
  });
  let target: HTMLElement | null | undefined = links
    .querySelector(".nav-link-active, .active")
    ?.closest<HTMLElement>(".dropdown-container");
  if (!target) {
    const path = window.location.pathname;
    const isMatch = (href: string | null): boolean => {
      if (!href || href === "#" || href.startsWith("#")) return false;
      try {
        const url = new URL(href, window.location.origin);
        return url.origin === window.location.origin && url.pathname === path;
      } catch {
        return false;
      }
    };
    for (const group of links.querySelectorAll<HTMLElement>(
      ".dropdown-container",
    )) {
      const top = group.querySelector(":scope > a.nav-link");
      const topHref = top?.getAttribute("href") ?? null;
      const childMatch = Array.from(
        group.querySelectorAll(".submenu-panel a"),
      ).some((child) => isMatch(child.getAttribute("href")));
      if (isMatch(topHref) || childMatch) {
        target = group;
        break;
      }
    }
  }
  if (!target) target = links.querySelector<HTMLElement>(".dropdown-container");
  target?.classList.add("nav-compact-active");
}

/** 收拢前兜底：保证恰有一项带 .nav-compact-active（胶囊永不为空）。
 *  setState("collapsed") 入口调用；打完仍无标记时强制补打首项。 */
function ensureCompactActive(links: HTMLElement | null): void {
  if (!links) return;
  if (links.querySelector(".nav-compact-active")) return;
  markCompactActive(links);
  if (links.querySelector(".nav-compact-active")) return;
  links
    .querySelector(".dropdown-container")
    ?.classList.add("nav-compact-active");
}

/** 实测菜单几何并写进 CSS 变量（rainzt Y）：展开宽 / 收拢宽 / 每项偏移量，
 *  并给当前页项的容器打 .nav-compact-active、给胶囊打 .is-layout-ready。
 *  测量时把胶囊临时移出视口（fixed + left:-10000px），测完原样恢复。 */
export function remeasureNavbarCollapse(): void {
  const nav = navbar();
  const links = navLinks();
  if (!nav || !links) return;
  // 仅胶囊模式量宽/收拢；classic 下本函数是空操作（init 已门控，此处
  // 再守一道，防外部直接调用时给 classic 菜单打上收拢标记）。
  if (!nav.classList.contains("navbar-style-floating-pill")) return;
  if (window.innerWidth < DESKTOP_MIN_WIDTH) {
    links.classList.remove("is-layout-ready");
    // 缩到 1441 以下时顺手复位收拢态（ocr 真 bug A2）：只摘 is-layout-ready
    // 不够——nav 上残留的 scrolled 让 .nav-compact-active 规则（特异度高于
    // Tailwind invisible）继续给当前页项写死 visibility:visible，当前页链接
    // 浮在导航栏中间，直到下一次滚动才复位。复位与 disabled 态同口径
    //（resetOnBehaviorChange）：清定时器、状态机置 disabled、去收拢类——
    // 只去类不同步状态机的话，缩回桌面后状态机仍以为是 collapsed、再也不
    // 会重新收拢。
    clearRecollapseTimer();
    collapseState = "disabled";
    applyDisabledReset(nav, links);
    return;
  }
  if (getComputedStyle(links).visibility === "hidden") return;
  cancelFoldingAnimations();
  const wasScrolled = nav.classList.contains("scrolled");
  const hadShadow = nav.classList.contains("navbar-sticky-shadow");
  const prevStyle = links.getAttribute("style");
  const items = Array.from(
    links.querySelectorAll<HTMLElement>(".dropdown-container"),
  );
  const prevItemStyles = items.map((g) => g.getAttribute("style"));
  nav.classList.remove("scrolled", "navbar-sticky-shadow");
  links.style.setProperty("position", "fixed", "important");
  links.style.setProperty("top", "0", "important");
  links.style.setProperty("left", "-10000px", "important");
  links.style.setProperty("display", "flex", "important");
  links.style.setProperty("width", "max-content", "important");
  links.style.setProperty("max-width", "none", "important");
  links.style.setProperty("transform", "none", "important");
  links.style.setProperty("visibility", "hidden", "important");
  links.style.setProperty("pointer-events", "none", "important");
  links.style.setProperty("transition", "none", "important");
  items.forEach((g) => {
    g.style.setProperty("position", "relative", "important");
    g.style.setProperty("top", "auto", "important");
    g.style.setProperty("left", "auto", "important");
    g.style.setProperty("display", "flex", "important");
    g.style.setProperty("opacity", "1", "important");
    g.style.setProperty("visibility", "visible", "important");
    g.style.setProperty("pointer-events", "auto", "important");
    g.style.setProperty("transform", "none", "important");
    g.style.setProperty("transition", "none", "important");
  });
  const linksRect = links.getBoundingClientRect();
  const expandedWidth = Math.ceil(linksRect.width);
  const itemOffsets = items.map((g) => {
    const r = g.getBoundingClientRect();
    return r.left + r.width / 2 - (linksRect.left + linksRect.width / 2);
  });
  const activeLink =
    links.querySelector<HTMLElement>(".nav-link-active, .active") ||
    links.querySelector<HTMLElement>(".nav-link");
  const rootFontSize =
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
    16;
  // 收拢宽取当前页链接的内容宽：rect 是量宽态（流内、未夹窄）的宽；再与
  // scrollWidth 取大——链接万一仍被旧样式夹住，内容宽能把它撑回单行。
  // （容器与各项不用 scrollWidth：量宽态 rect 本就是内容宽；而子菜单面板
  //  绝对定位溢出容器右侧时，scrollWidth 会把它也算进去、把展开宽撑大。）
  const activeRect = activeLink?.getBoundingClientRect();
  const compactWidth = Math.ceil(
    Math.max(
      activeRect?.width || rootFontSize * 4,
      activeLink?.scrollWidth || 0,
    ) +
      rootFontSize * 0.48 +
      2,
  );
  if (prevStyle === null) links.removeAttribute("style");
  else links.setAttribute("style", prevStyle);
  items.forEach((g, i) => {
    const s = prevItemStyles[i];
    if (s === null) g.removeAttribute("style");
    else if (s !== undefined) g.setAttribute("style", s);
  });
  if (wasScrolled) nav.classList.add("scrolled");
  if (hadShadow) nav.classList.add("navbar-sticky-shadow");
  // 🔴 写新宽度前先禁过渡：测量结束后上面已经把 style 恢复（transition 回到
  // CSS 的 `width 0.32s`），这里再写变量就会触发宽度动画；而容器是
  // `overflow: visible` ⇒ 动画期间菜单项溢出到容器外、文字叠在一起，看起来
  // 像在「首页 / 我的 / 数据看板」之间乱跳（2026-11-19 用户录屏）。
  // 字体分片陆续 loadingdone 会多次触发本函数，所以这个动画会反复播。
  // 双 rAF 后摘类：等新宽度真正应用完，再恢复过渡（hover 展开仍要动画）。
  links.classList.add("is-measuring");
  links.style.setProperty("--nav-links-expanded-width", `${expandedWidth}px`);
  links.style.setProperty("--nav-links-compact-width", `${compactWidth}px`);
  markCompactActive(links);
  items.forEach((g, i) => {
    g.style.setProperty(
      "--nav-item-expanded-offset",
      `${itemOffsets[i] || 0}px`,
    );
  });
  links.classList.add("is-layout-ready");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => links.classList.remove("is-measuring"));
  });
  // 换页后菜单项可能换过节点：把当前各项重新交给 ResizeObserver
  observeMenuItems();
}

function clearRecollapseTimer(): void {
  if (recollapseTimer !== undefined) {
    window.clearTimeout(recollapseTimer);
    recollapseTimer = undefined;
  }
}

/** 最近一次“保持展开”的交互时刻（performance.now 毫秒）：进入临时展开 /
 *  上滚 / 悬停移动 / 聚焦 / 指针离开都会刷新。收回定时器触发时按
 *  5000 − (now − lastKeepAliveAt) 算余量，余量 >100ms 则改期重排——
 *  临时展开至少稳定保持约 5 秒，过期定时器抢跑不了。 */
let lastKeepAliveAt = 0;

/** 起 / 重起收回定时器：余量 = 5000 − (now − lastKeepAliveAt) 自校准。
 *  调用点先把 lastKeepAliveAt 刷到 now（进入 TEMP_EXPANDED / 指针离开时），
 *  余量即满 5 秒；定时器回调里改期时不刷新 keep-alive，余量即剩余时间。 */
function armRecollapseTimer(): void {
  clearRecollapseTimer();
  const delay = Math.max(
    100,
    RECOLLAPSE_DELAY_MS - (performance.now() - lastKeepAliveAt),
  );
  recollapseTimer = window.setTimeout(onRecollapseTimer, delay);
}

/** 用户正在与导航栏交互：指针在胶囊上，或焦点在导航栏内（菜单 / 搜索框 /
 *  工具按钮）。滚动下滚强制收回与定时器收回都要让路——搜索框在
 *  .navbar-tools 内、不在 .nav-links 子树里，只查 links 的 :focus-within
 *  会漏掉搜索聚焦，定时器会在用户打字时把菜单收掉（验收 #6）。 */
function isNavbarInteracting(
  nav: HTMLElement,
  links: HTMLElement | null,
): boolean {
  if (links?.matches(":hover, :focus-within")) return true;
  return nav.matches(":focus-within");
}

/** 收回定时器触发：余量尚足则改期重排；悬停 / 聚焦中不收（离开时
 *  onPointerLeave 会重起 5 秒定时器）；否则进 COLLAPSED。 */
function onRecollapseTimer(): void {
  recollapseTimer = undefined;
  if (collapseState !== "temp-expanded") return;
  const remaining = RECOLLAPSE_DELAY_MS - (performance.now() - lastKeepAliveAt);
  if (remaining > 100) {
    armRecollapseTimer();
    return;
  }
  const nav = navbar();
  if (nav && isNavbarInteracting(nav, navLinks())) return;
  if (nav) setState("collapsed", nav, navLinks());
}

/** 临时展开态的子菜单风味切换：悬停 / 聚焦时开子菜单态
 * （is-active-submenu-open），指针离开时回滚动揭示态
 *  （is-scroll-revealed，子菜单关）。只动类，不动状态机。 */
function setTempExpandedFlavor(links: HTMLElement, viaHover: boolean): void {
  if (collapseState !== "temp-expanded") return;
  if (viaHover) {
    links.classList.add("is-active-submenu-open");
    links.classList.remove("is-scroll-revealed");
  } else {
    links.classList.add("is-scroll-revealed");
    links.classList.remove("is-active-submenu-open");
  }
}

/** 进入临时展开（悬停 / 聚焦 / 上滚的统一入口）：已收拢时进态（定时器随
 *  状态进入而起）；已在临时展开态时只刷新 keep-alive（不重启定时器）。 */
function enterTempExpanded(via: "scroll" | "hover"): void {
  const nav = navbar();
  const links = navLinks();
  if (!nav || !links) return;
  if (collapseState === "collapsed") {
    setState("temp-expanded", nav, links, via);
  } else if (collapseState === "temp-expanded") {
    lastKeepAliveAt = performance.now();
    if (via === "hover") setTempExpandedFlavor(links, true);
  }
}

/** 指针离开胶囊（rainzt W）：临时展开态 + 指针/焦点确已离开时，5 秒后收回
 *  （非立即）；同时关子菜单、回滚动揭示态。 */
function onPointerLeave(nav: HTMLElement): void {
  const links = nav.querySelector<HTMLElement>(".nav-links");
  if (collapseState !== "temp-expanded" || !links) return;
  if (links.matches(":hover, :focus-within")) return;
  trackSubmenuOpen(links, null);
  setTempExpandedFlavor(links, false);
  lastKeepAliveAt = performance.now();
  armRecollapseTimer();
}

/** 复位应用（disabled 态与模式切换复位共用）：去收拢、清子菜单态。 */
function applyDisabledReset(nav: HTMLElement, links: HTMLElement | null): void {
  cancelFoldingAnimations();
  nav.classList.remove("scrolled");
  if (links) {
    trackSubmenuOpen(links, null);
    links.classList.remove(
      "is-hover-expanded",
      "is-active-submenu-open",
      "is-scroll-revealed",
    );
    links.style.removeProperty("--nav-submenu-reveal-delay");
  }
  foldEndAt = 0;
}

/** 状态转移（唯一入口）：同态直接返回；任何一次离开都清收回定时器；
 *  进入 TEMP_EXPANDED 时刷 keep-alive 并起定时器。
 *  类集合每态只有一份 canonical 写法（收拢态见 collapsed 分支内联）。 */
function setState(
  next: NavbarCollapseState,
  nav: HTMLElement,
  links: HTMLElement | null,
  via: "scroll" | "hover" = "scroll",
): void {
  if (next === collapseState) return;
  clearRecollapseTimer();
  const prev = collapseState;
  collapseState = next;
  if (next === "disabled") {
    applyDisabledReset(nav, links);
    return;
  }
  if (next === "expanded") {
    const apply = (): void => {
      nav.classList.remove("scrolled");
      if (links) {
        trackSubmenuOpen(links, null);
        links.classList.remove(
          "is-hover-expanded",
          "is-active-submenu-open",
          "is-scroll-revealed",
        );
        links.style.removeProperty("--nav-submenu-reveal-delay");
      }
      foldEndAt = 0;
    };
    if (links && (prev === "collapsed" || prev === "temp-expanded")) {
      updateRevealDelay(links);
      foldAnimate(links, true, apply);
    } else {
      apply();
    }
    return;
  }
  if (next === "collapsed") {
    // 收拢前先保标记：无 .nav-compact-active 时收拢态 CSS 会把全部项藏掉
    if (links) ensureCompactActive(links);
    const apply = (): void => {
      nav.classList.add("scrolled");
      if (links) {
        trackSubmenuOpen(links, null);
        links.classList.remove("is-hover-expanded", "is-active-submenu-open");
        links.classList.add("is-scroll-revealed");
        links.style.removeProperty("--nav-submenu-reveal-delay");
      }
      foldEndAt = 0;
    };
    if (links) foldAnimate(links, false, apply);
    else apply();
    return;
  }
  // temp-expanded：刷 keep-alive、起 5 秒收回定时器，再展开菜单
  lastKeepAliveAt = performance.now();
  armRecollapseTimer();
  if (links) revealMenu(nav, via === "hover");
}

/** 控制器停用条件：always 模式 / 移动端 / 换页过渡。停用时复位、不写状态。 */
function isControllerDisabled(): boolean {
  return (
    document.documentElement.dataset.navbarFixed === "true" ||
    window.innerWidth < DESKTOP_MIN_WIDTH ||
    document.documentElement.classList.contains("is-changing") ||
    document.documentElement.classList.contains("is-animating")
  );
}

/** 每帧重算期望态（回滞 60/40，死区 20px）：
 *  y≤40 → EXPANDED；EXPANDED 下 y>60 → COLLAPSED；
 *  COLLAPSED 下 delta<−2 → TEMP_EXPANDED；
 *  TEMP_EXPANDED 下 delta>0 且 y>50 且非悬停/聚焦 → COLLAPSED；
 *  其余保持当前态（定时器到期由回调收回）。 */
function computeDesiredState(
  y: number,
  delta: number,
  hovering: boolean,
): NavbarCollapseState {
  if (y <= EXPAND_THRESHOLD_PX) return "expanded";
  switch (collapseState) {
    case "expanded":
      return y > COLLAPSE_THRESHOLD_PX ? "collapsed" : "expanded";
    case "collapsed":
      return delta < SCROLL_UP_DELTA_PX ? "temp-expanded" : "collapsed";
    case "temp-expanded":
      if (delta > 0 && y > TEMP_COLLAPSE_MIN_Y_PX && !hovering) {
        return "collapsed";
      }
      return "temp-expanded";
    case "disabled":
      return y > COLLAPSE_THRESHOLD_PX ? "collapsed" : "expanded";
  }
}

/** 滚动处理（单一控制器）：每帧按 (y, 方向, 悬停/聚焦) 重算期望态并应用；
 *  临时展开态下仍在上滚时只刷新 keep-alive（定时器到期自校准改期，不重启）。
 *  悬停/聚焦用实时 :hover/:focus-within 判定，不依赖指针事件是否漏发。 */
let lastScrollY = window.scrollY;
let scrollTicking = false;

function onScrollFrame(): void {
  scrollTicking = false;
  const nav = navbar();
  if (!nav) return;
  const links = nav.querySelector<HTMLElement>(".nav-links");
  const y = window.scrollY;
  const delta = y - lastScrollY;
  lastScrollY = y;
  if (isControllerDisabled()) {
    if (collapseState !== "disabled") setState("disabled", nav, links);
    return;
  }
  const hovering = isNavbarInteracting(nav, links);
  const next = computeDesiredState(y, delta, hovering);
  if (next !== collapseState) {
    setState(next, nav, links, "scroll");
  } else if (collapseState === "temp-expanded" && delta < SCROLL_UP_DELTA_PX) {
    lastKeepAliveAt = performance.now();
  }
}

function requestScrollFrame(): void {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(onScrollFrame);
}

/** 模式切换复位（rainzt T 开头 + navbarBehaviorChange）：强制复位后按
 *  当前滚动位置重算（always 时去收拢、切回 auto_hide 时按位置重算）。 */
function resetOnBehaviorChange(): void {
  const nav = navbar();
  if (!nav) return;
  cancelFoldingAnimations();
  clearRecollapseTimer();
  collapseState = "disabled";
  applyDisabledReset(nav, navLinks());
  lastScrollY = window.scrollY;
  requestScrollFrame();
}

/** 初始化（rainzt T + 事件接线）：app.ts 调用一次；重复调用空转。
 *  模式门控：收拢机制只在 floating_pill 下生效（rainzt 胶囊机制）；
 *  classic 用旧整条滑走（scroll-manager.ts），本模块不接管——
 *  两模式滚动行为互不干扰（2026-11-16 用户定规）。样式由
 *  theme.config 渲染进 #navbar 的 navbar-style-floating-pill 类，
 *  后台改样式要重载主题，故首帧判定一次即可。 */
export function initNavbarCollapse(): void {
  const nav = navbar();
  const links = navLinks();
  if (!nav || !links) return;
  if (!nav.classList.contains("navbar-style-floating-pill")) return;
  if (
    (window as unknown as { __etherealNavbarCollapseBound?: boolean })
      .__etherealNavbarCollapseBound
  ) {
    return;
  }
  (
    window as unknown as { __etherealNavbarCollapseBound?: boolean }
  ).__etherealNavbarCollapseBound = true;

  // 悬停 / 聚焦进入胶囊：已收拢时临时展开（定时器随状态进入而起）；
  // 已在临时展开态时只刷新 keep-alive（不重启定时器）。
  links.addEventListener("pointerenter", () => {
    enterTempExpanded("hover");
  });
  links.addEventListener("pointerleave", () => {
    trackSubmenuOpen(links, null);
    onPointerLeave(nav);
  });
  links.addEventListener("pointermove", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (collapseState === "collapsed") {
      // 指针移进已收拢的胶囊：悬停展开（上滚展开后胶囊在指针下方变宽、
      // 未触发 pointerenter 的情形也靠这一路进入）
      enterTempExpanded("hover");
    } else if (collapseState === "temp-expanded") {
      // 已在临时展开态：只刷新 keep-alive，不重启定时器
      lastKeepAliveAt = performance.now();
      setTempExpandedFlavor(links, true);
    }
    if (collapseState === "collapsed" || collapseState === "temp-expanded") {
      trackSubmenuOpen(links, target?.closest(".dropdown-container") ?? null);
    }
  });
  // 聚焦进入导航栏：focusin 必须绑在 #navbar 上——搜索框在 .navbar-tools 内、
  // 不在 .nav-links 子树里，绑 links 上焦点事件冒泡不到监听器，搜索聚焦
  // 永远展不开菜单（验收 #6）。工具按钮聚焦同样展开（用户正在用导航栏）。
  nav.addEventListener("focusin", (e) => {
    enterTempExpanded("hover");
    const target = e.target instanceof Element ? e.target : null;
    if (target) {
      trackSubmenuOpen(links, target.closest(".dropdown-container"));
    }
  });
  nav.addEventListener("focusout", () => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      const focusStillInside =
        active instanceof Element && nav.contains(active);
      if (!focusStillInside) {
        trackSubmenuOpen(links, null);
        onPointerLeave(nav);
      } else {
        trackSubmenuOpen(links, active.closest(".dropdown-container"));
      }
    });
  });

  // 站内链接点击后当前页可能变化：80ms / 240ms 后重量（rainzt 同源）
  document.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const anchor = target?.closest("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#") || /^https?:\/\//.test(href)) return;
    window.setTimeout(remeasureNavbarCollapse, 80);
    window.setTimeout(remeasureNavbarCollapse, 240);
  });
  window.addEventListener("popstate", remeasureNavbarCollapse);
  window.addEventListener("hashchange", remeasureNavbarCollapse);

  let resizeRaf = 0;
  window.addEventListener(
    "resize",
    () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        remeasureNavbarCollapse();
        // 尺寸变化后重算期望态（ocr 真 bug A2 的另一半）：remeasure 在窄分支
        // 里把状态机置 disabled，缩回桌面后若不重算，导航栏会一直停在展开态
        // 直到下一次滚动；scroll 帧只在滚动时跑，resize 时也要补一次。
        requestScrollFrame();
      });
    },
    { passive: true },
  );

  // 访客切换滚动模式（setNavbarScroll 派发）后复位
  window.addEventListener("navbarBehaviorChange", resetOnBehaviorChange);
  // 换页后当前页变化（navbar.ts 先更新 .nav-link-active）→ 重量
  onPageView("navbar-collapse", remeasureNavbarCollapse);
  // 迟到的量宽：首帧量宽可能撞上字体未载入（按回退字体量的宽不准）或
  // navbar.js 尚未标 .nav-link-active；载入完成与字体就绪后各重量一次
  window.addEventListener("load", remeasureNavbarCollapse);
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      remeasureNavbarCollapse();
    });
  }
  // 量宽自纠：迟到的字体分片（loadingdone，如文楷后几片）一到就重测；
  // ResizeObserver 盯住各项尺寸，字体/图标度量一变就重测重写变量。
  // fonts.ready 只在首批字体落定时 resolve 一次，管不到后到的分片。
  document.fonts?.addEventListener?.("loadingdone", () => {
    if (fontReloadRaf) return;
    fontReloadRaf = requestAnimationFrame(() => {
      fontReloadRaf = 0;
      remeasureNavbarCollapse();
    });
  });
  if (typeof ResizeObserver !== "undefined") {
    menuSizeObserver = new ResizeObserver(() => {
      if (menuSizeRaf) return;
      menuSizeRaf = requestAnimationFrame(() => {
        menuSizeRaf = 0;
        remeasureNavbarCollapse();
      });
    });
    observeMenuItems();
  }

  window.addEventListener("scroll", requestScrollFrame, { passive: true });
  // 换页过渡结束时补算一次：过渡期间帧处理只复位不写状态，若过渡后用户
  // 不再滚动，导航栏会一直停在复位态（y>60 却未收拢）；监听 <html> 的 class，
  // 过渡类（is-changing/is-animating）被移除的瞬间重算。
  // 与 navbar.ts 的玻璃监听同口径（只在「过渡 → 非过渡」的转换时触发）。
  let navbarWasTransitioning = false;
  const transitionObserver = new MutationObserver(() => {
    const transitioning =
      document.documentElement.classList.contains("is-changing") ||
      document.documentElement.classList.contains("is-animating");
    if (navbarWasTransitioning && !transitioning) requestScrollFrame();
    navbarWasTransitioning = transitioning;
  });
  transitionObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  // 诊断钩子（排障用）：返回当前滚动位置、状态机态、当前项标记、
  // wrapper/nav 类名、收回定时器是否挂起
  (
    window as unknown as {
      __navbarState?: () => {
        scrollY: number;
        state: NavbarCollapseState;
        hasActive: boolean;
        wrapperClasses: string;
        navbarClasses: string;
        timerPending: boolean;
      };
    }
  ).__navbarState = () => ({
    scrollY: window.scrollY,
    state: collapseState,
    hasActive: !!navLinks()?.querySelector(".nav-compact-active"),
    wrapperClasses: document.getElementById("navbar-wrapper")?.className ?? "",
    navbarClasses: navbar()?.className ?? "",
    timerPending: recollapseTimer !== undefined,
  });
  // 先打当前项标记（量宽失败时 CSS 兜底仍有当前项可留），再量宽
  markCompactActive(links);
  remeasureNavbarCollapse();
  onScrollFrame();
}

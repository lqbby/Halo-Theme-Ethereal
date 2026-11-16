// 导航栏「滚动收缩」（aemeath 机制）。
// 收拢机制参考 Firefly（MIT）aemeath 导航栏实现，按本站结构改写：
// rainzt.cn 线上实测 —— 下滚超 50px 后整条导航栏不滑走，只收中间菜单胶囊，
// 仅剩当前页那一项（Logo / 搜索 / 工具组原地不动）；上滚超 2px 临时全展开，
// 5 秒不碰自动再收回；悬停 / 聚焦收拢后的胶囊也展开。
// 与本站旧实现的区别：旧 scroll-manager 是整条滑走（navbar-hidden，banner
// 阈值约半屏）；此处只收菜单、阈值固定 50px，整条滑走逻辑已删除（见
// scroll-manager.ts），导航栏在 auto_hide 下始终可见。
// 门控：仅桌面端（≥1024px，菜单本身 lg 才可见）+ auto_hide 模式
// （html[data-navbar-fixed]="false"）；always 模式（"true"）永不收拢。
// 宽度与位置用 JS 实测：expanded 宽 / compact 宽 / 每项偏移量
// （--nav-item-expanded-offset）写进 CSS 变量，菜单胶囊绝对定位居中，
// 各项按偏移量绝对定位，宽过渡 .32s cubic-bezier(.6,0,.4,1)（见 components.css）。
// 换页后由 onPageView 重量（navbar.ts 的 updateDesktopNavActive 先跑，
// 保证 .nav-link-active 已更新）；访客切换滚动模式时 setNavbarScroll 派发
// navbarBehaviorChange，本模块监听后复位。
import { onPageView } from "./once";

// ── 常量（与 rainzt aemeath-navbar.js 同值）──
/** 收拢阈值：滚动超过 50px 即收（固定值，不是 banner 阈值） */
const SCROLL_THRESHOLD_PX = 50;
/** 上滚展开的最小位移（px）：delta < -2 才临时展开 */
const SCROLL_UP_DELTA_PX = -2;
/** 临时展开后无人操作（无 hover/focus）自动再收回的时间（ms） */
const RECOLLAPSE_DELAY_MS = 5000;
/** 折叠 WAAPI 动画时长（ms） */
const FOLD_DURATION_MS = 320;
/** 折叠动画中段关键帧位置（其余项淡出完成的时刻占比） */
const FOLD_FADE_END = 0.54;
/** 桌面端断点：与 Navbar.astro 的 lg 断点一致，菜单 <1024px 不可见 */
const DESKTOP_MIN_WIDTH = 1024;
/** 折叠 WAAPI 动画仅在宽屏启用（rainzt 同值；窄屏只走 CSS 类切换） */
const FOLD_MIN_WIDTH = 1440;

const navbar = (): HTMLElement | null => document.getElementById("navbar");
const navLinks = (): HTMLElement | null =>
  document.querySelector<HTMLElement>("#navbar .nav-links");

// 折叠动画进行中列表 + 当前折叠容器（rainzt F/A 同源）
let foldingAnimations: Animation[] = [];
let foldingEl: HTMLElement | null = null;
// 临时展开后自动收回的定时器（rainzt S）
let recollapseTimer: number | undefined;
// 指针是否在菜单胶囊内（rainzt L：pointermove 置真，供子菜单展开用）
let pointerInside = false;
// 折叠动画结束时刻（performance.now 毫秒；供子菜单揭示延迟用，rainzt E）
let foldEndAt = 0;

function cancelFoldingAnimations(): void {
  foldingAnimations.forEach((a) => {
    try {
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
    links.querySelectorAll<HTMLElement>(":scope > .dropdown-container"),
  );
  const activeItem = links.querySelector<HTMLElement>(
    ":scope > .nav-compact-active",
  );
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
      Number.parseFloat(g.style.getPropertyValue("--nav-item-expanded-offset")) ||
      0,
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
        { left: leftAt(activeOffset), transform: translateAt(activeCenter - activeOffset), offset: 0, easing: ease },
        { left: leftAt(activeOffset), transform: translateAt(0), offset: 0.46, easing: ease },
        { left: leftAt(activeOffset), transform: translateAt(0), offset: 1 },
      ]
    : [
        { left: leftAt(0), transform: translateAt(activeCenter), offset: 0, easing: ease },
        { left: leftAt(0), transform: translateAt(activeCenter), offset: FOLD_FADE_END, easing: ease },
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
            { left: leftAt(itemCenters[i]), opacity: itemOpacities[i], offset: 0, easing: ease },
            { left: leftAt(activeOffset), opacity: 0, offset: 0.46 },
            { left: leftAt(activeOffset), opacity: 0.12, offset: 1 - fadePoint, easing: ease },
            { left: leftAt(itemOffsets[i]), opacity: 1, offset: 1 },
          ]
        : [
            { left: leftAt(itemCenters[i]), opacity: itemOpacities[i], offset: 0, easing: ease },
            { left: leftAt(activeCenter), opacity: 0.12, offset: fadePoint },
            { left: leftAt(activeCenter), opacity: 0, offset: FOLD_FADE_END, easing: ease },
            { left: leftAt(0), opacity: 0, offset: 1 },
          ];
      return [g.animate(keyframes, opts)];
    }),
  ];
  activeAnim.onfinish = () => {
    if (foldingAnimations[0] === activeAnim) cancelFoldingAnimations();
  };
}

/** 其余项揭示延迟（rainzt z）：按胶囊当前宽度在展开/收拢区间的进度算，
 *  宽度越接近收拢态、延迟越大（最长 200ms），避免展开瞬间其余项抢先出现。 */
function updateRevealDelay(links: HTMLElement): void {
  const firstHidden = links.querySelector(
    ":scope > .dropdown-container:not(.nav-compact-active)",
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
function trackSubmenuOpen(
  links: HTMLElement,
  target: Element | null,
): void {
  const open =
    target?.matches(".dropdown-container") &&
    links.contains(target) &&
    target.querySelector(":scope > .submenu-panel")
      ? target
      : null;
  const current = links.querySelector(
    ":scope > .dropdown-container.nav-submenu-open",
  );
  if (current === open) return;
  if (current) current.classList.remove("nav-submenu-open");
  if (!open) return;
  const delay = Math.max(0, foldEndAt - performance.now());
  links.style.setProperty("--nav-submenu-reveal-delay", `${delay}ms`);
  open.classList.add("nav-submenu-open");
}

/** 揭示 / 收回菜单（rainzt R）：expand=true 全展开（悬停/上滚/子菜单），
 *  false 收回（仅剩当前页项）。withSubmenu=true 时同时打开子菜单态。 */
function revealMenu(
  nav: HTMLElement,
  expand: boolean,
  withSubmenu = false,
): void {
  if (!nav.classList.contains("scrolled")) return;
  const links = nav.querySelector<HTMLElement>(".nav-links");
  if (!links || !links.querySelector(".nav-compact-active .nav-link")) return;
  if (expand) {
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
  } else {
    foldEndAt = 0;
    links.style.removeProperty("--nav-submenu-reveal-delay");
    trackSubmenuOpen(links, null);
    foldAnimate(links, false, () => {
      links.classList.remove(
        "is-hover-expanded",
        "is-active-submenu-open",
        "is-scroll-revealed",
      );
    });
  }
}

/** 实测菜单几何并写进 CSS 变量（rainzt Y）：展开宽 / 收拢宽 / 每项偏移量，
 *  并给当前页项的容器打 .nav-compact-active、给胶囊打 .is-layout-ready。
 *  测量时把胶囊临时移出视口（fixed + left:-10000px），测完原样恢复。 */
export function remeasureNavbarCollapse(): void {
  const nav = navbar();
  const links = navLinks();
  if (!nav || !links) return;
  if (window.innerWidth < DESKTOP_MIN_WIDTH) {
    links.classList.remove("is-layout-ready");
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
  const compactWidth = Math.ceil(
    (activeLink?.getBoundingClientRect().width || rootFontSize * 4) +
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
  links.style.setProperty("--nav-links-expanded-width", `${expandedWidth}px`);
  links.style.setProperty("--nav-links-compact-width", `${compactWidth}px`);
  links.querySelectorAll(".nav-compact-active").forEach((el) => {
    el.classList.remove("nav-compact-active");
  });
  (
    links.querySelector(".nav-link-active, .active") ||
    links.querySelector(".nav-link")
  )
    ?.closest(".dropdown-container")
    ?.classList.add("nav-compact-active");
  items.forEach((g, i) => {
    g.style.setProperty("--nav-item-expanded-offset", `${itemOffsets[i] || 0}px`);
  });
  links.classList.add("is-layout-ready");
}

function clearRecollapseTimer(): void {
  if (recollapseTimer !== undefined) {
    window.clearTimeout(recollapseTimer);
    recollapseTimer = undefined;
  }
}

/** 临时展开 + 5 秒后自动收回（rainzt M）：上滚 / 悬停 / 聚焦时调用。
 *  withSubmenu=true 时展开并打开子菜单态。 */
function tempExpand(nav: HTMLElement, withSubmenu = false): void {
  if (!nav.classList.contains("scrolled")) return;
  revealMenu(nav, true, withSubmenu || pointerInside);
  clearRecollapseTimer();
  recollapseTimer = window.setTimeout(() => {
    recollapseTimer = undefined;
    const links = nav.querySelector<HTMLElement>(".nav-links");
    if (!links || links.matches(":hover, :focus-within")) return;
    revealMenu(nav, false);
  }, RECOLLAPSE_DELAY_MS);
}

/** 指针离开胶囊（rainzt W）：已展开且指针不在胶囊内时，5 秒后收回。 */
function onPointerLeave(nav: HTMLElement): void {
  const links = nav.querySelector<HTMLElement>(".nav-links");
  if (
    !nav.classList.contains("scrolled") ||
    !links?.classList.contains("is-hover-expanded") ||
    links.matches(":hover, :focus-within")
  ) {
    return;
  }
  pointerInside = false;
  trackSubmenuOpen(links, null);
  links.classList.add("is-scroll-revealed");
  links.classList.remove("is-active-submenu-open");
  clearRecollapseTimer();
  recollapseTimer = window.setTimeout(() => {
    recollapseTimer = undefined;
    if (!links.matches(":hover, :focus-within")) revealMenu(nav, false);
  }, RECOLLAPSE_DELAY_MS);
}

/** 滚动处理（rainzt T 的 p）：scrollTop > 50 即收拢；收拢态下上滚超 2px
 *  临时展开。always 模式 / 换页过渡 / 移动端时复位并直接返回。 */
let lastScrollY = window.scrollY;
let scrollTicking = false;

function onScrollFrame(): void {
  scrollTicking = false;
  const nav = navbar();
  if (!nav) return;
  const links = nav.querySelector<HTMLElement>(".nav-links");
  // always 模式（data-navbar-fixed="true"）：永不收拢，复位状态
  if (document.documentElement.dataset.navbarFixed === "true") {
    nav.classList.remove("scrolled");
    lastScrollY = window.scrollY;
    pointerInside = false;
    return;
  }
  // 换页过渡期间复位（Swup 的 is-changing / is-animating）
  if (
    document.documentElement.classList.contains("is-changing") ||
    document.documentElement.classList.contains("is-animating")
  ) {
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
    clearRecollapseTimer();
    pointerInside = false;
    foldEndAt = 0;
    lastScrollY = window.scrollY;
    return;
  }
  // 移动端（<1024px）菜单不可见：复位
  if (window.innerWidth < DESKTOP_MIN_WIDTH) {
    nav.classList.remove("scrolled");
    lastScrollY = window.scrollY;
    return;
  }
  const scrollY = window.scrollY;
  const delta = scrollY - lastScrollY;
  const shouldCollapse = scrollY > SCROLL_THRESHOLD_PX;
  if (shouldCollapse !== nav.classList.contains("scrolled")) {
    if (!shouldCollapse && links) updateRevealDelay(links);
    clearRecollapseTimer();
    pointerInside = false;
    foldEndAt = 0;
    if (links) trackSubmenuOpen(links, null);
    const apply = (): void => {
      if (!links) return;
      links.classList.remove("is-hover-expanded", "is-active-submenu-open");
      links.classList.toggle("is-scroll-revealed", shouldCollapse);
      links.style.removeProperty("--nav-submenu-reveal-delay");
      nav.classList.toggle("scrolled", shouldCollapse);
    };
    if (links) foldAnimate(links, !shouldCollapse, apply);
    else apply();
  }
  // 收拢态下上滚超 2px：临时全展开（5 秒后自动收回）
  if (nav.classList.contains("scrolled") && delta < SCROLL_UP_DELTA_PX) {
    tempExpand(nav, false);
  }
  lastScrollY = scrollY;
}

function requestScrollFrame(): void {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(onScrollFrame);
}

/** 模式切换复位（rainzt T 开头 + navbarBehaviorChange）：always 时去收拢、
 *  切回 auto_hide 时按当前滚动位置重算。 */
function resetOnBehaviorChange(): void {
  const nav = navbar();
  if (!nav) return;
  cancelFoldingAnimations();
  clearRecollapseTimer();
  pointerInside = false;
  foldEndAt = 0;
  const links = nav.querySelector<HTMLElement>(".nav-links");
  if (links) {
    trackSubmenuOpen(links, null);
    links.classList.remove(
      "is-hover-expanded",
      "is-active-submenu-open",
      "is-scroll-revealed",
    );
    links.style.removeProperty("--nav-submenu-reveal-delay");
  }
  if (document.documentElement.dataset.navbarFixed === "true") {
    nav.classList.remove("scrolled");
    return;
  }
  lastScrollY = window.scrollY;
  onScrollFrame();
}

/** 初始化（rainzt T + 事件接线）：app.ts 调用一次；重复调用空转。 */
export function initNavbarCollapse(): void {
  const nav = navbar();
  const links = navLinks();
  if (!nav || !links) return;
  if ((window as unknown as { __etherealNavbarCollapseBound?: boolean }).__etherealNavbarCollapseBound) {
    return;
  }
  (window as unknown as { __etherealNavbarCollapseBound?: boolean }).__etherealNavbarCollapseBound = true;

  links.addEventListener("pointerenter", () => {
    tempExpand(nav, false);
  });
  links.addEventListener("pointerleave", () => {
    trackSubmenuOpen(links, null);
    onPointerLeave(nav);
  });
  links.addEventListener("pointermove", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!pointerInside) {
      pointerInside = true;
      tempExpand(nav, true);
    }
    if (nav.classList.contains("scrolled")) {
      trackSubmenuOpen(links, target?.closest(".dropdown-container") ?? null);
    }
  });
  links.addEventListener("focusin", (e) => {
    tempExpand(nav, true);
    const target = e.target instanceof Element ? e.target : null;
    if (target) {
      trackSubmenuOpen(links, target.closest(".dropdown-container"));
    }
  });
  links.addEventListener("focusout", () => {
    requestAnimationFrame(() => {
      if (!pointerInside) {
        const active = document.activeElement;
        trackSubmenuOpen(
          links,
          active instanceof Element
            ? active.closest(".dropdown-container")
            : null,
        );
      }
      onPointerLeave(nav);
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
      });
    },
    { passive: true },
  );

  // 访客切换滚动模式（setNavbarScroll 派发）后复位
  window.addEventListener("navbarBehaviorChange", resetOnBehaviorChange);
  // 换页后当前页变化（navbar.ts 先更新 .nav-link-active）→ 重量
  onPageView("navbar-collapse", remeasureNavbarCollapse);

  window.addEventListener("scroll", requestScrollFrame, { passive: true });
  remeasureNavbarCollapse();
  onScrollFrame();
}

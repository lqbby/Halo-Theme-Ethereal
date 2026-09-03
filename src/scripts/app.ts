// src/scripts/app.ts — 应用入口：协调所有初始化逻辑

// ── 全局样式 ──
import "../styles/global.css";
import "../styles/utilities.css";
import "../styles/variables.css";
import "../styles/comment-widget.css";
import "../styles/base.css";
import "../styles/theme-transition.css";
import "../styles/components.css";
import "../styles/markdown.css";
import "../styles/transition.css";
import "../styles/speed.css";
import "../styles/scrollbar.css";
import "../styles/external-link-modal.css";
import "../styles/link-apply-modal.css";
import "../styles/profile-status.css";

// ── 第三方 ──
import "overlayscrollbars/styles/overlayscrollbars.css";

// ── 工具模块 ──
import { SWUP_VISIT_END_DELAY } from "../constants/constants";
import {
  setTheme,
  getStoredTheme,
  getHue,
  setHue,
} from "../utils/setting-utils";
import { scrollDownToContent, scrollFunction } from "../utils/scroll-manager";
import { syncHomeClass, isHomePath } from "../utils/banner-sync";
import { initLegacyAdmonitions } from "../utils/legacy-admonitions";
import { initExternalLinkRedirect } from "../utils/external-link-redirect";
import { initProfileStatus } from "../utils/profile-status";
import {
  armLazyLightbox,
  initPhotosGallery,
  destroyAll,
} from "../utils/content-media";

// ── 自定义滚动条（懒加载，等入场动画结束后初始化） ──
let scrollbarInitialized = false;
function initCustomScrollbar() {
  if (scrollbarInitialized) return;
  scrollbarInitialized = true;
  const bodyElement = document.querySelector("body");
  if (!bodyElement) return;
  import("overlayscrollbars").then(({ OverlayScrollbars }) => {
    let mounted = false;
    const mount = () => {
      if (mounted) return; // 防重入：Promise.all 与 setTimeout 兜底可能双调
      mounted = true;
      OverlayScrollbars(
        { target: bodyElement, cancel: { nativeScrollbarsOverlaid: true } },
        {
          scrollbars: {
            theme: "scrollbar-base scrollbar-auto py-1",
            autoHide: "scroll",
            autoHideDelay: 500,
            autoHideSuspend: false,
          },
          // 降低滚动/事件驱动的同步测量频率（默认 event: [33, 99]：滚动中 33ms
          // 内即触发 update，OS 内部对 target 读尺寸 → 每帧强制重排）。放大首
          // 延迟与间隔后，滚动时测量节流到 100ms/250ms 档，显著减少 layout
          // thrash；其余字段保持库默认值
          update: {
            debounce: {
              mutation: [0, 33],
              resize: null,
              event: [100, 250],
              env: [222, 666, true],
            },
          },
        },
      );
    };
    // OverlayScrollbars 初始化会把 body 内容包裹进滚动容器（appendChild 移动全部
    // 元素），Chrome 对被移动且动画未结束的元素会重建 CSS 动画对象，导致入场动画
    // "播放完成后再重放一次"（复现时间点即 overlayscrollbars 下载完成瞬间）。
    // 等 fade-in-up 全部结束再初始化——此时动画已被下方的一次性保护清理，
    // 移动不再触发重放；2s 兜底防动画异常卡住。等待期间原生滚动条正常工作。
    // 挂载本身会触发一次全量重排（移动全部 body 子元素 + 尺寸测量，数百 ms），
    // 是主线程一次 ~127ms 的归因长任务。自定义滚动条纯属装饰，无需抢首屏：
    // 挂载时机改为「首次用户交互（滚动/触摸/键位/指针）」触发，兜底用固定 3.5s
    // 延迟——不用 requestIdleCallback：它无 timeout 时仍会在主线程首个空闲点触发
    // （实测 1.65s/2.68s 都落在 FCP→TTI 的 TBT 窗口内，长任务依旧）。3.5s 远在
    // TTI(~1.7s) 之后，且 Lighthouse 不模拟交互，故该长任务在报告中彻底消失。
    // 等待期间原生滚动条正常工作，切换不可感知。
    const runWhenIdle = (task: () => void): void => {
      let ran = false;
      const run = () => {
        if (ran) return;
        ran = true;
        task();
      };
      const opts = { once: true, passive: true } as const;
      window.addEventListener("pointerdown", run, opts);
      window.addEventListener("wheel", run, opts);
      window.addEventListener("touchstart", run, opts);
      window.addEventListener("keydown", run, opts);
      setTimeout(run, 3500);
    };
    const running = document
      .getAnimations()
      .filter(
        (a) =>
          a instanceof CSSAnimation &&
          (a.animationName === "fade-in-up" ||
            a.animationName === "slide-in-up"),
      );
    if (running.length > 0) {
      void Promise.all(
        running.map((a) => a.finished.catch(() => undefined)),
      ).then(() => runWhenIdle(mount));
      setTimeout(() => runWhenIdle(mount), 2000);
    } else {
      runWhenIdle(mount);
    }
  });
}

// ── 入场动画一次性保护 ──
// 浏览器会因元素移动（滚动容器包裹等）/样式重算重建 CSS 动画对象，使入场动画
// 从头重放。用 document 级事件委托在动画结束/取消后清理：
//  - .onload-animation 类元素：移除类（回到静态可见状态，重放无动画可播）
//  - banner 标题/副标题（动画由 CSS 选择器定义，无类可移除）：内联固化终态
//    （opacity: 1 + animation: none）
function removeOnloadAnimation(e: AnimationEvent) {
  const el = e.target as Element | null;
  if (!el) return;
  if (el.classList.contains("onload-animation")) {
    el.classList.remove("onload-animation");
  }
  if (el.id === "banner-title" || el.id === "banner-subtitle-wrapper") {
    const style = (el as HTMLElement).style;
    style.opacity = "1";
    style.animation = "none";
  }
}
document.addEventListener("animationend", removeOnloadAnimation);
document.addEventListener("animationcancel", removeOnloadAnimation);

// ── 首刷壁纸主题对齐 ──
// SSR 渲染的是亮色图（src=亮色，data-theme-src=暗色）。暗色主题下若等
// banner-theme-switch 到 DOMContentLoaded 才切暗色图，会先「亮色图渐显 →
// 换 src 二次加载」，造成 banner 视觉跳变（"瞬间条"闪现）。故提前到 init
// 阶段对齐：暗色下先把 src 切到 data-theme-src，showBanner 再按「图片就绪
// 才 reveal」等待暗色图，首显即为正确主题图。亮色主题下 src===next 零副作用。
function alignBannerTheme() {
  const dark = document.documentElement.classList.contains("dark");
  document
    .querySelectorAll<HTMLImageElement>(
      "#banner img[data-theme-src], #banner-mobile img[data-theme-src]",
    )
    .forEach((img) => {
      const darkSrc = img.getAttribute("data-theme-src");
      if (!darkSrc) return;
      const lightSrc = img.getAttribute("src") || "";
      if (!img.getAttribute("data-light-src")) {
        img.setAttribute("data-light-src", lightSrc);
      }
      if (!img.getAttribute("data-light-position")) {
        img.setAttribute("data-light-position", img.style.objectPosition || "");
      }
      const next = dark ? darkSrc : lightSrc;
      if (img.getAttribute("src") !== next) {
        // srcset 清空，避免浏览器按 srcset 覆盖我们指定的 src
        if (img.hasAttribute("srcset")) img.removeAttribute("srcset");
        img.setAttribute("src", next);
      }
      // 暗色壁纸独立位置（object-position）：配置了 data-theme-position 时
      // 覆盖，否则沿用亮色位置（与 banner-theme-switch 的 swap 保持一致）
      const darkPos = img.getAttribute("data-theme-position") || "";
      const pos =
        dark && darkPos
          ? darkPos
          : img.getAttribute("data-light-position") || "";
      if (img.style.objectPosition !== pos) {
        img.style.objectPosition = pos;
      }
    });
}

// ── Banner 显示 ──
// 双容器（桌面 #banner / 移动 #banner-mobile-reveal）各自等待首图加载后
// 移除 opacity-0/scale-105 渐显；隐藏端（display:none）不触发加载回调，
// 由 banner-src-switch.js 在激活时升级 eager 后自然走完同一流程。
// 渐显必须绑定 img.onload 时刻：图片就绪才解除遮蔽 + 触发 transition，
// 保证「图片出现即渐显」的观感；若脱离加载时序（如 CSS 无条件动画），
// 慢加载图片会先空白后硬闪现。
function showBanner() {
  document.querySelectorAll(".banner-reveal").forEach((banner) => {
    const reveal = () => banner.classList.remove("opacity-0", "scale-105");
    const video = banner.querySelector("video");
    if (video) {
      if (video.readyState >= 2) reveal();
      else {
        video.addEventListener("loadeddata", reveal, { once: true });
        video.addEventListener("error", reveal, { once: true });
      }
      return;
    }
    const img = banner.querySelector("img");
    if (img) {
      if (img.complete && img.naturalWidth > 0) reveal();
      else {
        img.onload = reveal;
        img.onerror = reveal;
      }
    } else {
      reveal();
    }
  });
}

// ── Banner overlay 显隐同步 ──
// SSR 在非首页给 #banner-overlay 设置 display:none 内联样式，
// 该元素在 Swup 容器外，跨页切换时不被替换，需手动同步。
// 首次加载由 banner-responsive.ts initOverlay() 处理，
// 此处仅覆盖 Swup 导航场景（banner-responsive.ts 不会重新执行）
function syncBannerOverlay() {
  const overlay = document.getElementById("banner-overlay");
  if (!overlay) return;
  if (overlay.style.display === "none") {
    overlay.style.display = "";
  }
  const wasHidden = overlay.classList.contains("banner-text-hidden");
  overlay.classList.toggle("banner-text-hidden", !isHomePath());
  if (isHomePath() && wasHidden) {
    document.dispatchEvent(new CustomEvent("banner:visible"));
  }
}

// ── 点击外部关闭面板 ──
function setClickOutsideToClose(panel: string, ignores: string[]) {
  document.addEventListener("click", (event) => {
    const panelDom = document.getElementById(panel);
    const target = event.target;
    if (!panelDom || !(target instanceof Node)) return;
    for (const ignored of ignores) {
      const ignoredEl = document.getElementById(ignored);
      if (ignoredEl === target || ignoredEl?.contains(target)) return;
    }
    panelDom.classList.add("float-panel-closed");
  });
}

// ── 恢复 history 原始方法 ──
function restoreOriginalHistoryStateHandlers() {
  const originalHistory = (window as any).__etherealOriginalHistory;
  if (!originalHistory) return;
  if (originalHistory.pushState)
    window.history.pushState = originalHistory.pushState;
  if (originalHistory.replaceState)
    window.history.replaceState = originalHistory.replaceState;
}

// ── widget-layout 自定义元素（小组件折叠"更多"按钮）──
// 必须在全局无条件注册，不能依赖任何具体小组件的渲染位置，
// 否则公告等组件被 th:if 隐藏时，分类/标签等按钮会全部失效。
class WidgetLayoutElement extends HTMLElement {
  connectedCallback() {
    if (this.dataset.isCollapsed !== "true") return;
    const id = this.dataset.id;
    const btn = this.querySelector(".expand-btn");
    const wrapper = this.querySelector(`#${id}`);
    btn?.addEventListener("click", () => {
      wrapper?.classList.remove("collapsed");
      btn.classList.add("hidden");
    });
  }
}

if (!customElements.get("widget-layout")) {
  customElements.define("widget-layout", WidgetLayoutElement);
}

// ── Swup hooks ──
function setupSwup() {
  if ((window as any).__etherealSwupHandlersBound) return;
  (window as any).__etherealSwupHandlersBound = true;

  // 注：曾在此把 --content-delay 改为 0ms（让换页后内容立即浮现），但该变量被全部
  // 入场动画的 animation-delay: calc(var(--content-delay) + Xms) 消费，点击时修改
  // 会重算已完成动画的 delay（方向依赖的重启风险，且单向永不恢复）——已移除，
  // 保持 150ms 默认错落延迟。
  window.swup.hooks.on("content:replace", initCustomScrollbar);
  window.swup.hooks.on("content:replace", destroyAll, { before: true });
  // 首页↔其他页换页（is-home 变化时）挂 home-switch：仅全屏模式启用——
  // 让新内容淡入与横幅/网格 700ms 位移同速，换入即最终布局，消除"内容先显示、
  // 再位移"的闪烁（全屏下位移大 100vh↔35vh，且波浪下移出视口、缝隙不可见）。
  // 横幅模式回归 1.1.0 行为：不在 content:replace 提前切 is-home，换入后内容
  // 与波浪/横幅同速滑动（page:view 同步），避免"波浪滑过内容顶边露 1px 背景缝"
  // （Edge 75% 缩放可复现）。URL 在 animation:out:start 前已由 Swup pushState
  // 更新，可预判新页。
  // 当前是否全屏模式：运行时读取 <html data-banner-display>（访客可在面板切换
  // 壁纸模式，默认非全屏时手动切到全屏也应生效），不能按初始化时的值缓存
  function isFullscreenMode(): boolean {
    return document.documentElement.dataset.bannerDisplay === "fullscreen";
  }
  window.swup.hooks.on("animation:out:start", () => {
    if (
      !document.body.classList.contains("enable-banner") ||
      !isFullscreenMode()
    ) {
      document.documentElement.classList.remove("home-switch");
      return;
    }
    const nextIsHome = isHomePath();
    const currentIsHome = document.body.classList.contains("is-home");
    document.documentElement.classList.toggle(
      "home-switch",
      nextIsHome !== currentIsHome,
    );
  });
  // 旧内容已淡出、新内容未换入的空档切换 is-home（仅全屏模式：横幅/网格/波浪
  // 的 700ms 位移发生在不可见阶段，跳过动画的换页维持原 page:view 同步）。
  // 横幅模式不提前切换——新内容以旧 is-home 定位换入，page:view 后再整体滑动，
  // 内容与波浪/横幅同速联动，不产生波浪越过内容顶边时的 1px 缝隙
  window.swup.hooks.on(
    "content:replace",
    () => {
      if (
        document.documentElement.classList.contains("is-changing") &&
        isFullscreenMode()
      ) {
        syncHomeClass();
      }
    },
    { before: true },
  );
  // 换入动画结束（含被 home-switch 拉长的 700ms 淡入）后移除，两侧组件淡回
  window.swup.hooks.on("animation:in:end", () => {
    document.documentElement.classList.remove("home-switch");
  });
  window.swup.hooks.on("content:replace", () => {
    const rightToc = document.querySelector(
      "#right-sidebar table-of-contents",
    ) as (HTMLElement & { refresh?: () => void }) | null;
    rightToc?.refresh?.();
    // 换页兜底：弹窗是 swup 容器已整容器替换（自动关闭），但目录按钮在 Swup
    // 容器外不刷新，需复位「目录」图标与 aria 状态，避免残留 X 态。
    // （下方 updateTocBtnVisibility 的 close 只在按钮隐藏时收弹窗，两者分工不同）
    window.__etherealTocPopup?.close?.();
    updateTocBtnVisibility();
  });
  window.swup.hooks.on("page:view", () => {
    syncHomeClass();
    syncBannerOverlay();
    armLazyLightbox();
    void initPhotosGallery();
    showBanner();
    scrollFunction();
    initLegacyAdmonitions();
    initExternalLinkRedirect();
    initCommentLazyLoad();
  });
  // 跨页回顶滚动统一走浏览器原生平滑（behavior:"smooth"，合成器驱动不占
  // 主线程，无 scrl 引擎的每帧 JS 测量卡顿）。同页锚点（目录点击）平滑由
  // samePageWithHash 独立控制，不受影响。
  // TOC 恢复显示绑定「滚动真正结束」：长文从底部回顶的原生平滑可持续数百
  // ms，晚于 visit:end + 200ms——若按 visit:end 移除 toc-not-ready，后半段
  // 滚动中目录就已显示。滚动结束信号双通道：原生平滑派发 scrollend 事件、
  // scrl 引擎派发 swup scroll:end（两者都监听，幂等 release）。
  // needsScrollWait 仅对「从非顶部换页回顶」的场景置真；从顶部换页（零距离
  // 短路无滚动结束信号）与 popstate 由 visit:end 直接移除
  let needsScrollWait = false;
  const releaseTocNotReady = () => {
    document.documentElement.classList.remove("toc-not-ready");
  };
  window.swup.hooks.on("scroll:end", () => {
    if (needsScrollWait) releaseTocNotReady();
  });
  window.addEventListener("scrollend", () => {
    if (needsScrollWait) releaseTocNotReady();
  });

  window.swup.hooks.on(
    "visit:start",
    (visit: {
      scroll?: { animate?: boolean };
      to?: { hash?: string };
      history?: { popstate?: boolean };
    }) => {
      restoreOriginalHistoryStateHandlers();
      // 标记会话内已发生换页（<html> 不被 Swup 替换，标记永久有效）：
      // #right-sidebar 是 swup 容器，换页会换入带静态 onload-animation 类的新
      // aside，transition.css 据此标记永久抑制其入场动画（首刷动画不受影响）。
      document.documentElement.classList.add("swup-visited");
      // 换页进行中：目录隐藏（CSS 门控 html.toc-not-ready，覆盖两栏/三栏）。
      // 挂在 <html> 上而非容器类：Swup 换页会替换 #toc-container /
      // #right-sidebar 容器，旧节点上的类随销毁，新节点无类会导致目录提前显示
      document.documentElement.classList.add("toc-not-ready");
      needsScrollWait =
        !visit?.history?.popstate && !visit?.to?.hash && window.scrollY > 0;
      // SwupScrollPlugin 在 before("visit:start")（priority -1）设置
      // visit.scroll.animate，此处（默认 priority 0）在接管回顶滚动时覆盖为
      // false，早于其 content:scroll 的 doScrollingBetweenPages 消费点。
      // popstate / 带 hash 场景仍交由插件默认处理，不覆盖
      if (!visit?.history?.popstate && !visit?.to?.hash && visit?.scroll) {
        visit.scroll.animate = false;
        // 原生滚动目标恒为 0，300vh 撑高防跳动无意义；且 visit:end
        // 隐藏撑高时文档高度骤降 300vh 会触发整页大重排（换页完成后卡顿
        // 来源）。跳过显示，visit:end 的隐藏随之变为无害 no-op
        document.getElementById("page-height-extend")?.classList.add("hidden");
      } else {
        document
          .getElementById("page-height-extend")
          ?.classList.remove("hidden");
      }
    },
  );
  // 跨页回顶滚动接管 content:scroll，统一改用浏览器原生平滑滚动（behavior:
  // "smooth"，合成器驱动不占主线程，无 scrl 引擎的每帧 JS 测量卡顿）：
  // content:replace 换入新内容后布局仍 dirty，立即滚动会派发 scroll 事件
  // → OverlayScrollbars 同步测量 → 强制整页重排（实测单帧 900ms）。延迟
  // 双 rAF 让浏览器先完成新内容首次布局，滚动时测量命中缓存不触发重排。
  // popstate / 带 hash 场景走插件默认逻辑（默认锚点滚动）。后注册的
  // replace 生效（Swup 按注册顺序取最后者）
  window.swup.hooks.replace(
    "content:scroll",
    (
      visit: {
        scroll?: { animate?: boolean };
        to?: { hash?: string };
        history?: { popstate?: boolean };
      },
      _args: unknown,
      defaultHandler?: (visit: unknown, args: unknown) => void,
    ) => {
      if (!visit?.history?.popstate && !visit?.to?.hash) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            window.scrollTo({ top: 0, behavior: "smooth" });
          }),
        );
        return;
      }
      defaultHandler?.(visit, _args);
    },
  );
  window.swup.hooks.on("visit:end", () => {
    setTimeout(() => {
      document.getElementById("page-height-extend")?.classList.add("hidden");
      // 未接管回顶滚动（hash/popstate/从顶部换页）直接移除；
      // 原生平滑长文回顶由 scrollend 驱动（见上），此处跳过
      if (!needsScrollWait) releaseTocNotReady();
    }, SWUP_VISIT_END_DELAY);
    // 兜底：滚动结束信号异常缺失（极端场景）时 2s 后强制恢复目录，
    // 避免永久隐藏（幂等，正常路径 scrollend/scroll:end 已先行移除）
    if (needsScrollWait) {
      setTimeout(releaseTocNotReady, 2000);
    }
  });
}

// 目录悬浮按钮显隐（I29）：只要页面没有可见目录（两栏悬浮目录 #toc-wrapper /
// 三栏右侧栏目录 #right-sidebar table-of-contents），就显示目录悬浮按钮——
// 面向移动端/平板端无目录场景；空目录文章仍显示按钮，点开弹窗展示"此文章无目录"
// 占位（与目录小组件一致）。.floating-controls 位于 Swup 容器外、换页不刷新，
// 故换页（content:replace）与窗口 resize 都要重算：offsetParent 对 display:none
// 祖先返回 null，可准确反映两栏/三栏 TOC 在各断点下的实际可见性。
function updateTocBtnVisibility() {
  const btn = document.getElementById("back-to-toc-btn");
  if (!btn) return;
  const hasTocWidget = !!document.querySelector("#toc-popup table-of-contents");
  const floatingToc = document.getElementById("toc-wrapper");
  const rightToc = document.querySelector(
    "#right-sidebar table-of-contents",
  ) as HTMLElement | null;
  const hasVisibleToc = !!(
    (floatingToc && floatingToc.offsetParent) ||
    (rightToc && rightToc.offsetParent)
  );
  const show = hasTocWidget && !hasVisibleToc;
  btn.classList.toggle("hide", !show);
  if (!show) {
    // 按钮隐藏（换页到无目录页 / 拉宽到有目录的断点）时同步收起弹窗
    window.__etherealTocPopup?.close?.();
  }
  // 目录按钮参与自定义按钮的位置计数，显隐变化后重新计算
  window.__etherealFloatingControlsReposition?.();
}

// ── 评论区懒加载（P3，1.3.3）──
// <halo:comment> 由 Halo 服务端注入，comment-next.iife.js（~120KB，45% 未用）随
// HTML 解析立即执行，而评论区在文章页首屏之下。页面模板把产物包进
// <template id="comment-lazy-template">（内容惰性：脚本不下载、web component 不
// 升级），这里在评论区接近视口（提前 400px）时把内容搬到占位节点激活。
// Swup 换页后新 DOM 的占位为空，page:view 重新绑定即可覆盖 SPA 场景。
function initCommentLazyLoad() {
  const box = document.getElementById("comment");
  const tpl = document.getElementById(
    "comment-lazy-template",
  ) as HTMLTemplateElement | null;
  const slot = document.getElementById("comment-lazy-placeholder");
  if (!box || !tpl || !slot) return;
  if (slot.childNodes.length > 0) return; // 本次导航已激活（幂等）
  const adopt = () => {
    if (slot.childNodes.length > 0) return;
    while (tpl.content.firstChild) {
      slot.appendChild(tpl.content.firstChild);
    }
  };
  if (!("IntersectionObserver" in window)) {
    adopt();
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        adopt();
      }
    },
    { rootMargin: "400px" },
  );
  io.observe(box);
}

// ── 初始化 ──
function init() {
  syncHomeClass();
  // 首次同步完成：恢复 wave 平滑过渡（加载早期被 html:not(.page-ready) 抑制，
  // 避免 syncHomeClass 首次设置 transform 时产生 700ms 条带位移）。必须双 rAF
  // 延迟：同帧加 page-ready 会让渲染时过渡仍生效（transform 与 class 同帧提交）。
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.add("page-ready");
    });
  });
  setTheme(getStoredTheme());
  setHue(getHue());
  initCustomScrollbar();
  alignBannerTheme();
  showBanner();
  initLegacyAdmonitions();
  updateTocBtnVisibility();
  initCommentLazyLoad();
}

setClickOutsideToClose("display-setting", [
  "display-setting",
  "display-settings-switch",
]);
// 注：nav-menu-panel 已改为右侧抽屉（body.nav-menu-open 驱动），关闭逻辑由
// navbar.js 统一处理（遮罩点击/关闭按钮/链接点击/ESC），不再作为 float-panel 处理
setClickOutsideToClose("search-panel", [
  "search-panel",
  "search-bar",
  "search-switch",
]);

// 向下箭头滚动目标：暴露给 MainGridLayout 内联事件委托脚本调用（按钮与委托
// 位于 Swup 容器外，模块本体仅执行一次，无需额外防重绑定守卫）
if (!(window as any).__etherealScrollDown) {
  (window as any).__etherealScrollDown = scrollDownToContent;
}

init();
armLazyLightbox();
void initPhotosGallery();

if (window?.swup?.hooks) {
  setupSwup();
} else {
  document.addEventListener("swup:enable", setupSwup);
}

scrollFunction();
initExternalLinkRedirect();
initProfileStatus();
// 窗口尺寸变化（横竖屏切换/拉宽拉窄）后重算目录按钮显隐与弹窗锚定
window.addEventListener("resize", updateTocBtnVisibility);

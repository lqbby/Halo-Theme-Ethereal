// @ts-nocheck —— legacy 手写脚本迁入源码目录（保持 ES5 原样，不做类型改造）
// 注意：@ts-nocheck 必须在文件最顶端（任何 import 之前）才生效。
import { guardOnce } from "../../utils/once";
import { isHomePath } from "../../utils/banner-sync";
// Banner 叠加层：首页可见 + 空间不足隐藏
// （字号已改为「首帧定档」：模板输出 CSS 变量、components.css 用媒体查询收窄，
//  本脚本不再运行期写字号 —— 旧实现先按桌面字号渲染、defer 脚本执行后才收窄，
//  移动端首屏会「大字号闪变」，故整段移除，勿再写回内联 font-size）
(function () {
  var MIN_BANNER_HEIGHT = 180;
  // 刷新 bug 修（2026-11-17 哥哥定）：浏览器恢复下方滚动位置后，滑回顶部时
  // overlay 整层（卡片 + 全部人物）700ms 淡入、看起来像又刷新一遍。
  // 修法：载入时按实际滚动位置首帧直接定档显隐（不走过渡）；
  // 恢复滚动导致的隐藏，其首次显现也不走 opacity 过渡、直接显示。
  // 只影响载入后的首次显现，之后正常上下滑仍走淡入淡出。
  // flag 放 window 上（ocr 真 bug A7）：scroll 监听只绑一次（guardOnce），
  // Swup 换页后脚本重执行，局部变量每次都是新的——监听调的是第一次执行的
  // updateVisibility，其 flag 早被消耗掉，修法在第一次换页后就失效。
  // 与 __bannerUserInteracted 同口径，跨执行共享。

  function getEl(id) {
    return document.getElementById(id);
  }

  // 不走过渡直接定档显隐：临时关掉 transition、改类、强制重排、恢复。
  function setHiddenInstant(overlay, hidden) {
    overlay.style.transition = "none";
    overlay.classList.toggle("banner-text-hidden", hidden);
    void overlay.offsetWidth;
    overlay.style.transition = "";
  }

  // 用户是否操作过页面（window 级，Swup 重执行脚本时不重置）：
  // 刷新恢复滚动发生在用户操作之前，以此区分“恢复”与“用户下滑”。
  function userHasInteracted() {
    return !!window.__bannerUserInteracted;
  }

  // 首页判定统一走 utils/banner-sync 的 isHomePath（本文件旧实现不剥部署
  // base 路径，带 base 部署时首页会被误判成非首页、横幅标题被误隐藏；
  // isHomePath 是 Layout/app.ts 同源的权威实现，勿再本地复制一份）

  function positionOverlay() {
    var overlay = getEl("banner-overlay");
    var wrapper = getEl("banner-wrapper");
    if (overlay && wrapper) {
      // overlay 本身有 absolute inset-0，覆盖整个 wrapper
      // is-home 生效后 wrapper translate-y 将其带到视口顶部
      // 仅做清理：移除可能由旧逻辑残留的 inline top/bottom
      overlay.style.top = "";
      overlay.style.bottom = "";
    }
  }

  function updateVisibility() {
    var overlay = getEl("banner-overlay");
    if (!overlay) return;
    if (!isHomePath()) {
      // 非首页：淡出
      overlay.classList.add("banner-text-hidden");
      return;
    }

    var wrapper = getEl("banner-wrapper");
    if (!wrapper) {
      overlay.classList.remove("banner-text-hidden");
      return;
    }
    var wasHidden = overlay.classList.contains("banner-text-hidden");
    var rect = wrapper.getBoundingClientRect();
    if (rect.bottom >= MIN_BANNER_HEIGHT) {
      if (window.__bannerSkipRevealTransition) {
        // 刷新后首次滑回顶部：直接显示，不走 opacity 过渡
        window.__bannerSkipRevealTransition = false;
        setHiddenInstant(overlay, false);
      } else {
        overlay.classList.remove("banner-text-hidden");
      }
      // 从隐藏变为可见时，通知打字机/下坠脚本重新初始化
      if (wasHidden) {
        document.dispatchEvent(new CustomEvent("banner:visible"));
      }
    } else {
      if (!userHasInteracted()) {
        // 刷新恢复滚动位置导致的隐藏：直接隐藏（不走淡出），首次显现也不走过渡
        window.__bannerSkipRevealTransition = true;
        setHiddenInstant(overlay, true);
      } else {
        overlay.classList.add("banner-text-hidden");
      }
    }
  }

  function fullUpdate() {
    updateVisibility();
    positionOverlay();
  }

  // 清除 SSR 可能残留的 display:none，统一用 opacity 过渡。
  // 只在首页清（ocr 真 bug B2）：非首页 overlay 只是 display:none/透明度
  // 隐藏，eager/lazy 图只要在视口内照样下载——1481 的 lazy 只挡住了
  // display:none 子树里的图，而这里一清 display:none、overlay 又被渲染出来，
  // 非首页白下头像 + 贴纸 + 两角人物。非首页保持 display:none，零张下载；
  // 首页 SSR 本来就没有 display:none，不受影响；文章页切回首页时
  // isHomePath() 为真，照常清掉、人物正常出来。
  (function initOverlay() {
    var overlay = getEl("banner-overlay");
    if (overlay && overlay.style.display === "none" && isHomePath()) {
      overlay.style.display = "";
      overlay.classList.add("banner-text-hidden");
    }
  })();

  // 首帧定档：载入时已在下方滚动位置，直接隐藏、不走过渡
  (function initVisibility() {
    var overlay = getEl("banner-overlay");
    var wrapper = getEl("banner-wrapper");
    if (!overlay || !wrapper || !isHomePath()) return;
    if (wrapper.getBoundingClientRect().bottom < MIN_BANNER_HEIGHT) {
      window.__bannerSkipRevealTransition = true;
      setHiddenInstant(overlay, true);
    }
  })();

  fullUpdate();

  // window/document 级监听器只绑一次：本脚本会被 SwupScriptsPlugin 在每次换页时
  // 克隆重执行，不守卫则 resize/scroll 处理器逐次叠加（N 次换页 = N 倍回调开销）。
  // 换页后的重排由上方 fullUpdate() 在每次重执行时完成。
  // 原 swup:contentReplaced 监听删除：Swup v3 事件名，v4 分发 swup:{hook}，从未触发。
  if (!guardOnce("banner-responsive")) {
    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fullUpdate, 150);
    });

    var scrollTimer;
    window.addEventListener(
      "scroll",
      function () {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(function () {
          updateVisibility();
        }, 100);
      },
      { passive: true },
    );

    // 标记用户首次操作（刷新恢复滚动先于任何用户操作发生）。
    var markInteracted = function () {
      window.__bannerUserInteracted = true;
    };
    window.addEventListener("pointerdown", markInteracted, {
      once: true,
      passive: true,
    });
    window.addEventListener("wheel", markInteracted, {
      once: true,
      passive: true,
    });
    window.addEventListener("touchstart", markInteracted, {
      once: true,
      passive: true,
    });
    window.addEventListener("keydown", markInteracted, { once: true });
  }
})();

// @ts-nocheck —— legacy 手写经典脚本（ES5 原样，不做类型改造）
// 首页「系列」卡片条的行为（1.5.33）：系列切换 tablist + 横向 scroll-snap 轨道 + ‹ › 步进。
//
// 参考站 daily.yybb.us 只有一条轨道（他只有一个系列），本站多一层「系列切换」：
//   · 切换：点击 tab，或聚焦 tab 后按 ←/→/Home/End（WAI-ARIA tabs 的 roving tabindex 模式）；
//     切换 = 给面板换 `is-hidden` class，不重新取数（全部面板都已在 SSR 渲染好）；
//   · 箭头步进：步长 = 第 1 张与第 2 张卡 offsetLeft 之差（= 卡宽 + gap），比量
//     getBoundingClientRect 更稳（不受 transform / 缩放影响）；
//   · 箭头状态：按**当前面板**的 scrollLeft 边界置 `disabled`（到左头禁 ‹、到右头禁 ›）。
//     ⚠️ 刻意**不用**参考站那种「卡片数 ≤ 可见数就整块 hidden」——LQ 的系列只有 4 篇时
//        按钮会凭空消失，看起来像坏了。置灰比消失更好懂。
//   · prefers-reduced-motion 时 behavior 用 "auto"（别跟用户的减动效偏好对着干）。
//
// ⚠️ 本文件在 #swup-container 内（列在 PostList 里）：Swup 换页会把容器内脚本**克隆重执行**。
//    · 元素级绑定靠 `dataset.seriesBound` 幂等（同一元素只会绑一次）；
//    · 文档级 resize 监听靠 `window.__seriesStripLifecycle` 只挂一次；
//    · 监听器闭包挂在元素自身的 `__seriesSync` 上，resize 时通过它回调（避免重复实现一遍判定）。
// 换页后 DOM 是新的（dataset 干净）⇒ 会重新绑定，这是期望行为。
(function () {
  var SECTION_ID = "series-strip";
  var HIDDEN_CLASS = "is-hidden";
  /** 边界判定容差：sub-pixel 滚动位置（125% 缩放 / 分数宽度）会差零点几像素 */
  var EDGE_EPSILON = 1;

  /** 滚动步长：优先取前两张卡的间距；只有一张卡时退回卡宽 */
  function stepOf(cards) {
    if (cards.length < 2) {
      var only = cards[0];
      return only ? only.getBoundingClientRect().width || 0 : 0;
    }
    return cards[1].offsetLeft - cards[0].offsetLeft;
  }

  function enhance(el) {
    if (!el || el.dataset.seriesBound === "1") return;

    var panels = el.querySelectorAll("[data-series-panel]");
    if (!panels.length) return;

    el.dataset.seriesBound = "1";

    var navs = el.querySelector("[data-series-navs]");
    var prev = el.querySelector(".series-strip__nav--prev");
    var next = el.querySelector(".series-strip__nav--next");
    var tabsBox = el.querySelector("[data-series-tabs]");
    var tabs = tabsBox ? tabsBox.querySelectorAll("[data-series-tab]") : [];
    var active = 0;
    var reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      reduced = false;
    }

    function viewportOf(i) {
      return panels[i]
        ? panels[i].querySelector("[data-series-viewport]")
        : null;
    }

    /** 全量状态复算：面板显隐 + tab 的 aria/tabindex + 箭头可用性 */
    function sync() {
      var i;
      for (i = 0; i < panels.length; i++) {
        if (i === active) panels[i].classList.remove(HIDDEN_CLASS);
        else panels[i].classList.add(HIDDEN_CLASS);
      }
      for (i = 0; i < tabs.length; i++) {
        var on = i === active;
        tabs[i].setAttribute("aria-selected", on ? "true" : "false");
        tabs[i].setAttribute("tabindex", on ? "0" : "-1");
      }
      syncNavs();
    }

    /** 只复算箭头：滚动过程中频繁调用，别顺带重排面板 */
    function syncNavs() {
      var vp = viewportOf(active);
      if (!vp) return;
      var max = vp.scrollWidth - vp.clientWidth;
      var atStart = vp.scrollLeft <= EDGE_EPSILON;
      // 没有溢出时 max <= 0，两个都禁掉
      var atEnd = max <= EDGE_EPSILON || vp.scrollLeft >= max - EDGE_EPSILON;
      if (prev) prev.disabled = atStart;
      if (next) next.disabled = atEnd;
      if (navs) navs.setAttribute("data-series-at-end", atEnd ? "1" : "0");
    }

    /** 切到第 i 个系列；focus=true 时把焦点也移过去（键盘操作路径） */
    function select(i, focus) {
      if (i < 0 || i >= panels.length) return;
      if (i !== active) {
        active = i;
        var vp = viewportOf(active);
        // 换系列就回到该系列的第一张，位置可预期
        if (vp) vp.scrollLeft = 0;
      }
      sync();
      if (focus && tabs[i] && typeof tabs[i].focus === "function") {
        tabs[i].focus();
      }
    }

    function go(dir) {
      var vp = viewportOf(active);
      if (!vp) return;
      var step = stepOf(panels[active].querySelectorAll(".series-strip-card"));
      if (!step) return;
      vp.scrollBy({ left: dir * step, behavior: reduced ? "auto" : "smooth" });
      // scrollBy 是异步的（smooth），边界状态等 scroll 事件回来后由 syncNavs 更新；
      // 但 reduced-motion 下 behavior=auto 时浏览器可能不派发 scroll 事件，这里兜一次。
      if (reduced) syncNavs();
    }

    if (prev) {
      prev.addEventListener("click", function () {
        go(-1);
      });
    }
    if (next) {
      next.addEventListener("click", function () {
        go(1);
      });
    }

    if (tabsBox) {
      tabsBox.addEventListener("click", function (e) {
        var t =
          e.target && e.target.closest
            ? e.target.closest("[data-series-tab]")
            : null;
        if (!t || !tabsBox.contains(t)) return;
        select(parseInt(t.getAttribute("data-series-tab"), 10), false);
      });
      tabsBox.addEventListener("keydown", function (e) {
        var k = e.key;
        if (
          k !== "ArrowRight" &&
          k !== "ArrowLeft" &&
          k !== "Home" &&
          k !== "End"
        )
          return;
        var n = tabs.length;
        if (!n) return;
        var nx = active;
        if (k === "ArrowRight") nx = (active + 1) % n;
        else if (k === "ArrowLeft") nx = (active - 1 + n) % n;
        else if (k === "Home") nx = 0;
        else nx = n - 1;
        e.preventDefault();
        select(nx, true);
      });
    }

    // scroll 不冒泡，但捕获阶段能从后代冒到本节 ⇒ 一个监听覆盖所有面板的轨道
    el.addEventListener(
      "scroll",
      function (e) {
        if (e.target === viewportOf(active)) syncNavs();
      },
      { capture: true, passive: true },
    );

    // 供 resize 复算（见下方文档级监听）
    el.__seriesSync = function () {
      sync();
    };
    sync();
  }

  function init() {
    var all = document.querySelectorAll("#" + SECTION_ID);
    for (var i = 0; i < all.length; i++) enhance(all[i]);
  }

  // 文档级监听只挂一次：本脚本随 Swup 换页重执行，不加 window 级守卫就会叠出 N 份。
  if (!window.__seriesStripLifecycle) {
    window.__seriesStripLifecycle = true;
    window.addEventListener(
      "resize",
      function () {
        var all = document.querySelectorAll("#" + SECTION_ID);
        for (var i = 0; i < all.length; i++) {
          var sync = all[i].__seriesSync;
          if (typeof sync === "function") sync();
        }
      },
      { passive: true },
    );
  }

  init();
})();

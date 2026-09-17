// @ts-nocheck —— legacy 手写经典脚本（ES5 原样，不做类型改造）
// 首页「最新系列」卡片条的行为（1.5.32）：横向 scroll-snap 轨道 + ‹ › 按「一张卡」步进。
//
// 复刻参考站 daily.yybb.us 的 Ap()（featured nav）——逻辑逐条对齐：
//   · 可见数从 CSS 自定义属性 `--series-visible` 读（同一元素上由断点覆盖，JS 不重复写断点）；
//   · 滚动步长 = 第 1 张与第 2 张卡 offsetLeft 之差（= 卡宽 + gap），比量 getBoundingClientRect
//     更稳（不受 transform / 缩放影响）；
//   · 卡片数 ≤ 可见数 时给 `.series-strip__navs` 加 hidden（并回到最左），否则移除；
//   · prefers-reduced-motion 时 behavior 用 "auto"（别跟用户的减动效偏好对着干）。
//
// ⚠️ 本文件在 #swup-container 内（列在 PostList 里）：Swup 换页会把容器内脚本**克隆重执行**。
//    · 元素级绑定靠 `dataset.seriesBound` 幂等（同一元素只会绑一次）；
//    · 文档级 resize 监听靠 `window.__seriesStripLifecycle` 只挂一次；
//    · 监听器闭包挂在元素自身的 `__seriesSync` 上，resize 时通过它回调（避免重复实现一遍判定）。
// 换页后 DOM 是新的（dataset 干净）⇒ 会重新绑定，这是期望行为。
(function () {
  var SECTION_ID = "series-strip";
  var VISIBLE_PROP = "--series-visible";
  var FALLBACK_VISIBLE = 4;

  /** 读一行可见卡片数（CSS 里按断点覆盖 --series-visible，读计算值即可） */
  function visibleCount(el) {
    try {
      var raw = getComputedStyle(el).getPropertyValue(VISIBLE_PROP).trim();
      var n = parseInt(raw, 10);
      return isFinite(n) && n > 0 ? n : FALLBACK_VISIBLE;
    } catch (e) {
      return FALLBACK_VISIBLE;
    }
  }

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

    var viewport = el.querySelector(".series-strip__viewport");
    var track = el.querySelector(".series-strip__track");
    if (!viewport || !track) return;

    var cards = track.querySelectorAll(".series-strip-card");
    if (!cards.length) return;

    el.dataset.seriesBound = "1";

    var navs = el.querySelector(".series-strip__navs");
    var prev = el.querySelector(".series-strip__nav--prev");
    var next = el.querySelector(".series-strip__nav--next");
    var reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      reduced = false;
    }

    // 溢出判定 + 箭头显隐：卡片少到装得下时箭头整块隐藏、轨道回最左
    function sync() {
      var hasOverflow = cards.length > visibleCount(el);
      if (navs) {
        if (hasOverflow) navs.removeAttribute("hidden");
        else navs.setAttribute("hidden", "");
      }
      if (!hasOverflow) viewport.scrollLeft = 0;
    }

    function go(dir) {
      var step = stepOf(cards);
      if (!step) return;
      viewport.scrollBy({
        left: dir * step,
        behavior: reduced ? "auto" : "smooth",
      });
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

    // 供 resize 复算（见下方文档级监听）
    el.__seriesSync = sync;
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

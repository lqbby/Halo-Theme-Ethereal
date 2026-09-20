// @ts-nocheck —— legacy 手写经典脚本（ES5 原样，不做类型改造）
// 首页「系列」卡片条的行为（1.5.33）：系列切换 tablist + 横向 scroll-snap 轨道 + ‹ › 步进。
//
// 参考站 daily.yybb.us 只有一条轨道（他只有一个系列），本站多一层「系列切换」：
//   · 切换：点击 tab，或聚焦 tab 后按 ←/→/Home/End（WAI-ARIA tabs 的 roving tabindex 模式）；
//     切换 = 给面板换 `is-hidden` class，不重新取数（全部面板都已在 SSR 渲染好）；
//   · 「全部」面板（1.5.53 起是第 0 个且默认选中）：SSR 只能按「系列分组」输出 ⇒ 本脚本
//     按每张卡的 `data-publish-time` 把它重排成「发布时间倒序」。排序是幂等的
//     （`dataset.seriesSorted`），且必须在 sync() 之前跑（重排会改 scrollWidth）。
//   · 箭头步进：步长 = 第 1 张与第 2 张卡 offsetLeft 之差（= 卡宽 + gap），比量
//     getBoundingClientRect 更稳（不受 transform / 缩放影响）；
//   · 箭头状态：按**当前面板**的 scrollLeft 边界置 `disabled`（到左头禁 ‹、到右头禁 ›）。
//     ⚠️ 刻意**不用**参考站那种「卡片数 ≤ 可见数就整块 hidden」——LQ 的系列只有 4 篇时
//        按钮会凭空消失，看起来像坏了。置灰比消失更好懂。
//   · prefers-reduced-motion 时 behavior 用 "auto"。
//     🔴 这条**依赖 CSS 里没有 `scroll-behavior`**：`scrollBy({behavior:'auto'})` 的语义是
//        「沿用元素**计算后的** scroll-behavior」，而不是「瞬时」（CSSOM View 规范）。
//        因此 `.series-strip__viewport` 已刻意不声明 `scroll-behavior: smooth`，本文件的
//        behavior 参数是唯一真相源。谁把 smooth 加回 CSS，这条减动效分支就静默失效
//        （2026-09-18 CDP 实测：CSS 带 smooth 时传 'auto' 仍平滑滚动）。
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
      // behavior 是唯一真相源：CSS 里没有 scroll-behavior（见文件头），所以 'auto' 真的是瞬时。
      vp.scrollBy({ left: dir * step, behavior: reduced ? "auto" : "smooth" });
      // smooth 下滚动是异步的，边界状态等 scroll 事件回来由 syncNavs 更新；
      // 瞬时滚动虽然也会派发 scroll 事件，但同步补一次能保证「点一下按钮，置灰状态立刻正确」。
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

    /** 「全部」面板里一张卡的发布时间（毫秒）；拿不到就当 0（排到末尾） */
    function timeOf(card) {
      var v = card.getAttribute && card.getAttribute("data-publish-time");
      if (!v) return 0;
      var t = Date.parse(v);
      return isNaN(t) ? 0 : t;
    }

    /**
     * 「全部」面板：把 SSR 按「系列分组」输出的卡片重排成**按发布时间倒序**（最新在前）。
     * 为什么在这里排：Thymeleaf 的 `#lists` 只有自然序 sort()，没有 sortBy，跨系列合并
     * 成一张扁平列表更是做不到 ⇒ 只能在客户端排。SSR 侧的分组顺序是刻意保留的兜底
     * （脚本没跑时这条轨道照样有内容，只是未按时间排）。
     * ⚠️ `appendChild` 对**已在文档里的节点**是「移动」而非复制 ⇒ 依次 append 即完成重排。
     */
    function sortAllPanel() {
      var box = el.querySelector("[data-series-all]");
      if (!box || box.dataset.seriesSorted === "1") return;
      var track = box.querySelector("[data-series-track]");
      if (!track) return;
      var cards = [];
      for (var i = 0; i < track.children.length; i++)
        cards.push(track.children[i]);
      if (cards.length > 1) {
        cards.sort(function (a, b) {
          return timeOf(b) - timeOf(a);
        });
        for (var k = 0; k < cards.length; k++) track.appendChild(cards[k]);
      }
      box.dataset.seriesSorted = "1";
    }

    // 供 resize 复算（见下方文档级监听）
    el.__seriesSync = function () {
      sync();
    };
    // 先排「全部」面板再算首屏状态：重排会改变 scrollWidth，箭头置灰要按排完的结果算
    sortAllPanel();
    sync();

    // 预热非当前面板的**首张**封面。
    // 根因：非当前面板是 `display: none`，其中的 `<img loading="lazy">` 浏览器根本不会加载
    // （没有布局 ⇒ 永远“不在视口内”）；切到那个系列的瞬间图片才从零开始请求 ⇒ 卡片白闪。
    // 只预热每个面板的第一张（成本 = 系列数，通常 < 5 张），走浏览器缓存、不跟首屏抢带宽。
    function warmup() {
      // 预热纯粹是优化：宿主环境没有 Image 就跳过（回归测试的迷你 DOM 就没有）
      if (typeof Image !== "function") return;
      for (var k = 0; k < panels.length; k++) {
        if (k === active) continue;
        var img = panels[k].querySelector(".series-strip-card__img");
        var src = img && img.getAttribute("src");
        if (src) {
          var pre = new Image();
          pre.src = src;
        }
      }
    }
    // ⚠️ 用**全局** setTimeout 而不是 window.setTimeout：本脚本会被回归测试在迷你 DOM 里 eval，
    //    那个 stub window 只实现了少数 API，`window.setTimeout` 不存在 ⇒ 会直接抛
    //    「window.setTimeout is not a function」把整个 enhance 打断（2026-09-18 实测）。
    //    两个降级都没得用就算了 —— 预热失败不影响任何功能。
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(warmup);
    } else if (typeof setTimeout === "function") {
      setTimeout(warmup, 1200);
    }
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

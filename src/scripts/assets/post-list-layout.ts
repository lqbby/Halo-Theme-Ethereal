// @ts-nocheck —— legacy 手写脚本迁入源码目录（保持 ES5 原样，不做类型改造）
// 注意：@ts-nocheck 必须在文件最顶端（任何 import 之前）才生效。
import { guardOnce } from "../../utils/once";
// 文章卡片瀑布流（Masonry）布局
// 仅在容器为 grid 模式且启用瀑布流（data-masonry="true"）时生效；
// 否则恢复 CSS grid 布局。换页后由 SwupScriptsPlugin 重执行覆盖（同 collapse.js）。
(function () {
  // 封面 load 的 rAF 合并句柄（同一帧内多张封面加载完成只重排一次）
  var masonryFrame = null;

  function getContainer() {
    return document.getElementById("post-list-container");
  }

  // 是否启用瀑布流：grid 模式 + masonry 开关
  function isMasonryEnabled(container) {
    return (
      container.classList.contains("post-grid-mode") &&
      container.getAttribute("data-masonry") === "true"
    );
  }

  // 计算列数：容器宽度 / (最小列宽 + 间距)
  function getColCount(containerWidth, columnWidth, gap) {
    return Math.max(
      1,
      Math.floor((containerWidth + gap) / (columnWidth + gap)),
    );
  }

  function applyMasonry(container) {
    var items = Array.prototype.slice.call(
      container.querySelectorAll(".post-card-item"),
    );
    if (items.length === 0) return;

    var gap = 16; // 与 grid 模式的 gap 保持一致
    var columnWidth = parseInt(
      container.getAttribute("data-column-width") || "320",
      10,
    );
    if (!columnWidth || columnWidth < 1) columnWidth = 320;

    // 容器改为相对定位，卡片绝对定位
    container.classList.add("masonry-active");
    container.style.position = "relative";
    container.style.display = "block";

    var containerWidth = container.offsetWidth;
    var colCount = getColCount(containerWidth, columnWidth, gap);
    var itemWidth = (containerWidth - (colCount - 1) * gap) / colCount;
    var colHeights = new Array(colCount).fill(0);

    // 余数行左对齐：卡片数不被列数整除时（末页尤其常见），把最后
    // (items.length % colCount) 张**强制落在最左边那几列**，让空缺永远出现在
    // 右下角。纯贪心取「第一个最矮列」会把余数行整体推到右侧，
    // 底部左边空一大块 —— 观感是「错位」，而不是「没排满」。
    // 例：5 张 3 列，贪心得 1/2/2（左下角空洞），左对齐得 2/2/1（右下角空缺）。
    var tailCount = items.length % colCount;
    var tailStart = items.length - tailCount;

    // 🔴 三趟走，避免 layout thrashing：原先在 forEach 里「写 style → 读 offsetHeight」
    // 交错，每张卡都触发一次强制同步布局（N 张卡 = N 次 reflow，列表页连续长任务来源）。
    // 第一趟只写（清 transform / height 复位），第二趟只读（一次性拿全部高度），第三趟只写位置。
    // 高度在第二趟量：此时卡片宽度仍是 grid 列宽 = 下面的 itemWidth（同一条公式），
    // 量得的 offsetHeight 与旧实现「设完 absolute+width 再量」等价。
    items.forEach(function (item) {
      // 清掉可能残留的入场 transform，避免影响 offsetHeight
      item.style.transform = "";
      // 高度回归内容自定，覆盖 grid 模式的 height:100%（Firefly 同款处理）
      item.style.setProperty("height", "auto", "important");
    });
    // 第二趟：统一读取（连续读之间浏览器复用同一份布局，不会反复重排）
    var itemHeights = [];
    items.forEach(function (item, idx) {
      itemHeights[idx] = item.offsetHeight;
    });
    // 第三趟：只写位置，用预读高度累加列高
    items.forEach(function (item, idx) {
      var colIndex;
      if (tailCount > 0 && idx >= tailStart) {
        // 余数行：从左到右依次落位
        colIndex = idx - tailStart;
      } else {
        // 其余：放到当前最短列
        colIndex = colHeights.indexOf(Math.min.apply(null, colHeights));
      }
      item.style.position = "absolute";
      item.style.width = itemWidth + "px";
      item.style.top = colHeights[colIndex] + "px";
      item.style.left = colIndex * (itemWidth + gap) + "px";
      // 用预先量好的高度（避免写后读触发强制重排）
      colHeights[colIndex] += itemHeights[idx] + gap;
    });

    // colHeights 每列都多算了一个尾随 gap（含该列最后一张卡），
    // 容器高度取「最高列的真实底边」= max(colHeights) - gap，否则底部恒多 16px 空白。
    var tallest = Math.max.apply(null, colHeights);
    container.style.height = Math.max(0, tallest - gap) + "px";
  }

  function resetLayout(container) {
    container.classList.remove("masonry-active");
    container.style.position = "";
    container.style.display = "";
    container.style.height = "";
    var items = container.querySelectorAll(".post-card-item");
    for (var i = 0; i < items.length; i++) {
      items[i].style.position = "";
      items[i].style.top = "";
      items[i].style.left = "";
      items[i].style.width = "";
      items[i].style.height = "";
      items[i].style.transform = "";
    }
  }

  function init() {
    var container = getContainer();
    if (!container) return;
    if (isMasonryEnabled(container)) {
      applyMasonry(container);
    } else {
      resetLayout(container);
    }
  }

  // 封面图加载完成后可能改变卡片高度，重排一次
  function bindImageLoad() {
    var container = getContainer();
    if (!container || !isMasonryEnabled(container)) return;
    var imgs = container.querySelectorAll(".post-card-cover img");
    for (var i = 0; i < imgs.length; i++) {
      (function (img) {
        if (img.complete) return;
        // 🔴 rAF 合并：原先每张封面 load 都直接跑一次 applyMasonry（N 张图 = N 次全量
        // 重排）。同帧内多张图 load 只重排一次。
        img.addEventListener("load", function () {
          if (masonryFrame) return;
          masonryFrame = requestAnimationFrame(function () {
            masonryFrame = null;
            var c = getContainer();
            if (c && isMasonryEnabled(c)) applyMasonry(c);
          });
        });
      })(imgs[i]);
    }
  }

  // 初始化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      init();
      bindImageLoad();
    });
  } else {
    init();
    bindImageLoad();
  }

  // 暴露重排入口：访客切换文章布局（visitor-post-layout.js / 显示设置面板）
  // 换类后调用，按当前容器类决定应用瀑布流或恢复 CSS grid。
  // 幂等覆盖赋值，Swup 换页重执行本脚本时不会产生重复绑定。
  window.__postListRelayout = init;

  // 窗口尺寸变化时重排（防抖），只绑定一次避免 Swup 换页后重复监听
  if (!guardOnce("post-list-layout")) {
    var resizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var container = getContainer();
        if (!container || !isMasonryEnabled(container)) return;
        applyMasonry(container);
      }, 200);
    });

    // 页面从后台切回时重排（图片可能刚完成懒加载，Firefly 同款处理）
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        var container = getContainer();
        if (!container || !isMasonryEnabled(container)) return;
        applyMasonry(container);
      }
    });
  }
})();

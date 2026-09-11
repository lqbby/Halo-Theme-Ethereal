// @ts-nocheck —— legacy 手写经典脚本（ES5 风格；带参辅助函数在未标注时会触发
// astro check 的 ts(7006) 隐式 any，导致 CI Type check 失败）。必须位于第 1 行、任何 import 之前。
// 构建产物：public/assets/footer-friend-links.js（源码在 src/scripts/assets/，esbuild 编译，勿手改产物）
//
// 页脚随机友链：从每个 .footer-friend-links 内的 <template class="footer-friend-pool">
// 读取「乱序友链池」（服务端由 Links 插件 linkFinder.random(100) 一次性灌进来），
// 向 .footer-friend-list 渲染 N 条胶囊，点「换一批」在本地重抽 —— 零网络请求。
//
// 幂等策略：逐实例，用容器上的 data-ffl-ready 标记。
//   · MainGridLayout 里页脚渲染两份：桌面版在 #swup-container 内（换页被替换）、
//     移动版在 #swup-container 外的持久区（换页存活）。
//   · 因此不能用 guardOnce（全局一次性，会让换页后新建的桌面那份永远不初始化）。
//   · 换页后新节点无标记 → 自动重新初始化；移动那份标记在 → 跳过；旧按钮随旧节点回收。
//
// 初始化时机：脚本执行时立即跑一次 + Swup page:view 再跑一次。
//   脚本标签随页脚渲染（桌面/移动各一份），SwupScriptsPlugin 是否重执行本文件
//   取决于标签在内/外，两种情形都由 onPageView 兜住。
import { onPageView } from "../../utils/once";

(function () {
  "use strict";

  /** 容器就绪标记属性（值为 "1" 时跳过重复初始化） */
  var READY_ATTR = "data-ffl-ready";
  /**
   * 窄屏（<640px）保留的条数 = 2 列 × 2 行 = 4。
   * 与 CSS `.footer-friend-list` 的 grid-template-columns 断点、以及
   * `.footer-friend-chip--extra` 的 max-width:639px 媒体查询三者必须一致。
   */
  var MOBILE_MAX = 4;
  /** 友链池上限（与模板侧 linkFinder.random(100) 对齐） */
  var POOL_MAX = 100;

  /** 从 <template> 里读友链池；只收 http/https/协议相对/站内绝对路径，挡掉 javascript: 等 */
  function readPool(root) {
    var tpl = root.querySelector("template.footer-friend-pool");
    if (!tpl) return [];
    var host = tpl.content || tpl;
    var nodes = host.querySelectorAll("a.footer-friend-source");
    var pool = [];
    for (var i = 0; i < nodes.length && pool.length < POOL_MAX; i++) {
      var a = nodes[i];
      var url = a.getAttribute("href") || "";
      var name = a.getAttribute("data-friend-name") || "";
      if (!name) continue;
      if (!/^(https?:)?\/\//i.test(url) && url.charAt(0) !== "/") continue;
      if (url.charAt(0) === "/" && url.charAt(1) === "/") {
        // 协议相对，等价 http(s)，放行
      }
      if (/^\s*javascript:/i.test(url)) continue;
      pool.push({
        url: url,
        name: name,
        logo: a.getAttribute("data-friend-logo") || "",
      });
    }
    return pool;
  }

  /** Fisher–Yates 原地洗牌（传入前先 slice，别污染原池） */
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function makeChip(item, index, mobileMax) {
    var a = document.createElement("a");
    a.className =
      "footer-friend-chip" +
      (index >= mobileMax ? " footer-friend-chip--extra" : "");
    a.setAttribute("href", item.url);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    a.setAttribute("title", item.name);

    if (item.logo) {
      var img = document.createElement("img");
      img.className = "footer-friend-chip-logo";
      img.setAttribute("src", item.logo);
      img.setAttribute("alt", "");
      img.setAttribute("loading", "lazy");
      img.setAttribute("decoding", "async");
      img.setAttribute("referrerpolicy", "no-referrer");
      // 图标挂了就退回纯文字胶囊，别留破图
      img.addEventListener("error", function () {
        if (img.parentNode) img.parentNode.removeChild(img);
      });
      a.appendChild(img);
    }

    var span = document.createElement("span");
    span.className = "footer-friend-chip-name";
    span.textContent = item.name;
    a.appendChild(span);
    return a;
  }

  /** 重抽并重绘；返回是否渲染成功 */
  function paint(root, pool) {
    var list = root.querySelector(".footer-friend-list");
    if (!list) return false;

    var count = parseInt(root.getAttribute("data-friend-count") || "", 10);
    if (!isFinite(count) || count < 1) count = 8;
    var n = Math.min(count, pool.length);
    if (n < 1) return false;

    var mobileMax = Math.min(n, MOBILE_MAX);
    var picked = shuffle(pool.slice()).slice(0, n);

    var frag = document.createDocumentFragment();
    for (var i = 0; i < picked.length; i++) {
      frag.appendChild(makeChip(picked[i], i, mobileMax));
    }
    // replaceChildren 在 ES2015 目标下可能缺失（老 Safari），做降级
    if (typeof list.replaceChildren === "function") {
      list.replaceChildren(frag);
    } else {
      while (list.firstChild) list.removeChild(list.firstChild);
      list.appendChild(frag);
    }
    return true;
  }

  function init() {
    var roots = document.querySelectorAll(".footer-friend-links");
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      if (root.getAttribute(READY_ATTR) === "1") continue;

      var bar = root.querySelector(".footer-friend-bar");
      if (!bar) continue;

      var pool = readPool(root);
      if (pool.length < 1) continue; // 没友链就整块保持隐藏

      if (!paint(root, pool)) continue;

      var btn = root.querySelector(".footer-friend-shuffle");
      if (btn) {
        // 逐实例绑定：按钮随页脚 DOM 一起被替换/回收，无需清理旧监听
        (function (r, p, b) {
          b.addEventListener("click", function () {
            b.classList.remove("is-spinning");
            // 强制重排，让一次性旋转动画可重复触发
            void b.offsetWidth;
            b.classList.add("is-spinning");
            window.setTimeout(function () {
              paint(r, p);
            }, 160);
          });
        })(root, pool, btn);
      }

      bar.removeAttribute("hidden");
      root.setAttribute(READY_ATTR, "1");
    }
  }

  init();
  onPageView("footer-friend-links", init);
})();

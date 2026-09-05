// @ts-nocheck —— legacy 手写脚本迁入源码目录（保持 ES5 原样，不做类型改造）
// 评论区锚点落位高亮（配合 src/styles/components.css 的 #comment.comment-locate-flash）
// 触发场景：
//  - 从通知/邮件链接带 #comment（或 #comment-xxx）进入文章页；
//  - 侧栏「最近评论」点击跳转到 文章页#comment（RecentComments.astro 的跳转链接即
//    permalink + "#comment"，其注释明确期望「文章页有 #comment hash 处理脚本」）。
// 行为：滚动到评论区（#comment 的 scroll-margin-top 已处理 navbar 偏移）并脉冲高亮，
// 明确标示落点。2.5 曾删除原触发脚本导致该高亮失效，本文件恢复之。
import { onPageView } from "../../utils/once";
(function () {
  // 等评论区内容就绪的兜底时长。评论区由 app.ts 懒加载（1.3.3 起），从 adopt()
  // 到评论列表渲染要下载 comment-next（~120KB）再拉评论接口；锚点进入时虽然已
  // 跳过 IO 立即激活，仍可能要 1-2s。超时后照常落位，避免高亮永远不播。
  var READY_TIMEOUT = 3500;
  // 查找单条评论的轮询间隔
  var POLL_INTERVAL = 120;

  // comment-next 1.0.6+ 的单条锚点：元素 id 为
  //   comment-next-comment-<name>（顶层评论）/ comment-next-reply-<name>（回复）
  // 插件自带 scrollIntoView + scroll-margin-top，但**不做高亮**——本脚本补上。
  // 匹配后两种前缀都试：侧栏数据不区分顶层/回复，容错成本极低。
  var ANCHOR_RE = /^comment-next-(comment|reply)-(.+)$/;

  function findTarget(m) {
    var ids = ["comment-next-comment-" + m[2], "comment-next-reply-" + m[2]];
    // 先搜 light DOM（旧版插件/兼容），再穿透 <comment-widget> 的 shadow root。
    // ⭐ comment-next 1.0.13 把评论渲染在 Svelte web component 的 Shadow DOM 里，
    //   document.getElementById 搜不到——必须用 widget.shadowRoot.getElementById。
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) return el;
    }
    var widgets = document.querySelectorAll("comment-widget");
    for (var w = 0; w < widgets.length; w++) {
      var sr = widgets[w].shadowRoot;
      if (!sr) continue;
      for (var i = 0; i < ids.length; i++) {
        var el2 = sr.getElementById(ids[i]);
        if (el2) return el2;
      }
    }
    return null;
  }

  // 单条评论由 comment-next 异步渲染，出现时间不确定，轮询等它进 DOM
  function waitForTarget(m, cb) {
    var t0 = Date.now();
    (function poll() {
      var el = findTarget(m);
      if (el) return cb(el);
      if (Date.now() - t0 >= READY_TIMEOUT) return cb(null);
      setTimeout(poll, POLL_INTERVAL);
    })();
  }

  // 往 shadow root 注入一份与 light DOM .comment-locate-flash 等价的样式。
  // ⭐ light DOM 的 CSS 规则穿透不进 Shadow DOM（样式封装）；但 CSS 自定义属性
  //   （--primary）会从 host 沿树继承穿透进来，所以 shadow 内直接写 var(--primary) 即可。
  function ensureFlashStyle(root) {
    if (root.__etherealFlashStyle) return;
    var st = document.createElement("style");
    st.textContent =
      ".comment-locate-flash{outline-offset:2px;border-radius:0.5rem;animation:comment-locate-flash 1.6s ease-out}" +
      "@keyframes comment-locate-flash{" +
      "0%{outline:0 solid transparent;background-color:transparent}" +
      "12%{outline:3px solid color-mix(in oklab,var(--primary) 60%,transparent);background-color:color-mix(in oklab,var(--primary) 18%,transparent)}" +
      "70%{outline:3px solid color-mix(in oklab,var(--primary) 60%,transparent);background-color:color-mix(in oklab,var(--primary) 18%,transparent)}" +
      "100%{outline:0 solid transparent;background-color:transparent}}";
    root.appendChild(st);
    root.__etherealFlashStyle = true;
  }

  function flash(el) {
    // 目标在 shadow root 内时，light DOM 样式不生效，先注入等价样式。
    var root = el.getRootNode && el.getRootNode();
    if (root && root.nodeType === 11) ensureFlashStyle(root);
    // 先移除再强制 reflow，确保重复进入（SPA 换页/再次点击）可重新触发动画
    el.classList.remove("comment-locate-flash");
    void el.offsetWidth;
    el.classList.add("comment-locate-flash");
    var done = function () {
      el.classList.remove("comment-locate-flash");
      el.removeEventListener("animationend", done);
    };
    el.addEventListener("animationend", done);
    // 兜底：动画被中断（元素重渲染 / display 切换）时 animationend 可能不触发，
    // 用一个略长于动画时长的定时器强制清理 class，避免残留。
    setTimeout(done, 1800);
  }

  // ⭐ 等目标真正进入视口且滚动停稳后再闪高亮。长文平滑滚动可能持续 1s+，若在
  //   滚动进行中就把高亮播完，用户滚到位时早就看不见——这是「长文章高亮看不见」
  //   的根因（此前 findTarget 一命中就立即 flash，滚动才刚开始）。
  //   双信号：scrollend（现代浏览器，滚动结束的权威信号）+ scroll 空闲 debounce
  //   （旧浏览器 / 无滚动场景兜底）。加视口判据：目标还没滚进视口时绝不闪。
  function flashWhenSettled(el) {
    var t0 = Date.now();
    var IDLE = 160; // scroll 停止这么久视为停稳
    var MAX_WAIT = 4000; // 绝对兜底，避免任何异常下永不闪
    var settled = false;
    var idleTimer = null;

    function finish() {
      if (settled) return;
      settled = true;
      cleanup();
      flash(el);
    }
    function cleanup() {
      if (idleTimer) clearTimeout(idleTimer);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("scroll", onScroll);
      window.removeEventListener("scrollend", onScrollEnd);
      document.removeEventListener("scrollend", onScrollEnd);
    }
    function inView() {
      var r = el.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      return r.top < vh && r.bottom > 0;
    }
    function onScrollEnd() {
      finish();
    }
    function onScroll() {
      if (Date.now() - t0 > MAX_WAIT) return finish();
      if (idleTimer) clearTimeout(idleTimer);
      if (inView()) idleTimer = setTimeout(finish, IDLE);
    }
    window.addEventListener("scrollend", onScrollEnd, { passive: true });
    document.addEventListener("scrollend", onScrollEnd, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("scroll", onScroll, { passive: true });
    // 目标本就在视口（无需滚动）或滚动早已结束：短暂延迟后立即闪；
    // 否则（滚动尚未开始/目标还在下方）等 scroll 事件带它进视口再闪。
    if (inView()) idleTimer = setTimeout(finish, IDLE);
    else idleTimer = setTimeout(finish, MAX_WAIT);
  }

  function locateComment() {
    var hash = location.hash || "";
    if (hash.indexOf("#comment") !== 0) return;
    var box = document.getElementById("comment");
    if (!box) return;

    var reduce =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // 先解析 hash：区分「精准单条评论」与「普通评论区」。
    var raw;
    try {
      raw = decodeURIComponent(hash.slice(1));
    } catch (e) {
      raw = hash.slice(1);
    }
    var m = ANCHOR_RE.exec(raw);

    // ⭐ 精准模式（#comment-next-comment-<name>）：不先滚 #comment 顶——插件挂载后会
    //   自己精确 scrollIntoView 到那条评论，我们先滚会与它竞争（两个 smooth 滚动打架，
    //   即用户看到的「有冲突」）。这里只等目标进入 DOM（穿透 shadow root）后高亮它
    //   本身；找不到时退回高亮整个评论区，不至于毫无反馈。
    if (m) {
      box.classList.add("comment-locating");
      waitForTarget(m, function (el) {
        box.classList.remove("comment-locating");
        // ⭐ 滚动完全交给插件：comment-next 挂载时读 location.hash 自己 scrollIntoView
        //   （已实测精确落位，target 顶部落到视口顶部）。主题这里只补高亮——若再滚一次
        //   会与插件竞争（两个 smooth scroll 几乎同时启动、互相取消），产生「上下拉扯」。
        //   findTarget 命中时插件的平滑滚动通常才刚开始（长文要 1s+），立即 flash 会在
        //   滚动途中就播完；改等滚动停稳 + 目标进视口后再闪（flashWhenSettled）。
        flashWhenSettled(el || box);
      });
      return;
    }

    // 普通 #comment：滚动立即执行，不等评论区渲染。#comment 的顶边位置由上方正文
    // 决定，评论区内容撑开只增加自身高度、不改变顶边，所以此刻滚动的落点本来就
    // 准确，延后只会让用户多等 1-2s 且没有任何即时反馈。
    box.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });

    // 高亮延后到内容就绪再播：0.9s 脉冲在空壳上播完等于白播——用户看不到任何
    // 落点提示。等评论真正渲染出来再闪，指示才有意义。且等滚动停稳 + 目标进视口
    // 再闪（长文滚动途中闪完就看不见）。
    if (box.dataset.commentReady) {
      flashWhenSettled(box);
      return;
    }
    // 等待期间显示加载提示（components.css 的 .comment-locating）
    box.classList.add("comment-locating");
    var settled = false;
    var timer = setTimeout(finish, READY_TIMEOUT);
    function onReady() {
      finish();
    }
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      document.removeEventListener("comment:ready", onReady);
      box.classList.remove("comment-locating");
      requestAnimationFrame(function () {
        flashWhenSettled(box);
      });
    }
    document.addEventListener("comment:ready", onReady);
  }

  function bind() {
    locateComment();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  // Swup v4 钩子（navbar.ts 同范式）：SPA 换页后重新判定 hash。
  // 用共享 once() 去重注册：SwupScriptsPlugin 换页重执行脚本，不加守卫会重复注册
  // page:view 监听（每次导航多挂一个 bind → handler 泄漏，原 __commentLocateBound 守卫）。
  onPageView("comment-locate", bind);
})();

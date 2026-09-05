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
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) return el;
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

  function flash(box) {
    // 先移除再强制 reflow，确保重复进入（SPA 换页/再次点击）可重新触发动画
    box.classList.remove("comment-locate-flash");
    void box.offsetWidth;
    box.classList.add("comment-locate-flash");
    var done = function () {
      box.classList.remove("comment-locate-flash");
      box.removeEventListener("animationend", done);
    };
    box.addEventListener("animationend", done);
  }

  function locateComment() {
    var hash = location.hash || "";
    if (hash.indexOf("#comment") !== 0) return;
    var box = document.getElementById("comment");
    if (!box) return;

    // 滚动立即执行，不等评论区渲染：#comment 的顶边位置由上方正文决定，评论区
    // 内容撑开只增加自身高度、不改变顶边，所以此刻滚动的落点本来就是准确的，
    // 延后只会让用户多等 1-2s 且没有任何即时反馈。
    var reduce =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });

    // 精准模式：#comment-next-comment-<name> —— 等那条评论进入 DOM 后高亮它本身
    // （滚动由插件自己做）。找不到时退回高亮整个评论区，不至于毫无反馈。
    var raw;
    try {
      raw = decodeURIComponent(hash.slice(1));
    } catch (e) {
      raw = hash.slice(1);
    }
    var m = ANCHOR_RE.exec(raw);
    if (m) {
      box.classList.add("comment-locating");
      waitForTarget(m, function (el) {
        box.classList.remove("comment-locating");
        if (el) {
          // 插件在组件初始化时会自己滚一次，但评论区若已激活过（本次导航内
          // initCommentLazyLoad 因幂等直接 return），它不会重跑 —— 这里兜底
          // 再滚一次。元素上已有插件设的 scroll-margin-top，偏移是自适应的。
          el.scrollIntoView({
            behavior: reduce ? "auto" : "smooth",
            block: "start",
          });
        }
        flash(el || box);
      });
      return;
    }

    // 高亮延后到内容就绪再播：0.9s 脉冲在空壳上播完等于白播——用户看不到任何
    // 落点提示。等评论真正渲染出来再闪，指示才有意义。
    if (box.dataset.commentReady) {
      flash(box);
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
        flash(box);
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

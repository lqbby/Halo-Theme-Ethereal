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

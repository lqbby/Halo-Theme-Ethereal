// @ts-nocheck —— legacy 手写脚本迁入源码目录（保持 ES5 原样，不做类型改造）
// 评论区锚点落位高亮（配合 src/styles/components.css 的 #comment.comment-locate-flash）
// 触发场景：
//  - 从通知/邮件链接带 #comment（或 #comment-xxx）进入文章页；
//  - 侧栏「最近评论」点击跳转到 文章页#comment（RecentComments.astro 的跳转链接即
//    permalink + "#comment"，其注释明确期望「文章页有 #comment hash 处理脚本」）。
// 行为：滚动到评论区（#comment 的 scroll-margin-top 已处理 navbar 偏移）并脉冲高亮，
// 明确标示落点。2.5 曾删除原触发脚本导致该高亮失效，本文件恢复之。
(function () {
  function locateComment() {
    var hash = location.hash || "";
    if (hash.indexOf("#comment") !== 0) return;
    var box = document.getElementById("comment");
    if (!box) return;
    // 先移除再强制 reflow，确保重复进入（SPA 换页/再次点击）可重新触发动画
    box.classList.remove("comment-locate-flash");
    void box.offsetWidth;
    box.classList.add("comment-locate-flash");
    var done = function () {
      box.classList.remove("comment-locate-flash");
      box.removeEventListener("animationend", done);
    };
    box.addEventListener("animationend", done);
    box.scrollIntoView({ behavior: "smooth", block: "start" });
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
  // 守卫：SwupScriptsPlugin 换页重执行脚本，不加守卫会重复注册 page:view 监听
  //（每次导航多挂一个 bind，locateComment 被幂等调用 N 次 → handler 泄漏）。
  if (!window.__commentLocateBound) {
    window.__commentLocateBound = true;
    if (window.swup && window.swup.hooks) {
      window.swup.hooks.on("page:view", bind);
    } else {
      document.addEventListener("swup:enable", function () {
        if (window.swup && window.swup.hooks)
          window.swup.hooks.on("page:view", bind);
      });
    }
  }
})();

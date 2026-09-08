// @ts-nocheck —— legacy 手写经典脚本（ES5 原样，storageGet/Set 参数隐式 any 不参与类型检查，对齐 upvote.ts）
// 构建产物：public/assets/post-card-like.js（源码在 src/scripts/assets/，esbuild 编译，勿手改产物）
// 文章卡片点赞（列表/网格/瀑布流卡片底部点赞胶囊，调 Halo upvote API 真实点赞）
// 与 post-like.ts（详情页）共用 localStorage key，卡片/详情页点赞状态互通。
(function () {
  // localStorage 安全访问：隐私模式/禁存储下 getItem/setItem/removeItem 会抛
  // SecurityError（如 Safari 无痕），统一 try/catch，读取失败按「未点赞」处理。
  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function storageSet(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch (e) {}
  }
  function storageRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  }

  function init() {
    document.querySelectorAll(".post-card-stat-like").forEach(function (btn) {
      if (btn.dataset.cardLikeBound) return;
      btn.dataset.cardLikeBound = "true";

      var name = btn.getAttribute("data-post");
      var svCount = parseInt(btn.getAttribute("data-count") || "0", 10);
      // 与详情页 post-like.js 共用 key，状态互通（点卡片详情页红心、点详情页卡片红心）
      var key = "ethereal-like-" + name;
      var countEl = btn.querySelector(".post-card-like-count");
      var liked = storageGet(key) === "1";
      var count = Math.max(
        svCount,
        parseInt(storageGet(key + "-count") || "0", 10) || 0,
      );

      if (liked) btn.classList.add("liked");
      if (countEl) countEl.textContent = count > 0 ? String(count) : "0";

      // 点赞成功冷却 5s（失败可立即重试）：防脚本循环点击刷请求
      var cooldownUntil = 0;

      btn.addEventListener("click", function () {
        if (btn.classList.contains("liked")) return;
        if (Date.now() < cooldownUntil) return;
        // 乐观更新：先本地标记已赞、计数 +1（失败时回滚，与 post-like.js 行为对齐）
        btn.classList.add("liked");
        storageSet(key, "1");
        count++;
        storageSet(key + "-count", String(count));
        if (countEl) countEl.textContent = String(count);

        fetch("/apis/api.halo.run/v1alpha1/trackers/upvote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            group: "content.halo.run",
            plural: "posts",
            name: name,
          }),
        })
          .then(function (res) {
            // fetch 只在网络层失败时 reject，非 2xx 需显式检查（否则会静默失败）
            if (!res.ok) throw new Error("HTTP " + res.status);
            cooldownUntil = Date.now() + 5000;
          })
          .catch(function (e) {
            // 点赞失败：回滚乐观更新（计数 -1、撤销实心、清除本地标记、抖动提示）
            console.warn("[CardLike] 点赞失败", e && e.message);
            storageRemove(key);
            storageRemove(key + "-count");
            btn.classList.remove("liked");
            count = Math.max(svCount, count - 1);
            if (countEl) countEl.textContent = count > 0 ? String(count) : "0";
            btn.classList.add("upvote-failed");
            setTimeout(function () {
              btn.classList.remove("upvote-failed");
            }, 1200);
          });
      });
    });
  }

  init();

  // Swup 页面切换后重新初始化：由 SwupScriptsPlugin 按序重执行 defer 脚本覆盖，
  // 此处无需额外监听；dataset 守卫保证重执行幂等。
})();

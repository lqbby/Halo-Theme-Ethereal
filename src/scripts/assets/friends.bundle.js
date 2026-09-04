// 朋友圈脚本合并（构建产物：public/assets/friends.bundle.js，源码在 src/scripts/assets/，esbuild 编译，勿手改产物）
// 由 friend-authors / friends-blacklist / friends-group / friends-load-more 合并，
// 各 IIFE 守卫独立保留；空列表页由 friends.astro th:if 整体不加载

// 朋友圈：从文章链接提取博客主页
(function () {
  function init() {
    document.querySelectorAll(".friend-author").forEach(function (a) {
      if (a.dataset.friendBound) return;
      a.dataset.friendBound = "true";
      var postLink = a.getAttribute("data-site");
      if (!postLink) return;
      try {
        var u = new URL(postLink);
        a.href = u.origin + "/";
      } catch (e) {
        // URL 不合法，不设置 href（防止 javascript: 等危险协议）
      }
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    });
  }

  // 初始化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Swup 页面切换后重新初始化
  // 换页后重新初始化：每次进入朋友圈页面时 SwupScriptsPlugin 重执行覆盖；
  // 原 swup:contentReplaced 监听删除（v3 事件名从未触发）。
})();

// 朋友圈 - 黑名单过滤
(function () {
  function init() {
    try {
      var timeline = document.getElementById("friends-timeline");
      if (!timeline) return;

      var raw = timeline.getAttribute("data-blacklist") || "";
      if (!raw.trim()) return;

      var patterns = raw
        .split("\n")
        .map(function (s) {
          return s.trim().toLowerCase();
        })
        .filter(function (s) {
          return s.length > 0;
        });

      if (patterns.length === 0) return;

      var rows = Array.from(timeline.querySelectorAll(".friends-timeline-row"));

      rows.forEach(function (row) {
        var author = (
          row.getAttribute("data-group-author") || ""
        ).toLowerCase();
        var matched = patterns.some(function (p) {
          return author.indexOf(p) >= 0;
        });
        if (matched) {
          // 移除整组（含日期头），避免日期孤儿；1.3.24+ 引入 .friends-timeline-group 包裹
          var group = row.closest(".friends-timeline-group");
          if (group && group.parentNode) {
            group.parentNode.removeChild(group);
          } else {
            row.remove();
          }
        }
      });
    } catch (e) {
      // 静默失败，不阻断页面渲染
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // 换页后重新初始化由 SwupScriptsPlugin 重执行覆盖；
  // 原 swup:contentReplaced 监听删除（v3 事件名从未触发）。
})();

// 朋友圈
(function () {
  function init() {
    try {
      var timeline = document.getElementById("friends-timeline");
      if (!timeline) return;

      var rows = Array.from(timeline.querySelectorAll(".friends-timeline-row"));
      if (rows.length <= 1) return;

      // 按 日期|作者 分组
      var groups = new Map();
      rows.forEach(function (row) {
        var author = row.getAttribute("data-group-author") || "";
        var date = row.getAttribute("data-group-date") || "";
        var key = date + "|" + author;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      });

      groups.forEach(function (groupRows) {
        if (groupRows.length <= 1) return;

        var firstRow = groupRows[0];
        var firstContent = firstRow.querySelector(".friends-card .min-w-0");
        if (!firstContent) return;

        var firstCard = firstRow.querySelector(".friends-card");
        if (firstCard) firstCard.classList.add("friends-card-grouped");

        for (var i = 1; i < groupRows.length; i++) {
          var row = groupRows[i];
          var content = row.querySelector(".friends-card .min-w-0");
          if (!content) continue;

          // 从作者行中提取时间
          var authorLine = content.querySelector(".friends-item-header");
          var timeEl = authorLine ? authorLine.querySelector("time") : null;

          // 分隔线
          var sep = document.createElement("div");
          sep.className = "friends-article-separator";

          // 文章容器
          var article = document.createElement("div");
          article.className = "friends-article-item";

          // 时间
          if (timeEl) {
            var timeDiv = document.createElement("div");
            timeDiv.className = "friends-article-time";
            timeDiv.appendChild(timeEl.cloneNode(true));
            article.appendChild(timeDiv);
          }

          // 标题
          var titleEl = content.querySelector(".friends-item-title");
          if (titleEl) article.appendChild(titleEl.cloneNode(true));

          // 摘要
          var summaryEl = content.querySelector(".friends-item-summary");
          if (summaryEl) article.appendChild(summaryEl.cloneNode(true));

          // 来源链接
          var sourceEl = content.querySelector(".friends-source-link");
          if (sourceEl) article.appendChild(sourceEl.cloneNode(true));

          firstContent.appendChild(sep);
          firstContent.appendChild(article);

          // 1.3.24+ 引入 .friends-timeline-group 包裹 (date + row)：
          // row 被合并到 firstRow 后，其所在 group 变空（无 row、无 date），
          // 移除以免在 masonry 里留下空白占位。
          var srcGroup = row.parentElement;
          row.remove();
          if (
            srcGroup &&
            srcGroup.classList &&
            srcGroup.classList.contains("friends-timeline-group") &&
            !srcGroup.querySelector(".friends-timeline-row")
          ) {
            srcGroup.remove();
          }
        }
      });
    } catch (e) {
      // 静默失败，不阻断页面渲染
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // 换页后重新初始化由 SwupScriptsPlugin 重执行覆盖；
  // 原 swup:contentReplaced 监听删除（v3 事件名从未触发）。
})();

// 朋友圈 - 分批加载（"加载更多"按钮）+ JS 双栏 masonry 分配
// ⚠️ 布局不用 CSS columns 的 balance：它按 DOM 顺序「连续分段」，加载更多时
// 新增内容（DOM 顺序靠后）会全部堆到右列、左列不动（用户反馈「只加载右边的」）。
// 改为 flex 两列 + JS 按原始索引奇偶交替分配：新内容自然分散两列。
(function () {
  // 取「含 row 的 group」（与分组脚本后的可见卡片一一对应），保持原始 DOM 顺序
  function getGroups(timeline) {
    return Array.from(
      timeline.querySelectorAll(".friends-timeline-group"),
    ).filter(function (g) {
      return !!g.querySelector(".friends-timeline-row");
    });
  }

  // 按原始顺序重建布局：<768px 单列铺平；否则可见 group 奇偶交替进左右列。
  // groups 是 init 时捕获的原始顺序引用数组，重建不依赖当前 DOM 顺序（可反复调用）。
  function rebuildMasonry(timeline, groups, current) {
    // 摘除旧列容器（其内 group 随容器一并移出 DOM，但 groups 数组仍持有引用）
    Array.from(timeline.querySelectorAll(".friends-timeline-column")).forEach(
      function (col) {
        col.remove();
      },
    );
    timeline.classList.remove("masonry-active");

    var desktop = window.innerWidth >= 768;
    var visible = groups.slice(0, current);

    if (!desktop || visible.length < 2) {
      // 单列：按原始顺序全部铺回 timeline（隐藏组 display:none 不占位）
      groups.forEach(function (g) {
        timeline.appendChild(g);
      });
      return;
    }

    var left = document.createElement("div");
    left.className = "friends-timeline-column";
    var right = document.createElement("div");
    right.className = "friends-timeline-column";
    timeline.appendChild(left);
    timeline.appendChild(right);
    timeline.classList.add("masonry-active");

    groups.forEach(function (g, i) {
      if (i < current) {
        (i % 2 === 0 ? left : right).appendChild(g);
      } else {
        timeline.appendChild(g); // 隐藏组留在 timeline 直接子级（display:none）
      }
    });
  }

  function updateDisplay(timeline, groups, current) {
    var btn = document.getElementById("friends-load-more");
    groups.forEach(function (g, i) {
      g.style.display = i < current ? "" : "none";
    });
    timeline.dataset.friendsLoaded = current;
    if (btn) {
      btn.style.display = current < groups.length ? "flex" : "none";
    }
    rebuildMasonry(timeline, groups, current);
  }

  function setup() {
    try {
      var timeline = document.getElementById("friends-timeline");
      var btn = document.getElementById("friends-load-more");
      if (!timeline || !btn) return;

      var batchSize = parseInt(timeline.getAttribute("data-batch-size")) || 30;
      var allGroups = getGroups(timeline);

      // 移除之前可能绑定的 data 状态
      var current = parseInt(timeline.dataset.friendsLoaded) || batchSize;
      if (current > allGroups.length) current = allGroups.length;

      // 首次加载用 batchSize
      if (!timeline.dataset.friendsLoaded) {
        current = Math.min(batchSize, allGroups.length);
      }

      updateDisplay(timeline, allGroups, current);

      if (!btn.dataset.friendsMasonryBound) {
        btn.dataset.friendsMasonryBound = "true";
        btn.addEventListener("click", function () {
          var c = parseInt(timeline.dataset.friendsLoaded) || batchSize;
          c += batchSize;
          if (c > allGroups.length) c = allGroups.length;
          updateDisplay(timeline, allGroups, c);
        });
      }
    } catch (e) {
      // 静默失败，不阻断页面渲染
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    setup();
  }

  // resize 跨 768 断点重建：resize 监听全局只注册一次（Swup 换页重执行本脚本时
  // 不重复绑定）；setup 每次重查 DOM，避免闭包引用旧页面元素。
  if (!window.__etherealFriendsMasonryResizeBound) {
    window.__etherealFriendsMasonryResizeBound = true;
    var resizeTimer = null;
    window.addEventListener("resize", function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(setup, 150);
    });
  }
})();

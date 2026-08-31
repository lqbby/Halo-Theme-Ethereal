// @ts-nocheck —— 从 MainGridLayout.astro 内联脚本迁入（保持 ES5 原样，不做类型改造）
// 随机钓鱼 - 点击按钮鱼钩摇摆 1.5 秒后随机跳转朋友圈文章
// 放到 swup-container 外部 + 事件委托，保证直接访问和 Swup 导航都生效
// 构建产物：public/assets/random-fish.js（esbuild 编译，勿手改产物）
(function () {
  var t =
    window.__etherealI18n ||
    function (_key, fallback) {
      return fallback;
    };
  var SPIN_DELAY = 1500; // 摇摆等待时长（ms）
  var spinning = false; // 防止重复点击

  // 收集当前页面已渲染的朋友圈文章链接（兼容不同朋友圈插件标题类名）
  function getUrls() {
    var links = document.querySelectorAll(
      ".friends-item-title, .moment-item-title, .friend-item-title",
    );
    var urls = [];
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href");
      if (href && href !== "#") urls.push(href);
    }
    return urls;
  }

  // 停止摇摆，恢复按钮
  function stopSwing(btn) {
    spinning = false;
    btn.classList.remove("spinning");
    var label = btn.querySelector(".random-fish-label");
    if (label) label.textContent = t("page.friends.randomFish", "随机钓鱼");
  }

  // 鱼钩摇摆动画
  function startSwing(btn, callback) {
    var icon = btn.querySelector(".random-fish-icon");
    var label = btn.querySelector(".random-fish-label");
    btn.classList.add("spinning");
    if (label) label.textContent = t("page.friends.fishing", "正在钓...");
    if (icon) icon.style.setProperty("--swing-duration", "0.5s");
    setTimeout(callback, SPIN_DELAY);
  }

  // 移除跳转遮罩
  function removeOverlay() {
    var ov = document.getElementById("random-fish-overlay");
    if (ov) ov.remove();
  }

  // 显示「正在前往神秘区域」跳转遮罩（符合 Ethereal 空灵主题）
  function showGoOverlay() {
    if (document.getElementById("random-fish-overlay")) return;
    var ov = document.createElement("div");
    ov.id = "random-fish-overlay";
    ov.className = "random-fish-overlay";
    ov.innerHTML =
      '<div class="random-fish-overlay-card">' +
      '<svg class="random-fish-overlay-icon" viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" stroke="none"/></svg>' +
      '<span class="random-fish-overlay-text">正在前往神秘区域</span>' +
      "</div>";
    document.body.appendChild(ov);
    // 双 rAF 确保淡入过渡生效
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        ov.classList.add("show");
      });
    });
  }

  // 随机挑一篇并打开
  // newTab=true（朋友圈页内，摇摆期间仍在激活窗口）→ 新标签打开（走外链模态框拦截）
  // newTab=false（fetch 异步回调后，新标签易被弹窗拦截）→ 先显示跳转动画，再同标签导航，保证必跳
  function openRandom(urls, btn, newTab) {
    var chosen = urls[Math.floor(Math.random() * urls.length)];
    if (newTab && /^https?:\/\//i.test(chosen)) {
      var a = document.createElement("a");
      a.href = chosen;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      showGoOverlay();
      setTimeout(function () {
        if (window.swup && window.swup.navigate) window.swup.navigate(chosen);
        else window.location.href = chosen;
        // 跳转动画在页面切换完成后移除（SPA）；整页回退则自然消失
        if (window.swup && window.swup.hooks) {
          window.swup.hooks.on("visit:end", removeOverlay, {
            once: true,
          });
        } else {
          setTimeout(removeOverlay, 2000);
        }
      }, 500);
    }
    stopSwing(btn);
  }

  // 当前页无朋友圈文章（不在朋友圈页）时：抓取朋友圈页 HTML 解析文章链接，
  // 保证首页等任意页面点击钩子都能直接随机到一篇朋友圈文章（无需先跳转页面）
  function fetchFriendUrls(btn) {
    fetch("/peng-you-quan?t=" + Date.now())
      .then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        var urls = [];
        var links = doc.querySelectorAll(
          ".friends-item-title, .moment-item-title, .friend-item-title",
        );
        for (var i = 0; i < links.length; i++) {
          var href = links[i].getAttribute("href");
          if (href && href !== "#") urls.push(href);
        }
        if (!urls.length) {
          alert(t("page.friends.noRandomPosts", "暂无朋友圈文章可随机跳转"));
          stopSwing(btn);
          return;
        }
        openRandom(urls, btn, false); // 异步回调后：同标签导航，避免弹窗拦截
      })
      .catch(function (err) {
        console.warn("[random-fish] fetch friends page failed:", err);
        alert("获取朋友圈文章失败，请稍后重试");
        stopSwing(btn);
      });
  }

  function doRandomFish(btn) {
    var urls = getUrls();
    if (urls.length > 0) {
      openRandom(urls, btn, true); // 朋友圈页：新标签（原行为）
      return;
    }
    fetchFriendUrls(btn); // 其他页（含首页）：抓取后同标签跳
  }

  function handleClick(e) {
    var btn = e.target.closest("#random-fish-btn, #random-post-btn");
    if (!btn || spinning) return;
    e.preventDefault();

    spinning = true;
    startSwing(btn, function () {
      doRandomFish(btn);
    });
  }

  var bound = false;

  function ensureBound() {
    if (bound) return;
    document.addEventListener("click", handleClick);
    bound = true;
  }

  // 初始加载
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureBound);
  } else {
    ensureBound();
  }

  // Swup 页面切换后重新确认（事件委托已在 document 上；
  // SwupScriptsPlugin 换页重执行时 ensureBound 跳过——冗余注册已删除）。
})();

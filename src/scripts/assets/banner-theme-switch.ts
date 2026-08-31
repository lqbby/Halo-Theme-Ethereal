// @ts-nocheck —— legacy 手写脚本迁入源码目录（保持 ES5 原样，不做类型改造）
// Banner 壁纸暗/亮主题切换
// SSR 渲染亮色壁纸 + 每个图片元素携带 data-theme-src（暗色壁纸 URL，见
// MainGridLayout.astro / image-suffix.ts 的 darkSrcX / carouselDarkImgSrcExpr）。
// 本脚本监听 <html> 的 class 变化（主题暗/亮切换即 html.dark 增减，由
// Layout.astro 的暗色初始化脚本与 LightDarkSwitch 驱动），在亮/暗两套壁纸间
// 切换 <img>.src；无 data-theme-src 的元素（未配置暗色壁纸）跳过，保持亮色。
// 覆盖场景：单图/轮播/移动端独立来源（#banner / #banner-mobile 内所有 img）。
// 说明：暗色变体仅支持图片；视频源（<video>）不做暗色切换，两种主题沿用
// 同一视频源。
(function () {
  function isDark() {
    return document.documentElement.classList.contains("dark");
  }

  // 把带 data-theme-src 的 banner 图片 src 与 object-position 切换到当前主题
  // 对应的那份。首次切换前记录亮色 src（data-light-src）与位置
  // （data-light-position），恢复时无需依赖 SSR 原值。
  function swap() {
    var dark = isDark();
    var imgs = document.querySelectorAll(
      "#banner img[data-theme-src], #banner-mobile img[data-theme-src]",
    );
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var darkSrc = img.getAttribute("data-theme-src");
      if (!darkSrc) continue;
      if (!img.getAttribute("data-light-src")) {
        img.setAttribute("data-light-src", img.getAttribute("src") || "");
      }
      if (!img.getAttribute("data-light-position")) {
        img.setAttribute("data-light-position", img.style.objectPosition || "");
      }
      var lightSrc = img.getAttribute("data-light-src") || "";
      var next = dark ? darkSrc : lightSrc;
      if (img.getAttribute("src") !== next) {
        // srcset 清空，避免浏览器按 srcset 覆盖我们指定的 src
        if (img.hasAttribute("srcset")) img.removeAttribute("srcset");
        img.setAttribute("src", next);
      }
      // 暗色壁纸独立位置（object-position）：配置了 data-theme-position 时覆盖，
      // 否则沿用亮色位置
      var darkPos = img.getAttribute("data-theme-position") || "";
      var pos =
        dark && darkPos
          ? darkPos
          : img.getAttribute("data-light-position") || "";
      if (img.style.objectPosition !== pos) {
        img.style.objectPosition = pos;
      }
    }
  }

  function bind() {
    swap();
    // 全局守卫：Swup 换页克隆重执行时只绑一次观察器（banner 在 swup 容器外持久）
    if (!window.__etherealBannerThemeSwitchBound) {
      window.__etherealBannerThemeSwitchBound = true;
      var mo = new MutationObserver(function () {
        swap();
      });
      mo.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
  // Swup 换页后重跑（新页 banner DOM 若被替换，补挂观察器与初始态）。
  // 守卫：SwupScriptsPlugin 会在每次换页克隆重执行本脚本，不加守卫会重复注册
  // page:view 监听并随导航次数线性累积（与 navbar.ts 的 __touchSubmenuBound 同款问题）。
  if (!window.__etherealBannerHooksBound) {
    window.__etherealBannerHooksBound = true;
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

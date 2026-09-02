// @ts-nocheck —— legacy 手写脚本迁入源码目录（保持 ES5 原样，不做类型改造）
// 波浪动画（P5 优化：由 rAF + setAttribute("viewBox") 每帧改 viewBox 触发 SVG layout
// 重算，改为 CSS @keyframes 平移，动画完全走合成器路径，零主线程每帧开销）
// 2.8：#theme-config 解析与缓存契约收敛到 _theme-config.ts 的 getThemeConfig()
// #4：缓存统一到 src/utils/theme-config.ts（window.__themeConfig，Vite 侧共用）
// #6：styleSwitches 下钻收敛到 getStyleSwitches()
import { getStyleSwitches } from "./_theme-config";
(function () {
  // 三选开关（settings.yaml styleSwitches.banner_wave）：
  // disabled / 旧版布尔 false → 不启动动画；desktop_only + 触屏设备 → 隐藏容器并跳过动画。
  // wave.js 是 public/ 静态资产读不到 theme.config，配置经 getStyleSwitches() 从
  // Layout.astro 注入的 #theme-config JSON 读取（首个执行的脚本写缓存，后续复用）。
  var waveSw = getStyleSwitches();
  var waveValue = waveSw ? waveSw.banner_wave : null;
  // 关闭（含旧版布尔 false）：不启动动画
  if (waveValue === false || waveValue === "disabled") return;
  // 移动端关闭：触屏设备（pointer: coarse，与 navbar.js 判定一致）隐藏波浪容器并跳过动画
  if (
    waveValue === "desktop_only" &&
    window.matchMedia("(pointer: coarse)").matches
  ) {
    var waveBox = document.getElementById("wave-container");
    if (waveBox) waveBox.style.display = "none";
    return;
  }

  var waveContainer = document.getElementById("wave-container");
  if (!waveContainer) return;

  // 只初始化一次：本脚本会被 SwupScriptsPlugin 在每次换页时克隆重执行，
  // 而 #wave-container 位于 Layout（Swup 容器外）跨页面持久——不守卫则每次换页
  // 叠加 visibilitychange 监听 + IO 观察器（N 次换页 = N 倍开销）。
  if (window.__waveInited) return;
  window.__waveInited = true;

  // CSS 动画驱动（components.css 的 @keyframes wave-scroll），JS 只负责
  // 视口外/后台暂停：通过切换 animation-play-state 暂停/恢复，不触碰每帧属性。
  function setPaused(paused) {
    waveContainer.classList.toggle("wave-paused", paused);
  }

  // 页面不可见时暂停
  document.addEventListener("visibilitychange", function () {
    setPaused(document.hidden);
  });

  // 波浪不在视口内时暂停
  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        setPaused(!entries[0].isIntersecting);
      },
      { rootMargin: "100px" },
    );
    observer.observe(waveContainer);
  }
})();

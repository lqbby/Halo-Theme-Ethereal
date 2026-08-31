// @ts-nocheck —— legacy 手写脚本迁入源码目录（保持 ES5 原样，不做类型改造）
// 波浪 viewBox 动画
// 2.8：#theme-config 解析与缓存契约收敛到 _theme-config.ts 的 getThemeConfig()
import { getThemeConfig } from "./_theme-config";
(function () {
  // 三选开关（settings.yaml styleSwitches.banner_wave）：
  // disabled / 旧版布尔 false → 不启动动画；desktop_only + 触屏设备 → 隐藏容器并跳过动画。
  // wave.js 是 public/ 静态资产读不到 theme.config，配置经 getThemeConfig() 从
  // Layout.astro 注入的 #theme-config JSON 读取（首个执行的脚本写缓存，后续复用）。
  var waveValue = null;
  var waveCfg = getThemeConfig();
  if (waveCfg) {
    var waveSw = waveCfg.style && waveCfg.style.styleSwitches;
    if (waveSw) waveValue = waveSw.banner_wave;
  }
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

  if (!document.getElementById("wave-svg-1")) return;

  // 只初始化一次：本脚本会被 SwupScriptsPlugin 在每次换页时克隆重执行，
  // 而 #wave-container 位于 Layout（Swup 容器外）跨页面持久——不守卫则每次换页
  // 叠加一条 rAF 动画链 + visibilitychange 监听 + IO 观察器（N 次换页 = N 倍每帧开销）。
  if (window.__waveInited) return;
  window.__waveInited = true;

  var speeds = [18, 12, 8];
  var running = true;
  // 一次性缓存 3 个波浪 SVG：rAF 每帧原本各查一次 getElementById（60fps 下约
  // 180 次/秒）。#wave-container 位于 Swup 容器之外、跨换页持久，元素不重建，
  // 缓存安全；缺失的槽位留 null，由 setWaveViewBox 跳过。
  var waveSvgs = [
    document.getElementById("wave-svg-1"),
    document.getElementById("wave-svg-2"),
    document.getElementById("wave-svg-3"),
  ];

  function setWaveViewBox() {
    var t = performance.now() / 1000;
    for (var i = 0; i < 3; i++) {
      var svg = waveSvgs[i];
      if (!svg) continue;
      svg.setAttribute("viewBox", ((t / speeds[i]) % 1) * 2880 + " 0 1440 200");
    }
  }

  function step() {
    setWaveViewBox();
    if (running) requestAnimationFrame(step);
  }

  function resume() {
    if (running) return;
    running = true;
    requestAnimationFrame(step);
  }

  // 页面不可见时暂停
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      running = false;
    } else {
      resume();
    }
  });

  // 波浪不在视口内时暂停
  if ("IntersectionObserver" in window) {
    var waveContainer = waveSvgs[0] ? waveSvgs[0].closest("div") : null;
    if (waveContainer) {
      var observer = new IntersectionObserver(
        function (entries) {
          if (entries[0].isIntersecting) {
            resume();
          } else {
            running = false;
          }
        },
        { rootMargin: "100px" },
      );
      observer.observe(waveContainer);
    }
  }

  requestAnimationFrame(step);
  // 原 swup:contentReplaced 同步监听已删除：Swup v3 事件名，v4 分发
  // swup:{hook}（如 swup:content:replace），该监听从未触发；
  // 且 rAF 链每帧持续同步 viewBox，无需换页时额外校准。
})();

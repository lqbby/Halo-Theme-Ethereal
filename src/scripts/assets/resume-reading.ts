// @ts-nocheck —— legacy 手写经典脚本（ES5 风格，与 comment-locate.ts / post-like.ts 同款，不做类型改造）
// 构建产物：public/assets/resume-reading.js（源码在 src/scripts/assets/，esbuild 编译，勿手改产物）
//
// 断点续读（批次1 ③）：仅文章页生效（以 #post-container 存在性判定，脚本也只在 post.astro 引用）。
// · 保存：滚动时节流（rAF 合并 + ≥300ms 间隔，pagehide / 切后台时强制补存）把进度写入
//   localStorage，键 = "ethereal-resume:" + location.pathname（即文章 permalink 路径），
//   值 = JSON {y: 绝对 scrollY, p: 正文阅读百分比 0~100}。百分比以 #content 正文元素为锚
//   （起 = 正文顶，终 = 正文底 − 视口高），无 #content 时退到 #post-container，再退到整页。
// · 恢复：进入文章页时读记录，进度 >15% 且 <95% 才在正文顶部（#post-container 首位）
//   显示小条「继续上次阅读 · 约读到 X%」+ 继续按钮 + 关闭按钮；继续 = 平滑滚回保存的 y
//   （长距离 / 减少动态效果时瞬时，与 comment-locate 的 __smartScrollTo 同判据）；
//   关闭 = 隐藏并在 sessionStorage 记 dismissed，本次会话内同一篇文章不再显示。
// · 读完：保存或恢复时发现进度 ≥95% 一律删除该键（视为已读完）；滚回顶部（≤0%）同样删除。
//
// Swup 生命周期与 comment-locate.ts 同款：window 级监听（scroll/pagehide/visibilitychange）
// 用 onceBound 只注册一次、内部读共享 state（每次 init 按当前页刷新），避免脚本被
// SwupScriptsPlugin 克隆重执行时重复注册；每次进入页面由 onPageView("page:view") 重新 init，
// 首载由 onceBound init 兜底。文案走全局 i18n 助手：优先 window.__etherealI18n
// （Layout.astro 注入），回退 src/utils/i18n 的 t()（同源读 window.i18nResources）。
import { onPageView, onceBound } from "../../utils/once";
import { t as i18nT } from "../../utils/i18n";

(function () {
  var KEY_PREFIX = "ethereal-resume:";
  var DISMISS_PREFIX = "ethereal-resume-dismissed:";
  var SHOW_MIN = 15; // 进度 >15% 才提示续读
  var DONE = 95; // 进度 ≥95% 视为读完并清除
  var SAVE_INTERVAL = 300; // 保存最小间隔（ms），与 rAF 合并叠加节流

  function tt(key, fallback) {
    var g = window.__etherealI18n;
    if (typeof g === "function") return g(key, fallback);
    return i18nT(key, fallback);
  }

  // localStorage / sessionStorage 安全访问：隐私模式/禁存储下会抛 SecurityError，
  // 裸调会中断初始化（post-like.ts 同款守卫）。
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
  function sessionGet(key) {
    try {
      return sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function sessionSet(key, val) {
    try {
      sessionStorage.setItem(key, val);
    } catch (e) {}
  }

  // 跨 init 共享的运行态：window 级监听只注册一次、闭包读的是首个执行的这份 state，
  // 后续每次 init() 都按当前页面刷新它（当前文章的键、是否激活、小条元素）。
  var state = {
    key: null, // 当前文章的 localStorage 键（非文章页为 null）
    active: false, // 当前页是否为文章页（#post-container 存在）
    bar: null, // 当前显示的续读小条元素
    lastSave: 0, // 上次保存时间戳（节流）
    ticking: false, // scroll 的 rAF 合并标记
  };

  // 阅读进度：以正文元素为锚算百分比，并带回当前绝对 scrollY。
  function measure() {
    var y = window.scrollY || window.pageYOffset || 0;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var anchor =
      document.getElementById("content") ||
      document.getElementById("post-container");
    if (!anchor) {
      var doc = document.documentElement;
      var totalDoc = Math.max(0, doc.scrollHeight - vh);
      return { y: y, p: totalDoc > 0 ? (y / totalDoc) * 100 : 0 };
    }
    var rect = anchor.getBoundingClientRect();
    var top = y + rect.top; // 元素顶边的绝对位置
    var range = anchor.offsetHeight - vh; // 读完正文需要滚过的距离
    if (range <= 0) return { y: y, p: y > top ? 100 : 0 };
    var p = ((y - top) / range) * 100;
    if (p < 0) p = 0;
    if (p > 100) p = 100;
    return { y: y, p: p };
  }

  function save(force) {
    if (!state.active || !state.key) return;
    var now = Date.now();
    if (!force && now - state.lastSave < SAVE_INTERVAL) return;
    state.lastSave = now;
    var m = measure();
    // 读完（≥95%）或回到顶部（≤0%）：都没有续读价值，删键。
    if (m.p >= DONE || m.p <= 0) {
      storageRemove(state.key);
      return;
    }
    storageSet(
      state.key,
      JSON.stringify({ y: Math.round(m.y), p: Math.round(m.p) }),
    );
  }

  function onScroll() {
    if (state.ticking) return;
    state.ticking = true;
    requestAnimationFrame(function () {
      state.ticking = false;
      save(false);
    });
  }

  // 与 comment-locate.ts 的 __smartScrollTo 同判据：长距离（>1.5 屏）瞬时、
  // 短距离平滑、prefers-reduced-motion 一律瞬时。
  function smartScrollTo(top) {
    var reduce =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var dist = Math.abs(top - (window.scrollY || 0));
    var threshold = (window.innerHeight || 800) * 1.5;
    window.scrollTo({
      top: top,
      behavior: dist > threshold || reduce ? "auto" : "smooth",
    });
  }

  function ensureStyle() {
    if (document.getElementById("resume-reading-style")) return;
    var st = document.createElement("style");
    st.id = "resume-reading-style";
    st.textContent =
      // ⚠️ 必须浮动定位、绝不占文档流：初版是在流内插入（margin-bottom），刷新时
      // 浏览器先恢复滚动位置、小条随后插入会把正文整体顶下 ~50px，读到的位置
      // 就「跳到别处」（2026-11-13 用户实测反馈后改）。fixed 悬浮 pill 零布局位移。
      ".resume-reading-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(1rem + env(safe-area-inset-bottom, 0px));z-index:90;width:min(92vw,26rem);box-shadow:0 10px 30px rgba(0,0,0,.18);display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;padding:.6rem .8rem;border-radius:.75rem;background:var(--btn-regular-bg);border:1px solid var(--line-color);font-size:.85rem;color:var(--btn-content)}" +
      ".resume-reading-text{flex:1 1 auto;min-width:0}" +
      ".resume-reading-go{flex-shrink:0;border:none;cursor:pointer;border-radius:9999px;padding:.32rem .95rem;font:inherit;font-size:.82rem;font-weight:700;background:var(--primary);color:var(--on-primary,#fff);transition:transform .15s ease}" +
      ".resume-reading-go:active{transform:scale(.96)}" +
      ".resume-reading-close{flex-shrink:0;border:none;cursor:pointer;background:transparent;color:inherit;opacity:.55;font-size:1.1rem;line-height:1;padding:.25rem .45rem;border-radius:.5rem}" +
      ".resume-reading-close:hover{opacity:1}";
    document.head.appendChild(st);
  }

  function removeBar() {
    if (state.bar && state.bar.parentNode) {
      state.bar.parentNode.removeChild(state.bar);
    }
    state.bar = null;
  }

  function showBar(container, rec) {
    ensureStyle();
    var bar = document.createElement("div");
    bar.className = "resume-reading-bar";
    bar.id = "resume-reading-bar";

    var text = document.createElement("span");
    text.className = "resume-reading-text";
    text.textContent =
      tt("resume.label", "继续上次阅读") +
      " · " +
      tt("resume.progress", "约读到 {0}%").replace(
        "{0}",
        String(Math.round(rec.p)),
      );

    var go = document.createElement("button");
    go.type = "button";
    go.className = "resume-reading-go";
    go.textContent = tt("resume.continue", "继续");
    go.addEventListener("click", function () {
      var targetY = rec.y;
      removeBar();
      smartScrollTo(targetY);
    });

    var close = document.createElement("button");
    close.type = "button";
    close.className = "resume-reading-close";
    close.setAttribute("aria-label", tt("common.close", "关闭"));
    close.textContent = "×";
    close.addEventListener("click", function () {
      // 关闭后本次会话内同一篇文章不再显示（sessionStorage 按 pathname 记）。
      sessionSet(DISMISS_PREFIX + window.location.pathname, "1");
      removeBar();
    });

    bar.appendChild(text);
    bar.appendChild(go);
    bar.appendChild(close);
    container.insertBefore(bar, container.firstChild);
    state.bar = bar;
  }

  function init() {
    removeBar();
    var container = document.getElementById("post-container");
    if (!container) {
      state.active = false;
      state.key = null;
      return;
    }
    state.active = true;
    state.key = KEY_PREFIX + window.location.pathname;

    if (sessionGet(DISMISS_PREFIX + window.location.pathname) === "1") return;

    var raw = storageGet(state.key);
    if (!raw) return;
    var rec = null;
    try {
      rec = JSON.parse(raw);
    } catch (e) {}
    if (!rec || typeof rec.y !== "number" || typeof rec.p !== "number") {
      storageRemove(state.key);
      return;
    }
    if (rec.p >= DONE) {
      storageRemove(state.key);
      return;
    }
    if (rec.p <= SHOW_MIN) return;
    showBar(container, rec);
  }

  // 首载判定一次（与 comment-locate 的 init 同款：onceBound 去重，
  // 换页后的判定完全交给 onPageView，避免脚本重执行时重复 init）。
  onceBound("resume-reading:init", function () {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        init();
      });
    } else {
      init();
    }
  });

  // Swup 换页后重新判定（注册只做一次，handler 每次换页触发一次）。
  onPageView("resume-reading", function () {
    init();
  });

  // window 级监听只注册一次：监听内部读共享 state，非文章页 save() 自动空转。
  onceBound("resume-reading:scrollbind", function () {
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", function () {
      save(true);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) save(true);
    });
  });
})();

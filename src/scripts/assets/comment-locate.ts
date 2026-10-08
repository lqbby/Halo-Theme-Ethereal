// @ts-nocheck —— legacy 手写脚本迁入源码目录（保持 ES5 原样，不做类型改造）
// 评论区锚点落位 + 高亮：处理 #comment 与 #comment-next-<comment|reply>-<name> 两种 hash，
// 滚动到位后脉冲高亮落点（2.5 曾删原触发脚本导致失效，本文件恢复之）。
import { onPageView, onceBound } from "../../utils/once";
(function () {
  var READY_TIMEOUT = 5000; // 评论区内容就绪兜底（app.ts 懒加载 comment-next ~120KB；移动端慢网放宽）
  var POLL_INTERVAL = 120; // 查找单条评论的轮询间隔

  // comment-next 单条评论锚点 id：comment-next-comment-<name> / comment-next-reply-<name>。
  // 插件自带 scrollIntoView 但不做高亮，本脚本补高亮；两种前缀都试（侧栏数据不区分顶层/回复）。
  var ANCHOR_RE = /^comment-next-(comment|reply)-(.+)$/;

  function findTarget(m) {
    var ids = ["comment-next-comment-" + m[2], "comment-next-reply-" + m[2]];
    // 先搜 light DOM，再穿透 <comment-widget> 的 shadow root（1.0.13 起评论渲染在 Shadow DOM 内）。
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) return el;
    }
    var widgets = document.querySelectorAll("comment-widget");
    for (var w = 0; w < widgets.length; w++) {
      var sr = widgets[w].shadowRoot;
      if (!sr) continue;
      for (var i = 0; i < ids.length; i++) {
        var el2 = sr.getElementById(ids[i]);
        if (el2) return el2;
      }
    }
    return null;
  }

  // 单条评论由 comment-next 异步渲染，轮询等它进 DOM；超时后照常落位。
  function waitForTarget(m, cb) {
    var t0 = Date.now();
    (function poll() {
      var el = findTarget(m);
      if (el) return cb(el);
      if (Date.now() - t0 >= READY_TIMEOUT) return cb(null);
      setTimeout(poll, POLL_INTERVAL);
    })();
  }

  // Shadow DOM 样式封装：light DOM CSS 穿透不进，但 CSS 变量（--primary）会沿树继承穿透，
  // 故往 shadow root 注入一份等价 <style>（shadow 内直接 var(--primary)）。
  function ensureFlashStyle(root) {
    if (root.__etherealFlashStyle) return;
    var st = document.createElement("style");
    st.textContent =
      ".comment-locate-flash{outline-offset:2px;border-radius:0.5rem;animation:comment-locate-flash 1.6s ease-out}" +
      "@keyframes comment-locate-flash{" +
      "0%{outline:0 solid transparent;background-color:transparent}" +
      "12%{outline:3px solid color-mix(in oklab,var(--primary) 60%,transparent);background-color:color-mix(in oklab,var(--primary) 18%,transparent)}" +
      "70%{outline:3px solid color-mix(in oklab,var(--primary) 60%,transparent);background-color:color-mix(in oklab,var(--primary) 18%,transparent)}" +
      "100%{outline:0 solid transparent;background-color:transparent}}";
    root.appendChild(st);
    root.__etherealFlashStyle = true;
  }

  function flash(el) {
    var root = el.getRootNode && el.getRootNode();
    if (root && root.nodeType === 11) ensureFlashStyle(root);
    // 先移除再强制 reflow，确保重复进入（SPA 换页/再次点击）可重新触发动画。
    el.classList.remove("comment-locate-flash");
    void el.offsetWidth;
    el.classList.add("comment-locate-flash");
    var done = function () {
      el.classList.remove("comment-locate-flash");
      el.removeEventListener("animationend", done);
    };
    el.addEventListener("animationend", done);
    setTimeout(done, 1800); // 兜底：动画被中断时 animationend 不触发，避免 class 残留
  }

  // 等目标进视口 + 滚动停稳后再闪（长文平滑滚动可 1s+，滚动途中闪完就看不见）。
  // 双信号：scrollend（权威）+ scroll 空闲 debounce（旧浏览器兜底）。
  function flashWhenSettled(el) {
    var t0 = Date.now();
    var IDLE = 160; // scroll 停这么久视为停稳
    var MAX_WAIT = 4000; // 绝对兜底，避免任何异常下永不闪
    var settled = false;
    var idleTimer = null;

    function finish() {
      if (settled) return;
      settled = true;
      cleanup();
      flash(el);
    }
    function cleanup() {
      if (idleTimer) clearTimeout(idleTimer);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("scroll", onScroll);
      window.removeEventListener("scrollend", finish);
      document.removeEventListener("scrollend", finish);
    }
    function inView() {
      var r = el.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      return r.top < vh && r.bottom > 0;
    }
    function onScroll() {
      if (Date.now() - t0 > MAX_WAIT) return finish();
      if (idleTimer) clearTimeout(idleTimer);
      if (inView()) idleTimer = setTimeout(finish, IDLE);
    }
    window.addEventListener("scrollend", finish, { passive: true });
    document.addEventListener("scrollend", finish, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("scroll", onScroll, { passive: true });
    if (inView()) idleTimer = setTimeout(finish, IDLE);
    else idleTimer = setTimeout(finish, MAX_WAIT);
  }

  // 一次滚到位：等 <comment-widget> 尺寸稳定（头像/嵌套评论加载完）后，把目标评论
  // 垂直居中（元素中心对齐视口中心）window.scrollTo。前提：精准模式已先把 hash 改成
  // #comment，插件挂载时不触发自己的 scrollIntoView（其滚动发生在异步内容加载完前，
  // 位置是暂态的会滚偏）。
  function reduceMotion() {
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  // 目标滚动位置：元素中心对齐视口中心（顶部偏移 = (视口高 - 元素高) / 2）；
  // 元素高于视口时退化为贴 navbar 下方，避免顶部被固定导航栏遮挡。
  function commentScrollTop(el) {
    var rect = el.getBoundingClientRect();
    var absTop = window.scrollY + rect.top;
    var navEl = document.getElementById("navbar-wrapper");
    var navH = navEl ? navEl.getBoundingClientRect().height : 72;
    var viewportH = window.innerHeight;
    var desiredOffset = Math.max(navH, (viewportH - rect.height) / 2);
    var maxScroll = Math.max(
      0,
      document.documentElement.scrollHeight - viewportH,
    );
    return Math.min(Math.max(0, absTop - desiredOffset), maxScroll);
  }

  function settleAndScrollOnce(el) {
    return new Promise(function (resolve) {
      var scrollEndOnce = function (handler, fallbackMs) {
        var done = false;
        var fire = function () {
          if (done) return;
          done = true;
          window.removeEventListener("scrollend", fire);
          document.removeEventListener("scrollend", fire);
          clearTimeout(fb);
          handler();
        };
        window.addEventListener("scrollend", fire, { passive: true });
        document.addEventListener("scrollend", fire, { passive: true });
        var fb = setTimeout(fire, fallbackMs);
      };

      var scrolled = false; // settle/maxTimer 两条路径都可能触发 doScroll，守卫保证只滚一次
      var doScroll = function () {
        if (scrolled) return;
        scrolled = true;
        var target = commentScrollTop(el);
        if (Math.abs(target - window.scrollY) > 20) {
          scrollEndOnce(resolve, 1500);
          window.scrollTo({
            top: target,
            behavior: reduceMotion() ? "auto" : "smooth",
          });
        } else {
          resolve();
        }
      };

      var widget = null;
      try {
        widget = el.closest && el.closest("comment-widget");
      } catch (e) {}
      if (!widget) {
        var root = el.getRootNode && el.getRootNode();
        if (root && root.host) widget = root.host;
      }
      if (!widget) widget = document.querySelector("comment-widget");

      if (widget && typeof ResizeObserver !== "undefined") {
        var settleTimer, maxTimer;
        var ro = new ResizeObserver(function () {
          clearTimeout(settleTimer);
          settleTimer = setTimeout(function () {
            clearTimeout(maxTimer);
            ro.disconnect();
            doScroll();
          }, 240);
        });
        ro.observe(widget);
        maxTimer = setTimeout(function () {
          ro.disconnect();
          doScroll();
        }, 3500);
      } else {
        setTimeout(doScroll, 500);
      }
    });
  }

  // 落位后的漂移值守：头像/贴纸等异步资源在目标「上方」加载完时会把目标继续往下推
  // （移动端实测落位后仍漂移 +144px）。落位后守 3s：目标 absTop 漂移超 60px 做一次
  // 小幅校正（最多 2 次）；用户一旦滚动/触摸/按键立即停守（控制权交还用户）。
  function watchDrift(el) {
    var WINDOW_MS = 3000;
    var THRESHOLD = 60;
    var MAX_CORRECTIONS = 2;
    var t0 = Date.now();
    var corrections = 0;
    var stopped = false;
    var lastTop = el.getBoundingClientRect().top + window.scrollY;
    function stop() {
      if (stopped) return;
      stopped = true;
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
      window.removeEventListener("keydown", stop);
    }
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchmove", stop, { passive: true });
    window.addEventListener("keydown", stop);
    (function check() {
      if (stopped) return;
      if (Date.now() - t0 > WINDOW_MS) return stop();
      var nowTop = el.getBoundingClientRect().top + window.scrollY;
      if (
        corrections < MAX_CORRECTIONS &&
        Math.abs(nowTop - lastTop) > THRESHOLD
      ) {
        corrections++;
        lastTop = nowTop;
        var target = commentScrollTop(el);
        if (Math.abs(target - window.scrollY) > 20) {
          window.scrollTo({
            top: target,
            behavior: reduceMotion() ? "auto" : "smooth",
          });
        }
      }
      setTimeout(check, 300);
    })();
  }

  function locateComment(snap) {
    var hash = location.hash || "";
    if (hash.indexOf("#comment") !== 0) return;
    var box = document.getElementById("comment");
    if (!box) return;

    var reduce = reduceMotion();

    var raw;
    try {
      raw = decodeURIComponent(hash.slice(1));
    } catch (e) {
      raw = hash.slice(1);
    }
    var m = ANCHOR_RE.exec(raw);

    // 精准模式（#comment-next-*）：换页进入时先瞬时贴到评论区顶，再等目标进 DOM
    // 后精细居中 + 高亮；找不到退回高亮整个评论区。
    if (m) {
      box.classList.add("comment-locating");
      // 换页瞬间浏览器的 scroll anchoring 会把视口锚到未被 Swup 替换的页脚/侧栏
      // （移动端实测瞬时冲到页底 maxScroll，再被 settle 平滑回拉 = 「页脚一闪 +
      // 回拉」的三段式顿挫）。#comment 顶边此刻已稳定（上方正文是服务端渲染、评论
      // 内容只在 box 内部往下撑、不改变顶边），先瞬时贴靠（scroll-margin-top 已
      // 含 navbar 偏移），把锚定过冲在淡入完成前纠正掉。同页跳转（snap=false）
      // 无换页无过冲，保持单次平滑滚动更连贯。
      if (snap) {
        box.scrollIntoView({ behavior: "auto", block: "start" });
      }
      // replaceState 临时改 #comment：保留 wantsComment（评论区照常激活），但不再匹配插件
      // 对单条 id 的检查 → 插件挂载不滚；内容稳定后本脚本一次滚到位，再恢复 hash（replaceState
      // 不触发 hashchange / 原生锚点滚动）。
      var originalHash = location.hash;
      if (history.replaceState) {
        try {
          history.replaceState(null, "", "#comment");
        } catch (e) {}
      }
      waitForTarget(m, function (el) {
        box.classList.remove("comment-locating");
        if (history.replaceState) {
          try {
            history.replaceState(null, "", originalHash);
          } catch (e) {}
        }
        var targetEl = el || box;
        settleAndScrollOnce(targetEl).then(function () {
          flashWhenSettled(targetEl);
          // 精准命中单条评论时才值守漂移（兜底高亮整框时无此需要）
          if (el) watchDrift(el);
        });
      });
      return;
    }

    // 普通 #comment：立即滚。#comment 顶边由上方正文决定，内容撑开只增自身高度不改变顶边，
    // 此刻滚动落点本就准确，延后只会让用户多等。
    box.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });

    // 高亮延后到内容就绪再播（在空壳上播等于白播），且等滚动停稳 + 目标进视口。
    if (box.dataset.commentReady) {
      flashWhenSettled(box);
      return;
    }
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
        flashWhenSettled(box);
      });
    }
    document.addEventListener("comment:ready", onReady);
  }

  function bind(snap) {
    locateComment(!!snap);
  }

  // 首次整页加载判定一次 hash。onceBound 去重：SwupScriptsPlugin 换页克隆重执行本脚本时，
  // 顶层 bind 若裸调会与 onPageView 的 page:view handler 各执行一次 → 高光亮两遍。
  // 换页后的 hash 判定完全交给 onPageView（其 handler 每次换页恰好触发一次）。
  onceBound("comment-locate:init", function () {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        bind(true);
      });
    } else {
      bind(true);
    }
  });

  // Swup 换页后重新判定 hash（snap=true：先瞬时贴靠评论区顶，消灭换页瞬间浏览器
  // scroll anchoring 把视口锚到页脚/侧栏造成的过冲）；once 去重注册（重执行脚本
  // 不加守卫会重复注册 page:view）。
  onPageView("comment-locate", function () {
    bind(true);
  });

  // 同页锚点支持：侧栏「最近评论」指向当前文章时不走 Swup 换页，由小组件直接改
  // location.hash（hash 已相同则派发自定义事件）。监听后复用同一套落位 + 高亮逻辑
  // （snap=false：同页无换页过冲，单次平滑滚动更连贯）。
  // Swup 自身的 pushState/replaceState 不触发 hashchange，不会与换页路径重复。
  // 本脚本在 Swup 容器内会被克隆重执行，注册必须 once 去重。
  // 注意：bind 不能直接当监听器（Event 实参会被当成 snap=true）。
  onceBound("comment-locate:hashwatch", function () {
    window.addEventListener("hashchange", function () {
      bind(false);
    });
    window.addEventListener("ethereal:locate-comment", function () {
      bind(false);
    });
  });
})();

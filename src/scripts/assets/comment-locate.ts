// @ts-nocheck —— legacy 手写脚本迁入源码目录（保持 ES5 原样，不做类型改造）
// 评论区锚点落位 + 高亮：处理 #comment 与 #comment-next-<comment|reply>-<name> 两种 hash，
// 滚动到位后脉冲高亮落点（2.5 曾删原触发脚本导致失效，本文件恢复之）。
import { onPageView, onceBound } from "../../utils/once";
(function () {
  var READY_TIMEOUT = 3500; // 评论区内容就绪兜底（app.ts 懒加载 comment-next ~120KB）
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

  // 一次滚到位：等 <comment-widget> 尺寸稳定（头像/嵌套评论加载完）后按真实位置
  // window.scrollTo。前提：精准模式已先把 hash 改成 #comment，插件挂载时不触发自己的
  // scrollIntoView（其滚动发生在异步内容加载完前，位置是暂态的会滚偏）。
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

      var doScroll = function () {
        var rect = el.getBoundingClientRect();
        var absTop = window.scrollY + rect.top;
        var navEl = document.getElementById("navbar-wrapper");
        var navH = navEl ? navEl.getBoundingClientRect().height : 72;
        var desiredOffset = navH + 16;
        var maxScroll = Math.max(
          0,
          document.documentElement.scrollHeight - window.innerHeight,
        );
        var target = Math.min(Math.max(0, absTop - desiredOffset), maxScroll);
        if (Math.abs(target - window.scrollY) > 20) {
          scrollEndOnce(resolve, 1500);
          window.scrollTo({ top: target, behavior: "smooth" });
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

  function locateComment() {
    var hash = location.hash || "";
    if (hash.indexOf("#comment") !== 0) return;
    var box = document.getElementById("comment");
    if (!box) return;

    var reduce =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var raw;
    try {
      raw = decodeURIComponent(hash.slice(1));
    } catch (e) {
      raw = hash.slice(1);
    }
    var m = ANCHOR_RE.exec(raw);

    // 精准模式（#comment-next-*）：不先滚 #comment 顶（会与插件竞争），等目标进 DOM 后
    // 高亮它本身；找不到退回高亮整个评论区。
    if (m) {
      box.classList.add("comment-locating");
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
        settleAndScrollOnce(el || box).then(function () {
          flashWhenSettled(el || box);
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

  function bind() {
    locateComment();
  }

  // 首次整页加载判定一次 hash。onceBound 去重：SwupScriptsPlugin 换页克隆重执行本脚本时，
  // 顶层 bind 若裸调会与 onPageView 的 page:view handler 各执行一次 → 高光亮两遍。
  // 换页后的 hash 判定完全交给 onPageView（其 handler 每次换页恰好触发一次）。
  onceBound("comment-locate:init", function () {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bind);
    } else {
      bind();
    }
  });

  // Swup 换页后重新判定 hash；once 去重注册（重执行脚本不加守卫会重复注册 page:view）。
  onPageView("comment-locate", bind);
})();

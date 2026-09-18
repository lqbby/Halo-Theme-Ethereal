// @ts-nocheck —— legacy 手写经典脚本（ES5 原样，不做类型改造）
// 全屏 3D 转盘「随机抽取一篇文章」（1.5.31）
//
// 复刻自参考站 https://daily.yybb.us/ 的 random-post-carousel（1.5.30 只做了「方块整组转一圈」，
// LQ 明确说「我说的旋转不是你那个旋转，是点击之后的随机文章的旋转抽取一篇文章」⇒ 补上真身）：
//   · n 张封面沿 Y 轴排成圆环：每张 rotateY(i*step) translateZ(radius)，半径由面宽和 n 反算；
//     圆环整体 translateZ(-radius) 把「正面那张」推到 z=0；舞台 rotateX(-2.5deg) 微微仰视。
//   · 两段式：先 spinMs(1600) 按自定义缓动冲到目标角附近，再 easeMs(800) 收进正交角，
//     然后 holdMs(700) 定住 —— 期间点中的那张套白+主题色光环脉冲，其余压暗到 42%。
//   · 背面 = 同一张封面 hit 上 brightness(.35)（转盘背面也得有皮，不然转到侧面会露馅）；
//     backface-visibility:hidden 保证任一时刻只看得见朝向自己的那一面。
//   · Esc 取消（不导航）；导航由调用方在 onComplete 里做。
//
// ⚠️ 几何参数（0.28/0.68 面宽、1.45 半径系数、-2.5deg 仰角、3000px 透视）都是从参考站源码
//    逐字搬过来的，别凭手感改 —— 改任一个都要重新配平「面宽 / 半径 / 视野」三者。
// ⚠️ 文案不进本文件：标题由调用方从数据里给，取消提示由模板经 hidden 节点透传。

/** 把角度规整到 (-180, 180]，用于判断「哪张离正面最近」 */
function normalizeDeg(deg) {
  var d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/**
 * 目标角：从 from 出发，让第 targetIndex 张正对镜头，并至少多转 extraTurns 整圈（有「冲过去」的观感）
 */
function landingAngle(from, targetIndex, step, extraTurns) {
  var base = -targetIndex * step;
  var delta = normalizeDeg(base - from);
  if (delta <= 0) delta += 360;
  return from + delta + Math.max(0, extraTurns) * 360;
}

/** 当前正对镜头的那张（离正面最近） */
function frontIndex(angle, count, step) {
  var best = 0;
  var bestAbs = Infinity;
  for (var i = 0; i < count; i += 1) {
    var a = Math.abs(normalizeDeg(angle + i * step));
    if (a < bestAbs) {
      bestAbs = a;
      best = i;
    }
  }
  return best;
}

/** 面尺寸：窄屏按视口宽 68%（上限 220），宽屏 28%（上限 300） */
function faceSize() {
  var w = window.innerWidth || 800;
  if (w < 640) {
    var m = Math.min(Math.round(w * 0.68), 220);
    return { width: m, height: m };
  }
  var d = Math.min(Math.round(w * 0.28), 300);
  return { width: d, height: d };
}

/**
 * 两段式缓动：前 72% 走完 58% 的角度（起步猛、后段拖），再做一次 ease-in-out。
 * ⚠️ 不是标准 cubic-bezier —— 这是「转盘」观感的关键，别换成 easeOut。
 */
function easeSpin(t) {
  var s = t < 0 ? 0 : t > 1 ? 1 : t;
  var pivot = 0.72;
  var p;
  if (s < pivot) p = (s / pivot) * 0.58;
  else p = 0.58 + ((s - pivot) / (1 - pivot)) * 0.42;
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/**
 * 打开转盘。
 * @param {{faces:Array<{src?:string,title?:string}>, targetIndex:number, spinMs?:number,
 *          easeMs?:number, holdMs?:number, ariaLabel?:string, hint?:string,
 *          onComplete?:Function, onCancel?:Function}} opts
 * @returns {Function} close(completed) —— 主动关闭（completed=true 视为命中后关闭）
 */
export function openRandomPostCarousel(opts) {
  var o = opts || {};
  var faces = o.faces || [];
  var n = faces.length;
  var done = o.onComplete || function () {};
  var cancelled = o.onCancel || function () {};

  if (!n) {
    done();
    return function () {};
  }

  var target = (((o.targetIndex || 0) % n) + n) % n;
  var step = 360 / n;
  var radiusScale = 1.45; // 1 + 3 * 0.15（参考站源码常量）
  var tilt = -2.5;
  var perspective = 3000;
  var faceRadius = 18; // px 圆角
  var backBrightness = 3.5 / 10;
  var totalMs = Math.max(
    1200,
    Number(o.spinMs || 1600) + Number(o.easeMs || 800),
  );
  var turns = Math.max(2, Math.min(5, Math.round(totalMs / 850)));
  var holdMs = Number(o.holdMs || 700);

  var size = faceSize();
  var radius =
    (size.width * radiusScale) / (2 * Math.tan(Math.PI / Math.max(3, n)));

  // ---------- DOM ----------
  var overlay = document.createElement("div");
  overlay.className = "random-post-overlay is-open";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", o.ariaLabel || "Random post");

  var stage = document.createElement("div");
  stage.className = "random-post-overlay__stage";
  stage.style.setProperty("--rp-tilt", tilt + "deg");

  var tiltWrap = document.createElement("div");
  tiltWrap.className = "random-post-overlay__tilt";
  var ring = document.createElement("div");
  ring.className = "random-post-overlay__ring";
  tiltWrap.appendChild(ring);
  stage.appendChild(tiltWrap);

  var caption = document.createElement("div");
  caption.className = "random-post-overlay__caption";
  var title = document.createElement("h2");
  title.className = "random-post-overlay__title";
  caption.appendChild(title);
  if (o.hint) {
    var hint = document.createElement("p");
    hint.className = "random-post-overlay__hint";
    hint.textContent = o.hint;
    caption.appendChild(hint);
  }

  overlay.appendChild(stage);
  overlay.appendChild(caption);

  stage.style.perspective = perspective + "px";
  ring.style.width = size.width + "px";
  ring.style.height = size.height + "px";

  // 每张封面造一个 slot（面对面朝向圆心）；front/back 两层脸
  var slots = [];
  for (var i = 0; i < n; i += 1) {
    var slot = document.createElement("div");
    slot.className = "random-post-overlay__slot";
    slot.setAttribute("data-face-index", String(i));
    slot.style.transform =
      "rotateY(" + i * step + "deg) translateZ(" + radius + "px)";

    var front = document.createElement("div");
    front.className =
      "random-post-overlay__face random-post-overlay__face--front";
    front.style.borderRadius = faceRadius + "px";
    var back = document.createElement("div");
    back.className =
      "random-post-overlay__face random-post-overlay__face--back";
    back.style.borderRadius = faceRadius + "px";
    back.style.filter = "brightness(" + backBrightness + ")";

    slot.appendChild(front);
    slot.appendChild(back);
    ring.appendChild(slot);
    slots.push({
      slot: slot,
      front: front,
      back: back,
      src: String((faces[i] && faces[i].src) || ""),
      title: String((faces[i] && faces[i].title) || ""),
    });
  }

  // ---------- 状态机 ----------
  var startAngle = Math.random() * 360;
  var targetAngle = landingAngle(startAngle, target, step, turns);
  var angle = startAngle;
  var rafMotion = 0;
  var rafImages = 0;
  var alive = true;
  var phase = "motion"; // motion → hold → gone
  var startedAt = 0;
  var holdStart = 0;
  var locked = false;
  var lastTitleIndex = -1;
  var closing = false;
  // 封面加载顺序：目标篇排第一 —— 锁定那一刻它必须已经就位，否则中签的那张面是纯色块。
  // 其余按 slot 顺序排在后头，仍是一张接一张（见 loadNext）。
  var loadOrder = [target];
  for (var lo = 0; lo < n; lo += 1) {
    if (lo !== target) loadOrder.push(lo);
  }
  var loadCursor = 0;

  // 焦点管理：声明了 aria-modal="true" 就必须真的把焦点圈进来。
  // 转盘里没有可聚焦元素，所以策略是「聚焦容器自己 + 拦掉 Tab + 关闭后归还」。
  var lastFocus = document.activeElement;

  function paintRing() {
    ring.style.transform =
      "translateZ(" + -radius + "px) rotateY(" + angle + "deg)";
  }

  function paintTitle(a) {
    var idx = locked ? target : a == null ? frontIndex(angle, n, step) : a;
    if (idx === lastTitleIndex) return;
    lastTitleIndex = idx;
    title.textContent = (slots[idx] && slots[idx].title) || "";
  }

  // 封面按需顺序加载：一次只解析一张，避免 10 张同时解码卡住主线程。
  // 🔴 「串行」必须靠 onload/onerror 驱动 —— 在 `img.src = url` 之后立刻排下一帧是**假的串行**
  //    （等于 10 帧 ≈166ms 内把 10 张全发出去，注释说的保护根本没生效）。
  function loadNext() {
    if (!alive || loadCursor >= loadOrder.length) return;
    var it = slots[loadOrder[loadCursor]];
    loadCursor += 1;
    if (!it || !it.src) {
      rafImages = requestAnimationFrame(loadNext);
      return;
    }
    var img = new Image();
    var url = it.src;
    img.decoding = "async";
    var apply = function () {
      if (!alive) return;
      it.front.style.backgroundImage = 'url("' + url + '")';
      it.back.style.backgroundImage = 'url("' + url + '")';
    };
    var next = function () {
      if (!alive) return;
      rafImages = requestAnimationFrame(loadNext);
    };
    img.onload = function () {
      apply();
      next();
    };
    // 加载失败就跳过（不 apply）：把坏 URL 写进 background-image 只会让浏览器再 404 一次
    img.onerror = next;
    img.src = url;
  }

  function lockIn() {
    locked = true;
    angle = targetAngle;
    paintRing();
    paintTitle(target);
    var it = slots[target];
    if (it && it.slot) it.slot.classList.add("is-selected");
    overlay.classList.add("is-locked");
  }

  function tick(now) {
    if (!alive) return;
    if (!startedAt) startedAt = now;

    if (phase === "motion") {
      var t = (now - startedAt) / totalMs;
      angle = startAngle + (targetAngle - startAngle) * easeSpin(t);
      if (t >= 1) {
        phase = "hold";
        holdStart = now;
        lockIn();
      }
    } else if (phase === "hold" && now - holdStart >= holdMs) {
      close(true);
      return;
    }

    paintRing();
    if (!locked) paintTitle(null);
    rafMotion = requestAnimationFrame(tick);
  }

  function onResize() {
    size = faceSize();
    radius =
      (size.width * radiusScale) / (2 * Math.tan(Math.PI / Math.max(3, n)));
    ring.style.width = size.width + "px";
    ring.style.height = size.height + "px";
    for (var i = 0; i < slots.length; i += 1) {
      slots[i].slot.style.transform =
        "rotateY(" + i * step + "deg) translateZ(" + radius + "px)";
    }
    paintRing();
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close(false);
      return;
    }
    // 转盘里没有可聚焦元素：不拦 Tab，焦点就会从 aria-modal 逃到背后的页面内容上
    if (e.key === "Tab") e.preventDefault();
  }

  /** @param {boolean} completed 命中后关闭 = true；用户取消 = false */
  function close(completed) {
    if (closing) return;
    closing = true;
    alive = false;
    cancelAnimationFrame(rafMotion);
    cancelAnimationFrame(rafImages);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKey);
    overlay.classList.add("is-leaving");
    overlay.classList.remove("is-open");
    window.setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.body.classList.remove("random-post-open");
      // 只在「取消」时归还焦点：命中的话紧接着就是 Swup 换页，
      // 还焦点会把刚滚到顶部的页面又拽回原来的位置。
      if (
        !completed &&
        lastFocus &&
        document.contains(lastFocus) &&
        typeof lastFocus.focus === "function"
      ) {
        try {
          lastFocus.focus();
        } catch (e) {
          /* 目标已不可聚焦：忽略 */
        }
      }
      if (completed) done();
      else cancelled();
    }, 220);
  }

  document.body.classList.add("random-post-open");
  document.body.appendChild(overlay);
  // 容器自身可聚焦（tabindex=-1）+ 主动聚焦：配合 onKey 的 Tab 拦截，
  // 焦点就被圈在对话框里 → 读屏不会跑到 aria-modal 之后的内容
  overlay.tabIndex = -1;
  try {
    overlay.focus();
  } catch (e) {
    /* 环境不支持编程聚焦：忽略，不阻断转盘 */
  }
  paintRing();
  paintTitle(null);
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKey);
  rafMotion = requestAnimationFrame(tick);
  rafImages = requestAnimationFrame(loadNext);

  return close;
}

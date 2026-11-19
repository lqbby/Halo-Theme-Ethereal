// @ts-nocheck —— legacy 手写脚本迁入源码目录（保持 ES5 原样，不做类型改造）
// 注意：@ts-nocheck 必须在文件最顶端（任何 import 之前）才生效。
import { guardOnce } from "../../utils/once";
import { isHomePath } from "../../utils/banner-sync";
// Banner 叠加层：首页可见 + 空间不足隐藏
// （字号已改为「首帧定档」：模板输出 CSS 变量、components.css 用媒体查询收窄，
//  本脚本不再运行期写字号 —— 旧实现先按桌面字号渲染、defer 脚本执行后才收窄，
//  移动端首屏会「大字号闪变」，故整段移除，勿再写回内联 font-size）
(function () {
  var MIN_BANNER_HEIGHT = 180;
  // 刷新 bug 修（2026-11-17 哥哥定）+ 磨砂迟到修（2026-11-18 哥哥定）
  // + 手机滑回顶部卡片晚出现修（2026-11-18 哥哥定）：
  // 浏览器恢复下方滚动位置后，滑回顶部时 overlay 整层（卡片 + 全部人物）
  // 700ms 淡入、看起来像又刷新一遍；且淡入期间祖先 opacity<1 形成
  // Backdrop Root，卡片/开关的 backdrop-filter 采不到壁纸，磨砂要等淡入
  // 结束才出现（滚回顶部磨砂迟到约 700ms）。
  // 修法：载入时按实际滚动位置首帧直接定档显隐（不走过渡）；显现一律
  // 直接显示、不走 opacity 过渡（setHiddenInstant），淡出仍走过渡。
  // 旧 flag（window.__bannerSkipRevealTransition，ocr 真 bug A7）已随
  // “显现一律直接”废弃删除——显现不再分首次/之后。
  // 手机晚出现修：显现原先只靠 scroll 监听的 100ms 防抖 setTimeout 触发，
  // iOS Safari 在手指惯性滚动期间推迟 setTimeout 回调，等滚动停稳才跑
  // 防抖，卡片晚约 1 秒。显现改走 rAF 节流立即检查（惯性滚动期间 rAF
  // 照常触发），隐藏仍走防抖；另加 scrollend / touchend 两道兜底。

  function getEl(id) {
    return document.getElementById(id);
  }

  // 不走过渡直接定档显隐：临时关掉 transition、改类、强制重排、恢复。
  // 同时用 inert 挡键盘焦点（2026-11-19 哥哥要完美方案）：卡片与人物不再用
  // visibility: hidden（那会暂停 card-in / char-in / content-in，显现时重跑、
  // 闪一下），改 pointer-events: none + inert，动画只跑一次、键盘也点不到。
  function setHiddenInstant(overlay, hidden) {
    overlay.style.transition = "none";
    overlay.classList.toggle("banner-text-hidden", hidden);
    overlay.toggleAttribute("inert", hidden);
    void overlay.offsetWidth;
    overlay.style.transition = "";
  }

  // 入场动画定格（rainzt 做法，2026-11-19 哥哥问 rainzt 怎么做）：
  // 给卡片、全部人物、卡片内层每一项加 is-motion-settled，CSS 设
  // animation: none !important、opacity: 1 !important，永久定格；
  // 之后任何显现路径都不会再重跑入场动画、不再闪。
  function settleEntrance(overlay) {
    var card = overlay.querySelector(".home-wallpaper-card");
    if (card) card.classList.add("is-motion-settled");
    overlay.querySelectorAll(".char").forEach(function (el) {
      el.classList.add("is-motion-settled");
    });
    overlay
      .querySelectorAll(".home-wallpaper-card__content > *")
      .forEach(function (el) {
        // 跳过 #banner-title：它的入场/开关动画由 components.css 的
        // `.banner-title-enter #banner-title` 管，加 settled（animation:none
        // !important）会永久压掉那条规则 —— 访客来回切「显示标题」时标题
        // 再也不会淡入（2026-11-19 ocr 指出）。
        if (el.id === "banner-title") return;
        el.classList.add("is-motion-settled");
      });
    // 贴纸（含「欢迎访问」--note）同样定格：之前漏掉这一组 ⇒ 贴纸动画既无门控、
    // 又不会被 settle，刷新/滚动隐藏再显现时会重播。
    overlay
      .querySelectorAll(".home-wallpaper-sticker")
      .forEach(function (el) {
        el.classList.add("is-motion-settled");
      });
  }

  // 每个元素的入场动画结束时立即定格（rainzt 的 animationend 做法）：
  // 只绑一次；动画名是 card-in / char-in / content-in 的才定格，
  // 别的动画（如 hover）不受影响。
  function bindMotionSettled(overlay) {
    if (overlay.dataset.motionCleanupBound === "true") return;
    overlay.dataset.motionCleanupBound = "true";
    overlay.addEventListener("animationend", function (e) {
      if (
        e.target instanceof HTMLElement &&
        (e.animationName === "card-in" ||
          e.animationName === "char-in" ||
          e.animationName === "content-in" ||
          e.animationName === "sticker-in" ||
          e.animationName === "note-in")
      ) {
        // 同样跳过 #banner-title（见 settleEntrance 注释）
        if (e.target.id === "banner-title") return;
        e.target.classList.add("is-motion-settled");
      }
    });
  }

  // 只开一次入场动画（rainzt 的 reveal 做法）：双 rAF 后给 overlay 加
  // banner-entrance-ready，CSS 才挂上 card-in / char-in / content-in；
  // revealBound 守卫保证只开一次，之后滚动显隐、Swup 切页都不会再开。
  function revealEntrance(overlay) {
    if (overlay.dataset.revealBound === "true") return;
    overlay.dataset.revealBound = "true";
    bindMotionSettled(overlay);
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        overlay.classList.add("banner-entrance-ready");
      });
    });
    // 兜底 2000ms：最长入场是行内人物 `animation-delay` 1180ms（Minimax）
    // + char-in 700ms ≈ 1880ms，1500ms 会把它们冻结在半透明状态再硬跳到 1
    // （2026-11-19 ocr 指出）。
    window.setTimeout(function () {
      settleEntrance(overlay);
    }, 2000);
  }

  // 首页判定统一走 utils/banner-sync 的 isHomePath（本文件旧实现不剥部署
  // base 路径，带 base 部署时首页会被误判成非首页、横幅标题被误隐藏；
  // isHomePath 是 Layout/app.ts 同源的权威实现，勿再本地复制一份）

  function positionOverlay() {
    var overlay = getEl("banner-overlay");
    var wrapper = getEl("banner-wrapper");
    if (overlay && wrapper) {
      // overlay 本身有 absolute inset-0，覆盖整个 wrapper
      // is-home 生效后 wrapper translate-y 将其带到视口顶部
      // 仅做清理：移除可能由旧逻辑残留的 inline top/bottom
      overlay.style.top = "";
      overlay.style.bottom = "";
    }
  }

  function updateVisibility() {
    var overlay = getEl("banner-overlay");
    if (!overlay) return;
    if (!isHomePath()) {
      // 非首页：瞬间隐藏（不走 700ms 过渡 —— 否则整块 hero 淡出会被当成刷新）
      setHiddenInstant(overlay, true);
      return;
    }

    var wrapper = getEl("banner-wrapper");
    if (!wrapper) {
      setHiddenInstant(overlay, false);
      return;
    }
    var wasHidden = overlay.classList.contains("banner-text-hidden");
    var rect = wrapper.getBoundingClientRect();
    if (rect.bottom >= MIN_BANNER_HEIGHT) {
      // 状态未变（本来就可见）⇒ 直接返回：否则滚动监听里每帧都会重写
      // style.transition + void offsetWidth 强制重排（2026-11-19 ocr 指出）。
      if (!wasHidden && overlay.dataset.visSettled === "v") return;
      // 显现即终态（rainzt 做法）：入场动画只在首次加载开一次，跑完每个元素
      // 都已 is-motion-settled（animation: none !important、opacity: 1）；
      // 刷新时在下方则 initVisibility 已立即定格，显现时直接是终态，
      // 不用再加类禁动画，也不会重跑、不会闪。
      setHiddenInstant(overlay, false);
      overlay.dataset.visSettled = "v";
      // 从隐藏变为可见时，通知打字机/下坠脚本重新初始化
      if (wasHidden) {
        document.dispatchEvent(new CustomEvent("banner:visible"));
      }
    } else {
      // 🔴 隐藏一律瞬间（2026-11-19 修电脑端「首次滚动标题版/人物又刷新一次」）：
      // 原实现 userHasInteracted() 为真时走 overlay.classList.add(banner-text-hidden)
      // ⇒ overlay 的 opacity 有 700ms 过渡，而卡片/人物/标题都是 overlay 的子元素，
      // 祖先 opacity 渐变会让**整块 hero 区域淡出一次**（实测滚动时 opacity
      // 1→0.97→0.87→0.73→…→0.01 持续约 700ms），观感就是「内容和人物贴纸又刷新
      // 一遍」。而 banner 此刻本就已随滚动移出视口，淡出毫无意义。
      // 统一改 setHiddenInstant（瞬间隐藏、不走过渡），显现/隐藏都即时定档，
      // 首次滚动与后续滚动行为一致。
      // 已隐藏且已定格 ⇒ 状态无变化，跳过：settleEntrance 的 3× querySelectorAll
      // + setHiddenInstant 的强制重排若每帧都跑，会落在滚动热路径上（ocr 指出）。
      if (wasHidden && overlay.dataset.entranceSettled === "1") return;
      settleEntrance(overlay);
      setHiddenInstant(overlay, true);
      overlay.dataset.entranceSettled = "1";
      delete overlay.dataset.visSettled;
    }
  }

  function fullUpdate() {
    updateVisibility();
    positionOverlay();
  }

  // 清除 SSR 可能残留的 display:none，统一用 opacity 过渡。
  // 只在首页清（ocr 真 bug B2）：非首页 overlay 只是 display:none/透明度
  // 隐藏，eager/lazy 图只要在视口内照样下载——1481 的 lazy 只挡住了
  // display:none 子树里的图，而这里一清 display:none、overlay 又被渲染出来，
  // 非首页白下头像 + 贴纸 + 两角人物。非首页保持 display:none，零张下载；
  // 首页 SSR 本来就没有 display:none，不受影响；文章页切回首页时
  // isHomePath() 为真，照常清掉、人物正常出来。
  (function initOverlay() {
    var overlay = getEl("banner-overlay");
    if (overlay && overlay.style.display === "none" && isHomePath()) {
      overlay.style.display = "";
      overlay.classList.add("banner-text-hidden");
    }
  })();

  // 首帧定档：载入时已在下方滚动位置，直接隐藏、不走过渡
  // （rainzt 做法）：在下方则立即定格入场动画，显现时直接是终态；
  // 在顶部则只开一次入场动画（revealEntrance），跑完逐项定格。
  (function initVisibility() {
    var overlay = getEl("banner-overlay");
    var wrapper = getEl("banner-wrapper");
    if (!overlay || !wrapper || !isHomePath()) return;
    if (wrapper.getBoundingClientRect().bottom < MIN_BANNER_HEIGHT) {
      setHiddenInstant(overlay, true);
      settleEntrance(overlay);
    } else {
      revealEntrance(overlay);
    }
  })();

  fullUpdate();

  // window/document 级监听器只绑一次：本脚本会被 SwupScriptsPlugin 在每次换页时
  // 克隆重执行，不守卫则 resize/scroll 处理器逐次叠加（N 次换页 = N 倍回调开销）。
  // 换页后的重排由上方 fullUpdate() 在每次重执行时完成。
  // 原 swup:contentReplaced 监听删除：Swup v3 事件名，v4 分发 swup:{hook}，从未触发。
  if (!guardOnce("banner-responsive")) {
    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fullUpdate, 150);
    });

    var scrollTimer;
    var scrollRaf = 0;
    // 滚动监听：显现立即执行、隐藏走防抖。
    // iOS Safari 在手指惯性滚动期间推迟 setTimeout 回调，等滚动停稳才跑
    // 防抖，显现若走防抖、卡片要晚约 1 秒才出现（用户报手机滑回顶部卡片
    // 晚约 1 秒）。显现是直接显示（setHiddenInstant，无过渡），立即执行
    // 无抖动；隐藏走过渡，保留防抖避免快速来回滚动时反复淡出。
    // rAF 节流：显现检查每帧最多一次；iOS 惯性滚动期间 rAF 照常触发，
    // 不像 setTimeout 那样被推迟到滚动停稳。
    window.addEventListener(
      "scroll",
      function () {
        if (!scrollRaf) {
          scrollRaf = requestAnimationFrame(function () {
            scrollRaf = 0;
            var overlay = getEl("banner-overlay");
            // 仅当 overlay 当前隐藏时才立即检查显现（已显示时无事可做，
            // 隐藏仍走下方防抖）。
            if (overlay && overlay.classList.contains("banner-text-hidden")) {
              updateVisibility();
            }
          });
        }
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(function () {
          updateVisibility();
        }, 100);
      },
      { passive: true },
    );

    // scrollend：滚动彻底停稳（含惯性结束）后立即再核对一次。
    // 覆盖 scroll 事件本身也被推迟的老版本 / 极端情况；不支持 scrollend
    // 的浏览器上该事件永不触发、无副作用。
    window.addEventListener("scrollend", function () {
      updateVisibility();
    });

    // touchend：手指离开屏幕时立即核对一次（惯性开始前）。
    // 覆盖拖动到顶后无后续 scroll 事件的边界情况；在中途位置时是空操作。
    window.addEventListener(
      "touchend",
      function () {
        updateVisibility();
      },
      { passive: true },
    );

    // 注：原 markInteracted（pointerdown/wheel/touchstart/keydown → 标记用户交互，
    // 用来让「用户滚动隐藏」走 700ms 淡出、区分刷新恢复）已随「隐藏一律瞬间」
    // 一并移除 —— 正是它让滚轮滚动也走淡出、整块 hero 淡出一次看着像刷新。
  }
})();

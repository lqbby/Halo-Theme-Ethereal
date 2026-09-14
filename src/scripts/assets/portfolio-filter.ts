// @ts-nocheck 浏览器运行时脚本（经典脚本形态，esbuild 打成 IIFE）
//
// 项目集列表页 /portfolio 的「就地筛选」——纯客户端过滤，点胶囊 0 请求、瞬时切显隐。
// 交互与 /links 的友链筛选一致（点击分类胶囊就地重渲染 + 淡入）。
//
// 为什么本页能不走 PJAX：项目集列表没有服务端分页（listBy 直接取 1..999），
// 全部项目都在 SSR 输出的 DOM 里，任何过滤组合都能就地还原 ⇒ 不需要像
// /equipments、/photos 那样回服务端取新 HTML（见同目录 list-filter.ts）。
//
// 契约（全部由 portfolio.astro / PortfolioCard.astro SSR 输出）：
//   #pf-filter [data-pf-dim] [data-pf-value]   筛选胶囊（dim = platform|type，值 __all__ = 全部）
//   #pf-active-tag                              标签筛选生效指示（含一个 [data-pf-tag-text]）
//   #pf-page / #pf-featured / #pf-all          页面容器 / 推荐区 / 全部区
//   [data-list-item]                            卡片（在 #pf-featured 与 #pf-all 内）
//   [data-pf-platform] [data-pf-type]           卡片上的原始 key
//   [data-pf-tag]                               卡片上的隐藏标签节点（tags + techStacks）
//
// 说明：筛选状态**不写回 URL**（与参考站一致），避免与 Swup 的 history/popstate 打架；
// 但初始化时读一次 ?platform/type/tag，保证详情页技术栈 chip 的深链（?tag=Tech）仍生效。
//
// ── 1.5.18 修复：回访本页后筛选/胶囊失效（「点进去再回来就不筛选了」） ──
// 🔴🔴 病灶与 /bangumis 同款（1.5.17 修）：`guardOnce("portfolio-filter")` 的状态存在
//   window.__etherealOnce 上，而 **Swup 换页不会清它**。此前把整个 IIFE 罩在
//   `if (guardOnce("portfolio-filter")) return;` 之下 ⇒ 首次访问设下 key 后，回访时脚本
//   虽被 SwupScriptsPlugin 克隆重执行、却直接 return —— 初始化（setPills / setTagChip /
//   `apply()` 按 state 切显隐）与点击委托**全都不再执行**，于是胶囊没有激活态、卡片也
//   不再过滤（表现为整页「全部项目」裸奔）。
// ✅ 正解：拆两层 —— 「只该绑一次」的全局监听器关进 `bindGlobal()`（由 guardOnce 把门），
//   「每次进入都要重放」的 `init()` 无条件执行：重读 URL 参数 → 重算胶囊/标签指示 →
//   重新 `apply()`。`apply()` 幂等（只按 state 重写 style.display / 计数 / 空态），
//   重复执行零副作用、不动 DOM 结构（故卡片首屏的错峰入场动画不会被重播）。
//   两个触发源同时挂着：裸 `init()` 覆盖「Swup 重执行本脚本」与直刷首屏，
//   `onPageView` 覆盖「脚本按 src 被缓存、不再重执行」的换页。
//   （不再挂 astro:after-swap：上面两个触发源已覆盖全部进入路径，避免一次换页跑三遍。）
import { guardOnce, onPageView } from "../../utils/once";

(function () {
  var ALL = "__all__";
  var state = { platform: "", type: "", tag: "" };

  function page() {
    return document.getElementById("pf-page");
  }

  function readUrl() {
    var params = new URLSearchParams(window.location.search);
    state.platform = params.get("platform") || "";
    state.type = params.get("type") || "";
    state.tag = params.get("tag") || "";
  }

  function cardTags(card) {
    var nodes = card.querySelectorAll("[data-pf-tag]");
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var v = (nodes[i].textContent || "").trim();
      if (v) out.push(v);
    }
    return out;
  }

  // 插件对 tag 做「tags 与 techStacks 的 Or 匹配」，故卡片把两者都输出成 [data-pf-tag]。
  function matches(card) {
    var platform = card.getAttribute("data-pf-platform") || "";
    var type = card.getAttribute("data-pf-type") || "";
    if (state.platform && platform !== state.platform) return false;
    if (state.type && type !== state.type) return false;
    if (state.tag && cardTags(card).indexOf(state.tag) === -1) return false;
    return true;
  }

  function setPills() {
    var root = document.getElementById("pf-filter");
    if (!root) return;
    var chips = root.querySelectorAll("[data-pf-dim]");
    for (var i = 0; i < chips.length; i++) {
      var dim = chips[i].getAttribute("data-pf-dim");
      var val = chips[i].getAttribute("data-pf-value");
      var on = (state[dim] || ALL) === val;
      chips[i].classList.toggle("is-active", on);
      chips[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function setTagChip() {
    var chip = document.getElementById("pf-active-tag");
    if (!chip) return;
    if (state.tag) {
      var label = chip.querySelector("[data-pf-tag-text]");
      if (label) label.textContent = state.tag;
      chip.hidden = false;
    } else {
      chip.hidden = true;
    }
  }

  function apply(animate) {
    var root = page();
    if (!root) return;

    var anyFilter = !!(state.platform || state.type || state.tag);

    var featured = document.getElementById("pf-featured");
    if (featured) featured.hidden = anyFilter;

    var shown = 0;
    var scopes = [document.getElementById("pf-all"), featured];
    for (var s = 0; s < scopes.length; s++) {
      if (!scopes[s]) continue;
      var cards = scopes[s].querySelectorAll("[data-list-item]");
      for (var c = 0; c < cards.length; c++) {
        var card = cards[c];
        var ok = matches(card);
        card.style.display = ok ? "" : "none";
        if (ok) {
          if (scopes[s].id === "pf-all") shown++;
          if (animate) {
            card.classList.remove("list-item-enter");
            void card.offsetWidth; // 强制回流：重新加类时动画从头重播
            card.classList.add("list-item-enter");
          }
        } else {
          card.classList.remove("list-item-enter");
        }
      }
    }

    var head = document.getElementById("pf-all-head");
    if (head) head.classList.toggle("pf-sec--first", anyFilter);

    var count = document.getElementById("pf-all-count");
    if (count) count.textContent = String(shown);

    var empty = document.getElementById("pf-empty");
    if (empty) empty.hidden = shown > 0;

    var clear = document.getElementById("pf-empty-clear");
    if (clear) clear.hidden = !anyFilter;
  }

  function refresh(animate) {
    setPills();
    setTagChip();
    apply(animate);
  }

  /* ── 初始化（每次进入本页都要重放） ─────────────────────────────────── */

  // ⚠️ 本页无分页（全量渲染 + 客户端过滤），故无需像 /bangumis 那样复位页码。
  // ⚠️ 本页**不剥** .onload-animation：卡片首屏错峰入场靠它；apply() 只改
  //    style.display，不 remove/insert 节点，重复执行不会重播动画。
  function init() {
    readUrl();
    refresh(false);
  }

  /* ── 全局监听器（document 级委托，只绑一次） ────────────────────────── */

  function bindGlobal() {
    document.addEventListener("click", function (e) {
      var target = e.target;
      if (!target || !target.closest) return;

      var chip = target.closest("[data-pf-dim]");
      if (chip) {
        var root = document.getElementById("pf-filter");
        if (!root || !root.contains(chip)) return;
        var dim = chip.getAttribute("data-pf-dim");
        var val = chip.getAttribute("data-pf-value");
        if (!dim) return;
        // 点「全部」= 清空该维度；点已激活的胶囊 = 再点一次取消（切回全部）
        state[dim] = val === ALL || state[dim] === val ? "" : val || "";
        refresh(true);
        return;
      }

      if (target.closest("#pf-active-tag")) {
        state.tag = "";
        refresh(true);
      }
    });
  }

  // 🔴 顺序即契约：先补全局监听器（跨换页只绑一次），再无条件下重放初始化。
  if (!guardOnce("portfolio-filter")) bindGlobal();
  init();

  // 兜底：若某些 Swup 版本按 src 缓存脚本、不再重执行，page:view 仍会触发。
  // 与上面的 init() 重复执行是安全的（幂等）。
  onPageView("portfolio-filter", init);
})();

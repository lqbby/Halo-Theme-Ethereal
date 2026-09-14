// @ts-nocheck 浏览器运行时脚本（保持经典脚本形态：SwupScriptsPlugin 换页重执行 + window 守卫）
//
// 追番页 /bangumis 的**纯客户端**交互层：标题搜索 / 排序 / 客户端分页 / 详情弹窗 / LQIP。
//
// 为什么是「服务端渲染全量 + 客户端过滤」而不是全部客户端：插件的 Bangumi 模型没有 status
// 字段，状态只能在请求时按 follow_status 过滤 ⇒ 类型/状态两组筛选仍由 list-filter.js 走
// 局部 PJAX（服务端取该组合的全量），见 bangumis.astro 顶部注释。本脚本只处理「拿到全量
// 卡片之后」的部分。
//
// 契约（全部由 SSR 输出，脚本不依赖页面专属逻辑）：
//   [data-bangumi-grid]          卡片网格（卡片的直接父节点，重排在此容器内做）
//   [data-bangumi-card]          单张卡片（<a> 指向 B 站；data-* 携带 title/score/follow/
//                                cover/url/des… 供搜索、排序、弹窗回填）
//   [data-bangumi-search]        搜索输入框（**在 [data-list-region] 之外** ⇒ PJAX 不换掉它，
//                                查询词天然保留，无需任何状态同步）
//   [data-bangumi-sort]          排序 select（同上，在 region 之外）
//   [data-bangumi-pager]         分页容器（脚本渲染按钮；总数/页码文案由 data-* 透传 i18n）
//   [data-bangumi-empty-search]  被搜索筛空时的空态
//   [data-bangumi-count]         计数文案（data-count-template 里带 %d 占位）
//   [data-bangumi-filtered-badge] 「已筛选」徽章（data-base=1 表示服务端组合已被筛选）
//
// 关键设计：
//  - 排序靠**物理重排 DOM**（grid 的视觉顺序 = DOM 顺序），不是 CSS order。重排前先剥掉
//    onload-animation（否则节点的 remove+insert 会让入场动画重播、整屏闪一下）；
//    顺序已正确时不动 DOM（首屏默认顺序因此保留错峰入场动画）。
//  - 分页靠 display:none 切显隐，被隐藏的卡片不参与布局 ⇒ 视觉顺序仍是重排后的顺序。
//  - 监听 list-filter.js 派发的 `ethereal:list-swapped`（region 替换完成后）重建索引并
//    重放当前搜索/排序态 —— 比 MutationObserver 干净，也不会被自己渲染的分页按钮触发死循环。
//  - 弹窗的滚动锁挂在 <html> 上，而 <html> 不在 Swup 的替换范围内 ⇒ 必须在
//    pagehide / pageshow / astro:after-swap 三处清理，否则 bfcache 回退后页面锁死无法滚动。
import { guardOnce } from "../../utils/once";

(function () {
  if (guardOnce("bangumi-filter")) return;

  var PAGE_SIZE = 12;
  var SVG_PREV =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  var SVG_NEXT =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

  var state = { q: "", sort: "default", page: 1 };

  /* ── 选择器 / 工具 ─────────────────────────────────────────────────── */

  function grid() {
    return document.querySelector("[data-bangumi-grid]");
  }

  function listRoot() {
    return document.querySelector("[data-bangumi-list]");
  }

  function cardsOf() {
    var g = grid();
    if (!g) return [];
    return Array.prototype.slice.call(
      g.querySelectorAll("[data-bangumi-card]"),
    );
  }

  // 把 "1.2万" / "3.5 亿" / "9.9" / "-" 统一成可比较的数字；无法解析返回 -1（排最后）
  function toNumber(v) {
    if (v == null) return -1;
    var s = String(v).replace(/\s+/g, "");
    if (!s || s === "-") return -1;
    var m = s.match(/^([0-9]+(?:\.[0-9]+)?)(亿|万)?$/);
    if (!m) return -1;
    var n = parseFloat(m[1]);
    if (isNaN(n)) return -1;
    if (m[2] === "亿") n *= 1e8;
    else if (m[2] === "万") n *= 1e4;
    return n;
  }

  function escapeAttr(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function prefersReducedMotion() {
    try {
      return (
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    } catch (e) {
      return false;
    }
  }

  /* ── 索引 / 排序 / 重排 ────────────────────────────────────────────── */

  function buildIndex() {
    var els = cardsOf();
    var out = new Array(els.length);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var d = el.dataset || {};
      var ord = parseInt(d.index, 10);
      out[i] = {
        el: el,
        order: isNaN(ord) ? i : ord,
        title: (d.title || "").toLowerCase(),
        score: toNumber(d.score),
        follow: toNumber(d.follow),
      };
    }
    return out;
  }

  function compare(a, b) {
    if (state.sort === "score" && b.score !== a.score) return b.score - a.score;
    if (state.sort === "follow" && b.follow !== a.follow)
      return b.follow - a.follow;
    return a.order - b.order;
  }

  // 重排前剥掉入场动画：节点被 remove + insert 后 CSS 动画会重播，整屏闪一下
  function stripEntry() {
    var els = cardsOf();
    for (var i = 0; i < els.length; i++) {
      els[i].classList.remove("onload-animation");
      els[i].style.removeProperty("animation-delay");
    }
  }

  function reorder(shown) {
    var g = grid();
    if (!g) return;
    var changed = false;
    for (var i = 0; i < shown.length; i++) {
      if (g.children[i] !== shown[i].el) {
        changed = true;
        break;
      }
    }
    if (!changed) return; // 顺序已正确：不动 DOM（首屏默认顺序因此保住错峰入场）
    stripEntry();
    for (var j = 0; j < shown.length; j++) g.appendChild(shown[j].el);
  }

  /* ── 计数 / 空态 / 分页 ────────────────────────────────────────────── */

  function syncCountRow(shown) {
    var countEl = document.querySelector("[data-bangumi-count]");
    if (countEl) {
      var tpl = countEl.getAttribute("data-count-template");
      if (tpl) countEl.textContent = tpl.replace("%d", String(shown));
    }
    var badge = document.querySelector("[data-bangumi-filtered-badge]");
    if (badge) {
      var base = badge.getAttribute("data-base") === "1";
      badge.classList.toggle("hidden", !(base || state.q.trim() !== ""));
    }
  }

  function toggleEmptySearch(noResult) {
    var box = document.querySelector("[data-bangumi-empty-search]");
    if (box) box.hidden = !noResult;
  }

  function pagerBtn(page, inner, disabled, label, current) {
    return (
      '<button type="button" class="bangumi-pager-btn" data-bangumi-page="' +
      page +
      '"' +
      (disabled ? " disabled" : "") +
      (current ? ' aria-current="page"' : "") +
      ' aria-label="' +
      escapeAttr(label) +
      '">' +
      inner +
      "</button>"
    );
  }

  // 页码窗口：<=7 页全列；否则 1 … (p-1,p,p+1) … N
  function windowRange(page, pages) {
    var out = [];
    var i;
    if (pages <= 7) {
      for (i = 1; i <= pages; i++) out.push(i);
      return out;
    }
    out.push(1);
    var start = Math.max(2, page - 1);
    var end = Math.min(pages - 1, page + 1);
    if (start > 2) out.push(null);
    for (i = start; i <= end; i++) out.push(i);
    if (end < pages - 1) out.push(null);
    out.push(pages);
    return out;
  }

  function renderPager(page, pages) {
    var nav = document.querySelector("[data-bangumi-pager]");
    if (!nav) return;
    if (pages <= 1) {
      nav.hidden = true;
      nav.innerHTML = "";
      return;
    }
    var prevLabel = nav.getAttribute("data-prev-label") || "Previous";
    var nextLabel = nav.getAttribute("data-next-label") || "Next";
    var pageLabel = nav.getAttribute("data-page-label") || "Page %d";

    var html = pagerBtn(page - 1, SVG_PREV, page <= 1, prevLabel, false);
    var win = windowRange(page, pages);
    for (var i = 0; i < win.length; i++) {
      var p = win[i];
      if (p === null) {
        html += '<span class="bangumi-pager-gap" aria-hidden="true">…</span>';
      } else {
        html += pagerBtn(
          p,
          String(p),
          false,
          pageLabel.replace("%d", String(p)),
          p === page,
        );
      }
    }
    html += pagerBtn(page + 1, SVG_NEXT, page >= pages, nextLabel, false);

    nav.innerHTML = html;
    nav.hidden = false;
  }

  /* ── 主流程 ────────────────────────────────────────────────────────── */

  function apply() {
    var all = buildIndex();

    if (!all.length) {
      // 该组合本身没有数据：保留服务端渲染的空态，分页/搜索空态都收起来
      syncCountRow(0);
      toggleEmptySearch(false);
      renderPager(1, 1);
      return;
    }

    var q = state.q.trim().toLowerCase();
    var shown = q
      ? all.filter(function (it) {
          return it.title.indexOf(q) !== -1;
        })
      : all.slice();
    shown.sort(compare);

    var pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    if (state.page < 1) state.page = 1;

    reorder(shown);

    var start = (state.page - 1) * PAGE_SIZE;
    var end = start + PAGE_SIZE;
    for (var i = 0; i < all.length; i++) all[i].el.style.display = "none";
    for (var j = start; j < end && j < shown.length; j++)
      shown[j].el.style.display = "";

    syncCountRow(shown.length);
    toggleEmptySearch(shown.length === 0);
    renderPager(state.page, pages);
  }

  function syncSearchClear() {
    var btn = document.querySelector("[data-bangumi-search-clear]");
    if (btn) btn.hidden = state.q === "";
  }

  function scrollToList() {
    var el = listRoot();
    if (!el) return;
    try {
      var top = el.getBoundingClientRect().top + window.scrollY - 96;
      window.scrollTo({
        top: Math.max(0, top),
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    } catch (e) {
      /* 忽略 */
    }
  }

  /* ── LQIP：图片 onload 后摘掉模糊铺底层 ───────────────────────────── */

  function bindCover(img, box) {
    function done() {
      box.classList.add("is-ready");
      img.classList.remove("bangumi-cover-img--pending");
      img.removeEventListener("load", done);
      img.removeEventListener("error", done);
    }
    img.addEventListener("load", done);
    img.addEventListener("error", done);
  }

  function initCovers() {
    var imgs = document.querySelectorAll(
      "[data-bangumi-card] .bangumi-cover-img",
    );
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var box = img.closest ? img.closest(".bangumi-cover") : null;
      if (!box) continue;
      if (img.complete) {
        box.classList.add("is-ready");
        img.classList.remove("bangumi-cover-img--pending");
        continue;
      }
      if (img.getAttribute("data-lqip-bound") === "1") continue;
      img.setAttribute("data-lqip-bound", "1");
      img.classList.add("bangumi-cover-img--pending");
      bindCover(img, box);
    }
  }

  /* ── 详情弹窗 ─────────────────────────────────────────────────────── */

  var lastFocus = null;

  function modalRoot() {
    return document.getElementById("bangumi-modal");
  }

  function fillChip(root, sel, value) {
    var el = root.querySelector(sel);
    if (!el) return;
    var s = (value == null ? "" : String(value)).trim();
    el.textContent = s;
    el.hidden = !s;
  }

  function openModal(card) {
    var root = modalRoot();
    if (!root) return;
    var d = card.dataset || {};
    var cover = d.cover || "";

    var title = root.querySelector("[data-modal-title]");
    if (title) title.textContent = d.title || "";

    var img = root.querySelector("[data-modal-img]");
    if (img) {
      img.src = cover;
      img.alt = d.title || "";
    }
    var lqip = root.querySelector("[data-modal-lqip]");
    if (lqip)
      lqip.style.backgroundImage = cover
        ? "url('" + cover.replace(/'/g, "%27") + "')"
        : "none";

    fillChip(root, "[data-modal-type]", d.type);
    fillChip(root, "[data-modal-area]", d.area);
    fillChip(root, "[data-modal-total]", d.total);

    var scoreEl = root.querySelector("[data-modal-score]");
    if (scoreEl) {
      var sc = (d.score || "").trim();
      scoreEl.hidden = !sc || sc === "-";
      scoreEl.textContent = sc;
    }

    var keys = ["follow", "view", "danmaku", "coin"];
    for (var i = 0; i < keys.length; i++) {
      var v = root.querySelector('[data-modal-stat="' + keys[i] + '"]');
      if (v) v.textContent = d[keys[i]] || "-";
    }

    var des = root.querySelector("[data-modal-des]");
    if (des) des.textContent = d.des || "";

    var link = root.querySelector("[data-modal-link]");
    if (link) link.href = d.url || "#";

    lastFocus = document.activeElement;
    root.classList.add("is-open");
    document.documentElement.classList.add("bangumi-modal-open");
    var closeBtn = root.querySelector(".bangumi-modal-close");
    if (closeBtn) {
      try {
        closeBtn.focus({ preventScroll: true });
      } catch (e) {
        /* 忽略 */
      }
    }
  }

  function closeModal() {
    var root = modalRoot();
    if (root) root.classList.remove("is-open");
    document.documentElement.classList.remove("bangumi-modal-open");
    if (lastFocus && typeof lastFocus.focus === "function") {
      try {
        lastFocus.focus({ preventScroll: true });
      } catch (e) {
        /* 忽略 */
      }
    }
    lastFocus = null;
  }

  /* ── 事件（全部委托到 document：region 被替换后依然生效） ──────────── */

  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      // 卡片：左键且无修饰键 → 拦下改为开详情弹窗（其余情况交给浏览器开新标签，
      // 无 JS 时也是直接跳 B 站，属刻意保留的降级路径）
      var card = t.closest("[data-bangumi-card]");
      if (
        card &&
        e.button === 0 &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault();
        openModal(card);
        return;
      }

      if (t.closest("[data-bangumi-modal-close]")) {
        e.preventDefault();
        closeModal();
        return;
      }

      var pageEl = t.closest("[data-bangumi-page]");
      if (pageEl) {
        e.preventDefault();
        var p = parseInt(pageEl.getAttribute("data-bangumi-page"), 10);
        if (!isNaN(p) && p !== state.page) {
          state.page = p;
          apply();
          scrollToList();
        }
        return;
      }

      if (t.closest("[data-bangumi-search-clear]")) {
        e.preventDefault();
        var input = document.querySelector("[data-bangumi-search]");
        if (input) {
          input.value = "";
          try {
            input.focus({ preventScroll: true });
          } catch (e2) {
            /* 忽略 */
          }
        }
        state.q = "";
        state.page = 1;
        syncSearchClear();
        apply();
      }
    },
    false,
  );

  document.addEventListener(
    "input",
    function (e) {
      var el = e.target;
      if (!el || !el.matches || !el.matches("[data-bangumi-search]")) return;
      state.q = el.value || "";
      state.page = 1;
      syncSearchClear();
      apply();
    },
    false,
  );

  document.addEventListener(
    "change",
    function (e) {
      var el = e.target;
      if (!el || !el.matches || !el.matches("[data-bangumi-sort]")) return;
      state.sort = el.value || "default";
      state.page = 1;
      apply();
    },
    false,
  );

  document.addEventListener(
    "keydown",
    function (e) {
      if (e.key !== "Escape") return;
      var root = modalRoot();
      if (root && root.classList.contains("is-open")) closeModal();
    },
    false,
  );

  // list-filter.js 在 region 替换完成后派发：重建索引 + 重放当前搜索/排序态
  document.addEventListener(
    "ethereal:list-swapped",
    function () {
      initCovers();
      apply();
    },
    false,
  );

  function cleanup() {
    closeModal();
    document.documentElement.classList.remove("bangumi-modal-open");
  }
  document.addEventListener("astro:after-swap", cleanup, false);
  window.addEventListener("pagehide", cleanup, false);
  window.addEventListener("pageshow", cleanup, false);

  /* ── 初始化 ───────────────────────────────────────────────────────── */

  initCovers();
  syncSearchClear();
  apply();
})();

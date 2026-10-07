// @ts-nocheck —— legacy 手写经典脚本（ES5 原样，不做类型改造）
// 顶部两卡行的行为（1.5.29 建 / 1.5.31 按参考站 https://daily.yybb.us/ 重做两处动效）：
//   ① 左卡「随机一篇」：点击 → 拉开**全屏 3D 转盘**（_random-post-carousel）→ 命中后 Swup 导航。
//      转盘的面取自「随机一页」的 10 篇（可含重复，与参考站一致），目标篇从同一页里挑且避开当前页。
//   ② 右卡「热门 / 最近」：按 data-source 取回**一组**文章，填进服务端预渲染的 3~4 张叠层卡；
//      ‹ › 箭头在 is-front/is-mid/is-back 三档位间轮换（几何抄参考站的 perspective:900px 那套）。
//
// ⚠️ 本文件在 #swup-container 内（列在 PostList 里），Swup 换页会重执行 ⇒ 全部绑定都带守卫：
//    元素级用 dataset.bound、文档级用 window.__featuredCardsDelegated、跨页数据用 sessionStorage。
// ⚠️ 文案不写死中文：徽章/取消提示由模板经 hidden 节点透传，箭头文案走 th:aria-label。
import { fetchWithTimeout } from "../../utils/fetch-timeout";
import { makeImageSuffix } from "../../utils/image-suffix";
import { openRandomPostCarousel } from "./_random-post-carousel";

(function () {
  var API = "/apis/api.content.halo.run/v1alpha1/posts";
  var PAGE_SIZE = 20; // 随机取样页大小
  var CACHE_TTL = 10 * 60 * 1000; // 右卡缓存 10 分钟（会话内不反复打接口）
  var COVER_WIDTH = 800; // 与模板里 imageSuffixThWith("800") 对齐
  var FALLBACK_URL = "/archives"; // 随机取数全挂时的兜底去处
  var FACE_COUNT = 10; // 转盘面数（参考站 data-face-count 同值）
  var MAX_CARDS = 4; // 右卡最多几张叠层（同时只看得见 3 张，第 4 张藏在后面接轮换）

  // 与主题既有范式一致：热门 = stats.visit,desc（见 PopularPosts.astro）
  var SORT = {
    recent: "metadata.creationTimestamp,desc",
    popular: "stats.visit,desc",
  };

  function byId(id) {
    return document.getElementById(id);
  }

  /** 读隐藏文本节点里的 i18n 文案（模板用 th:text 渲染，脚本只读 textContent） */
  function labelOf(row, name, fallback) {
    var el = row.querySelector("[data-label-" + name + "]");
    var v = el && el.textContent ? el.textContent.trim() : "";
    return v || fallback || "";
  }

  /** 主题当前色相（--hue），用于让分类色块跟主题同源 */
  function baseHue() {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(
        "--hue",
      );
      var n = parseFloat(v);
      return isFinite(n) ? n : 250;
    } catch (e) {
      return 250;
    }
  }

  /** 由分类名派生一个稳定色相（同一分类永远同色），叠加在主题色相上 ⇒ 彩色但不跳出主题 */
  function hashHue(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }

  /** 分类色块：有分类就上色并显示，没有就隐藏（服务端兜底与取回文章共用） */
  function paintCategory(card) {
    var wrap = card.querySelector(".featured-cat");
    if (!wrap) return;
    var sq = card.querySelector("[data-featured-cat-square]");
    var nameEl = card.querySelector("[data-featured-cat]");
    var name = String((nameEl && nameEl.textContent) || "").trim();
    if (!name) name = String((sq && sq.getAttribute("data-cat")) || "").trim();
    if (!name) {
      wrap.classList.add("is-hidden");
      return;
    }
    wrap.classList.remove("is-hidden");
    if (sq) {
      sq.style.background =
        "oklch(0.72 0.16 " + ((baseHue() + hashHue(name)) % 360) + "deg)";
    }
  }

  function isPublic(p) {
    return !!(
      p &&
      p.spec &&
      p.spec.publish &&
      p.spec.visible === "PUBLIC" &&
      p.status &&
      p.status.permalink
    );
  }

  function fetchJson(url) {
    return fetchWithTimeout(url, {
      headers: { Accept: "application/json" },
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  function pickFrom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  /** 去掉末尾斜杠再比，避免 /foo 与 /foo/ 误判成两篇 */
  function normalizeUrl(u) {
    try {
      var url = new URL(u, window.location.origin);
      return (url.pathname.replace(/\/+$/, "") || "/") + url.search;
    } catch (e) {
      return String(u || "");
    }
  }

  /** 排除当前页那篇（随机到自己头上等于没随机）；全被排除就退回原样 */
  function excludeCurrent(list) {
    var here = normalizeUrl(window.location.href);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (normalizeUrl(list[i].status.permalink) !== here) out.push(list[i]);
    }
    return out.length ? out : list;
  }

  // ---------- 右卡：填充 ----------
  function renderPost(card, post, cfg) {
    var cover = card.querySelector("[data-featured-cover]");
    var img = card.querySelector(".featured-img");
    var el;

    card.setAttribute("href", post.status.permalink);
    card.setAttribute("aria-label", post.spec.title || "");
    el = card.querySelector("[data-featured-title]");
    if (el) el.textContent = post.spec.title || "";
    el = card.querySelector("[data-featured-excerpt]");
    if (el) el.textContent = post.status.excerpt || "";
    el = card.querySelector("[data-featured-date]");
    if (el) el.textContent = String(post.spec.publishTime || "").slice(0, 10);
    // 分类名（色块颜色随后由 paintCategory 统一上色）
    el = card.querySelector("[data-featured-cat]");
    if (el) {
      var cats = (post.categories || []).filter(Boolean);
      el.textContent = cats.length ? String(cats[0].spec.displayName) : "";
    }
    el = card.querySelector("[data-featured-badge]");
    if (el) el.textContent = cfg.badge;
    paintCategory(card);

    var src = post.spec.cover || "";
    if (cover && img) {
      if (src) {
        cover.classList.remove("is-cover-empty");
        img.setAttribute(
          "src",
          src + makeImageSuffix(cfg.provider, COVER_WIDTH, cfg.format),
        );
        img.setAttribute("alt", post.spec.title || "");
      } else {
        // 无封面：切到主题色兜底块；**同时摘掉 src**（空 src 会触发对当前页的请求）
        cover.classList.add("is-cover-empty");
        img.removeAttribute("src");
      }
    }
    card.setAttribute("data-state", "ready");
  }

  function cacheKey(source) {
    return "featured-post:" + source;
  }

  function readCache(source) {
    try {
      var raw = window.sessionStorage.getItem(cacheKey(source));
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.list || !obj.list.length || !obj.t) return null;
      if (Date.now() - obj.t > CACHE_TTL) return null;
      return obj.list;
    } catch (e) {
      return null;
    }
  }

  function writeCache(source, list) {
    try {
      window.sessionStorage.setItem(
        cacheKey(source),
        JSON.stringify({ t: Date.now(), list: list }),
      );
    } catch (e) {
      /* 禁存储环境：忽略，下次直接再请求 */
    }
  }

  /** 取一组文章（右卡叠层要好几张，不能只要 Top1） */
  function fetchList(source, size) {
    var url =
      API + "?page=0&size=" + size + "&sort=" + (SORT[source] || SORT.recent);
    return fetchJson(url).then(function (data) {
      var items = ((data && data.items) || []).filter(isPublic);
      if (!items.length) throw new Error("没有可用的公开文章");
      return items;
    });
  }

  // ---------- 右卡：三档位轮换（几何见 CSS，这里只管分配类） ----------
  function activateCardPositions(cards, front, activeCount) {
    var n = activeCount;
    for (var i = 0; i < cards.length; i++) {
      var el = cards[i];
      el.classList.remove("is-front", "is-mid", "is-back", "is-hidden");
      if (i >= n) {
        el.classList.add("is-hidden");
        el.setAttribute("tabindex", "-1");
        el.setAttribute("aria-hidden", "true");
        continue;
      }
      var off = (((i - front) % n) + n) % n;
      if (off === 0) {
        el.classList.add("is-front");
        el.removeAttribute("tabindex");
        el.removeAttribute("aria-hidden");
      } else if (off === 1 && n > 1) {
        el.classList.add("is-mid");
        el.setAttribute("tabindex", "-1");
        el.setAttribute("aria-hidden", "true");
      } else if (off === 2 && n > 2) {
        el.classList.add("is-back");
        el.setAttribute("tabindex", "-1");
        el.setAttribute("aria-hidden", "true");
      } else {
        el.classList.add("is-hidden");
        el.setAttribute("tabindex", "-1");
        el.setAttribute("aria-hidden", "true");
      }
    }
  }

  function bindPins(row, cfg) {
    var pins = row.querySelector("[data-featured-pins]");
    if (!pins || pins.dataset.bound === "1") return;
    pins.dataset.bound = "1";

    var cards = [];
    var all = pins.querySelectorAll(".featured-card--post");
    for (var i = 0; i < all.length; i++) cards.push(all[i]);
    if (!cards.length) return;

    var front = 0;
    var active = cards.length;
    var navs = pins.querySelector("[data-featured-navs]");

    function apply() {
      activateCardPositions(cards, front, active);
      if (navs) {
        if (active > 1) navs.removeAttribute("hidden");
        else navs.setAttribute("hidden", "");
      }
    }

    var source =
      row.getAttribute("data-source") === "popular" ? "popular" : "recent";
    cfg.badge = labelOf(
      row,
      source === "popular" ? "popular" : "recent",
      source === "popular" ? "Popular" : "Latest",
    );

    // 服务端兜底那几张的分类也要上色（否则是一块主色默认块）
    for (var c = 0; c < cards.length; c++) paintCategory(cards[c]);

    function fill(list) {
      var n = Math.min(cards.length, list.length);
      for (var k = 0; k < cards.length; k++) {
        if (k < n) {
          renderPost(cards[k], list[k], cfg);
          cards[k].removeAttribute("data-empty");
        } else {
          cards[k].setAttribute("data-empty", "1");
        }
      }
      active = n;
      front = 0;
      apply();
    }

    apply();
    if (navs) {
      navs.addEventListener("click", function (e) {
        var btn =
          e.target && e.target.closest
            ? e.target.closest(".featured-nav")
            : null;
        if (!btn || !pins.contains(btn)) return;
        e.preventDefault();
        if (active < 2) return;
        var dir = btn.getAttribute("data-dir") === "prev" ? -1 : 1;
        front = (((front + dir) % active) + active) % active;
        apply();
      });
    }

    var cached = readCache(source);
    if (cached) {
      fill(cached);
      return;
    }
    fetchList(source, MAX_CARDS)
      .then(function (list) {
        writeCache(source, list);
        fill(list);
      })
      .catch(function (e) {
        // 失败就保留服务端已渲染的几张（渐进增强），只是不再标记 pending
        console.warn("[featured-cards] 取文章失败，保留服务端兜底：", e);
        for (var k = 0; k < cards.length; k++) {
          cards[k].setAttribute("data-state", "fallback");
        }
        apply();
      });
  }

  // ---------- 左卡：随机一篇文章（点击拉开全屏转盘） ----------
  function go(url) {
    var swup = window.swup;
    if (swup && typeof swup.navigate === "function") {
      swup.navigate(url);
    } else {
      window.location.href = url;
    }
  }

  /** 随机取一页公开文章当「面池」（先问 total 再随机页；该页为空就退回首屏） */
  function fetchPool() {
    return fetchJson(API + "?page=0&size=1&sort=" + SORT.recent).then(
      function (data) {
        var total = Number(data && data.total) || 0;
        var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        var page = Math.floor(Math.random() * pages);
        var url =
          API + "?page=" + page + "&size=" + PAGE_SIZE + "&sort=" + SORT.recent;
        return fetchJson(url).then(function (d) {
          var items = ((d && d.items) || []).filter(isPublic);
          if (items.length) return items;
          return fetchJson(
            API + "?page=0&size=" + PAGE_SIZE + "&sort=" + SORT.recent,
          ).then(function (d2) {
            var again = ((d2 && d2.items) || []).filter(isPublic);
            if (!again.length) throw new Error("没有可用的公开文章");
            return again;
          });
        });
      },
    );
  }

  function toFace(post) {
    return {
      src: post.spec.cover || "",
      title: post.spec.title || "",
      url: post.status.permalink,
    };
  }

  /** 造 n 张面（允许重复，参考站同款）再把其中一张换成目标篇 */
  function buildFaces(pool, target, count) {
    var faces = [];
    for (var i = 0; i < count; i += 1) {
      faces.push(toFace(pickFrom(pool) || target));
    }
    var idx = Math.floor(Math.random() * count);
    faces[idx] = toFace(target);
    return { faces: faces, targetIndex: idx };
  }

  function onRandomClick(btn) {
    // ⚠️ 防重入守卫放**函数入口**：键盘 Enter 也走 click，只看按钮态挡不住
    if (btn.dataset.busy === "1") return;
    btn.dataset.busy = "1";
    btn.setAttribute("aria-busy", "true");

    var row = btn.closest ? btn.closest("#featured-cards") : null;
    var ariaLabel = (row && labelOf(row, "random", "")) || "";
    var hint = (row && labelOf(row, "hint", "")) || "";

    function release() {
      btn.dataset.busy = "";
      btn.removeAttribute("aria-busy");
    }

    // 减少动态效果：不做转盘，直接跳（与参考站一致）
    var reduce = false;
    try {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      reduce = false;
    }

    fetchPool()
      .then(function (pool) {
        var candidates = excludeCurrent(pool);
        var target = pickFrom(candidates) || pickFrom(pool);
        if (!target || !target.status || !target.status.permalink) {
          throw new Error("没有可用的公开文章");
        }
        var url = target.status.permalink;
        if (reduce) {
          // ⚠️ 这里也必须 release：Swup 换页只换容器 DOM，但回退（bfcache/pageshow）会
          //    把带着 busy=1 的旧节点还原回来 ⇒ 不复位的话按钮就永久锁死了。
          release();
          go(url);
          return;
        }
        var built = buildFaces(pool, target, FACE_COUNT);
        openRandomPostCarousel({
          faces: built.faces,
          targetIndex: built.targetIndex,
          ariaLabel: ariaLabel,
          hint: hint,
          onComplete: function () {
            release();
            go(url);
          },
          onCancel: release,
        });
      })
      .catch(function (e) {
        console.warn("[featured-cards] 随机文章失败：", e);
        release();
        go(FALLBACK_URL); // 取数不可用时也要“有去处”，别让点击落空
      });
  }

  // ---------- 初始化（幂等：Swup 换页会重执行本脚本） ----------
  function init() {
    var row = byId("featured-cards");
    if (!row) return;

    var cfg = {
      badge: "",
      provider: row.getAttribute("data-img-provider") || "none",
      format: row.getAttribute("data-img-format") || "",
    };

    bindPins(row, cfg);

    var randomBtn = byId("featured-random");
    if (randomBtn && randomBtn.dataset.bound !== "1") {
      randomBtn.dataset.bound = "1";
      randomBtn.addEventListener("click", function () {
        onRandomClick(randomBtn);
      });
    }
  }

  // 文档级监听只挂一次：本脚本在 Swup 容器内会随换页重新执行，
  // 不加 window 级守卫就会叠出 N 份清理器（换页越多次越多）。
  if (!window.__featuredCardsLifecycle) {
    window.__featuredCardsLifecycle = true;
    var teardown = function () {
      var open = document.querySelector(".random-post-overlay");
      if (open && open.parentNode) open.parentNode.removeChild(open);
      document.body.classList.remove("random-post-open");
    };
    // 浮层挂在 body 上 ⇒ 走 bfcache 回退时 pageshow 不会重建它，必须清掉残骸
    window.addEventListener("pagehide", teardown);
    window.addEventListener("pageshow", teardown);
  }

  init();
})();

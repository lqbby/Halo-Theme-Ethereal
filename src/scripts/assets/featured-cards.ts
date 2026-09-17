// @ts-nocheck —— legacy 手写经典脚本（ES5 原样，不做类型改造）
// 顶部两卡行的行为（1.5.29）：
//   ① 左卡「随机一篇文章」：点击 → 取 total → 随机页 → 随机篇 → Swup 导航（降级整页跳转）。
//   ② 右卡「热门 / 最近」：按 data-source 取 Top1 填充（会话内缓存，失败保留服务端已渲染的兜底内容）。
//
// ⚠️ 本文件在 #swup-container 内（列在 PostList 里），Swup 换页会重执行 ⇒ 全部绑定都带守卫：
//    元素级用 dataset.bound、跨页状态用 sessionStorage，重执行幂等。
// ⚠️ 文案不写死中文：徽章/阅读全文由模板经 data-* 透传（多语言站会串，见本仓既有约定）。
import { fetchWithTimeout } from "../../utils/fetch-timeout";
import { makeImageSuffix } from "../../utils/image-suffix";

(function () {
  var API = "/apis/api.content.halo.run/v1alpha1/posts";
  var PAGE_SIZE = 20; // 随机取样页大小
  var CACHE_TTL = 10 * 60 * 1000; // 右卡缓存 10 分钟（会话内不反复打接口）
  var COVER_WIDTH = 800; // 与模板里 imageSuffixThWith("800") 对齐
  var FALLBACK_URL = "/archives"; // 随机取数全挂时的兜底去处

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

  /** 主题当前色相（--hue），用于让左卡方块与分类色块跟主题同源 */
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
      if (!obj || !obj.post || !obj.t) return null;
      if (Date.now() - obj.t > CACHE_TTL) return null;
      return obj.post;
    } catch (e) {
      return null;
    }
  }

  function writeCache(source, post) {
    try {
      window.sessionStorage.setItem(
        cacheKey(source),
        JSON.stringify({ t: Date.now(), post: post }),
      );
    } catch (e) {
      /* 禁存储环境：忽略，下次直接再请求 */
    }
  }

  function fetchTop(source) {
    var url = API + "?page=0&size=1&sort=" + (SORT[source] || SORT.recent);
    return fetchJson(url).then(function (data) {
      var items = (data && data.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (isPublic(items[i])) return items[i];
      }
      throw new Error("没有可用的公开文章");
    });
  }

  // ---------- 左卡：随机一篇文章（点击带「转圈」） ----------
  var SPIN_MS = 800; // 与 CSS 的 featured-tiles-spin 时长对齐

  function go(url) {
    var swup = window.swup;
    if (swup && typeof swup.navigate === "function") {
      swup.navigate(url);
    } else {
      window.location.href = url;
    }
  }

  /** 重放旋转动画：先摘类、强制回流、再加类（与 AIOVTUE 同款写法） */
  function spin(btn) {
    btn.classList.remove("is-spinning");
    void btn.offsetWidth;
    btn.classList.add("is-spinning");
  }

  /** 至少在转圈时长之后再动作，保证「转一圈」看得见 */
  function afterSpin(startedAt) {
    var left = Math.max(0, SPIN_MS - (Date.now() - startedAt));
    return new Promise(function (resolve) {
      setTimeout(resolve, left);
    });
  }

  /** 在「全部文章」里均匀随机：先问 total，再随机取一页、页内随机取一篇。 */
  function pickRandom() {
    return fetchJson(API + "?page=0&size=1&sort=" + SORT.recent).then(
      function (data) {
        var total = Number(data && data.total) || 0;
        var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        var page = Math.floor(Math.random() * pages);
        return fetchJson(
          API + "?page=" + page + "&size=" + PAGE_SIZE + "&sort=" + SORT.recent,
        ).then(function (d) {
          var items = ((d && d.items) || []).filter(isPublic);
          if (!items.length) throw new Error("该页没有公开文章");
          return items[Math.floor(Math.random() * items.length)];
        });
      },
    );
  }

  function onRandomClick(btn) {
    // ⚠️ 防重入守卫放**函数入口**：键盘 Enter 也走 click，只看按钮态挡不住
    if (btn.dataset.busy === "1") return;
    btn.dataset.busy = "1";
    btn.setAttribute("aria-busy", "true");

    // 点击 → 那组彩色方块整组转一圈（0.8s）；**转完再跳**，
    // 否则取数只要 100ms、导航会把动画腰斩，用户根本看不到「转圈」。
    var started = Date.now();
    spin(btn);

    pickRandom()
      .then(function (post) {
        return afterSpin(started).then(function () {
          go(post.status.permalink);
        });
      })
      .catch(function (e) {
        console.warn("[featured-cards] 随机文章失败：", e);
        return afterSpin(started).then(function () {
          go(FALLBACK_URL); // 取数不可用时也要“有去处”，别让点击落空
        });
      })
      .then(function () {
        btn.dataset.busy = "";
        btn.removeAttribute("aria-busy");
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

    var postCard = byId("featured-post");
    if (postCard && postCard.dataset.bound !== "1") {
      postCard.dataset.bound = "1";
      paintCategory(postCard); // 服务端兜底那篇的分类也要上色（否则是一块主色默认块）
      var source =
        row.getAttribute("data-source") === "popular" ? "popular" : "recent";
      cfg.badge = labelOf(
        row,
        source === "popular" ? "popular" : "recent",
        source === "popular" ? "Popular" : "Latest",
      );
      var cached = readCache(source);
      if (cached) {
        renderPost(postCard, cached, cfg);
      } else {
        fetchTop(source)
          .then(function (post) {
            writeCache(source, post);
            renderPost(postCard, post, cfg);
          })
          .catch(function (e) {
            // 失败就保留服务端已渲染的那篇（渐进增强），只是不再标记 pending
            console.warn("[featured-cards] 取文章失败，保留服务端兜底：", e);
            postCard.setAttribute("data-state", "fallback");
          });
      }
    }

    var randomBtn = byId("featured-random");
    if (randomBtn && randomBtn.dataset.bound !== "1") {
      randomBtn.dataset.bound = "1";
      randomBtn.addEventListener("click", function () {
        onRandomClick(randomBtn);
      });
      // 转完把类摘掉，让方块回到常态角度（动画是 forwards 停住的）
      // ⚠️ 动画在子元素 .featured-tiles 上，animationend 会冒泡上来，所以要校验 e.target
      randomBtn.addEventListener("animationend", function (e) {
        if (e.target !== randomBtn.querySelector(".featured-tiles")) return;
        randomBtn.classList.remove("is-spinning");
      });
    }
  }

  init();
})();

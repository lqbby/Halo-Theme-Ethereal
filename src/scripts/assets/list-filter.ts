// @ts-nocheck 浏览器运行时脚本（保持经典脚本形态：SwupScriptsPlugin 换页重执行 + window 守卫）
//
// 通用「就地筛选 / 局部 PJAX」——点筛选胶囊只替换列表区，不跳转、不整页重载。
// 用于 /equipments、/photos、/bangumis（这些页面的列表由插件服务端分页，主题改不了
// pageSize ⇒ 无法像 /links 那样纯客户端过滤，只能取「列表区」的新 HTML 原地替换）。
//
// 页面契约（全部由 SSR 输出，脚本不依赖任何页面专属逻辑）：
//   [data-list-region]      被替换的容器（只换它的 innerHTML；本身留在 DOM 里）
//   [data-list-filter] a    筛选胶囊（点它触发局部加载）
//   [data-list-item]        列表项（替换后挂 .list-item-enter 做入场反馈）
//   [data-list-region].is-swapping  拉取中态（样式在 list-filter.css）
//
// 对外事件：替换完成后在 document 上派发 `ethereal:list-swapped`（detail.region）。
//   给页面级脚本一个「region 已是新 DOM」的确定时机 —— 追番页的 bangumi-filter.ts
//   靠它重建卡片索引并重放搜索/排序态。不用 MutationObserver 是因为 observer 会被
//   页面脚本自己渲染的分页 DOM 反复触发，需要额外写过滤条件才不自激。
//
// 1.5.17 提速：region HTML 按 URL 缓存（TTL 5min）+ 悬停/按下预取。
//   追番页的服务端取数很慢（逐页打 B 站接口，~2s），每次点胶囊都等一次体验很差。
//   现在同一 URL 只请求一次，命中的切换是瞬时的；预取与点击靠 ensureRegion()
//   按 URL 去重，共用同一条 fetch ⇒ 不会双请求。
//
// 关键设计：
//  - **筛选胶囊在 region 内部**：激活态（`bg-(--primary)`）完全由服务端按查询参数渲染
//    ⇒ 不需要任何 setActiveTab 的手写状态同步（bangumis 旧实现最易错的一块），
//    bare URL（如 /bangumis 无参数）也能靠服务端默认值正确高亮。
//  - 事件委托挂在 document 上（冒泡阶段）+ guardOnce：region 每次被替换后胶囊是全新
//    DOM，委托依然生效；Swup 换页后同样生效，逻辑只绑一次。
//  - **不写 history**：URL 保持不变（与参考站 /friends 的就地筛选一致）。既避免与
//    Swup 的 popstate/history.state 互相打架，也不需要 popstate 恢复逻辑。
//    portfolio 的 ?tag= 深链仍可用（客户端在初始化时读一次参数）。
//  - 序号（seq）守卫代替 loading 锁：连点多个胶囊时只采纳最后一次结果，且弱网/超时
//    不会把 UI 卡死（bangumis 旧实现用 loading 锁，连点会直接丢弃后续点击）。
//  - 任何一步失败（拉不到 region / HTTP 错 / 超时）→ 整页跳转兜底，行为等价于没装脚本。
//
// 依赖 window 全局（由 app.ts 暴露）：__etherealRefreshPhotosGallery —— 相册页替换
// #photos-gallery 后 PhotoSwipeLightbox 绑的还是旧元素，必须销毁重建（见 content-media.ts）。
import { guardOnce } from "../../utils/once";

(function () {
  if (guardOnce("list-filter")) return;

  var FETCH_TIMEOUT = 10000;
  var seq = 0;

  function currentRegion() {
    return document.querySelector("[data-list-region]");
  }

  function normPath(p) {
    return (p || "").replace(/\/+$/, "");
  }

  // 收集 region 内 `data-list-filter` 下所有 href 与 target 相同的胶囊，
  // 用于「按同 href 的第 n 个」精确回位焦点（bangumis 里 type=追番 与 status=全部
  // 的 href 完全相同，只按 href 匹配会把焦点还给同排第一个）。
  function sameHrefLinks(scope, href) {
    var out = [];
    var links = scope.querySelectorAll("[data-list-filter] a[href]");
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute("href") === href) out.push(links[i]);
    }
    return out;
  }

  function stripEntryAnimation(root) {
    var nodes = root.querySelectorAll(".onload-animation");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.remove("onload-animation");
      nodes[i].style.removeProperty("animation-delay");
    }
  }

  function playEnter(root) {
    var items = root.querySelectorAll("[data-list-item]");
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      el.classList.remove("list-item-enter");
      void el.offsetWidth; // 强制回流：重新加类时动画从头重播
      el.classList.add("list-item-enter");
    }
  }

  function focusBack(root, href, nth) {
    if (!href) return;
    var list = sameHrefLinks(root, href);
    if (!list.length) return;
    var target = list[nth >= 0 && nth < list.length ? nth : 0];
    try {
      target.focus({ preventScroll: true });
    } catch (e) {
      try {
        target.focus();
      } catch (e2) {
        /* 忽略 */
      }
    }
  }

  /* ── region HTML 缓存 + 预取（1.5.17） ────────────────────────────────
     痛点：追番页取全量时服务端要逐页打 B 站接口（~2s），每次点胶囊都得干等。
     做法：
       - ensureRegion(url) 按 URL 去重：同一 URL 的「预取」与「点击」共用同一条
         fetch promise ⇒ 不会双请求、不会双倍服务端渲染；成功后写进 cache。
       - 指针在胶囊上停住 ~180ms、或按下时，预取该 URL；点击时多半已命中缓存。
       - 缓存命中直接换 DOM，**不加 .is-swapping** ⇒ 切换瞬时完成。
     键用整条 URL：region 的 HTML 完全由查询参数（如 typeNum/status）决定，安全。
     TTL 5min：B 站数据变动慢，同时避免长时间停留后再看已是陈旧视图。 */

  var CACHE_TTL = 5 * 60 * 1000;
  var cache = {}; // url -> { html: string, t: number }
  var pending = {}; // url -> Promise<string>

  function cacheGet(url) {
    var entry = cache[url];
    if (!entry) return null;
    if (Date.now() - entry.t > CACHE_TTL) {
      delete cache[url];
      return null;
    }
    return entry.html;
  }

  function cacheSet(url, html) {
    cache[url] = { html: html, t: Date.now() };
  }

  // 同一 URL 只发一次请求（预取与点击复用同一条 promise）
  function ensureRegion(url) {
    if (pending[url]) return pending[url];

    var controller =
      typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, FETCH_TIMEOUT);

    var promise = fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller ? controller.signal : undefined,
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (html) {
        cacheSet(url, html);
        return html;
      });

    function done() {
      clearTimeout(timer);
      delete pending[url];
    }
    promise.then(done, done);

    pending[url] = promise;
    return promise;
  }

  // 把「整页 HTML」里的 region 内替换进当前 region（缓存与网络两条路共用）
  function applyHtml(html, url, href, nth) {
    var region = currentRegion();
    if (!region) {
      window.location.href = url;
      return;
    }
    var doc = new DOMParser().parseFromString(html, "text/html");
    var incoming = doc.querySelector("[data-list-region]");
    if (!incoming) {
      window.location.href = url;
      return;
    }
    stripEntryAnimation(incoming);

    // 相册页：PhotoSwipe 绑的是被替换掉的旧 #photos-gallery，需重建灯箱
    // （换组后 0 张图时 incoming 里可能没有 gallery，此时也必须销毁旧实例）
    var touchesGallery =
      !!region.querySelector("#photos-gallery") ||
      !!incoming.querySelector("#photos-gallery");
    region.innerHTML = incoming.innerHTML;
    if (touchesGallery) {
      var refresh = window.__etherealRefreshPhotosGallery;
      if (typeof refresh === "function") refresh();
    }

    focusBack(region, href, nth);
    playEnter(region);

    // region 已换新 DOM：派发通知，让页面的客户端脚本重建索引
    // （追番页的 bangumi-filter.js 靠它重放搜索/排序态；其余页面无监听者，零成本）
    document.dispatchEvent(
      new CustomEvent("ethereal:list-swapped", {
        detail: { region: region },
      }),
    );
  }

  function load(url, href, nth) {
    var region = currentRegion();
    if (!region) {
      window.location.href = url;
      return;
    }

    // 缓存命中：瞬时切换（无请求、无 loading 态）
    var cached = cacheGet(url);
    if (cached != null) {
      applyHtml(cached, url, href, nth);
      return;
    }

    // 序号（seq）守卫代替 loading 锁：连点多个胶囊时只采纳最后一次结果，且弱网/超时
    // 不会把 UI 卡死（旧实现用 loading 锁，连点会直接丢弃后续点击）。
    var mySeq = ++seq;
    // 拉取期间给 region 一个「加载中」态：追番页取全量时服务端要逐页打 B 站接口，
    // 可能 1~3s，没有反馈点击就像没生效（equipments/photos 很快，闪一下就过去）。
    region.classList.add("is-swapping");

    function settle() {
      region.classList.remove("is-swapping");
    }

    function bail() {
      settle();
      if (mySeq === seq) window.location.href = url;
    }

    // 任何一步失败（拉不到 region / HTTP 错 / 超时）→ 整页跳转兜底，
    // 行为等价于没装脚本。
    ensureRegion(url)
      .then(function (html) {
        if (mySeq !== seq) return; // 已被更新的请求取代：loading 态交给后者收尾
        settle();
        applyHtml(html, url, href, nth);
      })
      .catch(function () {
        bail();
      });
  }

  document.addEventListener("click", function (e) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;

    var target = e.target;
    if (!target || !target.closest) return;
    var link = target.closest("[data-list-filter] a[href]");
    if (!link) return;

    if (link.hasAttribute("download")) return;
    if (link.target && link.target !== "_self") return;

    var raw = link.getAttribute("href") || "";
    if (!raw || raw.charAt(0) === "#") return;
    if (/^(mailto:|tel:|javascript:)/i.test(raw)) return;

    var region = currentRegion();
    if (!region) return;
    // 本页没有可替换区域（例如 region 不在当前页）→ 交给浏览器整页跳转
    if (!document.body.contains(region)) return;

    e.preventDefault();

    var nth = -1;
    var same = sameHrefLinks(region, raw);
    for (var i = 0; i < same.length; i++) {
      if (same[i] === link) {
        nth = i;
        break;
      }
    }
    load(link.href, raw, nth);
  });

  /* ── 预取：指针停在胶囊上 / 按下时，提前把该 URL 的 region 拉进缓存 ────── */

  function linkUrlFrom(target) {
    if (!target || !target.closest) return null;
    var link = target.closest("[data-list-filter] a[href]");
    if (!link) return null;
    if (link.hasAttribute("download")) return null;
    if (link.target && link.target !== "_self") return null;
    var raw = link.getAttribute("href") || "";
    if (!raw || raw.charAt(0) === "#") return null;
    if (/^(mailto:|tel:|javascript:)/i.test(raw)) return null;
    return link.href;
  }

  function prefetch(url) {
    if (!url || cacheGet(url) != null || pending[url]) return;
    if (!currentRegion()) return; // 本页没有可替换区域时不预取
    ensureRegion(url).catch(function () {
      /* 预取失败静默：用户真点时会走 load 的整页跳转兜底 */
    });
  }

  var hoverTimer = null;
  // pointerover 会冒泡且在一次悬停内反复触发 ⇒ 每次重置计时器，指针「停住」约 180ms
  // 才真正预取；快速划过的胶囊不产生任何请求。
  document.addEventListener(
    "pointerover",
    function (e) {
      clearTimeout(hoverTimer);
      var url = linkUrlFrom(e.target);
      if (!url) return;
      hoverTimer = setTimeout(function () {
        prefetch(url);
      }, 180);
    },
    false,
  );
  document.addEventListener(
    "pointerout",
    function (e) {
      if (linkUrlFrom(e.target)) clearTimeout(hoverTimer);
    },
    false,
  );
  // 按下即预取（捕获阶段，早于 click）：随后 click 触发 load 时会复用这条 promise
  // （ensureRegion 按 URL 去重）⇒ 把等待时间提前到「按下→抬起」之间，移动端尤其明显。
  document.addEventListener(
    "pointerdown",
    function (e) {
      var url = linkUrlFrom(e.target);
      if (url) prefetch(url);
    },
    true,
  );

  // 换页后丢弃可能仍在途的请求结果（新页面有自己的 SSR 初始态，旧结果不得回写）。
  // 进入本页/其他页都无需额外恢复：region 是 SSR 渲染的，激活态也由服务端算好。
  document.addEventListener("astro:after-swap", function () {
    seq++;
  });
})();

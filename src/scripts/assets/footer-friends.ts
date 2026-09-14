// 页脚友情链接「随机」渲染（2026-09-14）。
//
// 数据链路：GET /apis/api.recent-comments.halo.run/v1alpha1/friends/random?size=N
//   —— 「Ethereal 配套」插件在**服务端**随机挑 N 条友链下发（见插件
//   EtherealFriendsRandomEndpoint）。服务端模板只输出空容器 + 总数，
//   条目全部由本脚本填入 ⇒ ① 每次进页/换页换一批；② 页脚体积与友链总数无关。
//
// 🔴🔴 必须幂等：@swup/scripts-plugin 默认开启（reloadScripts=true），它在每次
//   content:replace 时会 `document.querySelectorAll("script:not([data-swup-ignore-script])")`
//   把**整个 document 的 <script> 全部重建并重新执行**（不是只换容器内的）。
//   所以：
//     · 不能用 `if (window.__x) return` 这类一次性守卫 —— 那样换页后**新的**页脚
//       容器会永远空着（桌面版页脚位于 #swup-container 内，每次换页都是新节点）；
//     · 用 [data-hbf-loaded] 标记**已处理的容器**，每次执行只处理未标记的。
//
// 🔴 一页里有**两份**页脚：桌面版（#swup-container 内，lg 显示）+ 移动版（容器外，
//   lg 隐藏），两份都渲染 FooterFriendLinks。故先给全部容器打标、只发一次请求，
//   再把同一批结果填进每一份 —— 避免两次请求 / 两份内容不一致。
//
// 随机性来自**服务端洗牌**，因此请求必须带 `?_=<时间戳>` 绕过 CDN 边缘缓存
//   （否则同一 URL 不同访客会命中同一份缓存响应，就「不随机」了）。
(function () {
  "use strict";

  var ABS_URL = /^(https?:)?\/\//;

  // 只接受 http(s):// 或 // 或 / 开头的地址（与模板侧同口径），其余视为无效 ⇒ 不赋 href
  function safeUrl(value) {
    if (typeof value !== "string" || value.length === 0) return null;
    if (ABS_URL.test(value) || value.charAt(0) === "/") return value;
    return null;
  }

  // 单条胶囊：全程 DOM API + textContent（友链名称/描述属站外可控文本，
  // 字符串拼 innerHTML 会引入 XSS 面）。
  function buildItem(item) {
    var a = document.createElement("a");
    a.className = "hbf-item";

    var url = safeUrl(item.url);
    if (url) a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = item.description || item.displayName || "";

    var logo = safeUrl(item.logo);
    if (logo) {
      var img = document.createElement("img");
      img.className = "hbf-logo";
      img.src = logo;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      a.appendChild(img);
    } else {
      var ph = document.createElement("span");
      ph.className = "hbf-logo-ph";
      var ico = document.createElement("span");
      // 图标类名必须是**完整字面量**（运行时拼接的 Tailwind 类不会被扫描到）
      ico.className = "icon-[material-symbols--link-rounded] text-xs";
      ico.setAttribute("aria-hidden", "true");
      ph.appendChild(ico);
      a.appendChild(ph);
    }

    var name = document.createElement("span");
    name.className = "hbf-name";
    name.textContent = item.displayName || item.url || "";
    a.appendChild(name);
    return a;
  }

  // 把 items 填进一个 .hbf-list 容器。容器内可能有：
  //   · 上一批的条目（换页重执行时）—— 先删掉，防重复叠加；
  //   · SSR 直出的「更多」箭头 [data-hbf-more] —— 必须保留（它是 .hbf-list 的
  //     最后一个 flex 子项，靠 DOM 顺序「并入胶囊行」，删了排版就散）。
  function fill(box, items) {
    var stale = box.querySelectorAll(".hbf-item");
    Array.prototype.slice.call(stale).forEach(function (el) {
      el.remove();
    });

    var more = box.querySelector("[data-hbf-more]");
    var frag = document.createDocumentFragment();
    items.forEach(function (item) {
      frag.appendChild(buildItem(item));
    });
    // 插到「更多」箭头之前；more 为 null 时等价 appendChild（把本批追加到末尾）
    box.insertBefore(frag, more);
  }

  function init() {
    var boxes = Array.prototype.slice.call(
      document.querySelectorAll("[data-hbf-endpoint]:not([data-hbf-loaded])"),
    );
    if (boxes.length === 0) return;

    // 先全部打标：保证两份页脚只发一次请求，也防同一次换页里脚本被多次执行
    boxes.forEach(function (box) {
      box.setAttribute("data-hbf-loaded", "true");
    });

    var endpoint = boxes[0].getAttribute("data-hbf-endpoint");
    if (!endpoint) return;
    var size = parseInt(boxes[0].getAttribute("data-hbf-size") || "0", 10);

    var url =
      endpoint +
      (endpoint.indexOf("?") < 0 ? "?" : "&") +
      (size > 0 ? "size=" + size + "&" : "") +
      "_=" +
      Date.now();

    fetch(url, { credentials: "same-origin" })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        var items = (data && data.items) || [];
        if (items.length === 0) return;
        boxes.forEach(function (box) {
          fill(box, items);
        });
      })
      .catch(function () {
        /* 静默失败：容器留空，头部「申请友链」按钮与 <noscript> 的 /links 入口仍在 */
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

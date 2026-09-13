// @ts-nocheck —— 与 timeline.js 同款：配合模板里 th:data-* 多行字段在客户端渲染。
// 用于「关于我」与「博客更新日志」两个自定义页面：模板把多行文本写进 data-lines，
// 这里按行拆分后生成 chips / paragraphs / entries / tags / stackTags /
// projTech / stubRows。
//
// 为什么要客户端渲染：settings.yaml 里这些字段是 textarea（每行一条），
// 而 Thymeleaf 侧没有顺手的分行迭代；timeline.js 已确立同一做法。
//
// 「关于我」页的「保持联系」「页脚链接」已改为结构化设置 / 直接读侧栏社交，
// 由模板服务端渲染，不再经过本文件。
//
// Swup 换页由 SwupScriptsPlugin 重执行（DOM 已替换），data-rendered 守卫仅防重复。
(function () {
  function splitLines(raw) {
    if (!raw) return [];
    return String(raw)
      .split(/\r?\n/)
      .map(function (s) {
        return s.trim();
      })
      .filter(function (s) {
        return s.length > 0;
      });
  }

  // "名称|链接" → {label, href}；无竖线时视为纯文本
  function splitPair(line) {
    var i = line.indexOf("|");
    if (i < 0) return { label: line, href: "" };
    return {
      label: line.slice(0, i).trim(),
      href: line.slice(i + 1).trim(),
    };
  }

  var CLS_CHIP =
    "rounded-md bg-(--btn-regular-bg) px-2 py-1 text-xs font-bold text-(--btn-content)";
  // 「博客更新日志」页的标签胶囊（圆角全包），与「关于我」的 .about-chip 不同
  var CLS_TAG =
    "rounded-full border border-(--line-color) px-2.5 py-1 text-xs text-75 transition-colors hover:border-(--primary) hover:text-(--primary)";
  // 「服务器状态」四行的图标 = 参考站同一组，按数据源字段固定；
  // 必须是**完整字面量**类名，候选集已由 global.css 的 @source inline 登记。
  var STUB_ICONS = {
    cpu: "icon-[material-symbols--memory-rounded]",
    mem: "icon-[material-symbols--memory-alt-rounded]",
    memory: "icon-[material-symbols--memory-alt-rounded]",
    disk: "icon-[material-symbols--database]",
    system: "icon-[material-symbols--dns]",
    // 1.4.94 扩展：自托管常见的几类指标。数据源 items[].key 写这些名字即自动配图标，
    // 不写也能用（会落到默认图标）。⚠️ 新增图标名必须同步登记到 global.css 的 @source inline，
    // 否则 Tailwind 扫不到、图标不渲染且不报错。
    net: "icon-[material-symbols--swap-vert-rounded]",
    network: "icon-[material-symbols--swap-vert-rounded]",
    load: "icon-[material-symbols--speed-rounded]",
    temp: "icon-[material-symbols--device-thermostat]",
    swap: "icon-[material-symbols--swap-horiz-rounded]",
    uptime: "icon-[material-symbols--schedule-rounded]",
  };
  // 行内没写「名称|key」时按行序兜底
  var STUB_ORDER = ["cpu", "mem", "disk", "system"];
  var STUB_ICON_DEFAULT = "icon-[material-symbols--memory-rounded]";

  function render(el) {
    var kind = el.getAttribute("data-lines-render") || "chips";
    var lines = splitLines(el.getAttribute("data-lines"));
    if (lines.length === 0) {
      // 容器里可能已经有服务端渲染的静态子节点（例如「更新摘要」的版本号胶囊），
      // 这种情况只跳过追加，不能整块摘掉。
      if (!el.childNodes.length) el.remove();
      return;
    }

    var frag = document.createDocumentFragment();

    if (kind === "paragraphs") {
      // 版式由 .about-paragraphs > p 接管（max-width:72ch / .92rem / line-height:1.9）
      lines.forEach(function (line) {
        var p = document.createElement("p");
        p.textContent = line;
        frag.appendChild(p);
      });
    } else if (kind === "entries") {
      lines.forEach(function (line, i) {
        var pair = splitPair(line);
        var li = document.createElement("li");
        li.className =
          "flex items-start gap-3 rounded-lg bg-(--btn-regular-bg)/40 px-3 py-2.5";

        var num = document.createElement("span");
        num.className =
          "mt-0.5 shrink-0 font-mono text-xs font-bold text-(--primary)";
        num.textContent = ("0" + (i + 1)).slice(-2);

        var body = document.createElement("div");
        body.className = "min-w-0";

        if (pair.href && line.indexOf("|") >= 0) {
          var label = document.createElement("span");
          label.className = "mr-2 text-xs font-bold text-(--primary)";
          label.textContent = pair.label;
          body.appendChild(label);
          var txt = document.createElement("span");
          txt.className = "text-sm leading-relaxed text-75";
          txt.textContent = pair.href;
          body.appendChild(txt);
        } else {
          var only = document.createElement("span");
          only.className = "text-sm leading-relaxed text-75";
          only.textContent = pair.label;
          body.appendChild(only);
        }

        li.appendChild(num);
        li.appendChild(body);
        frag.appendChild(li);
      });
    } else if (kind === "tags") {
      // 「博客更新日志」页专用（圆角全包胶囊）
      lines.forEach(function (line) {
        var span = document.createElement("span");
        span.className = CLS_TAG;
        span.textContent = line;
        frag.appendChild(span);
      });
    } else if (kind === "stackTags") {
      // 「关于我 → 技术轨迹」= 参考站 .stack-list span（青色系胶囊，
      // 样式见 about.astro 的 .about-tag-chip）
      lines.forEach(function (line) {
        var span = document.createElement("span");
        span.className = "about-tag-chip";
        span.textContent = line;
        frag.appendChild(span);
      });
    } else if (kind === "projTech") {
      // 项目卡底部的技术标签：样式由 .about-proj__tech i 接管
      lines.forEach(function (line) {
        var i = document.createElement("i");
        i.textContent = line;
        frag.appendChild(i);
      });
    } else if (kind === "stubRows") {
      // 「服务器状态」指标行 = 参考站 .server-stat：
      //   图标方块 | (粗体指标名 + 小字明细) | 数值   ＋   下一行通栏进度条
      // 每行写「名称|key」，key ∈ cpu / mem / disk / system；key 决定图标。
      // system 行不渲染进度条（参考站靠 [data-server-stat=system] 隐藏）。
      // 未配置数据源时数值显示 —、进度条 0%，保持诚实占位。
      lines.forEach(function (line, i) {
        var sep = line.indexOf("|");
        var label = sep >= 0 ? line.slice(0, sep).trim() : line;
        var key =
          (sep >= 0 ? line.slice(sep + 1).trim() : "") || STUB_ORDER[i] || "";

        var row = document.createElement("div");
        row.className = "about-stub-row";
        row.setAttribute("data-stub-key", key);

        var icon = document.createElement("span");
        icon.className = "about-stub-icon";
        var glyph = document.createElement("span");
        glyph.setAttribute("class", STUB_ICONS[key] || STUB_ICON_DEFAULT);
        glyph.setAttribute("aria-hidden", "true");
        icon.appendChild(glyph);

        var copy = document.createElement("span");
        copy.className = "about-stub-copy";
        var strong = document.createElement("strong");
        strong.textContent = label;
        var small = document.createElement("small");
        copy.appendChild(strong);
        copy.appendChild(small);

        var val = document.createElement("span");
        val.className = "about-stub-val";
        val.textContent = "\u2014";

        var bar = document.createElement("span");
        bar.className = "about-stub-bar";
        bar.setAttribute("aria-hidden", "true");
        var fill = document.createElement("i");
        bar.appendChild(fill);

        row.appendChild(icon);
        row.appendChild(copy);
        row.appendChild(val);
        row.appendChild(bar);
        frag.appendChild(row);
      });
    } else {
      // chips：「更新摘要」条目底部的动作标签 = 参考站 .project-card__tags em
      lines.forEach(function (line) {
        var span = document.createElement("span");
        span.className = "about-chip";
        span.textContent = line;
        frag.appendChild(span);
      });
    }

    el.appendChild(frag);
    if (kind === "stubRows") applyServerStatus(el);
  }

  // ============ 服务器状态：拉取只读 JSON 并回填 ============
  // 数据源来自主题设置「服务器状态 → 数据源地址」；为空则完全不发请求，保持占位。
  // ⚠️ 必须带 cache-buster（?t=时间戳）：EdgeOne 的缓存键忽略 Vary: Origin，
  //    缓存命中那一份响应里**没有** Access-Control-Allow-Origin，浏览器会直接
  //    拒读；带唯一查询串强制 MISS 回源才能拿到 CORS 头。
  //
  // 1.4.94 起改为「自适应轮询」（原为固定 setInterval 60s）：
  //   ① 标签页在后台时**不发请求**（回到前台立刻补一次并复位退避）——
  //      监控卡片挂在 about 页，用户常开着标签页不动，省下的是 NAS 上那份 cron 产物的无效拉取；
  //   ② 连续失败按 60s → 120s → 300s 退避，成功立即复位，数据源长期挂掉时不再每分钟空打。
  var SERVER_INTERVAL = 60000;
  var SERVER_BACKOFF = [60000, 120000, 300000];
  var SERVER_STALE_MS = 10 * 60 * 1000;

  /** 数据源的 updated（unix 秒或毫秒）→ 相对时间文案；不可用返回空串 */
  function relativeTime(ts) {
    var ms = toMs(ts);
    if (ms === null) return "";
    var diff = Date.now() - ms;
    if (diff < 0) diff = 0;
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
    if (diff < 86400000) return Math.floor(diff / 3600000) + " 小时前";
    return Math.floor(diff / 86400000) + " 天前";
  }

  /** unix 秒/毫秒 → 毫秒时间戳；非法值返回 null */
  function toMs(ts) {
    var n = Number(ts);
    if (!isFinite(n) || n <= 0) return null;
    return n < 1e12 ? n * 1000 : n;
  }

  function applyServerStatus(el) {
    var url = (el.getAttribute("data-server-url") || "").trim();
    if (!url) return;

    var section = el.closest("section") || el.parentNode;
    var timer = null;
    var failures = 0;

    function stop() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      document.removeEventListener("visibilitychange", onVisible);
    }

    function schedule(delay) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, delay);
    }

    function onVisible() {
      // 回到前台立刻补一次（并复位退避），避免一直看着旧数据
      if (!document.hidden) {
        failures = 0;
        load();
      }
    }

    function load() {
      // Swup 换页后旧节点会被摘下 -> 顺手停掉定时器
      if (!document.contains(el)) {
        stop();
        return;
      }
      // 后台标签页不请求
      if (document.hidden) {
        schedule(SERVER_INTERVAL);
        return;
      }
      var bust = (url.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now();
      fetch(url + bust, { credentials: "omit", cache: "no-store" })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (data) {
          failures = 0;
          paintServerStatus(el, section, data);
          schedule(SERVER_INTERVAL);
        })
        .catch(function () {
          markServerOffline(el, section);
          failures += 1;
          schedule(
            SERVER_BACKOFF[Math.min(failures, SERVER_BACKOFF.length - 1)],
          );
        });
    }

    // 同一个容器重复初始化（Swup 换页重跑 render）时先卸掉上一轮的定时器与监听
    if (el.__serverStop) el.__serverStop();
    el.__serverStop = stop;
    document.addEventListener("visibilitychange", onVisible);
    load();
  }

  // 行与数据项的对应：行内写了 "名称|key" 就按 key 找，否则按顺序取第 i 项
  function findServerItem(items, key, index) {
    if (!items || !items.length) return null;
    if (key) {
      for (var i = 0; i < items.length; i++) {
        if (items[i] && items[i].key === key) return items[i];
      }
      return null;
    }
    return items[index] || null;
  }

  function paintServerStatus(el, section, data) {
    var items = (data && data.items) || [];
    var lines = splitLines(el.getAttribute("data-lines"));
    var rows = el.querySelectorAll(".about-stub-row");

    Array.prototype.slice.call(rows).forEach(function (row, i) {
      var raw = lines[i] || "";
      var sep = raw.indexOf("|");
      var key = sep >= 0 ? raw.slice(sep + 1).trim() : "";
      var item = findServerItem(
        items,
        key || row.getAttribute("data-stub-key"),
        i,
      );
      if (!item) return;

      var pct = parseFloat(item.percent);
      if (isNaN(pct)) pct = 0;
      if (pct < 0) pct = 0;
      if (pct > 100) pct = 100;

      var fill = row.querySelector(".about-stub-bar > i");
      var val = row.querySelector(".about-stub-val");
      var strong = row.querySelector(".about-stub-copy strong");
      var small = row.querySelector(".about-stub-copy small");

      // 进度条用 --meter-scale 驱动（参考站 .server-stat__meter>span 同款），
      // 不动 width，交给 CSS 里的 transform:scaleX + transition 做动画
      if (fill) fill.style.setProperty("--meter-scale", String(pct / 100));
      if (val) val.textContent = item.text || pct + "%";
      if (strong && !strong.textContent) strong.textContent = item.label || "";
      // 明细写在指标名下方；为空时由 CSS 的 small:empty 收掉高度
      if (small) small.textContent = item.detail || "";

      // 1.4.94：高负载分级 —— ≥95% 危险 / ≥85% 警告，CSS 按 data-level 把数值与进度条
      // 一起转琥珀/红。避免"存储 96% 快满了"和"CPU 12%"长得一模一样。
      var level = pct >= 95 ? "danger" : pct >= 85 ? "warn" : "";
      if (level) row.setAttribute("data-level", level);
      else row.removeAttribute("data-level");
    });

    // 状态标签：用户留空时补一个；有真实数据就切成「在线」态
    var chip = section.querySelector(".about-stub-chip");
    if (!chip) {
      chip = document.createElement("span");
      chip.className = "about-stub-chip";
      var head = section.querySelector(".about-card-head");
      if (head) head.appendChild(chip);
    }
    // 1.4.94：数据源自报 online:false（HTTP 通了但服务离线）时也走离线态，
    // 文案优先用数据源的 status，其次「离线」。
    if (chip && data && data.online === false) {
      chip.textContent = data.status || "离线";
      chip.classList.remove("about-stub-chip--live");
      chip.setAttribute("data-state", "offline");
    } else if (chip && data && data.status) {
      chip.textContent = data.status;
      chip.classList.add("about-stub-chip--live");
      chip.removeAttribute("data-state");
    }

    // 脚注：更新于 / 运行时长
    // 1.4.94：优先用数据源的 updated（unix 秒/毫秒）算**相对时间**（刚刚 / N 分钟前），
    // 绝对时间挂到 title 上；超过 10 分钟没更新则标 data-stale（CSS 转琥珀），
    // 让"数据卡住了"和"数据正常"一眼可分。
    var foot = section.querySelector("[data-server-foot]");
    if (foot && data) {
      var bits = [];
      var rel = relativeTime(data.updated);
      if (rel) bits.push("更新于 " + rel);
      else if (data.updatedText) bits.push("更新于 " + data.updatedText);
      if (data.uptimeDays) bits.push("已运行 " + data.uptimeDays + " 天");
      if (bits.length) {
        foot.textContent = bits.join(" · ");
        foot.removeAttribute("hidden");
      }
      if (data.updatedText) foot.setAttribute("title", data.updatedText);
      var ms = toMs(data.updated);
      if (ms !== null && Date.now() - ms > SERVER_STALE_MS) {
        foot.setAttribute("data-stale", "1");
      } else {
        foot.removeAttribute("data-stale");
      }
    }
    el.setAttribute("data-server-state", "live");
  }

  function markServerOffline(el, section) {
    var chip = section.querySelector(".about-stub-chip");
    if (chip) {
      chip.textContent = "离线";
      chip.classList.remove("about-stub-chip--live");
      chip.setAttribute("data-state", "offline");
    }
    var foot = section.querySelector("[data-server-foot]");
    if (foot) {
      foot.textContent = "数据源暂时取不到，稍后自动重试";
      foot.removeAttribute("hidden");
      foot.removeAttribute("data-stale");
      foot.removeAttribute("title");
    }
    el.setAttribute("data-server-state", "offline");
  }

  // 「我的朋友」：友链由**配套插件端点**（/apis/api.recent-comments.halo.run/.../friends/random）
  // 在服务端随机挑 N 条返回，这里只负责渲染成卡片。
  //
  // 2026-09-13（1.4.88）改造动机：原先由 Thymeleaf 把**全部**友链写进 HTML、前端再洗牌截前 N。
  // 友链上百条时 HTML 会随数量线性膨胀（每卡约 650B，且浏览器要解析再删掉 99% 的节点）；
  // 改为服务端随机 + 按需下发后，**页面体积与友链总数无关**，随机性也不受 CDN 缓存影响
  // （请求带 ?_=<时间戳> 绕开边缘缓存）。
  //
  // 代价：无 JS 时不再有卡片（about.astro 用 <noscript> 提供通往 /links 的入口兜底）。
  // Swup 换页后容器是新节点，本函数会自动重新拉取一批；data-friends-loaded 守卫防重复执行。
  function loadRandomFriends() {
    var box = document.querySelector(
      ".about-friends[data-friends-endpoint]:not([data-friends-loaded])",
    );
    if (!box) return;
    box.setAttribute("data-friends-loaded", "true");

    var endpoint = box.getAttribute("data-friends-endpoint");
    if (!endpoint) return;
    var n = parseInt(box.getAttribute("data-friends-count") || "6", 10);
    if (!n || n < 0) n = 6;

    // ?_=<时间戳> 强制绕过 CDN 边缘缓存 —— 否则不同访客会命中同一份缓存响应，
    // 「每次进页都换一批」就失效了（服务端已随机，前端不再洗牌）。
    var url =
      endpoint +
      (endpoint.indexOf("?") < 0 ? "?" : "&") +
      "size=" +
      n +
      "&_=" +
      Date.now();

    fetch(url, { credentials: "same-origin" })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        var items = data && data.items;
        if (!items || !items.length) return;
        var frag = document.createDocumentFragment();
        items.forEach(function (item) {
          frag.appendChild(buildFriendCard(item));
        });
        box.textContent = "";
        box.appendChild(frag);
      })
      .catch(function () {
        /* 静默失败：容器保持为空，noscript 里的 /links 入口仍在 */
      });
  }

  // 单条友链卡片。刻意全程用 DOM API + textContent（而非拼 innerHTML）：
  // 友链的名称/描述是站外可控文本，字符串拼接会引入 XSS 面。
  function buildFriendCard(item) {
    var a = document.createElement("a");
    a.className = "about-friend";
    var url = item.url || "";
    if (/^(https?:)?\/\//.test(url) || url.charAt(0) === "/") a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = item.description || item.displayName || "";

    var logo = item.logo || "";
    if (/^(https?:)?\/\//.test(logo) || logo.charAt(0) === "/") {
      var img = document.createElement("img");
      img.className = "about-friend-logo";
      img.src = logo;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      a.appendChild(img);
    } else {
      var ph = document.createElement("span");
      ph.className = "about-friend-logo-ph";
      var ico = document.createElement("span");
      ico.className = "icon-[material-symbols--link-rounded]";
      ico.setAttribute("aria-hidden", "true");
      ph.appendChild(ico);
      a.appendChild(ph);
    }

    var body = document.createElement("span");
    body.className = "about-friend-body";
    var name = document.createElement("span");
    name.className = "about-friend-name";
    name.textContent = item.displayName || item.url || "";
    body.appendChild(name);
    if (item.description) {
      var desc = document.createElement("span");
      desc.className = "about-friend-desc";
      desc.textContent = item.description;
      body.appendChild(desc);
    }
    a.appendChild(body);
    return a;
  }

  // 「最近的提交」= 最新文章 + 最新瞬间两组由服务端直出的行，这里按 data-time
  // 归并成一条时间线。时间戳都是 ISO-8601（同为 UTC 口径），取前 19 位（精确到秒）
  // 做**字典序**比较即等价于时间序 —— 既避开 Date.parse 对「9 位小数秒」的兼容性坑，
  // 也不用先解析。无 JS 时行照样完整可见（只是按「文章在前、瞬间在后」两组排），
  // 属于渐进增强；Swup 换页由 init 重新触发（data-sorted 守卫防重复）。
  function sortTimeline() {
    var box = document.querySelector(
      "[data-activity-timeline]:not([data-sorted])",
    );
    if (!box) return;
    box.setAttribute("data-sorted", "true");

    var rows = Array.prototype.slice.call(box.children);
    if (rows.length < 2) return;
    rows.sort(function (a, b) {
      var ka = String(a.getAttribute("data-time") || "").slice(0, 19);
      var kb = String(b.getAttribute("data-time") || "").slice(0, 19);
      if (ka === kb) return 0;
      return ka < kb ? 1 : -1;
    });
    rows.forEach(function (el) {
      box.appendChild(el);
    });
  }

  function init() {
    var nodes = document.querySelectorAll("[data-lines]:not([data-rendered])");
    Array.prototype.slice.call(nodes).forEach(function (el) {
      el.setAttribute("data-rendered", "true");
      render(el);
    });
    loadRandomFriends();
    sortTimeline();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // 暴露重排入口，供 Swup 换页后调用（幂等）
  window.__extendPagesRender = init;
})();

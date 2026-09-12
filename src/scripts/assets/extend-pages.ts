// @ts-nocheck —— 与 timeline.js 同款：配合模板里 th:data-* 多行字段在客户端渲染。
// 用于「关于我」与「博客更新日志」两个自定义页面：模板把多行文本写进 data-lines，
// 这里按行拆分后生成 chips / links / paragraphs / entries / tags。
//
// 为什么要客户端渲染：settings.yaml 里这些字段是 textarea（每行一条），
// 而 Thymeleaf 侧没有顺手的分行迭代；timeline.js 已确立同一做法。
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
  var CLS_TAG =
    "rounded-full border border-(--line-color) px-2.5 py-1 text-xs text-75 transition-colors hover:border-(--primary) hover:text-(--primary)";
  var CLS_LINK =
    "rounded-md bg-(--btn-regular-bg) px-3 py-1.5 text-sm font-bold text-(--btn-content) transition-colors hover:bg-(--btn-regular-bg-hover) hover:text-(--primary)";

  function render(el) {
    var kind = el.getAttribute("data-lines-render") || "chips";
    var lines = splitLines(el.getAttribute("data-lines"));
    if (lines.length === 0) {
      el.remove();
      return;
    }

    var frag = document.createDocumentFragment();

    if (kind === "paragraphs") {
      lines.forEach(function (line) {
        var p = document.createElement("p");
        p.className = "mb-3 text-sm leading-relaxed text-75 last:mb-0";
        p.textContent = line;
        frag.appendChild(p);
      });
    } else if (kind === "links") {
      lines.forEach(function (line) {
        var pair = splitPair(line);
        var a = document.createElement("a");
        a.className = CLS_LINK;
        a.textContent = pair.label;
        if (pair.href) {
          a.href = pair.href;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
        frag.appendChild(a);
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
      lines.forEach(function (line) {
        var span = document.createElement("span");
        span.className = CLS_TAG;
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
    } else if (kind === "contacts") {
      // 「保持联系」社交入口：名称|链接|图标类名
      // 图标第三段写的是**完整** iconify 类名（如 icon-[mdi--github]），
      // 候选类名已写在 settings.yaml 帮助文本里 -> Tailwind 会扫到并生成，
      // 因此这里直接透传类名即可（不要在本文件里拼接类名，那样扫不到）。
      lines.forEach(function (line) {
        var parts = line.split("|");
        var name = (parts[0] || "").trim();
        var href = (parts[1] || "").trim();
        var icon = (parts[2] || "").trim();
        if (!name) return;

        var a = document.createElement("a");
        a.className = "about-contact";
        a.title = name;
        if (href) {
          a.href = href;
          if (href.indexOf("mailto:") !== 0) {
            a.target = "_blank";
            a.rel = "noopener noreferrer";
          }
        }
        if (icon) {
          var ic = document.createElement("span");
          ic.className = "about-contact-icon " + icon;
          a.appendChild(ic);
        }
        var nm = document.createElement("span");
        nm.className = "about-contact-name";
        nm.textContent = name;
        a.appendChild(nm);
        frag.appendChild(a);
      });
    } else if (kind === "stubRows") {
      // 「服务器状态」指标行：每行一个指标名（可写 "名称|key" 指定数据字段），
      // 未配置数据源时进度条留 0%、数值显示 —（诚实占位）。
      lines.forEach(function (line) {
        var row = document.createElement("div");
        row.className = "about-stub-row";

        var head = document.createElement("div");
        head.className = "about-stub-head";

        var label = document.createElement("span");
        var sep = line.indexOf("|");
        label.textContent = sep >= 0 ? line.slice(0, sep).trim() : line;

        var bar = document.createElement("span");
        bar.className = "about-stub-bar";
        bar.setAttribute("role", "presentation");
        var fill = document.createElement("i");
        fill.style.width = "0%";
        bar.appendChild(fill);

        var val = document.createElement("span");
        val.className = "about-stub-val";
        val.textContent = "\u2014";

        head.appendChild(label);
        head.appendChild(bar);
        head.appendChild(val);
        row.appendChild(head);
        frag.appendChild(row);
      });
    } else {
      lines.forEach(function (line) {
        var span = document.createElement("span");
        span.className = CLS_CHIP;
        span.textContent = line;
        frag.appendChild(span);
      });
    }

    el.appendChild(frag);
    if (kind === "stubRows") applyServerStatus(el);
  }

  // ============ 服务器状态：拉取只读 JSON 并回填（每 60s 一次） ============
  // 数据源来自主题设置「服务器状态 → 数据源地址」；为空则完全不发请求，保持占位。
  // ⚠️ 必须带 cache-buster（?t=时间戳）：EdgeOne 的缓存键忽略 Vary: Origin，
  //    缓存命中那一份响应里**没有** Access-Control-Allow-Origin，浏览器会直接
  //    拒读；带唯一查询串强制 MISS 回源才能拿到 CORS 头。
  function applyServerStatus(el) {
    var url = (el.getAttribute("data-server-url") || "").trim();
    if (!url) return;

    var section = el.closest("section") || el.parentNode;

    function load() {
      // Swup 换页后旧节点会被摘下 -> 顺手停掉定时器
      if (!document.contains(el)) {
        if (el.__serverTimer) clearInterval(el.__serverTimer);
        return;
      }
      var bust = (url.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now();
      fetch(url + bust, { credentials: "omit", cache: "no-store" })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (data) {
          paintServerStatus(el, section, data);
        })
        .catch(function () {
          markServerOffline(el, section);
        });
    }

    if (el.__serverTimer) clearInterval(el.__serverTimer);
    load();
    el.__serverTimer = setInterval(load, 60000);
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
      var item = findServerItem(items, key, i);
      if (!item) return;

      var pct = parseFloat(item.percent);
      if (isNaN(pct)) pct = 0;
      if (pct < 0) pct = 0;
      if (pct > 100) pct = 100;

      var fill = row.querySelector(".about-stub-bar > i");
      var val = row.querySelector(".about-stub-val");
      if (fill) fill.style.width = pct + "%";
      if (val) val.textContent = item.text || pct + "%";

      // 明细（核心数/负载、已用容量…）放 title，不挤占设计版式
      if (item.detail || item.label) {
        row.setAttribute(
          "title",
          (item.label || "") + (item.detail ? "：" + item.detail : ""),
        );
      }
    });

    // 状态标签：用户留空时补一个；有真实数据就切成「在线」态
    var chip = section.querySelector(".about-stub-chip");
    if (!chip) {
      chip = document.createElement("span");
      chip.className = "about-stub-chip about-stub-chip--end";
      var head = section.querySelector(".about-card-head");
      if (head) head.appendChild(chip);
    }
    if (chip && data && data.status) {
      chip.textContent = data.status;
      chip.classList.add("about-stub-chip--live");
    }

    // 脚注：更新于 / 运行时长
    var foot = section.querySelector("[data-server-foot]");
    if (foot && data) {
      var bits = [];
      if (data.updatedText) bits.push("更新于 " + data.updatedText);
      if (data.uptimeDays) bits.push("已运行 " + data.uptimeDays + " 天");
      if (bits.length) {
        foot.textContent = bits.join(" · ");
        foot.removeAttribute("hidden");
      }
    }
    el.setAttribute("data-server-state", "live");
  }

  function markServerOffline(el, section) {
    var foot = section.querySelector("[data-server-foot]");
    if (foot) {
      foot.textContent = "数据源暂时取不到，稍后自动重试";
      foot.removeAttribute("hidden");
    }
    el.setAttribute("data-server-state", "offline");
  }

  // 「我的朋友」随机展示：服务端把全部友链渲染进 DOM（无 JS 时仍完整可见），
  // 这里洗牌后只保留前 data-count 个。defer 脚本在首次绘制前后极短窗口内执行，
  // 不会造成明显跳动；Swup 换页后由 init 重新触发（data-shuffled 守卫防重复）。
  function shuffleFriends() {
    var box = document.querySelector(
      '.about-friends[data-shuffle="true"]:not([data-shuffled])',
    );
    if (!box) return;
    box.setAttribute("data-shuffled", "true");

    var items = Array.prototype.slice.call(
      box.querySelectorAll(".about-friend"),
    );
    var n = parseInt(box.getAttribute("data-count") || "6", 10);
    if (!n || n < 0) n = 6;
    if (items.length <= n) return;

    // Fisher-Yates
    for (var i = items.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = items[i];
      items[i] = items[j];
      items[j] = t;
    }
    items.forEach(function (el, idx) {
      if (idx < n) box.appendChild(el);
      else el.remove();
    });
  }

  function init() {
    var nodes = document.querySelectorAll("[data-lines]:not([data-rendered])");
    Array.prototype.slice.call(nodes).forEach(function (el) {
      el.setAttribute("data-rendered", "true");
      render(el);
    });
    shuffleFriends();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // 暴露重排入口，供 Swup 换页后调用（幂等）
  window.__extendPagesRender = init;
})();

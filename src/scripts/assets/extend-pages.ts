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
      // 「服务器状态」占位行：每行一个指标名，进度条先留 0%
      lines.forEach(function (line) {
        var row = document.createElement("div");
        row.className = "about-stub-row";

        var head = document.createElement("div");
        head.className = "about-stub-head";

        var label = document.createElement("span");
        label.textContent = line;

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

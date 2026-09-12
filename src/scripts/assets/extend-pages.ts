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

  function init() {
    var nodes = document.querySelectorAll("[data-lines]:not([data-rendered])");
    Array.prototype.slice.call(nodes).forEach(function (el) {
      el.setAttribute("data-rendered", "true");
      render(el);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // 暴露重排入口，供 Swup 换页后调用（幂等）
  window.__extendPagesRender = init;
})();

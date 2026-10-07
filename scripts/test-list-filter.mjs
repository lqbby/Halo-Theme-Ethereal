// 通用「就地筛选 / 局部 PJAX」桩测（jsdom 真执行打包脚本）
//
// 被测：public/assets/list-filter.js（= 包内 templates/assets/list-filter.js），
//       源码 src/scripts/assets/list-filter.ts。服务 /equipments、/photos、/bangumis。
//
// 桩 DOM 完全按页面契约手写（不依赖线上站点）：
//   [data-list-region] / [data-list-filter] a / [data-list-item]
// 断言的是「点胶囊 → fetch 目标 URL → 只换 region 内 HTML → 焦点回位 → 入场类 →
// 相册灯箱重绑钩子」这条链，以及「不该拦的点击不拦」。
//
// 运行：
//   NODE_PATH="C:/Users/LQ/.workbuddy/binaries/node/workspace/node_modules" \
//   "C:/Users/LQ/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" scripts/test-list-filter.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_MODULE || "jsdom");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(ROOT, "public/assets/list-filter.js");
const ORIGIN = "https://example.test";

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "✅" : "❌"} ${name}：实得 ${JSON.stringify(actual)} / 应有 ${JSON.stringify(expected)}`,
  );
}

function cardsHtml(ids) {
  return ids
    .map(
      (n) =>
        `<a data-list-item="1" href="/e/${n}" class="onload-animation" style="animation-delay: 120ms">${n}</a>`,
    )
    .join("");
}

function pageHtml(ids, withGallery) {
  return `<!doctype html><html><body>
    <div id="region" data-list-region="1">
      <section class="onload-animation">
        <div data-list-filter="1">
          <a href="/equipments" data-no-swup="1" class="tab is-active">全部</a>
          <a href="/equipments?group=a" data-no-swup="1" class="tab">A</a>
          <a href="/equipments?group=b" data-no-swup="1" class="tab">B</a>
        </div>
        <div id="grid">${cardsHtml(ids)}</div>
        ${withGallery ? '<div id="photos-gallery"></div>' : ""}
      </section>
    </div>
    <a id="outside" href="/other">outside</a>
    <a id="pager" href="/equipments/page/2">2</a>
  </body></html>`;
}

function makeDom(html, { responder, url = ORIGIN + "/equipments", hook } = {}) {
  const navLogs = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => {
    navLogs.push(e && e.message ? e.message : String(e));
  });
  const dom = new JSDOM(html, {
    url,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const calls = [];
  dom.window.fetch = function (input, init) {
    calls.push({ url: String(input), init: init || {} });
    return Promise.resolve(responder(String(input)));
  };
  if (hook) dom.window.__etherealRefreshPhotosGallery = hook;
  dom.window.eval(readFileSync(BUNDLE, "utf8"));
  if (dom.window.document.readyState === "loading") {
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  }
  return { dom, calls, navLogs };
}

// 服务端返回整页 HTML：region 换成新的一组卡片，且胶囊激活态由服务端渲染
function pageWith(ids, activeHref, withGallery) {
  const tabs = ["/equipments", "/equipments?group=a", "/equipments?group=b"]
    .map(
      (href) =>
        `<a href="${href}" data-no-swup="1" class="tab${
          href === activeHref ? " is-active" : ""
        }">${href}</a>`,
    )
    .join("");
  return `<!doctype html><html><body><div id="region" data-list-region="1">
    <section class="onload-animation"><div data-list-filter="1">${tabs}</div>
    <div id="grid">${cardsHtml(ids)}</div>${
      withGallery ? '<div id="photos-gallery"></div>' : ""
    }</section></div></body></html>`;
}

function click(dom, selector, opts = {}) {
  const el = dom.window.document.querySelector(selector);
  if (!el) throw new Error(`桩里找不到 ${selector}`);
  const ev = new dom.window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...opts,
  });
  const notPrevented = el.dispatchEvent(ev);
  return { el, notPrevented };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// ── 场景 A：正常局部加载 ──────────────────────────────────────────────
{
  let hookCalls = 0;
  const { dom, calls, navLogs } = makeDom(pageHtml([1, 2], true), {
    responder: (url) =>
      url.indexOf("group=b") !== -1
        ? {
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(pageWith([3, 4], "/equipments?group=b", true)),
          }
        : {
            ok: true,
            status: 200,
            text: () => Promise.resolve(pageWith([1, 2], "/equipments", true)),
          },
    hook: () => {
      hookCalls++;
    },
  });

  const { notPrevented } = click(dom, 'a[href="/equipments?group=b"]');
  check("A·点击被 preventDefault（不整页跳转）", notPrevented, false);
  await tick();
  await tick();

  check("A·发起 1 次 fetch", calls.length, 1);
  check(
    "A·fetch 的路径+查询正确",
    new URL(calls[0].url).pathname + new URL(calls[0].url).search,
    "/equipments?group=b",
  );
  check(
    "A·region 内 HTML 已替换（新卡片 3/4）",
    Array.from(dom.window.document.querySelectorAll("#grid [data-list-item]"))
      .map((el) => el.textContent)
      .join(","),
    "3,4",
  );
  check(
    "A·只换 region 内：region 自身仍在",
    !!dom.window.document.getElementById("region"),
    true,
  );
  check(
    "A·替换后剥掉 onload-animation（不重播整页入场）",
    dom.window.document.querySelectorAll("#grid .onload-animation").length,
    0,
  );
  check(
    "A·替换后新卡片挂 list-item-enter（逐卡淡入）",
    dom.window.document.querySelectorAll("#grid .list-item-enter").length,
    2,
  );
  check(
    "A·焦点回到同 href 的胶囊上",
    dom.window.document.activeElement &&
      dom.window.document.activeElement.getAttribute("href"),
    "/equipments?group=b",
  );
  check("A·相册灯箱重绑钩子被调用", hookCalls, 1);
  check(
    "A·未退化为整页跳转",
    navLogs.filter((m) => /navigation/i.test(m)).length,
    0,
  );
}

// ── 场景 B：不该拦的点击 ────────────────────────────────────────────
{
  const { dom, calls } = makeDom(pageHtml([1], false), {
    responder: () => ({
      ok: true,
      status: 200,
      text: () => Promise.resolve(pageWith([9], "/equipments")),
    }),
  });
  click(dom, "#outside");
  click(dom, "#pager"); // 分页链接在 region 内、但不在 [data-list-filter] 下
  click(dom, '#region a[href="/equipments?group=a"]', { ctrlKey: true });
  click(dom, '#region a[href="/equipments?group=a"]', { metaKey: true });
  await tick();
  check(
    "B·region 外链接 / 分页链接 / 修饰键点击都不触发 fetch",
    calls.length,
    0,
  );
  check(
    "B·region 未被改动",
    dom.window.document.querySelectorAll("#grid [data-list-item]").length,
    1,
  );
}

// ── 场景 C：同 href 的多个胶囊，焦点按第 n 个回位 ────────────────────
{
  const dupHtml = `<!doctype html><html><body>
    <div id="region" data-list-region="1">
      <div data-list-filter="1">
        <a href="/bangumis?typeNum=1&amp;status=0" data-no-swup="1" id="t1">追番</a>
        <a href="/bangumis?typeNum=1&amp;status=0" data-no-swup="1" id="t2">全部</a>
      </div>
      <div id="grid">${cardsHtml([1])}</div>
    </div></body></html>`;
  const dupIncoming = dupHtml.replace(
    /<div id="grid">[\s\S]*?<\/div>/,
    `<div id="grid">${cardsHtml([7])}</div>`,
  );
  const { dom } = makeDom(dupHtml, {
    url: ORIGIN + "/bangumis",
    responder: () => ({
      ok: true,
      status: 200,
      text: () => Promise.resolve(dupIncoming),
    }),
  });
  click(dom, "#t2");
  await tick();
  await tick();
  check(
    "C·同 href 重复时焦点回到被点的第 2 个胶囊",
    dom.window.document.activeElement && dom.window.document.activeElement.id,
    "t2",
  );
}

// ── 场景 D：目标页没有 region（异常/后退边界）→ 整页跳转兜底 ────────
{
  const { dom, navLogs } = makeDom(pageHtml([1], false), {
    responder: () => ({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          "<!doctype html><html><body><p>no region</p></body></html>",
        ),
    }),
  });
  click(dom, 'a[href="/equipments?group=a"]');
  await tick();
  await tick();
  check(
    "D·无 region 时退化为整页跳转",
    navLogs.filter((m) => /navigation/i.test(m)).length > 0,
    true,
  );
}

console.log(failures === 0 ? "\n全部通过 ✅" : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);

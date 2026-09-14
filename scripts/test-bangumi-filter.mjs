// 追番页 /bangumis 客户端脚本的桩测（jsdom 真执行打包产物），覆盖 1.5.17 的两个修复：
//
// §A 回访不丢分页（回归核心）
//   症状：进详情页再回来，分页器消失、卡片全显示。
//   根因：顶层 `if (guardOnce("bangumi-filter")) return;` 的状态存在 window.__etherealOnce
//        上、跨 Swup 换页持久 ⇒ 第二次进入时脚本虽被 SwupScriptsPlugin 克隆重执行，却
//        直接 return，底部的 apply()（按页切显隐 + 渲染分页器）再也不跑。
//   修法：文档级监听仍只绑一次（bindGlobal），但 init() 每次脚本执行都跑。
//   ⇒ 本测试在**同一个 jsdom window** 里 eval 两次（中间重建 DOM，模拟换页），
//     断言第二次仍然「只显示第一页 + 分页器存在」。修复前该断言必红。
//
// §B 局部 PJAX 的 region HTML 缓存与预取
//   断言：同 URL 第二次点击 0 请求；hover 预取后再点击，总请求数只 +1（复用同一条 fetch）。
//
// 运行：
//   NODE_PATH="C:/Users/LQ/.workbuddy/binaries/node/workspace/node_modules" \
//   "C:/Users/LQ/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" scripts/test-bangumi-filter.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_MODULE || "jsdom");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BANGUMI_BUNDLE = join(ROOT, "public/assets/bangumi-filter.js");
const LIST_BUNDLE = join(ROOT, "public/assets/list-filter.js");
const ORIGIN = "https://example.test";

const PAGE_SIZE = 12; // 必须与 bangumi-filter.ts 的 PAGE_SIZE 一致

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "✅" : "❌"} ${name}：实得 ${JSON.stringify(actual)} / 应有 ${JSON.stringify(expected)}`,
  );
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── §A 追番页 ─────────────────────────────────────────────────────── */

// 与 bangumis.astro 的 SSR 契约对齐的最小 DOM（只保留脚本真正读的部分）
function bangumisHtml(n) {
  const cards = Array.from({ length: n }, (_, i) => {
    const idx = i + 1;
    const title = `Alpha ${idx}`;
    return `<a data-list-item="1" data-bangumi-card="1" data-index="${i}"
      data-title="${title}" data-score="${(10 - (i % 7)).toFixed(1)}"
      data-follow="${1000 + i}" data-type="番剧" data-area="日本"
      data-total="全12话" data-view="1.2万" data-danmaku="500" data-coin="10"
      data-des="${title} 的简介" data-cover="/c/${idx}.jpg" data-url="https://b/${idx}"
      class="onload-animation">${title}</a>`;
  }).join("");
  return `<!doctype html><html><body>
    <input type="search" data-bangumi-search value="" />
    <button type="button" data-bangumi-search-clear hidden></button>
    <select data-bangumi-sort>
      <option value="default" selected>默认顺序</option>
      <option value="score">评分</option>
      <option value="follow">追番人数</option>
    </select>
    <div id="bangumi-region" data-list-region="1">
      <div id="bangumi-list" data-bangumi-list="1">
        <span data-bangumi-count data-count-template="共 %d 部">共 0 部</span>
        <span data-bangumi-filtered-badge data-base="0" hidden>已筛选</span>
        <div data-bangumi-grid="1">${cards}</div>
        <div data-bangumi-empty-search hidden></div>
        <nav data-bangumi-pager hidden
          data-prev-label="上一页" data-next-label="下一页"
          data-page-label="第 %d 页"></nav>
      </div>
    </div>
    <div id="bangumi-modal"><button class="bangumi-modal-close" data-bangumi-modal-close></button></div>
  </body></html>`;
}

function countVisible(win) {
  return Array.from(
    win.document.querySelectorAll("[data-bangumi-card]"),
  ).filter((el) => el.style.display !== "none").length;
}

function pagerHidden(win) {
  const nav = win.document.querySelector("[data-bangumi-pager]");
  return nav ? nav.hidden : null;
}

function pagerButtons(win) {
  return win.document.querySelectorAll("[data-bangumi-pager] button").length;
}

{
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on("jsdomError", (e) =>
    errors.push(e && e.message ? e.message : String(e)),
  );
  const dom = new JSDOM(bangumisHtml(20), {
    url: ORIGIN + "/bangumis",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const win = dom.window;
  const bundle = readFileSync(BANGUMI_BUNDLE, "utf8");

  // ── 首次进入 ──────────────────────────────────────────────────────
  win.eval(bundle);
  await tick();

  check("A1·首次进入只显示第一页", countVisible(win), PAGE_SIZE);
  check("A1·首次进入分页器出现", pagerHidden(win), false);
  check("A1·20 张 = 2 页 ⇒ 4 个按钮（上/1/2/下）", pagerButtons(win), 4);
  check(
    "A1·计数按「匹配总数」显示（非当前页）",
    win.document.querySelector("[data-bangumi-count]").textContent,
    "共 20 部",
  );
  // 记录机制本身：守卫 key 落在 window.__etherealOnce 上 ⇒ 跨换页持久
  //（这正是旧实现「回访时整段 IIFE 被 return 掉」的原因）
  check(
    "A0·守卫状态确实跨换页持久（旧 bug 的成因）",
    !!(win.__etherealOnce && win.__etherealOnce["bangumi-filter"]),
    true,
  );

  // ── 模拟「进详情页再回来」：同一 window 内重建 DOM 后**再次执行**脚本 ──
  // （SwupScriptsPlugin 换页时就是这么干的；window.__etherealOnce 不会重置）
  win.document.body.innerHTML = bangumisHtml(20)
    .replace(/^[\s\S]*?<body>/, "")
    .replace(/<\/body>[\s\S]*$/, "");
  win.eval(bundle);
  await tick();

  check("A2·回访仍只显示第一页（回归核心）", countVisible(win), PAGE_SIZE);
  check("A2·回访分页器仍在（回归核心）", pagerHidden(win), false);
  check("A2·回访分页按钮仍为 4 个", pagerButtons(win), 4);

  // ── 回访后搜索仍生效（state 从 DOM 重读，不残留） ──────────────────
  const input = win.document.querySelector("[data-bangumi-search]");
  input.value = "Alpha 7";
  input.dispatchEvent(new win.Event("input", { bubbles: true }));
  await tick();
  check("A3·回访后搜索生效（唯一命中 1 张）", countVisible(win), 1);
  check("A3·命中 1 张 ⇒ 分页器收起", pagerHidden(win), true);

  // ── 清除搜索 → 回第 1 页；点第 2 页 → 只剩 8 张 ────────────────────
  win.document
    .querySelector("[data-bangumi-search-clear]")
    .dispatchEvent(
      new win.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  await tick();
  check("A4·清除搜索后恢复 20 张的第一页", countVisible(win), PAGE_SIZE);

  const page2 = win.document.querySelector('[data-bangumi-page="2"]');
  check("A4·第 2 页按钮存在", !!page2, true);
  page2.dispatchEvent(
    new win.MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  await tick();
  check("A4·第 2 页显示剩余 8 张", countVisible(win), 20 - PAGE_SIZE);

  // jsdom 未实现 window.scrollTo / 真跳转 ⇒ 这些是环境限制，不是脚本错误
  const realErrors = errors.filter(
    (m) => !/navigation|not implemented/i.test(m),
  );
  check(
    "A5·全程无脚本自身错误（忽略 jsdom 未实现的 scrollTo）",
    realErrors.length,
    0,
  );
  if (realErrors.length) realErrors.forEach((m) => console.log("   ↳ " + m));
}

/* ── §B 局部 PJAX 的缓存与预取 ─────────────────────────────────────── */

function listPageHtml(ids) {
  return `<!doctype html><html><body>
    <div id="region" data-list-region="1">
      <section class="onload-animation">
        <div data-list-filter="1">
          <a href="/equipments" data-no-swup="1">全部</a>
          <a href="/equipments?group=a" data-no-swup="1">A</a>
          <a href="/equipments?group=b" data-no-swup="1">B</a>
          <a href="/equipments?group=c" data-no-swup="1">C</a>
        </div>
        <div id="grid">${ids
          .map((n) => `<a data-list-item="1" href="/e/${n}">${n}</a>`)
          .join("")}</div>
      </section>
    </div></body></html>`;
}

// 换入的 region 同样要带齐所有胶囊（真实页面如此），否则后续点击会找不到链接
function listPageWith(ids) {
  return `<!doctype html><html><body><div id="region" data-list-region="1">
    <section class="onload-animation"><div data-list-filter="1">
      <a href="/equipments" data-no-swup="1">全部</a>
      <a href="/equipments?group=a" data-no-swup="1">A</a>
      <a href="/equipments?group=b" data-no-swup="1">B</a>
      <a href="/equipments?group=c" data-no-swup="1">C</a>
    </div><div id="grid">${ids
      .map((n) => `<a data-list-item="1" href="/e/${n}">${n}</a>`)
      .join("")}</div></section></div></body></html>`;
}

{
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", () => {});
  const dom = new JSDOM(listPageHtml([1, 2]), {
    url: ORIGIN + "/equipments",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const win = dom.window;
  const calls = [];
  win.fetch = function (input) {
    const url = String(input);
    calls.push(url);
    const g = new URL(url).searchParams.get("group") || "";
    const ids = g === "b" ? [3, 4] : g === "c" ? [5, 6] : [1, 2];
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(listPageWith(ids)),
    });
  };
  win.eval(readFileSync(LIST_BUNDLE, "utf8"));

  const click = (sel) =>
    win.document
      .querySelector(sel)
      .dispatchEvent(
        new win.MouseEvent("click", { bubbles: true, cancelable: true }),
      );
  const over = (sel) =>
    win.document
      .querySelector(sel)
      .dispatchEvent(new win.Event("pointerover", { bubbles: true }));
  const grid = () =>
    Array.from(win.document.querySelectorAll("#grid [data-list-item]"))
      .map((el) => el.textContent)
      .join(",");

  click('a[href="/equipments?group=b"]');
  await tick();
  await tick();
  check("B1·首次点击 group=b 发起 1 次请求", calls.length, 1);
  check("B1·region 换成 3,4", grid(), "3,4");

  click('a[href="/equipments?group=a"]');
  await tick();
  await tick();
  check("B2·再点 group=a 又发起 1 次（共 2）", calls.length, 2);
  check("B2·region 换成 1,2", grid(), "1,2");

  click('a[href="/equipments?group=b"]');
  await tick();
  await tick();
  check("B3·回到已缓存的 group=b：0 新请求（共 2）", calls.length, 2);
  check("B3·region 仍是 3,4（缓存命中即时切换）", grid(), "3,4");

  // hover 预取：pointerover 后需超过 180ms 防抖才真正发请求
  over('a[href="/equipments?group=c"]');
  await sleep(240);
  await tick();
  check("B4·hover 停住后预取 group=c（共 3）", calls.length, 3);

  click('a[href="/equipments?group=c"]');
  await tick();
  await tick();
  check("B5·点击已被预取的 group=c：不再新增请求（共 3）", calls.length, 3);
  check("B5·region 换成 5,6", grid(), "5,6");
}

console.log(failures === 0 ? "\n全部通过 ✅" : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);

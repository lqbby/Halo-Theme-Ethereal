/**
 * 归档页「分类筛选」桩件真执行测试
 *
 * 背景：Halo 的 ${archives} 是按文章分页的（页大小取自系统设置「归档页文章显示条数」），
 * 页内行级过滤会漏掉后续分页 ⇒ 归档页筛选曾出现「角标 3 篇 / 列表 0 篇」。
 * 本测试用**线上真实分页 HTML** 作桩，注入服务端契约属性（data-archive-total-pages /
 * data-archive-cats），在 jsdom 里真执行 src/pages/archives.astro 的内联脚本，
 * 断言「点某分类 → 列出的文章集合 == 全站该分类的全部文章」。
 *
 * 用法（需要网络，取线上分页 + 公开 API 做权威映射）：
 *   SITE=https://www.lqbby.com \
 *   NODE_PATH=/path/to/node_modules node scripts/test-archives-filter.mjs
 */
// 执行构建产物统一走 node:vm（项目禁用 eval / new Function）：runInContext(code, jsdomWindow)
import { runInContext } from "node:vm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// jsdom 不进主题依赖：用 CJS require 解析（NODE_PATH 对 CJS 生效），
// 也可以用 JSDOM_MODULE 指定绝对路径。
const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.JSDOM_MODULE || "jsdom");

const SITE = (process.env.SITE || "https://www.lqbby.com").replace(/\/+$/, "");
const ASTRO = fs.readFileSync(
  fileURLToPath(new URL("../src/pages/archives.astro", import.meta.url)),
  "utf8",
);
const SCRIPT = ASTRO.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];

const TMP = path.join(os.tmpdir(), "archive-filter-test");
fs.mkdirSync(TMP, { recursive: true });

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

// ── 1. 权威映射：文章 slug → 分类 slug（走 Halo 公开 API） ────────────────────
// 按页拉全：旧实现只取 size=200 一页，站点文章数超过 200 时映射表会静默截断，
// 后续断言等于在错误契约上验证（总数取 API 的 total、映射却只有前 200 篇）。
const API_PAGE_SIZE = 200;
const slugCats = new Map();
let TOTAL = 0;
for (let page = 1; ; page++) {
  const api = JSON.parse(
    await get(
      `${SITE}/apis/api.content.halo.run/v1alpha1/posts?page=${page}&size=${API_PAGE_SIZE}`,
    ),
  );
  TOTAL = api.total;
  for (const p of api.items) {
    slugCats.set(
      p.spec.slug,
      (p.categories || []).map((c) => c.spec.slug),
    );
  }
  if (api.items.length === 0 || slugCats.size >= TOTAL) break;
  if (page > 100) throw new Error(`API 分页异常：已拉 ${page} 页仍未凑齐 ${TOTAL} 篇`);
}
if (slugCats.size !== TOTAL)
  throw new Error(`映射不完整：API total=${TOTAL}，实际拉到 ${slugCats.size} 篇`);

// ── 2. 抓线上各分页，并注入服务端契约属性 ────────────────────────────────────
// 每页条数必须由线上第 1 页实际行数推断：旧实现写死 10 并自称「由第 1 页推断」，
// 站点改每页条数时 pageCount 算错，整个桩测集会在错误页数上跑。
const firstPageHtml = await get(`${SITE}/archives`);
const realPageSize = (firstPageHtml.match(/data-archive-row=/g) || []).length;
if (realPageSize === 0)
  throw new Error("第 1 页抓不到 data-archive-row，无法推断每页条数");
const pageCount = Math.ceil(TOTAL / realPageSize);
const rawPages = [firstPageHtml];
for (let k = 2; k <= pageCount; k++) {
  rawPages.push(await get(`${SITE}/archives/page/${k}`));
}

// 线上产物可能还是「旧 SSR」：那时空态块带 th:if="${filterActive}"，未筛选时压根不渲染。
// 新模板已改为**恒渲染**（脚本要在未筛选的第 1 页上取它的快照），故桩件补注入。
const EMPTY_BLOCK =
  '<div id="archive-empty-filter" hidden class="flex flex-col items-center justify-center gap-3 py-16 text-center">' +
  '<span class="icon-[material-symbols--inbox-outline-rounded] text-4xl text-30"></span>' +
  '<div class="text-sm text-50">该筛选条件下暂无文章</div></div>';
const pages = rawPages.map((html) => {
  let out = html.replace(
    /<div id="archive-list">/,
    `<div id="archive-list" data-archive-total-pages="${pageCount}">`,
  );
  out = out.replace(
    /(data-archive-row="([^"]+)" data-year="\d+")/g,
    (_m, whole, slug) =>
      `${whole} data-archive-cats="[${(slugCats.get(slug) || []).join(", ")}]"`,
  );
  if (!out.includes('id="archive-empty-filter"')) {
    out = out.replace(/(<div id="archive-list"[^>]*>)/, `$1${EMPTY_BLOCK}`);
  }
  return out;
});

// ── 3. jsdom 里真执行内联脚本 ─────────────────────────────────────────────────
const byPath = new Map();
byPath.set("/archives", pages[0]);
for (let k = 2; k <= pageCount; k++)
  byPath.set(`/archives/page/${k}`, pages[k - 1]);

const dom = new JSDOM(pages[0], {
  url: `${SITE}/archives`,
  runScripts: "outside-only",
  pretendToBeVisual: true,
});
const { window } = dom;
let fetchCount = 0;
window.fetch = (u) => {
  fetchCount++;
  const p = new URL(String(u), SITE).pathname;
  const body = byPath.get(p);
  return Promise.resolve({
    ok: !!body,
    status: body ? 200 : 404,
    text: () => Promise.resolve(body || ""),
  });
};
runInContext(SCRIPT, window);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const doc = () => window.document;
const rows = () =>
  Array.from(doc().querySelectorAll("#archive-list [data-archive-row]")).map(
    (a) => a.getAttribute("data-archive-row"),
  );
const yearCount = () =>
  (doc().querySelector("[data-archive-year-count]") || {}).textContent || "";
const subtitle = () =>
  (doc().getElementById("archive-subtitle") || {}).textContent || "";

await sleep(50);
const initial = rows();
const initialFetches = fetchCount;

// ── 4. 逐分类点击，断言「结果 == 全站该分类全部文章」 ─────────────────────────
const cats = new Set();
for (const list of slugCats.values()) for (const c of list) cats.add(c);
const tabs = Array.from(doc().querySelectorAll("#archive-filter-tabs a"));

const results = [];
let failed = 0;

for (const tab of tabs) {
  const u = new URL(tab.getAttribute("href"), SITE);
  const slug = u.searchParams.get("category");
  const uncat = u.searchParams.has("uncategorized");
  // 「全部」tab 不带任何筛选参数，不走筛选断言（由末尾的「回到全部」单独验证）
  if (!slug && !uncat) continue;
  const label =
    (tab.querySelector("span") || {}).textContent || slug || "未分类";

  tab.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  await sleep(700); // 退场过渡 400ms + 渲染

  const got = new Set(rows());
  const want = new Set();
  for (const [s, cs] of slugCats) {
    if (uncat ? cs.length === 0 : cs.includes(slug)) want.add(s);
  }
  const missing = [...want].filter((x) => !got.has(x));
  const extra = [...got].filter((x) => !want.has(x));
  const ok = missing.length === 0 && extra.length === 0;
  if (!ok) failed++;

  const emptyEl = doc().getElementById("archive-empty-filter");
  results.push({
    label,
    want: want.size,
    got: got.size,
    ok,
    missing,
    extra,
    yearCount: yearCount().trim(),
    subtitle: subtitle().trim(),
    empty: !emptyEl ? "缺失❌" : emptyEl.hidden ? "隐藏" : "显示",
  });
}

// 回到「全部」：应恢复分页（只渲第 1 页）
const allTab = tabs.find(
  (a) =>
    new URL(a.getAttribute("href"), SITE).pathname.replace(/\/+$/, "") ===
      "/archives" &&
    !new URL(a.getAttribute("href"), SITE).searchParams.has("category"),
);
let backOk = false;
let backRows = 0;
if (allTab) {
  allTab.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  await sleep(700);
  backRows = rows().length;
  backOk = backRows === realPageSize;
  if (!backOk) failed++;
}

// ── 5. 场景二：入口直接带筛选参数（分享链接 / 刷新 / 后退） ───────────────────
// 模拟 SSR 只渲了第 1 页里的命中行（数量随站点内容变化，可能为 0），
// 断言 init() 会自动补齐后续分页并把该分类的全部文章都渲染出来。
// 注：旧断言写死 ssrRows === 0（当年 AI工具 的文章全在第 2 页），站点内容
// 变化后第 1 页已有命中行，该前提不再成立；核心断言是「补齐到全量」。
const scenSlug = "ai";
let scenWant = 0;
for (const cs of slugCats.values()) if (cs.includes(scenSlug)) scenWant++;
let filteredFixture = pages[0].replace(
  /<a [^>]*data-archive-cats="\[([^\]]*)\]"[^>]*>[\s\S]*?<\/a>/g,
  (m, cats) =>
    cats
      .split(",")
      .map((s) => s.trim())
      .includes(scenSlug)
      ? m
      : "",
);
{
  const d2 = new JSDOM(filteredFixture, {
    url: `${SITE}/archives?category=${scenSlug}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  d2.window.fetch = (u) => {
    const p = new URL(String(u), SITE).pathname;
    const body = byPath.get(p);
    return Promise.resolve({
      ok: !!body,
      status: body ? 200 : 404,
      text: () => Promise.resolve(body || ""),
    });
  };
  runInContext(SCRIPT, d2.window);
  const ssrRows = d2.window.document.querySelectorAll(
    "#archive-list [data-archive-row]",
  ).length;
  await sleep(800);
  const gotRows = d2.window.document.querySelectorAll(
    "#archive-list [data-archive-row]",
  ).length;
  var entryOk = ssrRows <= scenWant && gotRows === scenWant;
  if (!entryOk) failed++;
  var entryInfo = `SSR ${ssrRows} 行 → 补齐后 ${gotRows} 行（应 ${scenWant}）`;
}

// ── 6. 报告 ───────────────────────────────────────────────────────────────────
console.log(
  `站点 ${SITE}｜全站 ${TOTAL} 篇｜每页 ${realPageSize} 篇｜共 ${pageCount} 页`,
);
console.log(
  `首屏行数 ${initial.length}（=每页条数）｜首次筛选额外请求 ${initialFetches} 次\n`,
);
const pad = (s, n) => String(s).padEnd(n, " ");
console.log(`${pad("分类", 16)} ${pad("应有", 5)} ${pad("实得", 5)} 结果`);
console.log("-".repeat(72));
for (const r of results) {
  console.log(
    `${pad(r.label, 16)} ${pad(r.want, 5)} ${pad(r.got, 5)} ${r.ok ? "✅" : "❌ 漏=" + r.missing + " 多=" + r.extra}`,
  );
  console.log(
    `     年计数「${r.yearCount}」｜副标题「${r.subtitle}」｜空态${r.empty}`,
  );
}
console.log("-".repeat(72));
console.log(
  `回到「全部」：${backRows} 行（应为 ${realPageSize}）${backOk ? "✅" : "❌"}`,
);
console.log(
  `入口带筛选（?category=${scenSlug}）：${entryInfo} ${entryOk ? "✅" : "❌"}`,
);
console.log(failed === 0 ? "\n✅ 全部通过" : `\n❌ 失败 ${failed} 项`);
process.exitCode = (failed === 0 ? 0 : 1);

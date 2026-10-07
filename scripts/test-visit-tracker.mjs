// @ts-check
// 「切换页面 → 文章访问量重复计数」桩测（jsdom 真执行埋点脚本）
//
// 被测：
//   ① `scripts/fixtures/halo-tracker.js` —— Halo 核心注入的埋点（线上原样副本）
//   ② 产物 HTML 里带 `data-visit-guard` 的内联脚本 —— 主题的 pushState 守卫
//
// 复现的机制（三个事实都由源码/实测确认，不是猜测）：
//   · `@swup/head-plugin@2.3.1` 的 mergeHeadContents 对新 head 里 outerHTML 不存在的元素做
//     `el.cloneNode(true)` + `insertBefore` ⇒ 换页时 `<script src="/halo-tracker.js" data-name=…>`
//     被**重建** ⇒ 浏览器重新执行 tracker。
//   · tracker 执行时 `u.pushState = h(u,"pushState",V)` 包装 history.pushState；而 V 上报用的
//     group/plural/name 是**本次执行时**读到的 data-name（闭包固定，之后再变 URL 也不会更新）。
//   · Swup 的 pushState 发生在 `visit:start`，而 head 更新挂在 `content:replace` 之前 ⇒
//     **pushState 先、head 重建后**。
//   ⇒ A→B 换页：pushState 令旧 hook 用 name=A 报一次（错报给上一篇文章），随后重建的
//     tracker(B) 执行再报一次 B；而每次执行又叠加一层 hook ⇒ 第 k 次换页 pushState 触发 k 层，
//     上一篇文章被重复 k 次。⇒ 访问量随浏览深度**超线性膨胀**。
//
// 断言：
//   · 对照组（无守卫）：必须能观察到「上报的 name ≠ 当前所在文章」的错报 ⇒ 锁死 bug 存在。
//     若这条将来失败，说明 Halo 改过 tracker 行为，守卫可退役。
//   · 守卫组（传产物 HTML）：每次换页恰好 1 次上报，且 name 就是当前文章。
//
// 运行：
//   # 仅对照组（不需要构建产物）
//   NODE_PATH="<node workspace>/node_modules" node scripts/test-visit-tracker.mjs
//   # 对照 + 守卫组（从产物抠出真实守卫脚本）
//   NODE_PATH="<node workspace>/node_modules" node scripts/test-visit-tracker.mjs <产物目录或 html>
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_MODULE || "jsdom");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TRACKER_SRC = readFileSync(
  join(ROOT, "scripts/fixtures/halo-tracker.js"),
  "utf8",
);
const ORIGIN = "https://example.test";

let failures = 0;
/**
 * @param {string} name
 * @param {unknown} actual
 * @param {unknown} expected
 */
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} ${name}：实得 ${a} / 应有 ${e}`);
}
/**
 * @param {string} name
 * @param {boolean} cond
 * @param {string} [detail]
 */
function ok(name, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? `：${detail}` : ""}`);
}

/**
 * 从产物 HTML 里抠出带 data-visit-guard 的内联脚本体
 * @param {string} html
 * @returns {{ attrs: string; body: string } | null}
 */
function extractGuard(html) {
  const tag = /<script([^>]*data-visit-guard[^>]*)>/i.exec(html);
  if (!tag) return null;
  const start = /** @type {number} */ (tag.index) + tag[0].length;
  const end = html.indexOf("</script>", start);
  return { attrs: tag[1], body: html.slice(start, end) };
}

function makeEnv() {
  const virtualConsole = new VirtualConsole(); // 静音 tracker 的 console.debug
  /** @type {string[]} */
  const errors = [];
  /** @param {any} e */
  const onJsdomError = (e) => {
    errors.push(e && e.message ? e.message : String(e));
  };
  virtualConsole.on("jsdomError", onJsdomError);

  const dom = new JSDOM(
    "<!doctype html><html><head></head><body></body></html>",
    {
      url: ORIGIN + "/archives/A",
      runScripts: "outside-only",
      pretendToBeVisual: true,
      virtualConsole,
    },
  );
  const w = /** @type {any} */ (dom.window);
  // SPA 换页时文档早就 complete ⇒ tracker 的 `C()` 会立即上报（模拟真实时序）
  Object.defineProperty(w.document, "readyState", {
    value: "complete",
    configurable: true,
  });

  /** @type {Array<{name?: string, url?: string, referrer?: string}>} */
  const reports = [];
  /**
   * @param {any} input
   * @param {any} [init]
   */
  const mockFetch = (input, init) => {
    const url = String(input);
    if (url.includes("/trackers/counter")) {
      try {
        reports.push(JSON.parse(String(init && init.body)));
      } catch {
        reports.push({ name: "<unparsable>" });
      }
    }
    return Promise.resolve({ ok: true, text: () => Promise.resolve("1") });
  };
  w.fetch = mockFetch;
  return { dom, w, reports, errors };
}

/**
 * 模拟「浏览器把重建的 <script src="/halo-tracker.js" data-name=…> 插进 head 并执行」。
 * head 插件会先移除 outerHTML 不等的旧 script，再插入 cloneNode 出来的新 script。
 * @param {any} w
 * @param {string} name
 */
function execTracker(w, name) {
  const head = w.document.head;
  const stale = head.querySelector("script[data-name]");
  if (stale) stale.remove();

  const el = w.document.createElement("script");
  el.setAttribute("data-group", "content.halo.run");
  el.setAttribute("data-plural", "posts");
  el.setAttribute("data-name", name);
  el.src = "/halo-tracker.js";
  head.appendChild(el);

  Object.defineProperty(w.document, "currentScript", {
    value: el,
    configurable: true,
  });
  try {
    w.eval(TRACKER_SRC);
  } finally {
    delete w.document.currentScript;
  }
}

/**
 * Swup 的导航：pushState 在 visit:start，head 重建在其后
 * @param {any} w
 * @param {string} to
 */
function navPush(w, to) {
  w.history.pushState({}, "", to);
}

console.log("── 对照组：无守卫（现状）──");
{
  const env = makeEnv();
  const { w, reports } = env;
  execTracker(w, "A"); // 首屏落在文章 A
  navPush(w, "/archives/B");
  execTracker(w, "B");
  navPush(w, "/archives/C");
  execTracker(w, "C");

  const names = reports.map((r) => r.name);
  const wrong = reports.filter(
    (r) => !String(r.url || "").endsWith("/" + r.name),
  );
  console.log(
    `   上报序列：${JSON.stringify(names)}（共 ${reports.length} 次）`,
  );
  console.log(
    `   错报明细：${JSON.stringify(reports.map((r) => `${r.name}@${r.url}`))}`,
  );
  check("对照-1 首屏恰好上报 1 次当前文章", names.slice(0, 1), ["A"]);
  ok(
    "对照-2 存在「上报 url 与 name 不匹配」的错报（= 统计失真，bug 存在）",
    wrong.length > 0,
    `${wrong.length} 条错报`,
  );
  ok(
    "对照-3 已离开的文章被持续重复计数（hook 叠加）",
    names.filter((n) => n === "A").length >= 2 &&
      names.filter((n) => n === "B").length >= 2,
    `A=${names.filter((n) => n === "A").length} 次 / B=${names.filter((n) => n === "B").length} 次（各应 1 次）`,
  );
  check("对照-4 全程无 jsdom 运行时错误", env.errors.length, 0);
  if (env.errors.length) console.log("   ", env.errors.slice(0, 2).join(" | "));
  env.dom.window.close();
}

// 守卫组（可选）：从产物抠出真实守卫脚本
const arg = process.argv[2];
let htmlPath = null;
if (arg) {
  try {
    htmlPath = statSync(arg).isDirectory() ? join(arg, "post.html") : arg;
    if (!readFileSync(htmlPath, "utf8")) htmlPath = null;
  } catch {
    htmlPath = null;
  }
  if (!htmlPath || !extractGuard(readFileSync(htmlPath, "utf8"))) {
    // 退而求其次：在目录里找任意含守卫的 html
    const dir = statSync(arg).isDirectory() ? arg : dirname(arg);
    const hit = readdirSync(dir)
      .filter((f) => f.endsWith(".html"))
      .map((f) => join(dir, f))
      .find((p) => extractGuard(readFileSync(p, "utf8")));
    htmlPath = hit || null;
  }
}

if (!htmlPath) {
  console.log(
    "\n⚠️ 未传产物路径（或产物里没有 data-visit-guard）⇒ 跳过守卫组。",
  );
  console.log(
    `\n${failures === 0 ? "✅ 对照组通过（bug 已复现）" : `❌ ${failures} 项失败`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

const guard = extractGuard(readFileSync(htmlPath, "utf8"));
if (!guard) {
  console.log("\n⚠️ 产物里找不到 data-visit-guard ⇒ 跳过守卫组。");
  process.exit(failures === 0 ? 0 : 1);
}
console.log(`\n── 守卫组：脚本来自 ${htmlPath} ──`);
console.log(`   属性：${guard.attrs.trim()}`);
{
  const env = makeEnv();
  const { w, reports } = env;
  w.eval(guard.body); // 守卫必须先于 tracker 执行（head 里靠前）
  execTracker(w, "A");
  const afterFirst = reports.length;
  navPush(w, "/archives/B");
  execTracker(w, "B");
  const afterSecond = reports.length;
  navPush(w, "/archives/C");
  execTracker(w, "C");

  check(
    "守卫-1 上报 name 序列 = 进入过的文章",
    reports.map((r) => r.name),
    ["A", "B", "C"],
  );
  check("守卫-2 首屏上报 1 次", afterFirst, 1);
  check("守卫-3 第一次换页只多 1 次上报", afterSecond - afterFirst, 1);
  check("守卫-4 第二次换页只多 1 次上报", reports.length - afterSecond, 1);
  ok(
    "守卫-5 pushState 未触发任何 hook 上报（url 与 name 始终一致）",
    reports.every((r) => String(r.url || "").endsWith("/" + r.name)),
    JSON.stringify(reports.map((r) => `${r.name}@${r.url}`)),
  );
  ok(
    "守卫-6 守卫后 pushState 仍正常工作（Swup 导航未被破坏）",
    w.location.pathname === "/archives/C",
    `location=${w.location.pathname}`,
  );
  check("守卫-7 全程无 jsdom 运行时错误", env.errors.length, 0);
  if (env.errors.length) console.log("   ", env.errors.slice(0, 2).join(" | "));
  env.dom.window.close();
}

console.log(`\n${failures === 0 ? "✅ 全部通过" : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);

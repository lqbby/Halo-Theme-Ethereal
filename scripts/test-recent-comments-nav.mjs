// @ts-check
// 侧栏「最近评论」跳转逻辑桩测（jsdom 真执行构建产物）
//
// 被测：
//   ① templates/index.html 里 RecentComments 的内联脚本
//      （源码 src/components/widget/RecentComments.astro）—— 点击跳转三分支
//   ② templates/assets/comment-locate.js
//      （源码 src/scripts/assets/comment-locate.ts）—— 同页锚点监听只注册一次
//
// 断言链：
//   NAV-1 跨页评论点击 ⇒ preventDefault + swup.navigate(permalink + 精准锚点)
//   NAV-2 同页评论点击 ⇒ 不走 swup；改写 location.hash 并触发 hashchange
//   NAV-3 同页 + hash 已相同 ⇒ 不再触发 hashchange，改派 ethereal:locate-comment
//   NAV-4 Ctrl+点击 ⇒ 不拦截（放行原生新标签语义），不走 swup、不改 hash
//   NAV-5 无 permalink（href="#"）⇒ 拦截且无任何导航
//   NAV-6 Swup 动画进行中（is-animating）⇒ 点击被忽略；结束后恢复可点
//   CL-1  comment-locate 注册 hashchange / ethereal:locate-comment 各一次
//   CL-2  脚本被克隆重执行（模拟 Swup 换页）⇒ 监听器不重复注册
//   CL-3  换页路径（带精准 hash 进入）⇒ 先瞬时贴靠 #comment 顶 + replaceState
//   CL-4  同页路径（hashchange）⇒ 不再瞬时贴靠（单次平滑更连贯），仍做 replaceState
//
// 运行（JSDOM 在 managed workspace，不在仓库依赖里）：
//   NODE_PATH="C:/Users/LQ/.workbuddy/binaries/node/workspace/node_modules" \
//   "C:/Users/LQ/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" scripts/test-recent-comments-nav.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_MODULE || "jsdom");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = join(ROOT, "templates/index.html");
const ORIGIN = "https://example.test";

const html = readFileSync(INDEX, "utf8");

let failures = 0;
/**
 * @param {string} name
 * @param {unknown} actual
 * @param {unknown} expected
 */
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "✅" : "❌"} ${name}：实得 ${JSON.stringify(actual)} / 应有 ${JSON.stringify(expected)}`,
  );
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
 * 从产物 index.html 抠出「含锚点的那个内联脚本」的脚本体（去掉 <script ...> 标签）
 * @param {string} source
 * @param {string} anchor
 * @returns {string}
 */
function extractInlineScript(source, anchor) {
  const i = source.indexOf(anchor);
  if (i < 0) throw new Error(`产物里找不到锚点：${anchor}`);
  const start = source.lastIndexOf("<script", i);
  const openEnd = source.indexOf(">", start);
  const end = source.indexOf("</script>", i);
  return source.slice(openEnd + 1, end);
}

const RC_SRC = extractInlineScript(html, "var LIMIT=5;");
const CL_SRC = readFileSync(
  join(ROOT, "templates/assets/comment-locate.js"),
  "utf8",
);

/** @type {(n?: number) => Promise<void>} */
const flush = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

/**
 * 构造一个 jsdom 环境：URL 在「当前文章页」/archives/post-1，
 * 聚合端点返回三条评论（同页 / 跨页 / 无链接）。
 * @param {string} url
 */
function makeEnv(url) {
  const virtualConsole = new VirtualConsole();
  /** @type {string[]} */
  const jsdomErrors = [];
  /** @param {any} e */
  const onJsdomError = (e) => {
    jsdomErrors.push(e && e.message ? e.message : String(e));
  };
  virtualConsole.on("jsdomError", onJsdomError);

  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="recent-comments-list"><div class="loading">加载中...</div></div>
    </body></html>`,
    {
      url,
      runScripts: "outside-only",
      pretendToBeVisual: true,
      virtualConsole,
    },
  );
  const w = /** @type {any} */ (dom.window);

  // 监听器登记（断言「只注册一次」）
  /** @type {Array<{ type: string; fn: any }>} */
  const listeners = [];
  const origAdd = w.addEventListener.bind(w);
  /**
   * @param {string} type
   * @param {any} fn
   * @param {any} [opts]
   */
  const addListener = (type, fn, opts) => {
    listeners.push({ type, fn });
    return origAdd(type, fn, opts);
  };
  w.addEventListener = addListener;
  /** @param {string} type */
  const countOf = (type) => listeners.filter((l) => l.type === type).length;

  // swup 桩：只记录 navigate 调用
  /** @type {string[]} */
  const navCalls = [];
  w.swup = {
    /** @param {any} href */
    navigate(href) {
      navCalls.push(String(href));
    },
  };

  // 懒加载钩子：只登记不执行，让测试自己控制 load 时机
  /** @type {Record<string, () => void>} */
  const lazy = {};
  /**
   * @param {string} id
   * @param {() => void} fn
   */
  const themeLazyInit = (id, fn) => {
    lazy[id] = fn;
  };
  w.__themeLazyInit = themeLazyInit;
  if (typeof w.AbortController === "undefined")
    w.AbortController = AbortController;

  // fetch 桩：聚合端点返回「同页 / 跨页 / 无 permalink」三条
  const now = new Date().toISOString();
  /**
   * @param {any} input
   */
  const mockFetch = (input) => {
    const u = String(input);
    const body = u.includes("comments/latest")
      ? {
          items: [
            {
              name: "c-same",
              displayName: "同页用户",
              content: "这条属于当前文章",
              creationTime: now,
              permalink: "/archives/post-1",
            },
            {
              name: "c-other",
              displayName: "他页用户",
              content: "这条属于别的文章",
              creationTime: now,
              permalink: "/archives/post-2",
            },
            {
              name: "c-nolink",
              displayName: "无链用户",
              content: "这条没有 permalink",
              creationTime: now,
            },
          ],
        }
      : { items: [] };
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    });
  };
  w.fetch = mockFetch;

  return { dom, w, lazy, navCalls, countOf, jsdomErrors };
}

/**
 * 派生一个左键 click（无修饰键）
 * @param {any} w
 * @param {any} [opts]
 */
function leftClick(w, opts) {
  return new w.MouseEvent(
    "click",
    Object.assign({ bubbles: true, cancelable: true, button: 0 }, opts || {}),
  );
}

console.log("── RecentComments 跳转逻辑（产物内联脚本）──");
{
  const env = makeEnv(ORIGIN + "/archives/post-1");
  const { w, lazy, navCalls } = env;
  w.eval(RC_SRC);

  const load = lazy["recent-comments-list"];
  check("NAV-0 lazyInit 注册的 load 是函数", typeof load, "function");
  load();
  await flush();

  const anchors = w.document.querySelectorAll("#recent-comments-list a");
  check("NAV-0 渲染出 3 条评论链接", anchors.length, 3);
  check(
    "NAV-0 同页评论 href 带精准锚点",
    anchors[0].getAttribute("href"),
    "/archives/post-1#comment-next-comment-c-same",
  );
  check(
    "NAV-0 无 permalink 评论保持占位 href",
    anchors[2].getAttribute("href"),
    "#",
  );

  // 事件触发计数（jsdom 的 hashchange 异步派发）
  let hashchangeCount = 0;
  /** 记录 hashchange 触发次数 */
  const onHashchange = () => {
    hashchangeCount++;
  };
  w.addEventListener("hashchange", onHashchange);
  let locateEventCount = 0;
  /** 记录 ethereal:locate-comment 触发次数 */
  const onLocate = () => {
    locateEventCount++;
  };
  w.addEventListener("ethereal:locate-comment", onLocate);

  // NAV-1 跨页评论 ⇒ swup.navigate
  const navB1 = navCalls.length;
  const ret1 = anchors[1].dispatchEvent(leftClick(w));
  check("NAV-1 跨页点击被拦截", ret1, false);
  check("NAV-1 跨页点击走 swup.navigate", navCalls.length, navB1 + 1);
  check(
    "NAV-1 navigate 参数 = permalink + 精准锚点",
    navCalls[navCalls.length - 1],
    "/archives/post-2#comment-next-comment-c-other",
  );

  // NAV-2 同页评论 ⇒ 改 hash，不走 swup
  const navB2 = navCalls.length;
  const ret2 = anchors[0].dispatchEvent(leftClick(w));
  check("NAV-2 同页点击被拦截", ret2, false);
  await flush();
  check("NAV-2 同页点击不走 swup", navCalls.length, navB2);
  check(
    "NAV-2 同页点击改写 location.hash",
    w.location.hash,
    "#comment-next-comment-c-same",
  );
  check("NAV-2 同页点击触发一次 hashchange", hashchangeCount, 1);

  // NAV-3 同页 + hash 已相同 ⇒ 派发自定义事件
  const hb3 = hashchangeCount;
  const lb3 = locateEventCount;
  anchors[0].dispatchEvent(leftClick(w));
  await flush();
  check("NAV-3 同 hash 重复点击不再触发 hashchange", hashchangeCount, hb3);
  check(
    "NAV-3 同 hash 重复点击派发 ethereal:locate-comment",
    locateEventCount,
    lb3 + 1,
  );

  // NAV-4 Ctrl+点击 ⇒ 放行原生（不拦截、不导航）
  const navB4 = navCalls.length;
  const ret4 = anchors[1].dispatchEvent(leftClick(w, { ctrlKey: true }));
  check("NAV-4 Ctrl+点击不拦截（放行原生）", ret4, true);
  check("NAV-4 Ctrl+点击不走 swup", navCalls.length, navB4);
  check(
    "NAV-4 Ctrl+点击不改 hash",
    w.location.hash,
    "#comment-next-comment-c-same",
  );

  // NAV-5 href="#" ⇒ 拦截但无任何导航
  const navB5 = navCalls.length;
  const ret5 = anchors[2].dispatchEvent(leftClick(w));
  check("NAV-5 占位 href 点击被拦截", ret5, false);
  check("NAV-5 占位 href 无任何导航", navCalls.length, navB5);

  // NAV-6 Swup 动画进行中 ⇒ 忽略；结束后恢复
  w.document.documentElement.classList.add("is-animating");
  const navB6 = navCalls.length;
  anchors[1].dispatchEvent(leftClick(w));
  check("NAV-6 换页动画中点击被忽略", navCalls.length, navB6);
  w.document.documentElement.classList.remove("is-animating");
  anchors[1].dispatchEvent(leftClick(w));
  check("NAV-6 动画结束后恢复可点", navCalls.length, navB6 + 1);

  const realErrors = env.jsdomErrors.filter((m) => !/not implemented/i.test(m));
  check("NAV 全程无 jsdom 运行时错误", realErrors.length, 0);
  if (realErrors.length) console.log("   ", realErrors.slice(0, 3).join(" | "));
  env.dom.window.close();
}

console.log("\n── comment-locate 同页锚点监听（产物 comment-locate.js）──");
{
  const env = makeEnv(ORIGIN + "/archives/post-1");
  const { w, countOf } = env;
  w.eval(CL_SRC);
  check("CL-1 hashchange 监听注册一次", countOf("hashchange"), 1);
  check(
    "CL-1 ethereal:locate-comment 监听注册一次",
    countOf("ethereal:locate-comment"),
    1,
  );

  // 模拟 Swup 换页克隆重执行（同一 window 再 eval 一次）⇒ 不得重复注册
  w.eval(CL_SRC);
  check(
    "CL-2 克隆重执行后监听器总数不变",
    countOf("hashchange") + countOf("ethereal:locate-comment"),
    2,
  );

  const realErrors = env.jsdomErrors.filter((m) => !/not implemented/i.test(m));
  check("CL 全程无 jsdom 运行时错误", realErrors.length, 0);
  if (realErrors.length) console.log("   ", realErrors.slice(0, 3).join(" | "));
  env.dom.window.close();
}

console.log("\n── comment-locate 瞬时贴靠（snap）行为 ──");
{
  // 需要 #comment 盒子：精准模式下 snap 路径对它 scrollIntoView
  const virtualConsole = new VirtualConsole();
  /** @type {string[]} */
  const jsdomErrors = [];
  /** @param {any} e */
  const onJsdomError = (e) => {
    jsdomErrors.push(e && e.message ? e.message : String(e));
  };
  virtualConsole.on("jsdomError", onJsdomError);
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="comment"><div id="comment-lazy-placeholder"></div></div>
    </body></html>`,
    {
      url: ORIGIN + "/archives/post-1#comment-next-comment-c-same",
      runScripts: "outside-only",
      pretendToBeVisual: true,
      virtualConsole,
    },
  );
  const w = /** @type {any} */ (dom.window);
  /** @type {any[]} */
  const snapCalls = [];
  const box = w.document.getElementById("comment");
  /** 记录 scrollIntoView 调用（jsdom 原生未实现，桩掉）
   * @param {any} o */
  const recordSnap = (o) => snapCalls.push(o);
  box.scrollIntoView = recordSnap;
  w.eval(CL_SRC);
  // jsdom 构造返回时 readyState 可能仍是 "loading"（bind 挂到 DOMContentLoaded），
  // 等事件落地后再断言；bind 的监听器先注册，事件触发时先跑。
  await new Promise((resolve) => {
    if (w.document.readyState !== "loading") return resolve(null);
    w.document.addEventListener("DOMContentLoaded", () => resolve(null), {
      once: true,
    });
  });

  // CL-3 换页路径（onceBound init 立判）：snap=true ⇒ 瞬时贴靠 + replaceState
  check("CL-3 换页路径瞬时贴靠一次", snapCalls.length, 1);
  check(
    "CL-3 贴靠为 auto+start（瞬时、含 scroll-margin 偏移）",
    JSON.stringify(snapCalls[0]),
    JSON.stringify({ behavior: "auto", block: "start" }),
  );
  check("CL-3 replaceState 暂改 #comment", w.location.hash, "#comment");

  // CL-4 同页路径（hashchange）：snap=false ⇒ 不再贴靠，仍 replaceState
  w.location.hash = "#comment-next-comment-c-other";
  await flush();
  check("CL-4 同页路径不再瞬时贴靠", snapCalls.length, 1);
  check(
    "CL-4 同页路径仍 replaceState 暂改 #comment",
    w.location.hash,
    "#comment",
  );

  const realErrors2 = jsdomErrors.filter((m) => !/not implemented/i.test(m));
  check("CL-3/4 全程无 jsdom 运行时错误", realErrors2.length, 0);
  if (realErrors2.length)
    console.log("   ", realErrors2.slice(0, 3).join(" | "));
  dom.window.close();
}

console.log(`\n${failures === 0 ? "✅ 全部通过" : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);

// @ts-check
// 侧栏小组件缓存桩测（jsdom 真执行构建产物内联脚本）
//
// 被测（都是 templates/index.html 里的内联脚本，源码分别是
// src/components/widget/RecentComments.astro 与 PopularPosts.astro）：
//   ① RecentComments —— 侧栏「最近评论」
//   ② PopularPosts   —— 侧栏「热门文章」
//
// 为什么需要它：侧栏延迟的观感来自两层应用缓存叠加（主题 sessionStorage +
// 插件服务端进程内缓存），CDN 层已实测 no-store。这里只锁主题端这一层的行为。
//
// 断言链：
//   RC-1 未过期缓存 ⇒ 直接渲染、不发请求
//   RC-2 过期缓存   ⇒ 重发请求（TTL 从 5 分钟降到 30 秒的核心诉求）
//   RC-3 halo:comment:created / :comment-reply:created ⇒ 清缓存 + 立即重拉
//   RC-4 脚本被重复执行（模拟 Swup 换页克隆重执行）⇒ 监听器只注册一次
//   PP-1 新格式 {ts,posts} 未过期 ⇒ 命中缓存不发请求
//   PP-2 新格式过期 ⇒ 重发请求
//   PP-3 旧裸数组格式（无 ts）⇒ 判失效重发请求（老会话残留不能永远钉住）
//   PP-4 真请求回填新格式 {ts,posts}
//
// 运行（JSDOM 在 managed workspace，不在仓库依赖里）：
//   NODE_PATH="C:/Users/LQ/.workbuddy/binaries/node/workspace/node_modules" \
//   "C:/Users/LQ/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" scripts/test-widget-cache.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_MODULE || "jsdom");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = join(ROOT, "templates/index.html");
const ORIGIN = "https://example.test";

const RC_KEY = "ethereal-recent-comments";
const PP_KEY = "popular_posts_v1";

const html = readFileSync(INDEX, "utf8");

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "✅" : "❌"} ${name}：实得 ${JSON.stringify(actual)} / 应有 ${JSON.stringify(expected)}`,
  );
}
function ok(name, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? `：${detail}` : ""}`);
}

/** 从产物 index.html 抠出「含锚点的那个内联脚本」的脚本体（去掉 <script ...> 标签） */
function extractInlineScript(source, anchor) {
  const i = source.indexOf(anchor);
  if (i < 0) throw new Error(`产物里找不到锚点：${anchor}`);
  const start = source.lastIndexOf("<script", i);
  const openEnd = source.indexOf(">", start);
  const end = source.indexOf("</script>", i);
  return source.slice(openEnd + 1, end);
}

const RC_SRC = extractInlineScript(html, "var LIMIT=5;");
const PP_SRC = extractInlineScript(html, PP_KEY);

const flush = async (n = 8) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

// 一条缓存里的评论（renderComments 消费 shape：owner/spec 两层）
const cachedComment = (name) => ({
  metadata: { name: `c-${name}` },
  owner: { displayName: name },
  spec: {
    content: `${name} 的评论`,
    creationTime: new Date(Date.now() - 60000).toISOString(),
  },
});

// 一篇热门文章（renderList 消费 shape）
const post = {
  metadata: { name: "post-1" },
  spec: { title: "文章一", slug: "post-1", publish: true, visible: "PUBLIC" },
  status: { permalink: "/archives/post-1" },
  stats: { visit: 12, comment: 1 },
};

function makeEnv() {
  const virtualConsole = new VirtualConsole();
  const jsdomErrors = [];
  virtualConsole.on("jsdomError", (e) =>
    jsdomErrors.push(e && e.message ? e.message : String(e)),
  );

  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="recent-comments-list"><div class="loading">加载中...</div></div>
      <div id="popular-posts-list"></div>
    </body></html>`,
    {
      url: ORIGIN + "/",
      runScripts: "outside-only",
      pretendToBeVisual: true,
      virtualConsole,
    },
  );
  const w = /** @type {any} */ (dom.window);

  // 监听器登记（断言「只注册一次」）
  const listeners = [];
  const origAdd = w.addEventListener.bind(w);
  w.addEventListener = (type, fn, opts) => {
    listeners.push({ type, fn });
    return origAdd(type, fn, opts);
  };
  const countOf = (type) => listeners.filter((l) => l.type === type).length;

  // 懒加载钩子：只登记不执行，让测试自己控制 load 时机
  const lazy = {};
  w.__themeLazyInit = (id, fn) => {
    lazy[id] = fn;
  };
  w.__etherealI18n = (_k, fb) => fb;
  w.__etherealBigNum = (n, _k, suffix) => String(n) + suffix;
  if (typeof w.AbortController === "undefined")
    w.AbortController = AbortController;

  // fetch 桩：按 URL 分辨是「最近评论聚合端点」还是「文章列表」
  const fetchCalls = [];
  w.fetch = (input) => {
    const url = String(input);
    fetchCalls.push(url);
    const body = url.includes("comments/latest")
      ? {
          items: [
            {
              name: "live-1",
              displayName: "实时用户",
              content: "服务端最新评论",
              creationTime: new Date().toISOString(),
              permalink: "/archives/post-1",
            },
          ],
        }
      : { items: [post] };
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    });
  };

  return { dom, w, lazy, fetchCalls, listeners, countOf, jsdomErrors };
}

const listHtml = (w, id) => String(w.document.getElementById(id).innerHTML);

console.log("── RecentComments（侧栏「最近评论」）──");
{
  const env = makeEnv();
  const { w, lazy, fetchCalls, countOf } = env;
  w.eval(RC_SRC);

  check(
    "RC-0 lazyInit 注册的 load 是函数",
    typeof lazy["recent-comments-list"],
    "function",
  );
  check("RC-0 __rcReload 暴露给事件回调", typeof w.__rcReload, "function");
  check(
    "RC-0 两个评论事件各注册一次",
    countOf("halo:comment:created") + countOf("halo:comment-reply:created"),
    2,
  );

  const load = lazy["recent-comments-list"];

  // RC-1 未过期缓存 ⇒ 不发请求
  w.sessionStorage.setItem(
    RC_KEY,
    JSON.stringify({
      ts: Date.now() - 5000,
      comments: [cachedComment("缓存用户")],
    }),
  );
  const base1 = fetchCalls.length;
  load();
  await flush();
  check("RC-1 未过期缓存不发请求", fetchCalls.length, base1);
  ok(
    "RC-1 命中缓存后渲染出内容",
    listHtml(w, "recent-comments-list").includes("缓存用户"),
    `innerHTML=${listHtml(w, "recent-comments-list").length}B`,
  );

  // RC-2 过期缓存 ⇒ 重发请求（TTL=30s）
  w.sessionStorage.setItem(
    RC_KEY,
    JSON.stringify({
      ts: Date.now() - 31000,
      comments: [cachedComment("过期用户")],
    }),
  );
  const base2 = fetchCalls.length;
  load();
  await flush();
  check("RC-2 过期 31s 的缓存触发重请求", fetchCalls.length, base2 + 1);
  ok(
    "RC-2 重请求打到聚合端点",
    fetchCalls[fetchCalls.length - 1].includes("comments/latest"),
    fetchCalls[fetchCalls.length - 1],
  );
  ok(
    "RC-2 渲染为服务端新数据",
    listHtml(w, "recent-comments-list").includes("实时用户"),
  );

  // 25 秒前（< 30s）仍应命中，边界另一侧
  w.sessionStorage.setItem(
    RC_KEY,
    JSON.stringify({
      ts: Date.now() - 25000,
      comments: [cachedComment("边界用户")],
    }),
  );
  const base2b = fetchCalls.length;
  load();
  await flush();
  check("RC-2 过期 25s 的缓存仍命中", fetchCalls.length, base2b);

  // RC-3 评论创建事件 ⇒ 清缓存 + 立即重拉
  w.sessionStorage.setItem(
    RC_KEY,
    JSON.stringify({ ts: Date.now(), comments: [cachedComment("事件前")] }),
  );
  const base3 = fetchCalls.length;
  w.dispatchEvent(new w.Event("halo:comment:created"));
  check("RC-3 事件同步清掉缓存", w.sessionStorage.getItem(RC_KEY), null);
  await flush();
  check("RC-3 事件触发一次重拉", fetchCalls.length, base3 + 1);

  // 回复事件走同一条通路
  const base3b = fetchCalls.length;
  w.dispatchEvent(new w.Event("halo:comment-reply:created"));
  await flush();
  check("RC-3 回复事件同样触发重拉", fetchCalls.length, base3b + 1);

  // RC-4 Swup 换页克隆重执行脚本 ⇒ 监听器不得重复绑定
  const beforeCount =
    countOf("halo:comment:created") + countOf("halo:comment-reply:created");
  w.eval(RC_SRC);
  const afterCount =
    countOf("halo:comment:created") + countOf("halo:comment-reply:created");
  check("RC-4 脚本重执行后监听器总数不变", afterCount, beforeCount);
  ok("RC-4 重执行后 __rcReload 指向新闭包", typeof w.__rcReload === "function");
  const base4 = fetchCalls.length;
  w.dispatchEvent(new w.Event("halo:comment:created"));
  await flush();
  check("RC-4 重执行后事件只重拉一次", fetchCalls.length, base4 + 1);

  check("RC-4 全程无 jsdom 运行时错误", env.jsdomErrors.length, 0);
  if (env.jsdomErrors.length)
    console.log("   ", env.jsdomErrors.slice(0, 3).join(" | "));
  env.dom.window.close();
}

console.log("\n── PopularPosts（侧栏「热门文章」）──");
{
  const env = makeEnv();
  const { w, lazy, fetchCalls } = env;
  w.eval(PP_SRC);

  check(
    "PP-0 lazyInit 注册的 load 是函数",
    typeof lazy["popular-posts-list"],
    "function",
  );
  const load = lazy["popular-posts-list"];

  // PP-1 新格式未过期 ⇒ 命中
  w.sessionStorage.setItem(
    PP_KEY,
    JSON.stringify({ ts: Date.now() - 5000, posts: [post] }),
  );
  const base1 = fetchCalls.length;
  load();
  await flush();
  check("PP-1 新格式未过期不发请求", fetchCalls.length, base1);
  ok(
    "PP-1 命中缓存后渲染出标题",
    listHtml(w, "popular-posts-list").includes("文章一"),
  );

  // PP-2 新格式过期 ⇒ 重发
  w.sessionStorage.setItem(
    PP_KEY,
    JSON.stringify({ ts: Date.now() - 31000, posts: [post] }),
  );
  const base2 = fetchCalls.length;
  load();
  await flush();
  check("PP-2 新格式过期 31s 触发重请求", fetchCalls.length, base2 + 1);

  // PP-3 旧裸数组格式（改动前的残留）⇒ 判失效
  w.sessionStorage.setItem(PP_KEY, JSON.stringify([post]));
  const base3 = fetchCalls.length;
  load();
  await flush();
  check("PP-3 旧裸数组格式判失效重请求", fetchCalls.length, base3 + 1);

  // PP-4 真请求回填新格式
  let stored = null;
  try {
    stored = JSON.parse(w.sessionStorage.getItem(PP_KEY) || "null");
  } catch {
    stored = null;
  }
  ok(
    "PP-4 回填为 {ts,posts} 新格式",
    !!(stored && typeof stored.ts === "number" && Array.isArray(stored.posts)),
    JSON.stringify(
      stored && {
        ts: typeof stored.ts,
        posts: stored.posts && stored.posts.length,
      },
    ),
  );

  check("PP-4 全程无 jsdom 运行时错误", env.jsdomErrors.length, 0);
  if (env.jsdomErrors.length)
    console.log("   ", env.jsdomErrors.slice(0, 3).join(" | "));
  env.dom.window.close();
}

console.log(`\n${failures === 0 ? "✅ 全部通过" : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);

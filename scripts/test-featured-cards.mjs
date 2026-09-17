#!/usr/bin/env node
/**
 * 顶部两卡行（FeaturedCards）行为回归 —— 跑构建产物 `templates/assets/featured-cards.js`。
 *
 * 覆盖（都是「不测就会悄悄坏」的点）：
 *   [1] 右卡 recent：只发 1 次请求、排序用 creationTimestamp，并把取回文章填进 DOM
 *   [2] 右卡 popular：排序换成 stats.visit（与侧栏「热门文章」同口径）
 *   [3] 会话缓存：Swup 换页重执行脚本时不再打接口，直接用 sessionStorage 渲染
 *   [4] 取数失败：保留服务端已渲染的兜底内容，只把 data-state 标 fallback（不空窗）
 *   [5] 左卡点击：取 total → 随机页 → 随机篇 → 恰好 1 次导航（swup.navigate 优先）
 *   [6] 防重入：连点两次只发一组请求、只导航一次（键盘 Enter 走同一入口）
 *   [7] 左卡取数全挂：也要有去处（兜底跳 /archives），不能让点击落空
 *   [8] 取回的文章无封面：切 is-cover-empty 并**摘掉 img 的 src**（空 src 会打当前页）
 *
 * 用法：node scripts/test-featured-cards.mjs [templates/assets/featured-cards.js]
 */
import fs from "node:fs";

const target = process.argv[2] || "templates/assets/featured-cards.js";
const code = fs.readFileSync(target, "utf8");

const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

// ---------- 极简 DOM 桩（只实现脚本用到的那部分） ----------
function mkEl(tag, attrs = {}, text = "") {
  const el = {
    tagName: tag,
    _attrs: { ...attrs },
    _children: [],
    _cls: new Set((attrs.class || "").split(/\s+/).filter(Boolean)),
    _text: text,
    dataset: {},
    _listeners: {},
    get className() {
      return [...this._cls].join(" ");
    },
    set className(v) {
      this._cls = new Set(String(v).split(/\s+/).filter(Boolean));
    },
    classList: {
      add: (c) => el._cls.add(c),
      remove: (c) => el._cls.delete(c),
      contains: (c) => el._cls.has(c),
    },
    get textContent() {
      return this._text;
    },
    set textContent(v) {
      this._text = String(v);
    },
    getAttribute(k) {
      return k in this._attrs ? this._attrs[k] : null;
    },
    setAttribute(k, v) {
      this._attrs[k] = String(v);
    },
    removeAttribute(k) {
      delete this._attrs[k];
    },
    addEventListener(t, fn) {
      (this._listeners[t] = this._listeners[t] || []).push(fn);
    },
    dispatch(t, ev) {
      (this._listeners[t] || []).forEach((fn) => fn(ev || {}));
    },
    appendChild(c) {
      this._children.push(c);
      return c;
    },
    _all(out = []) {
      out.push(this);
      this._children.forEach((c) => c._all(out));
      return out;
    },
    querySelector(sel) {
      return this._all().find((n) => n !== this && match(n, sel)) || null;
    },
  };
  return el;
}

/** 只支持本用例需要的三种选择器：.class / [data-x] / 组合（按空格分隔的追加条件） */
function match(el, sel) {
  const parts = sel
    .trim()
    .split(/(?=[.[])/)
    .filter(Boolean);
  return parts.every((p) => {
    if (p.startsWith(".")) return el._cls.has(p.slice(1));
    if (p.startsWith("[")) return el.getAttribute(p.slice(1, -1)) !== null;
    return el.tagName === p;
  });
}

const POST = (id, { cover = "https://img/x.webp", visit = 1234 } = {}) => ({
  metadata: { name: id },
  spec: {
    title: "标题 " + id,
    cover,
    publish: true,
    visible: "PUBLIC",
    publishTime: "2026-08-0" + (id.length % 9) + "T10:00:00Z",
  },
  // ⚠️ 摘要在 status 上（不是 spec）—— 与 Halo 实际模型一致，放错层会得到「摘要已填」假阴性
  status: { permalink: "/archives/" + id, excerpt: "摘要 " + id },
  stats: { visit, comment: 3 },
});

function makeEnv({
  source = "recent",
  failTop = false,
  total = 100,
  hang = false,
  topPost = null,
} = {}) {
  const top = topPost || POST("top");
  // 卡片内部节点
  const nodes = {
    title: mkEl("span"),
    excerpt: mkEl("span"),
    date: mkEl("span"),
    visit: mkEl("span"),
    badge: mkEl("span", {}, "最近文章"),
    img: mkEl("img"),
    cover: mkEl("span", { "data-featured-cover": "" }),
    words: mkEl("span"),
  };
  nodes.title.setAttribute("data-featured-title", "");
  nodes.excerpt.setAttribute("data-featured-excerpt", "");
  nodes.date.setAttribute("data-featured-date", "");
  nodes.visit.setAttribute("data-featured-visit", "");
  nodes.badge.setAttribute("data-featured-badge", "");
  nodes.cover.className = "featured-cover";
  nodes.img.className = "featured-img";
  nodes.cover.appendChild(nodes.img);

  const card = mkEl("a", { id: "featured-post", href: "/archives/fallback" });
  [
    nodes.cover,
    nodes.title,
    nodes.excerpt,
    nodes.date,
    nodes.visit,
    nodes.badge,
  ].forEach((n) => card.appendChild(n));
  const btn = mkEl("button", { id: "featured-random" });

  const row = mkEl("div", { id: "featured-cards", "data-source": source });
  row.appendChild(
    mkEl("span", { class: "hidden", "data-label-popular": "" }, "热门文章"),
  );
  row.appendChild(
    mkEl("span", { class: "hidden", "data-label-recent": "" }, "最近文章"),
  );
  row.appendChild(btn);
  row.appendChild(card);

  const byId = {
    "featured-cards": row,
    "featured-random": btn,
    "featured-post": card,
  };

  const calls = [];
  const navs = [];
  const fetchStub = (url) => {
    const u = String(url);
    calls.push(u);
    if (hang) return new Promise(() => {});
    if (failTop) return Promise.resolve({ ok: false, status: 500 });
    // ⚠️ 「取 Top1」与「随机跳转问 total」用的是**同一个 URL**（page=0&size=1&sort=…）
    //    ⇒ 桩件只需返回 { total, items:[top] }：Top1 用 items[0]、随机流程只读 total ✓
    if (/size=1/.test(u)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ total, items: [top] }),
      });
    }
    if (/size=20/.test(u)) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            total,
            items: [POST("r1"), POST("r2"), POST("r3")],
          }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ total: 1, items: [top] }),
    });
  };

  const store = () => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      _map: m,
    };
  };
  const win = {
    sessionStorage: store(),
    localStorage: store(),
    swup: { navigate: (u) => navs.push(u) },
    location: { href: "" },
  };

  return {
    row,
    btn,
    card,
    nodes,
    calls,
    navs,
    win,
    run() {
      const fn = new Function(
        "window",
        "document",
        "console",
        "setTimeout",
        "clearTimeout",
        "fetch",
        code,
      );
      fn(
        win,
        { getElementById: (id) => byId[id] || null },
        { warn() {}, log() {}, error() {}, info() {} },
        setTimeout,
        clearTimeout,
        fetchStub,
      );
    },
  };
}

let pass = 0;
const fails = [];
function check(label, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fails.push(label);
    console.log(`  ✗ ${label}${extra ? "  → " + extra : ""}`);
  }
}

console.log(`被测产物：${target}（${code.length} 字符）\n`);

// ================= 静态断言（产物 HTML / CSS / i18n） =================
{
  const pathMod = await import("node:path");
  const urlMod = await import("node:url");
  const repoRoot = pathMod.resolve(
    pathMod.dirname(urlMod.fileURLToPath(import.meta.url)),
    "..",
  );
  const tplDir = pathMod.join(repoRoot, "templates");
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
  const idx = read(pathMod.join(tplDir, "index.html"));
  const cat = read(pathMod.join(tplDir, "category.html"));
  let css = "";
  const assets = pathMod.join(tplDir, "assets");
  if (fs.existsSync(assets)) {
    for (const f of fs.readdirSync(assets))
      if (f.endsWith(".css")) css += read(pathMod.join(assets, f));
  }
  css += (idx.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join("\n");

  console.log("[0] 产物静态断言");
  check("首页有 #featured-cards", idx.includes('id="featured-cards"'));
  check(
    "类别页**没有**两卡行（只在首页渲染）",
    cat.length > 0 && !cat.includes('id="featured-cards"'),
  );
  const iRow = idx.indexOf('id="featured-cards"');
  const iList = idx.indexOf('id="post-list-container"');
  check(
    "两卡行在列表容器之前（红线位置）",
    iRow > -1 && iRow < iList,
    `${iRow} < ${iList}`,
  );
  check(
    "设置门控 featuredEnable 在产物里",
    /featuredEnable == null or theme\.config\?\.layout\?\.postList\?\.featuredEnable/.test(
      idx,
    ),
  );
  check(
    "仅首页第一页：posts.page == 1 门控在产物里",
    /and posts\.page == 1/.test(idx),
  );
  check(
    "来源设置读的是 layout.postList.featuredSource",
    /layout\?\.postList\?\.featuredSource/.test(idx),
  );
  check(
    "左卡是 <button>（键盘语义，可 Enter 触发）",
    idx.includes('id="featured-random"') &&
      /<button[^>]*id="featured-random"/.test(idx),
  );
  check("右卡是 <a>（可点整卡）", /<a[^>]*id="featured-post"/.test(idx));
  check(
    "i18n 文案经隐藏节点透传（脚本不写死中文）",
    idx.includes("data-label-popular") && idx.includes("data-label-recent"),
  );
  check(
    "交互面齐全：hover 上浮 / active 按压 / focus-visible / reduced-motion",
    /\.featured-card:hover\{[^}]*translateY\(-2px\)/.test(css) &&
      /\.featured-card:active\{[^}]*scale\(\.995\)|\.featured-card:active\{[^}]*scale\(0?\.995\)/.test(
        css,
      ) &&
      /\.featured-card:focus-visible\{[^}]*outline/.test(css) &&
      /prefers-reduced-motion[\s\S]{0,700}\.featured-card/.test(css),
  );
  check(
    "箭头带半透明圆底（浅封面可辨）",
    /\.featured-arrow-chip\{[^}]*background:(#000000[0-9a-f]{2}|rgb\(0 0 0)/.test(
      css,
    ),
  );
  check(
    "桌面 34/66 两列、右侧卡 44/56 左图右文",
    /\.featured-row\{[^}]*grid-template-columns:minmax\(0,\s*34%\)/.test(css) &&
      /\.featured-card--post\{[^}]*grid-template-columns:minmax\(0,\s*44%\)/.test(
        css,
      ),
  );
  for (const [file, word] of [
    ["default.properties", "Random post"],
    ["zh_CN.properties", "随机一篇文章"],
    ["zh_TW.properties", "隨機一篇文章"],
  ]) {
    const txt = read(pathMod.join(repoRoot, "i18n", file));
    check(
      `${file} 有 featured.random.title`,
      new RegExp(`^featured\\.random\\.title=${word}`, "m").test(txt),
    );
    check(
      `${file} 有 featured.badge.popular / recent / readMore`,
      /^featured\.badge\.popular=.+/m.test(txt) &&
        /^featured\.badge\.recent=.+/m.test(txt) &&
        /^featured\.readMore=.+/m.test(txt),
    );
  }
  console.log("");
}

console.log("[1] 右卡 recent：1 次请求 + 排序正确 + 填充 DOM");
{
  const e = makeEnv({ source: "recent" });
  e.run();
  await flush();
  check("只发 1 次请求", e.calls.length === 1, e.calls.join(" | "));
  check(
    "按创建时间倒序（最近）且 size=1",
    /sort=metadata\.creationTimestamp,desc/.test(e.calls[0]) &&
      /size=1/.test(e.calls[0]),
    e.calls[0],
  );
  check(
    "标题已填",
    e.nodes.title.textContent === "标题 top",
    e.nodes.title.textContent,
  );
  check("摘要已填", e.nodes.excerpt.textContent === "摘要 top");
  check(
    "日期已填（取前 10 位）",
    /^\d{4}-\d{2}-\d{2}$/.test(e.nodes.date.textContent),
    e.nodes.date.textContent,
  );
  check("访问量已填", e.nodes.visit.textContent === "1234");
  check(
    "徽章文案 = 最近文章",
    e.nodes.badge.textContent === "最近文章",
    e.nodes.badge.textContent,
  );
  check(
    "卡片 href 指向该文",
    e.card.getAttribute("href") === "/archives/top",
    e.card.getAttribute("href"),
  );
  check(
    "封面 src 已填（带 CDN 后缀函数结果）",
    String(e.nodes.img.getAttribute("src")).startsWith("https://img/x.webp"),
    String(e.nodes.img.getAttribute("src")),
  );
  check("状态标记 ready", e.card.getAttribute("data-state") === "ready");
}

console.log("[2] 右卡 popular：排序换成 stats.visit");
{
  const e = makeEnv({ source: "popular" });
  e.run();
  await flush();
  check(
    "排序 = stats.visit,desc",
    /sort=stats\.visit,desc/.test(e.calls[0]),
    e.calls[0],
  );
  check(
    "徽章文案 = 热门文章",
    e.nodes.badge.textContent === "热门文章",
    e.nodes.badge.textContent,
  );
}

console.log("[3] 会话缓存：重执行不再打接口");
{
  const e = makeEnv({ source: "recent" });
  e.run();
  await flush();
  const first = e.calls.length;
  // 模拟 Swup 换页重执行（同一 window/sessionStorage，新的 DOM 节点）
  const e2 = makeEnv({ source: "recent" });
  e2.win.sessionStorage = e.win.sessionStorage;
  e2.run();
  await flush();
  check("第二次执行 0 请求", e2.calls.length === 0, e2.calls.join(" | "));
  check(
    "但仍从缓存渲染出内容",
    e2.nodes.title.textContent === "标题 top",
    e2.nodes.title.textContent,
  );
  check("首次确实请求过", first === 1, String(first));
}

console.log("[4] 取数失败：保留服务端兜底，不空窗");
{
  const e = makeEnv({ source: "popular", failTop: true });
  e.nodes.title.textContent = "服务端兜底标题";
  e.run();
  await flush();
  check(
    "内容保持服务端渲染的那篇",
    e.nodes.title.textContent === "服务端兜底标题",
    e.nodes.title.textContent,
  );
  check(
    "状态标记 fallback",
    e.card.getAttribute("data-state") === "fallback",
    e.card.getAttribute("data-state"),
  );
}

console.log("[5] 左卡点击：取 total → 随机页 → 恰好 1 次导航");
{
  const e = makeEnv();
  e.run();
  await flush();
  e.calls.length = 0;
  e.btn.dispatch("click");
  await flush(10);
  check(
    "发了 2 次请求（total + 随机页）",
    e.calls.length === 2,
    e.calls.join(" | "),
  );
  check("第一次是 size=1 问 total", /size=1/.test(e.calls[0]), e.calls[0]);
  check(
    "第二次是 size=20 的某一页",
    /size=20/.test(e.calls[1]) && /page=\d/.test(e.calls[1]),
    e.calls[1],
  );
  check(
    "恰好导航 1 次（走 swup.navigate）",
    e.navs.length === 1,
    e.navs.join(" | "),
  );
  check(
    "目标是随机页里的某篇",
    /^\/archives\/r[123]$/.test(e.navs[0] || ""),
    e.navs[0],
  );
}

console.log("[6] 防重入：连点两次只走一遍");
{
  const e = makeEnv();
  e.run();
  await flush();
  e.calls.length = 0;
  e.btn.dispatch("click");
  e.btn.dispatch("click");
  await flush(10);
  check(
    "只发 2 次请求（不是 4 次）",
    e.calls.length === 2,
    e.calls.join(" | "),
  );
  check("只导航 1 次", e.navs.length === 1, e.navs.join(" | "));
}

console.log("[7] 左卡取数全挂：兜底跳 /archives");
{
  const e = makeEnv({ failTop: true });
  e.run();
  await flush();
  e.btn.dispatch("click");
  await flush(10);
  check(
    "导航到兜底地址",
    e.navs.length === 1 && e.navs[0] === "/archives",
    e.navs.join(" | "),
  );
  check(
    "busy 已复位（可再次点击）",
    e.btn.dataset.busy === "",
    JSON.stringify(e.btn.dataset),
  );
}

console.log("[8] 取回文章无封面：切 is-cover-empty 并摘掉 src");
{
  const noCover = { ...POST("top"), spec: { ...POST("top").spec, cover: "" } };
  const e = makeEnv({ source: "recent", topPost: noCover });
  e.nodes.img.setAttribute("src", "https://img/old.webp"); // 服务端兜底那篇是有封面的
  e.run();
  await flush();
  check(
    "封面容器切到 is-cover-empty",
    e.nodes.cover.classList.contains("is-cover-empty"),
    e.nodes.cover.className,
  );
  check(
    "img 的 src 被摘掉（否则空 src 会打当前页）",
    e.nodes.img.getAttribute("src") === null,
    String(e.nodes.img.getAttribute("src")),
  );
  check(
    "状态仍标记 ready（内容有效）",
    e.card.getAttribute("data-state") === "ready",
  );
}

console.log(
  `\n通过 ${pass} 项${fails.length ? `，失败 ${fails.length} 项：\n - ${fails.join("\n - ")}` : "，全部通过"}`,
);
process.exit(fails.length ? 1 : 0);

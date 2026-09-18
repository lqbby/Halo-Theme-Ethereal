#!/usr/bin/env node
/**
 * 顶部两卡行（FeaturedCards）行为回归 —— 1.5.31 按参考站 https://daily.yybb.us/ 重做后整套重写。
 *
 * 1.5.30 那版断言的是「方块整组转一圈」+「两层叠层」，1.5.31 两处动效都换了实现
 * ⇒ 旧断言全部失效，这里按**新结构**重写（产物字节是唯一真相，断言文本都从产物里抄的）。
 *
 * 覆盖（都是「不测就会悄悄坏」的点）：
 *   [0] 产物静态断言：HTML 结构 / 压缩后 CSS 的几何常量 / i18n 文案
 *   [1] 右卡 recent：1 次请求（size=4）、排序 creationTimestamp、填满 4 张叠层并分档位
 *   [2] 右卡 popular：排序换成 stats.visit（与侧栏「热门文章」同口径）+ 徽章文案
 *   [3] 右卡 ‹ › 换档：next / prev 在 is-front / is-mid / is-back 三档间轮换
 *   [4] 右卡缓存：Swup 换页重执行不再打接口，但仍从 sessionStorage 渲染
 *   [5] 右卡取数失败：保留服务端已渲染的兜底，只标 data-state=fallback（不空窗）
 *   [6] 左卡点击：2 次请求（问 total → 随机页）→ 拉开全屏转盘的**几何**（面数/步角/半径/仰角）
 *        → 走完两段式动画 + 停顿时长后**恰好 1 次导航**、并清场
 *   [7] 左卡 Esc 取消：不导航、浮层与 body 类都摘掉、busy 复位
 *   [8] 左卡防重入：连点两次只发一组请求、只导航一次
 *   [9] 左卡取数全挂：也要有去处（兜底跳 /archives）且 busy 复位
 *  [10] prefers-reduced-motion：不做转盘、直接跳，但仍要复位 busy（否则回退页面按钮永久锁死）
 *  [11] 无封面文章：切 is-cover-empty 且**摘掉 img 的 src**（空 src 会打当前页）
 *
 * 用法：node scripts/test-featured-cards.mjs [templates/assets/featured-cards.js]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2] || "templates/assets/featured-cards.js";
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
/** 产物目录跟被测脚本走（`<theme>/templates/assets/x.js` ⇒ `<theme>/templates`） */
const tplDir = (() => {
  const guess = path.resolve(path.dirname(target), "..");
  return fs.existsSync(path.join(guess, "index.html"))
    ? guess
    : path.join(repoRoot, "templates");
})();
const themeRoot = fs.existsSync(path.join(tplDir, "..", "i18n"))
  ? path.resolve(tplDir, "..")
  : repoRoot;

const code = fs.readFileSync(target, "utf8");

/**
 * 转盘脚本的**源码**（不是产物）：焦点管理 / 串行加载这类「写法本身即契约」的断言必须看源码
 * —— 产物会被压缩，字符串断言会被压碎。路径基准是 themeRoot。
 */
const carouselSrc = (() => {
  const p = path.join(themeRoot, "src/scripts/assets/_random-post-carousel.ts");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
})();

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const flush = async (n = 8) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

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

// ================== 迷你 DOM ==================
/** 选择器只支持本用例用到的形态：tag / .class / #id / [attr] / 以及它们的拼接 */
function match(el, sel) {
  const parts = sel
    .trim()
    .split(/(?=[.#[])/)
    .filter(Boolean);
  return parts.every((p) => {
    if (p.startsWith("#")) return el._attrs.id === p.slice(1);
    if (p.startsWith(".")) return el._cls.has(p.slice(1));
    if (p.startsWith("[")) {
      const body = p.slice(1, -1);
      const eq = body.indexOf("=");
      if (eq < 0) return el.getAttribute(body) !== null;
      const k = body.slice(0, eq);
      const v = body.slice(eq + 1).replace(/^["']|["']$/g, "");
      return el.getAttribute(k) === v;
    }
    return el.tagName === p.toUpperCase();
  });
}

function mkEl(tag, attrs = {}, text = "") {
  const el = {
    tagName: String(tag).toUpperCase(),
    parentNode: null,
    _attrs: { ...attrs },
    _children: [],
    _cls: new Set(
      String(attrs.class || "")
        .split(/\s+/)
        .filter(Boolean),
    ),
    _text: text,
    dataset: {},
    _listeners: {},
    // 真 DOM 元素恒有 .style；桩件不给的话，任何写内联样式的地方都会炸（paintCategory 踩过）
    _style: {
      setProperty(k, v) {
        this[k] = String(v);
      },
    },
    get style() {
      return this._style;
    },
    get className() {
      return [...this._cls].join(" ");
    },
    set className(v) {
      this._cls = new Set(String(v).split(/\s+/).filter(Boolean));
    },
    get textContent() {
      return this._text;
    },
    set textContent(v) {
      this._text = String(v);
    },
    classList: {
      // ⚠️ 必须变参：产品里是 remove("is-front","is-mid","is-back","is-hidden")，
      //    只吃第一个参数会留下脏类，换档断言就会「越换越乱」（踩过）
      add: (...cs) => cs.forEach((c) => el._cls.add(c)),
      remove: (...cs) => cs.forEach((c) => el._cls.delete(c)),
      contains: (c) => el._cls.has(c),
      toggle: (c) => (el._cls.has(c) ? el._cls.delete(c) : el._cls.add(c)),
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
      c.parentNode = el;
      el._children.push(c);
      return c;
    },
    removeChild(c) {
      const i = el._children.indexOf(c);
      if (i >= 0) el._children.splice(i, 1);
      c.parentNode = null;
      return c;
    },
    contains(node) {
      let n = node;
      while (n) {
        if (n === el) return true;
        n = n.parentNode;
      }
      return false;
    },
    closest(sel) {
      let n = el;
      while (n) {
        if (match(n, sel)) return n;
        n = n.parentNode;
      }
      return null;
    },
    _descend(out = []) {
      el._children.forEach((c) => {
        out.push(c);
        c._descend(out);
      });
      return out;
    },
    querySelector(sel) {
      return el._descend().find((n) => match(n, sel)) || null;
    },
    querySelectorAll(sel) {
      return el._descend().filter((n) => match(n, sel));
    },
  };
  return el;
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
  categories: [{ spec: { displayName: "博客" } }],
  stats: { visit, comment: 3 },
});

/** 右卡的叠层卡（服务端预渲染的那 3~4 张，类名由 th:classappend 给） */
function buildCard(extraCls, state = "pending") {
  const card = mkEl("a", {
    class: "featured-card featured-card--post " + extraCls,
    href: "/",
  });
  card.setAttribute("data-state", state);

  const cover = mkEl("span", { class: "featured-cover" });
  cover.setAttribute("data-featured-cover", "");
  const veil = mkEl("span", { class: "featured-veil" });
  const arrow = mkEl("span", { class: "featured-arrow" });
  arrow.appendChild(mkEl("span", { class: "featured-arrow-chip" }));
  const img = mkEl("img", { class: "featured-img" });
  const fb = mkEl("span", { class: "featured-cover-fallback" });
  cover.appendChild(veil);
  cover.appendChild(arrow);
  cover.appendChild(img);
  cover.appendChild(fb);

  const body = mkEl("span", { class: "featured-body" });
  const title = mkEl("span", { class: "featured-title" });
  title.setAttribute("data-featured-title", "");
  const excerpt = mkEl("span", { class: "featured-excerpt" });
  excerpt.setAttribute("data-featured-excerpt", "");

  const foot = mkEl("span", { class: "featured-card-foot" });
  const badge = mkEl("span", { class: "featured-badge" });
  const badgeText = mkEl("span", {});
  badgeText.setAttribute("data-featured-badge", "");
  badge.appendChild(badgeText);

  const cat = mkEl("span", { class: "featured-cat" });
  const sq = mkEl("span", { class: "featured-cat-square" });
  sq.setAttribute("data-featured-cat-square", "");
  const catName = mkEl("span", {});
  catName.setAttribute("data-featured-cat", "");
  cat.appendChild(sq);
  cat.appendChild(catName);

  const meta = mkEl("span", { class: "featured-meta" });
  const date = mkEl("span", {});
  date.setAttribute("data-featured-date", "");
  meta.appendChild(date);

  foot.appendChild(badge);
  foot.appendChild(cat);
  foot.appendChild(meta);
  body.appendChild(title);
  body.appendChild(excerpt);
  body.appendChild(foot);
  card.appendChild(cover);
  card.appendChild(body);
  return {
    card,
    cover,
    img,
    title,
    excerpt,
    badgeText,
    sq,
    catName,
    cat,
    date,
  };
}

function makeEnv({
  source = "recent",
  fail = false,
  total = 100,
  reduce = false,
  topPost = null,
  cardCount = 4,
  firstNoCover = false,
} = {}) {
  const top = topPost || POST("top");

  // ---- body 树 ----
  const body = mkEl("body");
  const documentElement = mkEl("html");
  const row = mkEl("div", { id: "featured-cards" });
  row.setAttribute("data-source", source);
  row.setAttribute("data-img-provider", "none");
  row.setAttribute("data-img-format", "");
  for (const name of ["popular", "recent", "random", "hint"]) {
    const lab = mkEl("span", { class: "hidden" });
    lab.setAttribute("data-label-" + name, "");
    lab.textContent =
      {
        popular: "热门文章",
        recent: "最近文章",
        random: "随机一篇文章",
        hint: "按 Esc 取消",
      }[name] || name;
    row.appendChild(lab);
  }

  const btn = mkEl("button", {
    id: "featured-random",
    class: "featured-card featured-card--random",
  });
  btn.appendChild(mkEl("span", { class: "featured-random-action" }));
  row.appendChild(btn);

  const pins = mkEl("div", { class: "featured-pins" });
  pins.setAttribute("data-featured-pins", "");
  const stack = mkEl("div", { class: "featured-stack" });
  const clsList = ["is-front", "is-mid", "is-back", "is-hidden"]
    .slice(0, Math.max(1, cardCount))
    .concat(
      Array.from({ length: Math.max(0, cardCount - 4) }, () => "is-hidden"),
    );
  const cards = [];
  for (let i = 0; i < cardCount; i++) {
    const built = buildCard(clsList[i] || "is-hidden");
    cards.push(built);
    stack.appendChild(built.card);
  }
  pins.appendChild(stack);
  const navs = mkEl("div", { class: "featured-navs" });
  navs.setAttribute("data-featured-navs", "");
  const prevBtn = mkEl("button", {
    class: "featured-nav featured-nav--prev",
  });
  prevBtn.setAttribute("data-dir", "prev");
  const nextBtn = mkEl("button", {
    class: "featured-nav featured-nav--next",
  });
  nextBtn.setAttribute("data-dir", "next");
  navs.appendChild(prevBtn);
  navs.appendChild(nextBtn);
  pins.appendChild(navs);
  row.appendChild(pins);
  body.appendChild(row);

  const doc = {
    body,
    documentElement,
    createElement: (t) => mkEl(t),
    getElementById: (id) =>
      body._descend().find((n) => n._attrs.id === id) || null,
    querySelector: (s) => body.querySelector(s),
    querySelectorAll: (s) => body.querySelectorAll(s),
  };

  // ---- rAF 手动时钟（转盘动画必须可确定地推进，否则测试要真等 3 秒） ----
  let rafSeq = 0;
  let rafQueue = [];
  let clock = 0;
  const raf = (cb) => {
    const id = ++rafSeq;
    rafQueue.push({ id, cb });
    return id;
  };
  const caf = (id) => {
    rafQueue = rafQueue.filter((t) => t.id !== id);
  };
  async function advance(ms, step = 16) {
    const end = clock + ms;
    while (clock < end) {
      clock += step;
      const batch = rafQueue;
      rafQueue = [];
      for (const t of batch) t.cb(clock);
      await flush(3);
    }
  }

  // ---- 网络桩 ----
  const calls = [];
  const navs2 = [];
  const queued = () => {
    if (fail) return Promise.resolve({ ok: false, status: 500 });
    const items = (list) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ total, items: list }),
      });
    if (/size=1/.test(cur)) return items([top]);
    if (/size=4/.test(cur))
      return items([
        firstNoCover ? POST("c0", { cover: "" }) : POST("c0"),
        POST("c1"),
        POST("c2"),
        POST("c3"),
      ]);
    if (/size=20/.test(cur)) return items([POST("r1"), POST("r2"), POST("r3")]);
    return items([top]);
  };
  let cur = "";
  const fetchStub = (url) => {
    cur = String(url);
    calls.push(cur);
    return queued();
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

  const winListeners = {};
  const win = {
    sessionStorage: store(),
    localStorage: store(),
    swup: { navigate: (u) => navs2.push(u) },
    location: { href: "https://blog.test/", origin: "https://blog.test" },
    innerWidth: 1280,
    matchMedia: (q) => ({
      matches: reduce && /reduced-motion/.test(q),
      media: q,
    }),
    addEventListener: (t, fn) => {
      (winListeners[t] = winListeners[t] || []).push(fn);
    },
    removeEventListener: (t, fn) => {
      winListeners[t] = (winListeners[t] || []).filter((f) => f !== fn);
    },
    dispatch: (t, ev) => (winListeners[t] || []).forEach((fn) => fn(ev || {})),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };

  function FakeImage() {
    this.onload = null;
    this.onerror = null;
    this.decoding = "";
  }
  Object.defineProperty(FakeImage.prototype, "src", {
    get() {
      return this._src || "";
    },
    set(v) {
      this._src = v;
      // 同步触发 onload：让 background-image 真的落到桩元素上，可断言
      if (typeof this.onload === "function") this.onload();
    },
  });

  return {
    body,
    row,
    btn,
    pins,
    navs,
    prevBtn,
    nextBtn,
    cards,
    calls,
    navs2,
    win,
    advance,
    settle: (n = 30) => flush(n),
    run() {
      const fn = new Function(
        "window",
        "document",
        "console",
        "setTimeout",
        "clearTimeout",
        "fetch",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "Image",
        "getComputedStyle",
        code,
      );
      fn(
        win,
        doc,
        { warn() {}, log() {}, error() {}, info() {} },
        setTimeout,
        clearTimeout,
        fetchStub,
        raf,
        caf,
        FakeImage,
        () => ({ getPropertyValue: (k) => (k === "--hue" ? "250" : "") }),
      );
    },
    clickNav(which) {
      const btnEl = which === "prev" ? prevBtn : nextBtn;
      navs.dispatch("click", { target: btnEl, preventDefault() {} });
    },
  };
}

console.log(`被测产物：${target}（${code.length} 字符）`);
console.log(`产物目录：${tplDir}\n`);

// ================= [0] 产物静态断言 =================
{
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
  const idx = read(path.join(tplDir, "index.html"));
  const cat = read(path.join(tplDir, "category.html"));
  let css = "";
  const assets = path.join(tplDir, "assets");
  if (fs.existsSync(assets)) {
    for (const f of fs.readdirSync(assets))
      if (f.endsWith(".css")) css += read(path.join(assets, f));
  }
  css += (idx.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join("\n");

  const nTiles = (idx.match(/featured-random-tags-icon/g) || []).length;
  const nPairs = (idx.match(/featured-random-tags-pair/g) || []).length;
  const nTileBg = (idx.match(/--tile-bg:/g) || []).length;

  console.log("[0] 产物静态断言");
  check("首页有 #featured-cards", idx.includes('id="featured-cards"'));
  check(
    "类别页**没有**两卡行（只在首页渲染）",
    cat.length > 0 && !cat.includes('id="featured-cards"'),
  );
  const iRow = idx.indexOf('id="featured-cards"');
  const iList = idx.indexOf('id="post-list-container"');
  check(
    "两卡行在列表容器之前",
    iRow > -1 && iRow < iList,
    `${iRow} < ${iList}`,
  );
  check(
    "门控齐全：featuredEnable + posts.page == 1 + featuredSource",
    /featuredEnable == null or theme\.config\?\.layout\?\.postList\?\.featuredEnable/.test(
      idx,
    ) &&
      /and posts\.page == 1/.test(idx) &&
      /layout\?\.postList\?\.featuredSource/.test(idx),
  );

  // ---- 左卡（随机一篇）：斜向常驻流动 ----
  check(
    "左卡是 <button>，且被 fcRandom 设置门控",
    /<button[^>]*id="featured-random"/.test(idx) &&
      idx.includes('th:if="${fcRandom}"'),
  );
  check(
    "左卡图标格 12×3=36 格、6×3=18 列",
    nTiles === 36 && nPairs === 18,
    `tiles=${nTiles} pairs=${nPairs}`,
  );
  check(
    "每格底色走行内 --tile-bg（写死在 CSS 就全同色了）",
    nTileBg === 36 && idx.includes('style="--tile-bg:#358bff"'),
    `count=${nTileBg}`,
  );
  check(
    "图标来自已装图标集（fa6-brands / mdi）",
    idx.includes("icon-[fa6-brands--github]") &&
      idx.includes("icon-[mdi--language-typescript]"),
  );
  check(
    "流动 = 容器 rotate(-30deg) + 整行 50s linear infinite 循环",
    /\.featured-random-tags-group\{[^}]*width:175%[^}]*rotate\(-30deg\)/.test(
      css,
    ) &&
      /\.featured-random-tags-scroll\{[^}]*animation:50s linear infinite featured-tile-flow/.test(
        css,
      ),
  );
  check(
    "位移正好一份（-33.3333%），3 份才能无缝接回",
    /@keyframes featured-tile-flow\{[^@]*translate\(-33\.3333%\)/.test(css) &&
      /\.featured-random-tags-scroll\{[^}]*min-width:100%/.test(css),
  );
  check(
    "图标格 2.9rem / 圆角 .7rem / 列宽 3.15rem / 偶数列左移（参考站逐字量值）",
    /\.featured-random-tags-icon\{[^}]*border-radius:\.7rem[^}]*width:2\.9rem;height:2\.9rem/.test(
      css,
    ) &&
      /\.featured-random-tags-pair\{[^}]*width:3\.15rem/.test(css) &&
      /\.featured-random-tags-icon:nth-child\(2n\)\{[^}]*translate\(-\.85rem\)/.test(
        css,
      ),
  );
  check(
    "图标格底色读 --tile-bg 并对缺值兜底",
    /\.featured-random-tags-icon\{[^}]*background:var\(--tile-bg,var\(--primary\)\)/.test(
      css,
    ),
  );

  // ---- 右卡（热门/最近）：三档叠层 + ‹ › ----
  check(
    "右卡叠层容器有 perspective（没有它就只是平面平移）",
    /\.featured-stack\{[^}]*perspective:900px/.test(css),
  );
  check(
    "四档位几何（is-front / is-mid / is-back / is-hidden）",
    /\.featured-card--post\.is-front\{[^}]*z-index:3/.test(css) &&
      /\.featured-card--post\.is-mid\{[^}]*translate3d\(5px,4px,-12px\)[^}]*rotate\(1\.4deg\)[^}]*scale\(\.985\)/.test(
        css,
      ) &&
      /\.featured-card--post\.is-back\{[^}]*translate3d\(-5px,7px,-24px\)[^}]*rotate\(-1\.8deg\)[^}]*scale\(\.97\)/.test(
        css,
      ) &&
      /\.featured-card--post\.is-hidden\{[^}]*visibility:hidden/.test(css),
  );
  check(
    "右卡是 <a>（整卡可点），th:each 取前 4 篇",
    /<a[^>]*class="featured-card featured-card--post"/.test(idx) &&
      idx.includes('th:each="fcPost, fcStat : ${fcItems}"') &&
      // ⚠️ 刻意写成 `not (… >= 4)` 而不是 `… < 4`，跟 SeriesStrip 统一（免得以后有人误以为
      //    `<` 更危险）。这里必须容两种形态：**静态属性**里 Astro 会把 `>` 转义成 `&gt;`
      //    （2026-09-18 看产物定论：源码 `>=` ⇒ 产物 `&gt;=`），astoparser 会还原，照样能跑。
      //    ⚠️ 别拿 SeriesStrip 那处对比：它是 **Astro 模板表达式**（th:if={`…`}），
      //       走 JS 字符串那条路，`>` **不转义** —— 只有静态属性才转义。
      /not \(fcStat\.index (&gt;=|>=) 4\)/.test(idx) &&
      !/fcStat\.index &lt; 4/.test(idx),
  );
  check(
    '封面 <img> 走 th:attr 而不是 th:src（真机实测：th:src 求值 null 写出 src="" 会打当前页）',
    // 正负都用**完整表达式**匹配，避免误伤别处的 th:src
    idx.includes(
      'th:attr="src=${#strings.isEmpty(fcPost.spec.cover) ? null : fcPost.spec.cover + suffix}"',
    ) &&
      !idx.includes(
        'th:src="${#strings.isEmpty(fcPost.spec.cover) ? null : fcPost.spec.cover + suffix}"',
      ),
  );
  check(
    "转盘声明了 aria-modal 就得真管焦点：可聚焦容器 + 主动 focus + 拦 Tab + 取消时归还",
    carouselSrc.includes("overlay.tabIndex = -1") &&
      carouselSrc.includes("overlay.focus()") &&
      carouselSrc.includes('e.key === "Tab"') &&
      carouselSrc.includes("lastFocus.focus()") &&
      // 命中的分支不能还焦点：紧接着就是 Swup 换页，还焦点会把页面拽回原位
      carouselSrc.includes("if (\n        !completed &&"),
  );
  check(
    "转盘封面是真串行（下一张在 onload/onerror 里才排）且目标篇优先加载",
    carouselSrc.includes("var loadOrder = [target]") &&
      carouselSrc.includes("img.onerror = next;") &&
      carouselSrc.includes("next();") &&
      // 旧写法 = 假串行：src 之后立刻排下一帧，10 帧内把 10 张全发出去
      !/img\.src = url;\s*rafImages = requestAnimationFrame\(loadNext\);/.test(
        carouselSrc,
      ),
  );
  check(
    "‹ › 换档箭头在产物里（带 aria-label 走 i18n）",
    idx.includes("data-featured-navs") &&
      idx.includes('data-dir="prev"') &&
      idx.includes('data-dir="next"') &&
      /th:aria-label="#\{featured\.nav\.prev\}"/.test(idx) &&
      /th:aria-label="#\{featured\.nav\.next\}"/.test(idx),
  );
  check(
    "箭头默认透明不拦事件、hover / focus-within 才浮现（圆形 32px）",
    /\.featured-nav\{[^}]*width:2rem;height:2rem[^}]*opacity:0;pointer-events:none[^}]*border-radius:999px/.test(
      css,
    ) &&
      /\.featured-pins:hover \.featured-nav,\.featured-pins:focus-within \.featured-nav\{opacity:1;pointer-events:auto\}/.test(
        css,
      ),
  );
  check(
    "触屏（<768px）箭头常显 —— 没有 hover 就没法换档",
    // ⚠️ 压缩器把范围查询改写成了 `(width<=767.98px)`，别按源码里的 max-width 写
    /@media \(width<=767\.98px\)\{[\s\S]{0,1400}\.featured-nav\{opacity:1;pointer-events:auto\}/.test(
      css,
    ),
  );

  // ---- 全局浮层（转盘）----
  check(
    "浮层样式是 global 且挂在 body 上（组件级 scoped 到不了）",
    /body\.random-post-open\{overflow:hidden\}/.test(css) &&
      /\.random-post-overlay\{[^}]*z-index:12000[^}]*position:fixed;inset:0/.test(
        css,
      ),
  );
  check(
    "转盘三层 preserve-3d + 仰角读 --rp-tilt",
    /\.random-post-overlay__tilt\{[^}]*transform-style:preserve-3d[^}]*rotateX\(var\(--rp-tilt/.test(
      css,
    ) &&
      /\.random-post-overlay__ring\{[^}]*transform-style:preserve-3d/.test(
        css,
      ) &&
      /\.random-post-overlay__slot\{[^}]*transform-style:preserve-3d/.test(css),
  );
  check(
    "中签那张：白环 + 主题色光环 + 1.1s 脉冲；其余压暗",
    /\.random-post-overlay__slot\.is-selected \.random-post-overlay__face--front\{[^}]*0 0 0 3px #ffffffeb[^}]*animation:1\.1s ease-in-out infinite random-post-pulse/.test(
      css,
    ) &&
      /@keyframes random-post-pulse\{/.test(css) &&
      /\.random-post-overlay\.is-locked \.random-post-overlay__slot:not\(\.is-selected\)\{opacity:\.42/.test(
        css,
      ),
  );
  check(
    "背面也贴同一张封面并压暗（否则转到侧面露馅）",
    /\.random-post-overlay__face--back\{[^}]*rotateY\(180deg\)/.test(css) &&
      /backface-visibility:hidden/.test(css),
  );

  // ---- 减少动态效果 ----
  check(
    "reduced-motion 下停掉常驻流动 + 关掉脉冲",
    /\.featured-random-tags-scroll,\.featured-card--post\[data-state=pending\] \.featured-body\{animation:none\}/.test(
      css,
    ) &&
      /prefers-reduced-motion:reduce\)\{[\s\S]{0,400}\.random-post-overlay__slot\.is-selected \.random-post-overlay__face--front\{animation:none\}/.test(
        css,
      ),
  );

  // ---- i18n ----
  for (const [file, kv] of [
    [
      "default.properties",
      {
        "featured.random.title": "Random post",
        "featured.nav.prev": "Previous",
        "featured.nav.next": "Next",
        "featured.ring.hint": "Press Esc to cancel",
      },
    ],
    [
      "zh_CN.properties",
      {
        "featured.random.title": "随机一篇文章",
        "featured.nav.prev": "上一篇",
        "featured.nav.next": "下一篇",
        "featured.ring.hint": "按 Esc 取消",
      },
    ],
    [
      "zh_TW.properties",
      {
        "featured.random.title": "隨機一篇文章",
        "featured.nav.prev": "上一篇",
        "featured.nav.next": "下一篇",
        "featured.ring.hint": "按 Esc 取消",
      },
    ],
  ]) {
    const txt = read(path.join(themeRoot, "i18n", file));
    check(
      `${file} 新增键齐全（随机标题 / 上一篇 / 下一篇 / Esc 提示）`,
      Object.entries(kv).every(([k, v]) =>
        new RegExp(`^${k.replace(/\./g, "\\.")}=${v}$`, "m").test(txt),
      ),
    );
    check(
      `${file} 保留徽章与动作文案键`,
      /^featured\.badge\.popular=.+/m.test(txt) &&
        /^featured\.badge\.recent=.+/m.test(txt) &&
        /^featured\.random\.action=.+/m.test(txt) &&
        /^featured\.random\.desc=.+/m.test(txt),
    );
  }
  check(
    "文案经隐藏节点透传（脚本里不写中文）",
    ["popular", "recent", "random", "hint"].every((n) =>
      idx.includes(`data-label-${n}`),
    ),
  );
  console.log("");
}

console.log("[1] 右卡 recent：1 次请求 + 排序 + 填满 4 张叠层");
{
  const e = makeEnv({ source: "recent" });
  e.run();
  await flush();
  check("只发 1 次请求", e.calls.length === 1, e.calls.join(" | "));
  check(
    "按创建时间倒序（最近）且 size=4（叠层要好几张）",
    /sort=metadata\.creationTimestamp,desc/.test(e.calls[0] || "") &&
      /size=4/.test(e.calls[0] || ""),
    e.calls[0],
  );
  check(
    "四张卡都填上了标题",
    e.cards.every((c, i) => c.title.textContent === "标题 c" + i),
    e.cards.map((c) => c.title.textContent).join(" | "),
  );
  check("摘要已填", e.cards[0].excerpt.textContent === "摘要 c0");
  check(
    "日期已填（取前 10 位）",
    /^\d{4}-\d{2}-\d{2}$/.test(e.cards[0].date.textContent),
    e.cards[0].date.textContent,
  );
  check(
    "分类名已填且色块上色（跟主题色相同源）",
    e.cards[0].catName.textContent === "博客" &&
      /^oklch\(0\.72 0\.16 \d+(\.\d+)?deg\)$/.test(
        String(e.cards[0].sq.style.background),
      ),
    `${e.cards[0].catName.textContent} / ${e.cards[0].sq.style.background}`,
  );
  check(
    "徽章文案 = 最近文章",
    e.cards[0].badgeText.textContent === "最近文章",
    e.cards[0].badgeText.textContent,
  );
  check(
    "卡片 href 指向各自文章",
    e.cards[1].card.getAttribute("href") === "/archives/c1",
    e.cards[1].card.getAttribute("href"),
  );
  check(
    "封面 src 已填",
    String(e.cards[0].img.getAttribute("src")).startsWith("https://img/x.webp"),
    String(e.cards[0].img.getAttribute("src")),
  );
  check(
    "档位：front / mid / back / hidden 各就各位",
    e.cards[0].card.classList.contains("is-front") &&
      e.cards[1].card.classList.contains("is-mid") &&
      e.cards[2].card.classList.contains("is-back") &&
      e.cards[3].card.classList.contains("is-hidden"),
    e.cards.map((c) => c.card.className).join(" | "),
  );
  check(
    "四张都标 ready",
    e.cards.every((c) => c.card.getAttribute("data-state") === "ready"),
  );
  check("箭头显示（>1 张才给换档）", e.navs.getAttribute("hidden") === null);
  check(
    "只有 front 可聚焦，其余摘出无障碍树",
    e.cards[0].card.getAttribute("tabindex") === null &&
      e.cards[0].card.getAttribute("aria-hidden") === null &&
      e.cards[1].card.getAttribute("tabindex") === "-1" &&
      e.cards[1].card.getAttribute("aria-hidden") === "true",
  );
}

console.log("[2] 右卡 popular：排序换成 stats.visit");
{
  const e = makeEnv({ source: "popular" });
  e.run();
  await flush();
  check(
    "排序 = stats.visit,desc",
    /sort=stats\.visit,desc/.test(e.calls[0] || ""),
    e.calls[0],
  );
  check(
    "徽章文案 = 热门文章",
    e.cards[0].badgeText.textContent === "热门文章",
    e.cards[0].badgeText.textContent,
  );
}

console.log("[3] 右卡 ‹ › 换档");
{
  const e = makeEnv({ source: "recent" });
  e.run();
  await flush();
  const RANKS = ["is-front", "is-mid", "is-back", "is-hidden"];
  const ranksOf = (i) =>
    RANKS.filter((c) => e.cards[i].card.classList.contains(c));
  const allSingular = () => e.cards.every((_, i) => ranksOf(i).length === 1);

  check(
    "初始每张卡恰好一个档位类",
    allSingular(),
    JSON.stringify(e.cards.map((c) => c.card.className)),
  );

  e.clickNav("next");
  check(
    "next：第 2 张拿到 is-front，第 1 张退到 is-hidden",
    e.cards[1].card.classList.contains("is-front") &&
      e.cards[2].card.classList.contains("is-mid") &&
      e.cards[3].card.classList.contains("is-back") &&
      e.cards[0].card.classList.contains("is-hidden"),
    e.cards.map((c) => c.card.className).join(" | "),
  );
  check("换档后仍然恰好一个档位类（脏类会越换越乱）", allSingular());

  // 再点 3 次 ⇒ 共 4 次，取模回到第 1 张
  e.clickNav("next");
  e.clickNav("next");
  e.clickNav("next");
  check(
    "next ×4（一轮）回到第 1 张",
    e.cards[0].card.classList.contains("is-front"),
    e.cards.map((c) => c.card.className).join(" | "),
  );
  check("轮完一轮仍是四个不同档位", allSingular());

  e.clickNav("prev");
  check(
    "prev：反向取模回到第 4 张，第 1 张退到 is-mid",
    e.cards[3].card.classList.contains("is-front") &&
      e.cards[0].card.classList.contains("is-mid"),
    e.cards.map((c) => c.card.className).join(" | "),
  );
  check(
    "换档不发任何请求（纯前端换位）",
    e.calls.length === 1,
    String(e.calls.length),
  );
}

console.log("[4] 右卡缓存：重执行不再打接口");
{
  const e = makeEnv({ source: "recent" });
  e.run();
  await flush();
  const first = e.calls.length;
  // 模拟 Swup 换页重执行（同一 sessionStorage，新的 DOM 树）
  const e2 = makeEnv({ source: "recent" });
  e2.win.sessionStorage = e.win.sessionStorage;
  e2.run();
  await flush();
  check("第二次执行 0 请求", e2.calls.length === 0, e2.calls.join(" | "));
  check(
    "但仍从缓存渲染出内容",
    e2.cards[0].title.textContent === "标题 c0",
    e2.cards[0].title.textContent,
  );
  check("首次确实请求过", first === 1, String(first));
}

console.log("[5] 右卡取数失败：保留服务端兜底，不空窗");
{
  const e = makeEnv({ source: "popular", fail: true });
  e.cards[0].title.textContent = "服务端兜底标题";
  e.run();
  await flush();
  check(
    "内容保持服务端渲染的那篇",
    e.cards[0].title.textContent === "服务端兜底标题",
    e.cards[0].title.textContent,
  );
  check(
    "四张都标记 fallback",
    e.cards.every((c) => c.card.getAttribute("data-state") === "fallback"),
  );
}

console.log("[6] 左卡点击：2 次请求 → 全屏转盘几何 → 恰好 1 次导航");
{
  const e = makeEnv();
  e.run();
  await flush();
  e.calls.length = 0;
  e.btn.dispatch("click");
  await e.settle();

  check(
    "发了 2 次请求（问 total + 随机页）",
    e.calls.length === 2,
    e.calls.join(" | "),
  );
  check(
    "第一次是 size=1 问 total",
    /size=1/.test(e.calls[0] || ""),
    e.calls[0],
  );
  check(
    "第二次是 size=20 的某一页",
    /size=20/.test(e.calls[1] || "") && /page=\d/.test(e.calls[1] || ""),
    e.calls[1],
  );

  const overlay = e.body.querySelector(".random-post-overlay");
  check("浮层已挂到 body", !!overlay);
  // 封面是「每帧贴一张」按需加载的 ⇒ 不推进时钟就还是空底
  await e.advance(320);
  if (overlay) {
    check(
      "无障碍：role=dialog + aria-modal + aria-label 走 i18n",
      overlay.getAttribute("role") === "dialog" &&
        overlay.getAttribute("aria-modal") === "true" &&
        overlay.getAttribute("aria-label") === "随机一篇文章",
      overlay.getAttribute("aria-label"),
    );
    check(
      "取消提示来自隐藏节点",
      overlay.querySelector(".random-post-overlay__hint")?.textContent ===
        "按 Esc 取消",
    );
    const slots = overlay.querySelectorAll(".random-post-overlay__slot");
    check("10 个面（FACE_COUNT）", slots.length === 10, String(slots.length));
    check(
      "每个 slot 有正反两张脸（背面朝向圆心）",
      slots.every(
        (s) => s.querySelectorAll(".random-post-overlay__face").length === 2,
      ),
    );
    // 几何：step = 36°，radius = 面宽 * 1.45 / (2*tan(pi/n))
    const faceW = Math.min(Math.round(1280 * 0.28), 300); // 300
    const expectedRadius = (faceW * 1.45) / (2 * Math.tan(Math.PI / 10));
    const t0 = String(slots[0].style.transform || "");
    const t1 = String(slots[1].style.transform || "");
    const gotRadius = Number(
      (/translateZ\(([\d.]+)px\)/.exec(t1) || [])[1] || NaN,
    );
    check(
      "面宽按 28vw 封顶 300px 给到环形",
      String(
        overlay.querySelector(".random-post-overlay__ring").style.width,
      ) === "300px",
      String(overlay.querySelector(".random-post-overlay__ring").style.width),
    );
    check(
      "步角 36°（360/10）",
      /rotateY\(0deg\)/.test(t0) && /rotateY\(36deg\)/.test(t1),
      `${t0} | ${t1}`,
    );
    check(
      "半径按参考公式反算（1.45 / 2tan(pi/n)）",
      Math.abs(gotRadius - expectedRadius) < 0.6,
      `${gotRadius} vs ${expectedRadius.toFixed(2)}`,
    );
    check(
      "仰角 -2.5deg 写在舞台的 --rp-tilt 上",
      String(
        overlay.querySelector(".random-post-overlay__stage").style["--rp-tilt"],
      ) === "-2.5deg",
      String(
        overlay.querySelector(".random-post-overlay__stage").style["--rp-tilt"],
      ),
    );
    check(
      "封面按需贴到正反两张脸上",
      String(
        slots[0].querySelector(".random-post-overlay__face--front").style
          .backgroundImage,
      ).includes("img/x.webp") &&
        String(
          slots[0].querySelector(".random-post-overlay__face--back").style
            .backgroundImage,
        ).includes("img/x.webp"),
    );
    check(
      "body 上了 random-post-open（锁滚动）",
      e.body.classList.contains("random-post-open"),
    );
  }

  await e.advance(3600); // 两段式 2400ms + 停顿 700ms + 余量
  await sleepMs(280); // close() 里的 220ms 收尾
  check(
    "恰好导航 1 次（走 swup.navigate）",
    e.navs2.length === 1,
    e.navs2.join(" | "),
  );
  check(
    "目标是随机页里的某篇",
    /^\/archives\/r[123]$/.test(e.navs2[0] || ""),
    e.navs2[0],
  );
  check(
    "命中后面板收尾：浮层摘掉、body 类清掉、busy 复位",
    !e.body.querySelector(".random-post-overlay") &&
      !e.body.classList.contains("random-post-open") &&
      e.btn.dataset.busy === "" &&
      e.btn.getAttribute("aria-busy") === null,
    `busy=${JSON.stringify(e.btn.dataset.busy)}`,
  );
}

console.log("[7] 左卡 Esc 取消：不导航、清场、busy 复位");
{
  const e = makeEnv();
  e.run();
  await flush();
  e.btn.dispatch("click");
  await e.settle();
  check("浮层已开", !!e.body.querySelector(".random-post-overlay"));
  e.win.dispatch("keydown", { key: "Escape", preventDefault() {} });
  await sleepMs(280);
  check("Esc 不导航", e.navs2.length === 0, e.navs2.join(" | "));
  check(
    "浮层与 body 类都被摘掉",
    !e.body.querySelector(".random-post-overlay") &&
      !e.body.classList.contains("random-post-open"),
  );
  check("busy 复位（可以再摇一次）", e.btn.dataset.busy === "");
}

console.log("[8] 左卡防重入：连点两次只走一遍");
{
  const e = makeEnv();
  e.run();
  await flush();
  e.calls.length = 0;
  e.btn.dispatch("click");
  e.btn.dispatch("click");
  await e.settle();
  check(
    "只发 2 次请求（不是 4 次）",
    e.calls.length === 2,
    e.calls.join(" | "),
  );
  check(
    "只开一个浮层",
    e.body.querySelectorAll(".random-post-overlay").length === 1,
    String(e.body.querySelectorAll(".random-post-overlay").length),
  );
  await e.advance(3600);
  await sleepMs(280);
  check("只导航 1 次", e.navs2.length === 1, e.navs2.join(" | "));
}

console.log("[9] 左卡取数全挂：兜底跳 /archives");
{
  const e = makeEnv({ fail: true });
  e.run();
  await flush();
  e.btn.dispatch("click");
  await e.settle();
  check(
    "导航到兜底地址",
    e.navs2.length === 1 && e.navs2[0] === "/archives",
    e.navs2.join(" | "),
  );
  check(
    "不开浮层（取数都没成功）",
    !e.body.querySelector(".random-post-overlay"),
  );
  check(
    "busy 已复位（可再次点击）",
    e.btn.dataset.busy === "" && e.btn.getAttribute("aria-busy") === null,
    JSON.stringify(e.btn.dataset),
  );
}

console.log("[10] prefers-reduced-motion：不做转盘直接跳，但 busy 必须复位");
{
  const e = makeEnv({ reduce: true });
  e.run();
  await flush();
  e.btn.dispatch("click");
  await e.settle();
  check("不创建浮层", !e.body.querySelector(".random-post-overlay"));
  check("仍然导航 1 次", e.navs2.length === 1, e.navs2.join(" | "));
  check(
    "busy 复位（不改的话 bfcache 回退后按钮永久锁死）",
    e.btn.dataset.busy === "" && e.btn.getAttribute("aria-busy") === null,
    JSON.stringify(e.btn.dataset),
  );
}

console.log("[11] 无封面文章：切 is-cover-empty 并摘掉 src");
{
  const e = makeEnv({ source: "recent", firstNoCover: true });
  e.cards[0].img.setAttribute("src", "https://img/old.webp"); // 服务端兜底那篇是有封面的
  e.run();
  await flush();
  check(
    "封面容器切到 is-cover-empty",
    e.cards[0].cover.classList.contains("is-cover-empty"),
    e.cards[0].cover.className,
  );
  check(
    "img 的 src 被摘掉（否则空 src 会打当前页）",
    e.cards[0].img.getAttribute("src") === null,
    String(e.cards[0].img.getAttribute("src")),
  );
  check(
    "后面那张有封面的不受影响",
    !e.cards[1].cover.classList.contains("is-cover-empty") &&
      String(e.cards[1].img.getAttribute("src")).startsWith(
        "https://img/x.webp",
      ),
    String(e.cards[1].img.getAttribute("src")),
  );
  check(
    "状态仍标记 ready（内容有效）",
    e.cards[0].card.getAttribute("data-state") === "ready",
  );
}

console.log(
  `\n通过 ${pass} 项${fails.length ? `，失败 ${fails.length} 项：\n - ${fails.join("\n - ")}` : "，全部通过"}`,
);
process.exit(fails.length ? 1 : 0);

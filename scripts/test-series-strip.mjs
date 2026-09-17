#!/usr/bin/env node
/**
 * 首页「最新系列」卡片条（SeriesStrip，1.5.32 新增）回归。
 *
 * 覆盖三层，都是「不测就会静默坏」的点：
 *   [A] 产物静态断言 —— 门控顺序 / 卡片要素 / 空属性坑 / 只在首页出现 / CSS 分块与哈希
 *   [B] i18n 与后台设置 —— 用到的键必须在三份 .properties 里都存在；settings.yaml 字段齐全
 *   [C] 行为脚本（迷你 DOM 跑真产物 js）—— 溢出判定、箭头显隐、按一张卡步进、
 *       reduced-motion、重复执行幂等、resize 只挂一个监听
 *
 * 关键背景（踩过的坑，写进断言防复发）：
 *   · th:if(3) 早于 th:with(4) ⇒ 插件版本守卫必须在 finder 调用**之前**的层，
 *     否则旧插件（1.0.3）下首页会 500。断言 A1/A2 用「出现位置先后」锁死这个顺序。
 *   · Thymeleaf 3.1.5 对 null 求值的 th:src / th:href **不是删属性，而是写空值**
 *     （`src=""` / `href=""`）⇒ 必须有 th:if 兜住。断言 A4/A5。
 *   · 判空若写在 <section> 内部，系列为 0 时首页会留一条空 <section>（1rem 死空白）。断言 A6。
 *
 * 用法：node scripts/test-series-strip.mjs [templates/assets/series-strip.js]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const target = process.argv[2] || "templates/assets/series-strip.js";
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const tplDir = (() => {
  const guess = path.resolve(path.dirname(target), "..");
  return fs.existsSync(path.join(guess, "index.html"))
    ? guess
    : path.join(repoRoot, "templates");
})();
const themeRoot = fs.existsSync(path.join(tplDir, "..", "i18n"))
  ? path.resolve(tplDir, "..")
  : repoRoot;

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

const read = (p) => fs.readFileSync(p, "utf8");
/** HTML 实体还原（`&gt;` → `>`），让断言能写「人话」 */
const unesc = (s) =>
  s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");

const rawIndex = read(path.join(tplDir, "index.html"));
const index = unesc(rawIndex);
const js = read(target);

// ================== [A] 产物静态断言 ==================
console.log("\n[A] 产物静态断言");

check(
  "index.html 里有系列条容器 #series-strip",
  index.includes('id="series-strip"'),
);
check(
  "A1 插件版本守卫存在（ethereal-companion >=1.1.0，实体会被还原成 >）",
  index.includes("pluginFinder.available('ethereal-companion', '>=1.1.0')"),
);
const iGate = index.indexOf("pluginFinder.available('ethereal-companion'");
const iFinder = index.indexOf("recentCommentsSeriesFinder.listLatest");
check(
  "A2 版本守卫出现在 finder 调用之前（th:if 早于 th:with，顺序反了旧插件会 500）",
  iGate >= 0 && iFinder > iGate,
  `gate=${iGate} finder=${iFinder}`,
);
check(
  "A3 listLatest 的入参是 th:with 里声明的 seriesCount（同层后向引用）",
  index.includes(
    "seriesItems=${recentCommentsSeriesFinder.listLatest(seriesCount)}",
  ),
);
check(
  'A4 <img> 有 th:if 兜住（th:src 为 null 会写出 src="" 去打当前页）',
  /<img[^>]*series-strip-card__img[^>]*th:if="\$\{series\.latest != null and not #strings\.isEmpty\(series\.latest\.cover\)\}"/.test(
    index,
  ),
);
check(
  'A5 卡片 <a> 有 th:if 兜住 permalink（th:href 为 null 会写出 href=""）',
  /<a[^>]*th:if="\$\{series\.latest != null and series\.latest\.permalink != null\}"/.test(
    index,
  ),
);
check(
  "A5b 不再出现 `? series.latest.permalink : null` 这种空 href 写法",
  !index.includes("series.latest.permalink : null"),
);
check(
  'A6 判空罩在 <section> 外面（th:if="${not #lists.isEmpty(seriesItems)}" 在 section 上）',
  /<section[^>]*id="series-strip"[^>]*th:if="\$\{not #lists\.isEmpty\(seriesItems\)\}"/.test(
    index,
  ) ||
    /<section[^>]*th:if="\$\{not #lists\.isEmpty\(seriesItems\)\}"[^>]*id="series-strip"/.test(
      index,
    ),
);
check(
  "A7 可见数写在 section 的 style 上（桌面 4 / 平板 3 / 手机 2）",
  index.includes(
    "--series-visible-desktop:4;--series-visible-tablet:3;--series-visible-mobile:2",
  ),
);
check(
  "A8 卡片要素齐全（cover / img / placeholder / count / title / excerpt）",
  [
    "__cover",
    "__img",
    "__placeholder",
    "__count",
    "__title",
    "__excerpt",
  ].every((s) => index.includes("series-strip-card" + s)),
);

const tplVer = (() => {
  const m = /version:\s*"([0-9.]+)"/.exec(
    read(path.join(themeRoot, "theme.yaml")),
  );
  return m ? m[1] : "";
})();
check(
  `A9 首页引了 series-strip.js 且 ?v= 与 theme.yaml 版本一致（${tplVer}）`,
  tplVer !== "" && index.includes(`assets/series-strip.js?v=${tplVer}`),
  `theme.yaml=${tplVer}`,
);

check(
  "A10 只有首页带系列条（category/tag 用同一 PostList 但不该有）",
  (() => {
    for (const f of ["category.html", "tag.html", "archives.html"]) {
      const p = path.join(tplDir, f);
      if (fs.existsSync(p) && read(p).includes("series-strip-card"))
        return false;
    }
    return true;
  })(),
);

/** PostList 样式分块：含容器查询几何常量，且引用它的每一页哈希一致 */
const cssChunks = fs
  .readdirSync(path.join(tplDir, "assets"))
  .filter((f) => /^PostList\..*\.css$/.test(f));
check(
  "A11 PostList 样式分块存在且只有一份",
  cssChunks.length === 1,
  cssChunks.join(","),
);
if (cssChunks.length === 1) {
  const css = read(path.join(tplDir, "assets", cssChunks[0]));
  check(
    "A12 样式里有容器查询 + 吸附 + 卡片宽度公式",
    css.includes("container-type:inline-size") &&
      css.includes("scroll-snap-type") &&
      css.includes("100cqi"),
  );
  check(
    "A13 卡片宽度是 (100cqi - (V-1)*gap - 2*edge - 1px)/V 形式",
    /100cqi.*var\(--series-visible\).*\/.*var\(--series-visible\)/s.test(css) ||
      css.includes("--series-card-w"),
  );
  const users = [];
  for (const f of fs.readdirSync(tplDir)) {
    if (!f.endsWith(".html")) continue;
    const m = new RegExp(`PostList\\.[A-Za-z0-9_-]+\\.css`).exec(
      read(path.join(tplDir, f)),
    );
    if (m) users.push([f, m[0]]);
  }
  const uniq = new Set(users.map((u) => u[1]));
  check(
    "A14 引用 PostList 样式的每一页都是同一个哈希（改 CSS 后旧哈希会变孤儿）",
    uniq.size === 1 && uniq.has(cssChunks[0]),
    [...uniq].join(","),
  );
}

// ================== [B] i18n 与设置 ==================
console.log("\n[B] i18n 与后台设置");

const usedKeys = [
  ...new Set(
    [...index.matchAll(/#\{(seriesStrip\.[A-Za-z0-9_.]+)/g)].map((m) => m[1]),
  ),
];
check(
  "B1 产物里引用了 seriesStrip.* 的键",
  usedKeys.length >= 4,
  usedKeys.join(","),
);

const i18nFiles = [
  "default.properties",
  "zh_CN.properties",
  "zh_TW.properties",
];
const i18nText = Object.fromEntries(
  i18nFiles.map((f) => [f, read(path.join(themeRoot, "i18n", f))]),
);
for (const f of i18nFiles) {
  const missing = usedKeys.filter(
    (k) =>
      !new RegExp("^" + k.replace(/\./g, "\\.") + "=", "m").test(i18nText[f]),
  );
  check(`B2 ${f} 覆盖了全部键`, missing.length === 0, missing.join(","));
}
// zh_CN / zh_TW 必须是中文化文案（不能留英文占位）
check(
  "B3 zh_CN 的 seriesStrip.title 是中文",
  /^seriesStrip\.title=[^\x00-\x7F]/m.test(i18nText["zh_CN.properties"]),
);

const settings = read(path.join(themeRoot, "settings.yaml"));
check(
  "B4 settings 的 postList 组含 seriesEnable 开关",
  /name:\s*seriesEnable/.test(settings),
);
check(
  "B5 settings 的 postList 组含 seriesCount 数字",
  /name:\s*seriesCount/.test(settings),
);
check(
  "B6 seriesCount 有 1..24 的约束与联动显隐",
  /label:\s*系列卡片数量/.test(settings) &&
    /min:\s*1/m.test(settings) &&
    /max:\s*24/m.test(settings) &&
    /if:\s*"\$get\(postList_seriesEnable\)\.value === true"/.test(settings),
);
check(
  "B7 postList 默认值里带上了新字段",
  /seriesEnable:\s*true/.test(settings) && /seriesCount:\s*4/.test(settings),
);

// ================== [C] 行为脚本 ==================
console.log("\n[C] 行为脚本（迷你 DOM 跑真产物 js）");

try {
  execFileSync(process.execPath, ["--check", target], { stdio: "pipe" });
  check("C1 产物 js 语法通过 node --check", true);
} catch (e) {
  check(
    "C1 产物 js 语法通过 node --check",
    false,
    String(e.message).slice(0, 120),
  );
}

/** 只支持本用例用到的选择器：tag / .class / #id / 拼接 */
function match(el, sel) {
  return sel
    .trim()
    .split(/(?=[.#[])/)
    .filter(Boolean)
    .every((p) => {
      if (p.startsWith("#")) return el._attrs.id === p.slice(1);
      if (p.startsWith(".")) return el._cls.has(p.slice(1));
      return el.tagName === p.toUpperCase();
    });
}

function mkEl(tag, attrs = {}) {
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
    dataset: {},
    _listeners: {},
    offsetLeft: 0,
    scrollLeft: 0,
    scrollCalls: [],
    get className() {
      return [...el._cls].join(" ");
    },
    getAttribute(k) {
      return k in el._attrs ? el._attrs[k] : null;
    },
    setAttribute(k, v) {
      el._attrs[k] = String(v);
    },
    removeAttribute(k) {
      delete el._attrs[k];
    },
    addEventListener(t, fn) {
      (el._listeners[t] = el._listeners[t] || []).push(fn);
    },
    dispatch(t, ev) {
      (el._listeners[t] || []).forEach((fn) => fn(ev || {}));
    },
    appendChild(c) {
      c.parentNode = el;
      el._children.push(c);
      return c;
    },
    getBoundingClientRect() {
      return { width: 200 };
    },
    scrollBy(opt) {
      el.scrollCalls.push(opt);
      el.scrollLeft += opt.left;
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

/**
 * 造一个「首页 series-strip」桩：cards 张卡片，可见数由 visible 决定。
 * 卡片 offsetLeft 按 i*(200+12) 布置 —— 脚本的步长 = cards[1].offsetLeft - cards[0].offsetLeft。
 */
function makeStrip({ cards, visible = 4 }) {
  const section = mkEl("section", {
    id: "series-strip",
    class: "series-strip",
  });
  const head = mkEl("div", { class: "series-strip__head" });
  const navs = mkEl("div", { class: "series-strip__navs" });
  const prev = mkEl("button", {
    class: "series-strip__nav series-strip__nav--prev",
  });
  const next = mkEl("button", {
    class: "series-strip__nav series-strip__nav--next",
  });
  navs.appendChild(prev);
  navs.appendChild(next);
  head.appendChild(navs);

  const viewport = mkEl("div", { class: "series-strip__viewport" });
  const track = mkEl("div", { class: "series-strip__track" });
  for (let i = 0; i < cards; i++) {
    const a = mkEl("a", {
      class: "series-strip-card",
      href: "/archives/p" + i,
    });
    a.offsetLeft = i * 212;
    track.appendChild(a);
  }
  viewport.appendChild(track);
  section.appendChild(head);
  section.appendChild(viewport);
  return { section, navs, prev, next, viewport, track, visible };
}

/** 在给定 window/document 桩里 eval 一次产物 js */
function runJs(strip, { reducedMotion = false } = {}) {
  const doc = {
    _sections: strip ? [strip.section] : [],
    querySelectorAll(sel) {
      if (sel === "#series-strip") return doc._sections;
      return [];
    },
    querySelector(sel) {
      return doc.querySelectorAll(sel)[0] || null;
    },
  };
  const win = {
    _resize: [],
    addEventListener(t, fn) {
      if (t === "resize") win._resize.push(fn);
    },
    removeEventListener() {},
    matchMedia() {
      return { matches: reducedMotion };
    },
    getComputedStyle() {
      return {
        getPropertyValue(k) {
          return k === "--series-visible" ? String(strip.visible) : "";
        },
      };
    },
  };
  // 产物 js 用到的全局：document / window / getComputedStyle / isFinite / parseInt
  const fn = new Function("document", "window", "getComputedStyle", js);
  fn(doc, win, win.getComputedStyle);
  return { doc, win };
}

{
  const strip = makeStrip({ cards: 6, visible: 4 });
  const { win } = runJs(strip);
  check(
    "C2 卡片数 > 可见数 ⇒ 箭头显示（移除 hidden）",
    strip.navs.getAttribute("hidden") === null,
  );
  strip.next.dispatch("click");
  check(
    "C3 点 › 向右滚「一张卡」（212px）",
    strip.viewport.scrollCalls.length === 1 &&
      strip.viewport.scrollCalls[0].left === 212,
    JSON.stringify(strip.viewport.scrollCalls),
  );
  strip.prev.dispatch("click");
  check(
    "C4 点 ‹ 向左滚一张卡",
    strip.viewport.scrollCalls.length === 2 &&
      strip.viewport.scrollCalls[1].left === -212,
    JSON.stringify(strip.viewport.scrollCalls),
  );
  check(
    "C5 默认 behavior=smooth",
    strip.viewport.scrollCalls.every((c) => c.behavior === "smooth"),
  );
  check(
    "C6 resize 监听只挂一次",
    win._resize.length === 1,
    String(win._resize.length),
  );

  // 重复执行（Swup 换页克隆重执行）不应重复绑定
  const before = strip.viewport.scrollCalls.length;
  runJs(strip);
  strip.next.dispatch("click");
  check(
    "C7 同一元素重复执行不重复绑定（点一次只滚一次）",
    strip.viewport.scrollCalls.length === before + 1,
    `${before} → ${strip.viewport.scrollCalls.length}`,
  );
}

{
  // 卡片装得下 ⇒ 箭头隐藏 + 轨道回最左
  const strip = makeStrip({ cards: 3, visible: 4 });
  strip.viewport.scrollLeft = 500;
  runJs(strip);
  check(
    "C8 卡片数 ≤ 可见数 ⇒ 箭头隐藏",
    strip.navs.getAttribute("hidden") !== null,
  );
  check(
    "C9 无溢出时轨道回到最左",
    strip.viewport.scrollLeft === 0,
    String(strip.viewport.scrollLeft),
  );
  // 变窄后重新出现溢出 → resize 后箭头应再现
  strip.visible = 2;
  const { win } = runJs(strip);
  win._resize.forEach((fn) => fn());
  check(
    "C10 resize 后可见数变小 ⇒ 箭头重新显示（复算生效）",
    strip.navs.getAttribute("hidden") === null,
  );
}

{
  const strip = makeStrip({ cards: 6, visible: 4 });
  runJs(strip, { reducedMotion: true });
  strip.next.dispatch("click");
  check(
    "C11 prefers-reduced-motion ⇒ behavior=auto（不跟用户偏好对着干）",
    strip.viewport.scrollCalls[0].behavior === "auto",
    JSON.stringify(strip.viewport.scrollCalls[0]),
  );
}

{
  // 页面没有系列条时不能抛
  let threw = null;
  try {
    runJs(null);
  } catch (e) {
    threw = e;
  }
  check(
    "C12 页面上没有 #series-strip 时不抛异常",
    threw === null,
    threw && String(threw.message),
  );
}

console.log(
  `\n通过 ${pass} 项${fails.length ? `，失败 ${fails.length} 项：\n - ${fails.join("\n - ")}` : "，全部通过"}`,
);
process.exit(fails.length ? 1 : 0);

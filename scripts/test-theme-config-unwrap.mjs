#!/usr/bin/env node
/**
 * #theme-config 分组拆层（realNode）行为回归测试。
 *
 * 背景（2026-09-18 实锤）：
 *   Halo 把 `theme.config?.<group>` 序列化进 `#theme-config` 时，每个分组都会多包一层
 *   `{ realNode: { …真实字段 } }`（实测线上：mods/layout/style/sidebar/post/footer/links/
 *   external_link/performance/auth/base/friends **全都有**这一层；组内子对象不再包）。
 *   而主题里所有客户端读者都按「扁平分组」取值：
 *     · Weather / WelcomePopup  → cfg.sidebar.widgetsConfig.rightWidgets[].tencent_key
 *     · PopularPosts            → cfg.base
 *     · post.astro              → cfg.performance.imageProcessing
 *     · utils/theme-config.ts   → cfg.style.bannerStyle（banner 轮播）
 *   ⇒ 不拆这一层就恒为 undefined，而且是**完全静默**的：天气明明配了 Key 却一直显示
 *   「请配置腾讯地图 Key」（LQ 2026-09-18 报的就是这个）。
 *   服务端 Thymeleaf 读同一路径 `theme.config?.sidebar?.widgetsConfig` 是**正常**的
 *   （已用线上渲染结果反证：侧栏渲染的正是用户配置的那 10 个小组件，而非兜底 Categories+Tags），
 *   只有 JSON 序列化后多这一层 ⇒ 修法是「紧跟 #theme-config 的一段内联脚本，先把 JSON 拆平」。
 *
 * 被测对象 = **构建产物**里那段脚本（templates/index.html）；不传参数时自动找。
 * 另附一条源码层同步断言：两个外壳（src/layouts/Layout.astro、src/pages/layout.astro）
 * 里的这段脚本必须逐字节一致（少改一个外壳 ⇒ 插件页/普通页面行为不一致）。
 * [7] 还锁一条容易漏的伴生要求：#theme-config 必须带 `data-swup-theme`，否则换页时会被
 * Swup 的 head 插件按 outerHTML 差异换回原始（带 realNode）元素，改动等于白做。
 *
 * 用法：node scripts/test-theme-config-unwrap.mjs [path/to/index.html]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SHELLS = ["src/layouts/Layout.astro", "src/pages/layout.astro"];

// ---------- 抠出「紧跟 #theme-config 的那段脚本」 ----------
function extractNormalizer(html) {
  const anchor = html.indexOf('id="theme-config"');
  if (anchor < 0) throw new Error("产物里没有 #theme-config");
  const start = html.indexOf("<script", anchor);
  if (start < 0) throw new Error("#theme-config 之后没有 <script>");
  const openEnd = html.indexOf(">", start) + 1;
  const end = html.indexOf("</script>", openEnd);
  if (end < 0) throw new Error("脚本没有闭合");
  return html.slice(openEnd, end);
}

// 从 .astro 源码里抠同一段（用标记注释定位），用于两个外壳的一致性比对
function extractFromShell(src) {
  const marker = "本脚本必须紧跟上面的 #theme-config";
  const i = src.indexOf(marker);
  if (i < 0) return null;
  const start = src.lastIndexOf("<script>", i);
  const end = src.indexOf("</script>", i);
  if (start < 0 || end < 0) return null;
  return src.slice(start + "<script>".length, end);
}

// ---------- 桩件：一个只有 textContent 的元素 ----------
function makeEl(text) {
  return {
    _t: text,
    get textContent() {
      return this._t;
    },
    set textContent(v) {
      this._t = String(v);
    },
  };
}

function runNormalizer(code, raw) {
  const el = makeEl(raw);
  const doc = {
    getElementById: (id) => (id === "theme-config" ? el : null),
  };
  // eslint-disable-next-line no-new-func
  new Function("document", "window", code)(doc, {});
  return el.textContent;
}

// ---------- 断言 ----------
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

// 复刻 Halo 的序列化形态：每个分组多包一层 realNode
const wrappedFixture = JSON.stringify({
  mods: { realNode: { enable: true, cardShell: true } },
  sidebar: {
    realNode: {
      profile: { name: "LQBBY" },
      widgetsConfig: {
        widgets: [{ value: "categories" }, { value: "tag" }],
        rightWidgets: [
          { value: "moe-counter", counter_theme: "moebooru" },
          {
            value: "weather",
            tencent_key: "YT4BZ-7AHWQ-CIG55-4H5LF-AKUBK-SGB25",
            default_city: "110000",
          },
        ],
      },
    },
  },
  style: { realNode: { bannerStyle: { banner: "carousel" } } },
  performance: { realNode: { imageProcessing: { provider: "wsrv" } } },
  base: {
    realNode: { banner: { x: 1 }, menu: { y: 2 }, welcome: { enable: true } },
  },
});

// 未包 realNode 的形态（兼容态：Halo 若改回扁平，必须原样不动）
const flatFixture = JSON.stringify({
  sidebar: { widgetsConfig: { widgets: [{ value: "tag" }] } },
  style: { bannerStyle: { banner: "static" } },
});

// 目标 HTML
let target = process.argv[2];
if (!target) {
  for (const name of ["index.html", "page.html", "post.html"]) {
    const p = path.join(ROOT, "templates", name);
    if (fs.existsSync(p)) {
      target = p;
      break;
    }
  }
}
if (!target || !fs.existsSync(target)) {
  console.error("找不到构建产物（templates/*.html），请先 build，或显式传路径");
  process.exit(2);
}

const code = extractNormalizer(fs.readFileSync(target, "utf8"));
console.log(`被测脚本：${target}（${code.length} 字符）\n`);

// 1) 拆层后各消费者路径都能取到值
console.log("[1] 包了 realNode ⇒ 拆平后消费者路径全部可达");
{
  const out = runNormalizer(code, wrappedFixture);
  const cfg = JSON.parse(out);
  check(
    "顶层分组不再有 realNode",
    !("realNode" in cfg.sidebar),
    Object.keys(cfg.sidebar).join(","),
  );
  const wc = cfg.sidebar.widgetsConfig;
  check("sidebar.widgetsConfig 可达", !!wc);
  const weather = (wc?.rightWidgets || []).find((w) => w.value === "weather");
  check(
    "★ 天气 Key 能取到（原 bug：恒为 undefined ⇒ 一直提示「请配置腾讯地图 Key」）",
    weather?.tencent_key === "YT4BZ-7AHWQ-CIG55-4H5LF-AKUBK-SGB25",
    JSON.stringify(weather),
  );
  check("cfg.mods.cardShell 可达", cfg.mods?.cardShell === true);
  check(
    "cfg.style.bannerStyle 可达（banner 轮播）",
    cfg.style?.bannerStyle?.banner === "carousel",
  );
  check(
    "cfg.performance.imageProcessing 可达（post 页图片处理）",
    cfg.performance?.imageProcessing?.provider === "wsrv",
  );
  check(
    "cfg.base 仍是对象 ⇒ PopularPosts 必须自带字符串判据",
    typeof cfg.base === "object",
  );
}

// 2) 组内子对象不再包 ⇒ 只拆一层，别过度拆
console.log("[2] 只拆分组根一层");
{
  const cfg = JSON.parse(runNormalizer(code, wrappedFixture));
  check("组内子对象保持原样", cfg.sidebar.profile?.name === "LQBBY");
}

// 3) 未包 realNode 时原样不动（两态兼容）
console.log("[3] 未包 realNode ⇒ 不动");
{
  const out = runNormalizer(code, flatFixture);
  check("输出与输入一致", out === flatFixture, out);
  check(
    "扁平结构仍可读",
    JSON.parse(out).style?.bannerStyle?.banner === "static",
  );
}

// 4) 幂等：跑两遍结果不变
console.log("[4] 幂等");
{
  const once = runNormalizer(code, wrappedFixture);
  const twice = runNormalizer(code, once);
  check("第二遍不再变化", once === twice);
}

// 5) 异常输入不许抛（这段脚本在每个页面 head 里跑，抛了就白屏风险）
console.log("[5] 异常输入静默跳过");
for (const [label, raw] of [
  ["非法 JSON", "{ not json"],
  ["空串", ""],
  ["JS 注释占位（未经过 Halo 的裸产物）", "/*[[${}]]*/"],
  ["JSON 是数组", "[1,2,3]"],
  ["realNode 不是对象", '{"sidebar":{"realNode":"x"}}'],
]) {
  let ok = true;
  let out = "";
  try {
    out = runNormalizer(code, raw);
  } catch (e) {
    ok = false;
  }
  check(`${label} ⇒ 不抛异常`, ok);
  if (label === "realNode 不是对象") {
    check(
      "非对象的 realNode 原样保留",
      JSON.parse(out).sidebar.realNode === "x",
    );
  }
}

// 6) 两个外壳源码里这段脚本必须一致（少改一个 ⇒ 页面间行为不一致）
console.log("[6] 两个外壳同步");
{
  // ⚠️ 行尾归一化后再比：仓库 core.autocrlf=true，两个外壳的检出可能是 CRLF / LF 混着的，
  // 直接逐字节比会因 31 个 \r 报假差异（2026-09-18 踩过）。
  const norm = (s) => (s === null ? null : s.replace(/\r\n/g, "\n").trim());
  const a = norm(
    extractFromShell(fs.readFileSync(path.join(ROOT, SHELLS[0]), "utf8")),
  );
  const b = norm(
    extractFromShell(fs.readFileSync(path.join(ROOT, SHELLS[1]), "utf8")),
  );
  check(`${SHELLS[0]} 里有这段脚本`, a !== null);
  check(`${SHELLS[1]} 里有这段脚本`, b !== null);
  check(
    "两外壳的脚本逐行一致（行尾已归一化）",
    a !== null && b !== null && a === b,
    a && b ? `${a.length} vs ${b.length}` : "",
  );
}

// 7) #theme-config 必须带 data-swup-theme（否则换页时被 Swup head 插件换回原始 JSON）
//    根因：主题开了 updateHead:true，@swup/head-plugin 按 outerHTML 全等增删 head 元素 ——
//    被本脚本改写过的元素与「新页面的原始 JSON」永不相等 ⇒ 旧元素被删、带 realNode 的原始
//    元素被插回，天气 Key 在软导航后复发。data-swup-theme 让它既不删也不加（shouldKeepTag）。
console.log("[7] #theme-config 带 data-swup-theme（跨 Swup 换页常驻）");
{
  const tagRe = /<script[^>]*id="theme-config"[^>]*>/;
  const artifactHtml = fs.readFileSync(target, "utf8");
  const artTag = artifactHtml.match(tagRe)?.[0] || "";
  check(
    "产物里 #theme-config 带 data-swup-theme",
    /data-swup-theme/.test(artTag),
    artTag,
  );
  check(
    '产物里保留 th:inline="javascript"（拆层脚本不改 th 表达式）',
    /th:inline="javascript"/.test(artTag),
    artTag,
  );
  for (const rel of SHELLS) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const tag = src.match(tagRe)?.[0] || "";
    check(
      `${rel} 的 #theme-config 带 data-swup-theme`,
      /data-swup-theme/.test(tag),
      tag,
    );
  }
}

console.log(
  `\n通过 ${pass} 项${fails.length ? `，失败 ${fails.length} 项：\n - ${fails.join("\n - ")}` : "，全部通过"}`,
);
process.exit(fails.length ? 1 : 0);

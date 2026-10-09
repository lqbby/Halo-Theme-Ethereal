// @ts-check
// Banner 壁纸主题对齐桩测（jsdom 真执行构建产物内联脚本）
//
// 被测：src/layouts/MainGridLayout.astro 紧随 #banner-wrapper 的两个内联脚本
//   · 对齐：window.__etherealAlignBannerTheme —— 按 html.dark 决定暗色 <source>
//     存废与 img.src/object-position 归位（解析期执行，早于主 bundle）
//   · 揭示：window.__etherealRevealBanners —— 媒体就绪 + 首帧后摘 opacity-0/scale-105
//
// 回归的 bug（2026-10-09 报）：亮色模式刷新会瞬间闪一下暗色壁纸。机理：
//   <picture> 内暗色 <source media="(prefers-color-scheme: dark)"> 只认 OS 偏好、
//   看不到 html.dark ⇒「站点亮色 + 系统暗色」时浏览器解析期就选中暗色壁纸；揭示脚本
//   又立刻（读到的是暗图的 complete）摘了遮罩 ⇒ 亮图换回时闪一下暗图。
//
// 断言链：
//   BA-1 产物里对齐脚本存在，且排在揭示脚本之前（顺序即正确性）
//   BA-2 亮色有效 ⇒ 暗色 <source> 被移除；img.src 保持亮色；**亮色 srcset 阶梯保留**
//   BA-3 暗色有效 ⇒ src 切到 data-theme-src、srcset 被清、data-light-src 记录亮色原值
//   BA-4 object-position：暗色用 data-theme-position，亮色回 data-light-position
//   BA-5 幂等：重复调用不改变结果（app.ts / Swup 换页会再调）
//   BA-6 揭示门槛：候选集刚被换过（complete 先 true 后 false）时不得立刻摘遮罩，
//        必须等 load 事件才摘（否则闪暗图）
//
// 运行（JSDOM 在 managed workspace，不在仓库依赖里）：
//   NODE_PATH=C:\Users\LQ\.workbuddy\binaries\node\workspace\node_modules node scripts/test-banner-theme-align.mjs
//   ⚠️ 读 cwd 的 templates/index.html（构建产物）⇒ 须在 worktree 里跑
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_MODULE || "jsdom");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = join(ROOT, "templates/index.html");

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

if (!existsSync(INDEX)) {
  console.error(
    "❌ 找不到构建产物 templates/index.html —— 先 build 再跑（须在 worktree 里）",
  );
  process.exit(1);
}
const html = readFileSync(INDEX, "utf8");

/**
 * 抽出含 marker 的内联 <script> 体（is:inline 产物无属性，写作 `<script>`）
 * @param {string} src @param {string} marker
 */
function extractInline(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const open = src.lastIndexOf("<script", at);
  const bodyStart = src.indexOf(">", open) + 1;
  const end = src.indexOf("</script>", at);
  return src.slice(bodyStart, end);
}

const alignCode = extractInline(html, "__etherealAlignBannerTheme");
const revealCode = extractInline(html, "__etherealRevealBanners");

check("BA-1a 产物含对齐脚本", alignCode !== null, true);
check("BA-1b 产物含揭示脚本", revealCode !== null, true);
check(
  "BA-1c 对齐脚本排在揭示脚本之前",
  html.indexOf("__etherealAlignBannerTheme") <
    html.indexOf("__etherealRevealBanners"),
  true,
);
if (!alignCode || !revealCode) process.exit(1);

const LIGHT = "https://cdn.test/light.webp";
const LIGHT_SET =
  "https://cdn.test/light.webp?w=400 400w, https://cdn.test/light.webp?w=1600 1600w";
const DARK = "https://cdn.test/dark.webp?w=1920";

const BANNER_HTML = `<!DOCTYPE html><html><body>
<div id="banner-wrapper">
  <div id="banner" class="banner-reveal relative overflow-hidden opacity-0 scale-105">
    <picture class="contents">
      <source media="(prefers-color-scheme: dark)" data-ethereal-theme-dark srcset="${DARK}">
      <img id="banner-img" src="${LIGHT}" srcset="${LIGHT_SET}" sizes="100vw"
           data-theme-src="${DARK}" data-theme-position="top" style="object-position: center">
    </picture>
  </div>
</div>
</body></html>`;

/**
 * 造一个可跑两个内联脚本的 jsdom 环境
 * @param {{ dark: boolean, complete?: boolean }} opt
 */
function makeEnv(opt) {
  /** @type {string[]} */
  const jsdomErrors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (/** @type {{message?: string}} */ e) =>
    jsdomErrors.push(e && e.message ? e.message : String(e)),
  );
  const dom = new JSDOM(BANNER_HTML, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window;
  if (opt.dark) w.document.documentElement.classList.add("dark");
  const img = /** @type {any} */ (w.document.getElementById("banner-img"));
  // jsdom 不加载图片 ⇒ complete 由测试掌控，用来模拟「换图前 / 换图后」两种终态
  let completeFlag = opt.complete === true;
  Object.defineProperty(img, "complete", {
    configurable: true,
    get: () => completeFlag,
  });
  w.eval(alignCode);
  return {
    dom,
    w,
    img,
    jsdomErrors,
    setComplete: (/** @type {boolean} */ v) => {
      completeFlag = v;
    },
  };
}

/** @param {any} w */
const frames = (w, n = 3) =>
  new Promise((resolve) => {
    const step = (/** @type {number} */ k) =>
      k <= 0 ? resolve(undefined) : w.requestAnimationFrame(() => step(k - 1));
    step(n);
  });
/** @param {any} w */
const tick = (w) => new Promise((resolve) => w.setTimeout(resolve, 0));
/** @param {any} el */
const hidden = (el) =>
  el.classList.contains("opacity-0") && el.classList.contains("scale-105");

const run = async () => {
  // ── BA-2 亮色有效（bug 场景：不依赖 OS，jsdom 无媒体求值 ⇒ 直接验「source 被移除」）──
  {
    const env = makeEnv({ dark: false, complete: true });
    const { w, img } = env;
    check(
      "BA-2a 亮色：暗色 <source> 被移除",
      w.document.querySelectorAll("source[data-ethereal-theme-dark]").length,
      0,
    );
    check("BA-2b 亮色：src 保持亮色", img.getAttribute("src"), LIGHT);
    check("BA-2c 亮色：srcset 阶梯保留", img.getAttribute("srcset"), LIGHT_SET);
    check(
      "BA-2d 亮色：data-light-src 已记录",
      img.getAttribute("data-light-src"),
      LIGHT,
    );
    check("BA-2e 全程无 jsdom 运行时错误", env.jsdomErrors.length, 0);
  }

  // ── BA-3/BA-4 暗色有效 ──
  {
    const env = makeEnv({ dark: true, complete: false });
    const { w, img } = env;
    check(
      "BA-3a 暗色：暗色 <source> 保留（AUTO+OS 暗色时省一张亮图）",
      w.document.querySelectorAll("source[data-ethereal-theme-dark]").length,
      1,
    );
    check("BA-3b 暗色：src 切到 data-theme-src", img.getAttribute("src"), DARK);
    check("BA-3c 暗色：srcset 被清", img.hasAttribute("srcset"), false);
    check(
      "BA-3d 暗色：data-light-src 记录亮色原值",
      img.getAttribute("data-light-src"),
      LIGHT,
    );
    check(
      "BA-4a 暗色：用 data-theme-position",
      img.style.objectPosition,
      "top",
    );

    // ── BA-5 幂等 ──
    w.__etherealAlignBannerTheme();
    w.__etherealAlignBannerTheme();
    check("BA-5a 幂等：src 仍为暗色", img.getAttribute("src"), DARK);
    check("BA-5b 幂等：srcset 仍为空", img.hasAttribute("srcset"), false);
    check(
      "BA-5c 幂等：data-light-src 未被覆盖",
      img.getAttribute("data-light-src"),
      LIGHT,
    );
    check("BA-5d 全程无 jsdom 运行时错误", env.jsdomErrors.length, 0);
  }

  // ── BA-6 揭示门槛（回归核心）：候选集刚被换过时不得立刻摘遮罩 ──
  {
    const env = makeEnv({ dark: false, complete: true });
    const { w, img, setComplete } = env;
    const banner = w.document.getElementById("banner");
    w.eval(revealCode);
    // 模拟浏览器在「下一个任务」才提交新的 currentSrc：暗图（已缓存，complete=true）
    // 随 source 移除作废 ⇒ 此刻尚未就绪
    setComplete(false);
    await tick(w);
    await frames(w, 2);
    check("BA-6a 未就绪时不摘遮罩", hidden(banner), true);
    // 亮色图加载完成（load 事件）⇒ 才允许揭示
    img.dispatchEvent(new w.Event("load"));
    await frames(w, 3);
    check("BA-6b load 后摘遮罩", hidden(banner), false);
    check("BA-6c 全程无 jsdom 运行时错误", env.jsdomErrors.length, 0);
  }

  // ── BA-6 反向：图已就绪（缓存命中）时正常揭示，不会永久隐藏 ──
  {
    const env = makeEnv({ dark: false, complete: true });
    const { w } = env;
    const banner = w.document.getElementById("banner");
    w.eval(revealCode);
    await tick(w);
    await frames(w, 3);
    check("BA-6d 已就绪（complete）时正常揭示", hidden(banner), false);
    check("BA-6e 全程无 jsdom 运行时错误", env.jsdomErrors.length, 0);
  }

  console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
};

void run();

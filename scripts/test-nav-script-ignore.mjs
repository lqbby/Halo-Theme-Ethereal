// @ts-check
// 换页脚本重执行豁免名单桩测（2026-10-11 → v1.7.24）
//
// 背景：@swup/scripts-plugin 每次 content:replace 克隆执行全文档所有无
//   data-swup-ignore-script 的 <script>（文章页实测 53 个）。其中一批脚本
//   重跑是纯空转（整段 guardOnce / window 标志 / 早退）或重复注册监听——
//   给它们加豁免可省克隆+解析+执行开销（换页冻结减负，承 v1.7.23）。
//
// 判定规则（加豁免前必须读过脚本守卫结构）：
//   · 加：整段守卫（重跑 no-op）/ 事件委托 + 点击时查 DOM（跨页自然生效）
//   · 不加：每次重跑有实质工作（responsive/typewriter/drop 的换页重排、
//     fullscreen-hero 每页状态、footer-friends 页脚在容器内随换页重建）
//
// 判据（源码级）：
//   I1 豁免名单（8 处，均在 Swup 容器外持久）：
//      navbar.js / sakura.js / banner-carousel.js / banner-media.js /
//      banner-theme-switch.js / random-fish.js / 向下箭头内联 / CE 守卫内联
//   I2 必须不豁免的对照（防误加）：banner-responsive.js / banner-typewriter.js /
//      banner-drop.js / fullscreen-hero.js / footer-friends.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = join(ROOT, "src/layouts/MainGridLayout.astro");
const NAVBAR = join(ROOT, "src/components/Navbar.astro");
const LAYOUT = join(ROOT, "src/layouts/Layout.astro");

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

const main = readFileSync(MAIN, "utf8").replace(/\s+/g, " ");
const navbar = readFileSync(NAVBAR, "utf8").replace(/\s+/g, " ");
const layout = readFileSync(LAYOUT, "utf8").replace(/\s+/g, " ");

/** 某脚本 src 的标签块内是否含豁免属性 */
function hasIgnore(src, file) {
  const i = file.indexOf(`/assets/${src}?v=`);
  if (i < 0) return false;
  const end = file.indexOf("</script>", i);
  return file.slice(i, end).includes("data-swup-ignore-script");
}

check("I1a navbar.js 豁免", hasIgnore("navbar.js", navbar), true);
check("I1b sakura.js 豁免", hasIgnore("sakura.js", main), true);
check(
  "I1c banner-carousel.js 豁免",
  hasIgnore("banner-carousel.js", main),
  true,
);
check("I1d banner-media.js 豁免", hasIgnore("banner-media.js", main), true);
check(
  "I1e banner-theme-switch.js 豁免",
  hasIgnore("banner-theme-switch.js", main),
  true,
);
check("I1f random-fish.js 豁免", hasIgnore("random-fish.js", main), true);
check(
  "I1g 向下箭头内联豁免（is:inline data-swup-ignore-script）",
  /<script is:inline data-swup-ignore-script> \/\/ 全屏模式首页向下箭头/.test(
    main,
  ),
  true,
);
check(
  "I1h CustomElement 守卫内联豁免（Layout）",
  /Guard against duplicate Custom Element registration[\s\S]{0,80}<script data-swup-ignore-script>/.test(
    layout,
  ),
  true,
);

check(
  "I2a banner-responsive.js 不豁免（换页重排是设计行为）",
  hasIgnore("banner-responsive.js", main),
  false,
);
check(
  "I2b banner-typewriter.js 不豁免（runInitTW 每页重初始化）",
  hasIgnore("banner-typewriter.js", main),
  false,
);
check("I2c banner-drop.js 不豁免", hasIgnore("banner-drop.js", main), false);
check(
  "I2d fullscreen-hero.js 不豁免（无整段守卫、每页状态）",
  readFileSync(
    join(ROOT, "src/components/FullscreenHeroEffect.astro"),
    "utf8",
  ).includes("data-swup-ignore-script"),
  false,
);
check(
  "I2e footer-friends.js 不豁免（页面在容器内随换页重建）",
  hasIgnore("footer-friends.js", main),
  false,
);

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

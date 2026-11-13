// @ts-check
// 非主题页交还浏览器守卫（上游 #82）的行为桩测
//
// 被测：src/scripts/app.ts 里的 shouldHandoffToBrowser(html, containers)
//   —— 主题页必然带 astro.config.mjs 声明的全部 Swup 容器；插件自带前台页缺任一容器
//      ⇒ 返回 true（交还浏览器原生跳转），避免 SwupHeadPlugin 摘掉整套主题 CSS。
//
// 做法：从源码正则抽出该纯函数（去掉 TS 类型注解）后在 Node 里直接跑；再断言构建产物里
//      确实注册了 page:load 守卫（压缩后保留的字符串字面量）。
//
// 断言链：
//   SH-1 主题页（四个容器齐备）⇒ false（照常 Swup 接管）
//   SH-2 插件页缺一个容器 ⇒ true（交还浏览器）
//   SH-3 插件页四容器全缺 ⇒ true
//   SH-4 清单为空 / 非数组 / 选择器非常规 ⇒ 一律 false（宁可漏判，不误判主题页）
//   SH-5 产物 bundle 里 page:load 守卫存在（含容器选择器正则标志）
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "src/scripts/app.ts");
const ASSETS = join(ROOT, "templates/assets");

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

// ── 从源码抽出被测纯函数（剥离 TS 类型注解；函数体本身是 ES5 兼容 JS）──
const src = readFileSync(APP, "utf8");
const fnStart = src.indexOf("function shouldHandoffToBrowser");
if (fnStart < 0) {
  console.error(
    "❌ 源码里找不到 shouldHandoffToBrowser（上游 #82 守卫是否还在？）",
  );
  process.exit(1);
}
const fnEnd = src.indexOf("\n}", fnStart);
const raw = src.slice(fnStart, fnEnd + 2);
const cleaned = raw
  .replace(/: unknown/g, "")
  .replace(/: string/g, "")
  .replace(/: boolean/g, "")
  .replace(/\(html, containers\)/, "(html, containers)");
/** @type {(html: string, containers: unknown) => boolean} */
const shouldHandoffToBrowser = new Function(
  `${cleaned}; return shouldHandoffToBrowser;`,
)();

// 与 astro.config.mjs 的 swup.containers 一致（改配置时这里也要跟着改——测试的意义之一）
const CONTAINERS = [
  "#swup-container",
  "#toc-container",
  "#right-sidebar",
  "#toc-popup",
];
const themePage = `<html><body><main id="swup-container"></main><div id="toc-container"></div><aside id="right-sidebar"></aside><div id="toc-popup"></div></body></html>`;
const pluginPageMissingOne = themePage.replace(
  '<div id="toc-popup"></div>',
  "",
);
const pluginPageBare = "<html><body><div id='plugin-app'></div></body></html>";

check(
  "SH-1 主题页四容器齐备 ⇒ 不交还",
  shouldHandoffToBrowser(themePage, CONTAINERS),
  false,
);
check(
  "SH-2 插件页缺一个容器 ⇒ 交还",
  shouldHandoffToBrowser(pluginPageMissingOne, CONTAINERS),
  true,
);
check(
  "SH-3 插件页全缺 ⇒ 交还",
  shouldHandoffToBrowser(pluginPageBare, CONTAINERS),
  true,
);
check(
  "SH-4 清单为空 ⇒ 不交还",
  shouldHandoffToBrowser(pluginPageBare, []),
  false,
);
check(
  "SH-4 清单非数组 ⇒ 不交还",
  shouldHandoffToBrowser(pluginPageBare, null),
  false,
);
check(
  "SH-4 选择器非常规（含后代选择器）⇒ 不交还",
  shouldHandoffToBrowser(pluginPageBare, ["#swup-container .x"]),
  false,
);

// ── SH-5 产物断言：page:load 守卫已进 bundle（压缩后仅字符串字面量可匹配）──
if (!existsSync(ASSETS)) {
  console.error(`❌ 找不到构建产物目录（先在仓库根跑 astro build）：${ASSETS}`);
  process.exit(1);
}
// 脚本序号会随 Layout.astro 里 <script> 块增减漂移（曾是 index_1，现为 index_0），
// 不写死序号：在所有 Layout 脚本 bundle 里找真正含 page:load 守卫的那一个。
const bundles = readdirSync(ASSETS).filter(
  (f) =>
    /^Layout\.astro_astro_type_script_index_\d+_lang\./.test(f) &&
    f.endsWith(".js"),
);
if (!bundles.length) {
  console.error("❌ 产物里找不到 Layout 主脚本 bundle");
  process.exit(1);
}
const bundleName = bundles.find((f) =>
  readFileSync(join(ASSETS, f), "utf8").includes("page:load"),
);
const bundle = bundleName ? readFileSync(join(ASSETS, bundleName), "utf8") : "";
const hasHook = bundle.includes("page:load");
const hasContainersRef = /containers/.test(bundle);
check("SH-5 产物注册了 page:load 守卫", hasHook && hasContainersRef, true);
if (!hasHook) console.log("    bundles:", bundles.join(", "));

console.log(`\n${failures === 0 ? "✅ 全部通过" : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);

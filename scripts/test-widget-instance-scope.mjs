// @ts-check
// 小组件「实例作用域」桩测（2026-10-12，v1.7.32）
//
// 背景：同一小组件可同时配在桌面两栏与移动端列表 ⇒ 文档里有多份同 id 元素。
//   原实现用 getElementById(固定 id) 与 __themeLazyInit(字符串键) 定位元素，
//   永远命中文档第一个（桌面那份）；移动端其被 has-mobile-sidebar 隐藏 ⇒
//   IO 永不触发、内容永远停在「加载中」（实测「热门文章」复现）。
// 修复：各组件脚本用 document.currentScript 取本实例所在条目容器（widgetRoot），
//   容器内 querySelector；__themeLazyInit 改传元素（不再是字符串键）。
// 判据：
//   W1 六个受影响组件均有 widgetRoot + currentScript 声明
//   W2 这些组件内不再有「按内联 id 的 getElementById」（theme-config 等全局除外）
//   W3 组件目录内不再出现 __themeLazyInit("字符串键") 形态（音乐播放器用唯一变量 id，合法）
//   W4 Layout.astro 的懒加载批处理含「零尺寸 = 隐藏 ⇒ observe」判据（防重复请求）
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = join(ROOT, "src/components/widget");
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

const TARGETS = [
  "PopularPosts",
  "Hitokoto",
  "MoeCounter",
  "RecentComments",
  "SiteStats",
  "Weather",
];
// 允许保留的全局 id（非实例内部元素）
const GLOBAL_IDS = ["theme-config"];

for (const name of TARGETS) {
  const src = readFileSync(join(W, `${name}.astro`), "utf8");
  const hasRoot =
    /var widgetRoot =\s*\n?\s*\(document\.currentScript && document\.currentScript\.parentElement\) \|\|\s*\n?\s*document;/.test(
      src,
    );
  check(`W1 ${name} 有 widgetRoot（currentScript 实例作用域）`, hasRoot, true);

  const inlineIds = [...src.matchAll(/document\.getElementById\("([^"]+)"\)/g)]
    .map((m) => m[1])
    .filter((id) => !GLOBAL_IDS.includes(id));
  check(
    `W2 ${name} 无内联 id 的 getElementById（剩余：${inlineIds.join(",") || "无"}）`,
    inlineIds.length,
    0,
  );
  check(
    `W3 ${name} 懒加载注册不再用字符串键`,
    /__themeLazyInit\("/.test(src),
    false,
  );
}

{
  const layout = readFileSync(LAYOUT, "utf8");
  check(
    "W4 懒加载批处理含零尺寸判据（rect.width > 0 && rect.height > 0）",
    /rect\.width > 0 &&\s*\n\s*rect\.height > 0 &&/.test(layout),
    true,
  );
}

// 组件目录整体扫描：不应再有 __themeLazyInit("字面量id"
{
  let offenders = [];
  for (const f of readdirSync(W)) {
    if (!f.endsWith(".astro")) continue;
    const src = readFileSync(join(W, f), "utf8");
    if (/__themeLazyInit\("/.test(src)) offenders.push(f);
  }
  check(
    "W5 组件目录无 __themeLazyInit(字符串字面量) 残迹",
    offenders.join(",") || "无",
    "无",
  );
}

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

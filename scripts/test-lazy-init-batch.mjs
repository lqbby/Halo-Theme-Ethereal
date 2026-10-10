// @ts-check
// 换页冻结减负桩测（2026-10-11，v1.7.23）
//
// 背景：CDP Profiler 归因显示换页长任务（~274ms）中 ~126ms 来自
//   `window.__themeLazyInit` 的「同步可见性检查」——换页后各 widget 内联
//   脚本依次调用它，每次 getComputedStyle+getBoundingClientRect 都在脏树
//   上强制布局，且 initFn 改 DOM 后下一个再测 ⇒ 级联冲刷。另有 replaceWith
//   克隆执行全文档 53 个脚本（其中纯定义类无需重跑）。
// 修复：① themeLazyInit 批量化（同任务收集 → 微任务批量测量一次冲刷 →
//   批量执行 init；queueMicrotask 带 Promise 回退）；② 两个纯定义脚本
//   （i18n 助手 / themeLazyInit 定义）加 data-swup-ignore-script 豁免
//   Swup 重执行克隆。
//
// 判据（源码级）：Layout.astro 中
//   L1 i18n 助手脚本带 data-swup-ignore-script
//   L2 themeLazyInit 定义脚本带 data-swup-ignore-script
//   L3 批量收集 + 微任务调度（queue + schedule + queueMicrotask + Promise 回退）
//   L4 两遍结构：先测量收集再执行（不再在调用点直接 getComputedStyle）
//   L5 observe 分支保留（离屏仍走 IntersectionObserver 懒加载）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
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

const src = readFileSync(LAYOUT, "utf8");
const flat = src.replace(/\s+/g, " ");

check(
  "L1 i18n 助手脚本带 data-swup-ignore-script",
  /<script is:inline data-swup-ignore-script> \/\/ 全局 i18n 助手/.test(flat),
  true,
);
check(
  "L2 themeLazyInit 定义脚本带 data-swup-ignore-script",
  /<script is:inline data-swup-ignore-script> \(function \(\) \{ if \(window\.__themeLazyInit\) return; var queue = \[\];/.test(
    flat,
  ),
  true,
);
check(
  "L3 批量收集 + 微任务调度（含 Promise 回退）",
  /queue\.push\(/.test(flat) &&
    /var schedule = function \(\) \{ if \(scheduled\) return; scheduled = true; if \(typeof queueMicrotask === "function"\) queueMicrotask\(flush\); else if \(typeof Promise === "function"\) Promise\.resolve\(\)\.then\(flush\); else flush\(\); \};/.test(
      flat,
    ),
  true,
);
check(
  "L4 两遍结构：第一遍集中测量（注释锚定）+ 第二遍执行 init",
  /第一遍：集中测量（脏树只冲刷一次布局）/.test(flat) &&
    /第二遍：批量执行 init/.test(flat) &&
    /for \(var j = 0; j < run\.length; j\+\+\) run\[j\]\.initFn\(\);/.test(
      flat,
    ),
  true,
);
check(
  "L5 离屏仍走 IntersectionObserver（observe 分支保留）",
  /observe: function \(\) \{ var io = new IntersectionObserver\(/.test(flat),
  true,
);
check(
  "L6 调用点不再直接同步测量（getComputedStyle 只在 flush 内）",
  (() => {
    const defs = flat.indexOf("window.__themeLazyInit = function");
    const before = flat.slice(0, defs);
    // 定义之前不应再有 __themeLazyInit 的旧同步实现残留（旧实现含
    // 「cs.display !== "none"」同步检查）
    return (
      before.indexOf('cs.display !== "none"') < 0 &&
      flat.split("getComputedStyle(item.el)").length === 2
    );
  })(),
  true,
);

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

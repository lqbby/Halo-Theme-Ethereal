// @ts-check
// CSS 前缀成对·顺序契约桩测（2026-10-20，bug-hunter round1 · R2）
//
// 背景：压缩链（lightningcss）会把同一规则内的 `X` 与 `-webkit-X` 视为重复声明、
//   只保留**最后一条**。因此「前缀在后」= 产物只剩前缀版 = Chromium 静默失去该属性。
//   round1 扫描在 `markdown.css` 抓到两处写反：
//     · `.custom-md a:not(...)` 的 `box-decoration-break`（多行链接的虚线下划线克隆）
//     · `.custom-md li.vditor-task input[type=checkbox]` 的 `appearance`（任务清单复选框自绘）
// 判据：
//   P1 源码里已知前缀对的顺序一律「前缀在前、标准在后」（.css 与 .astro 内联 style 都扫）
//   P2 构建期守卫 ensure-backdrop-filter-pair 覆盖这些属性对（双向补齐）
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAIRS = [
  "backdrop-filter",
  "box-decoration-break",
  "appearance",
];

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

/** 扫描一段 CSS 文本里的「前缀在后」违规，baseLine 用于把行号映射回源文件 */
/**
 * @param {string} text
 * @param {string} label
 * @param {string[]} out
 * @param {number} [baseLine]
 */
function scanCssText(text, label, out, baseLine = 0) {
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2];
    for (const prop of PAIRS) {
      const iStd = body.indexOf(`${prop}:`);
      const iPre = body.indexOf(`-webkit-${prop}:`);
      if (iPre > iStd && iStd >= 0) {
        const line = baseLine + text.slice(0, m.index).split("\n").length;
        out.push(`${label}:${line} (${prop})`);
      }
    }
  }
}

/** 收集 src 下所有 css 文件 + .astro 内联 <style> 的「前缀在后」违规 */
function scanReversed() {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const files = [];
  /** @param {string} d */
  const walk = (d) => {
    for (const e of readdirSyncSafe(d)) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith(".css") || e.name.endsWith(".astro")) files.push(join(d, e.name));
    }
  };
  walk(join(ROOT, "src"));
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const label = f.replace(ROOT, "").replace(/\\/g, "/");
    if (f.endsWith(".astro")) {
      // 只扫 <style> 块（frontmatter/脚本里的对象字面量会误报）
      for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
        const before = text.slice(0, m.index + m[0].indexOf(">") + 1);
        const baseLine = before.split("\n").length - 1;
        scanCssText(m[1], label + " [内联style]", out, baseLine);
      }
    } else {
      scanCssText(text, label, out);
    }
  }
  return out;
}
/** @param {string} d */
function readdirSyncSafe(d) {
  try {
    return readdirSync(d, { withFileTypes: true });
  } catch {
    return [];
  }
}

const reversed = scanReversed();
check(`P1 无「前缀在后」的规则（${reversed.length} 处违规）`, reversed.length, 0);
if (reversed.length) for (const r of reversed.slice(0, 6)) console.log("    ", r);

{
  const guard = readFileSync(join(ROOT, "scripts/ensure-backdrop-filter-pair.mjs"), "utf8");
  const missing = PAIRS.filter((p) => !guard.includes(`"${p}"`));
  check(
    `P2 守卫覆盖全部前缀对（缺 ${missing.join(",") || "无"}）`,
    missing.length,
    0,
  );
}

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

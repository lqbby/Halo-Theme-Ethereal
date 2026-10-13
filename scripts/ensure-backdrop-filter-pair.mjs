// @ts-check
// 构建后处理：兜底补回被 CSS 工具链「去重」吃掉的 **无前缀** backdrop-filter。
//
// 背景（2026-10-13 实测）：lightningcss/压缩链会把同一规则里的
//   backdrop-filter: blur(8px);  -webkit-backdrop-filter: blur(8px);
// 视为重复声明、只保留**最后一条**。主题的惯例是「前缀在前、标准在后」（保留标准版 ✓），
// 但 .banner-link（banner 链接胶囊，v1.7.25 自上游移植）与 .random-fish-overlay 两处
// 写成了「标准在前、前缀在后」⇒ 产物里只剩 `-webkit-backdrop-filter:`，而
// **Chromium 只认无前缀的 backdrop-filter** ⇒ Chrome/Edge/Android 上这两处磨砂直接失效
// （Safari 因为认前缀反而正常，属于最隐蔽的一类：本机测不出、换浏览器才炸）。
//
// 与 ensure-icon-mask-prefix 同理：不依赖工具链行为，直接对产物**双向补齐**——
// 只有 `-webkit-backdrop-filter: V` 的规则补 `backdrop-filter: V`（Chromium 只认后者）；
// 只有 `backdrop-filter: V` 的规则补 `-webkit-backdrop-filter: V`（Safari < 18 只认前者）。
// 压缩链按「同属性去重」只留一条，这一步是让两端都有磨砂的唯一可靠办法。
//
// 以 Astro integration 挂载到 astro:build:done（见 astro.config.mjs），
// 也可独立运行：node scripts/ensure-backdrop-filter-pair.mjs [outDir]（默认 ./templates）
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 最内层规则：选择器 { 声明块 }（@media/@layer 外层含 `{`，[^{}] 不会跨层）
const RULE = /([^{}]+)\{([^{}]*)\}/g;

/**
 * 给一段 CSS 补回缺失的无前缀 `backdrop-filter`。
 * 只处理「有 -webkit- 版、缺标准版」的规则；顺序写错导致的丢失由它兜底，
 * 源码侧仍应统一「前缀在前、标准在后」。
 * @param {string} content
 * @returns {{ content: string, rules: number, patched: number, added: string[] }}
 */
export function patchBackdropFilterPairs(content) {
  let rules = 0;
  let patched = 0;
  const added = [];
  const out = content.replace(RULE, (whole, selector, body) => {
    const hasPre = /-webkit-backdrop-filter\s*:/.test(body);
    const stdMatch = /(^|[^-\w])backdrop-filter\s*:\s*([^;}]+)/.exec(body);
    const preMatch = /-webkit-backdrop-filter\s*:\s*([^;}]+)/.exec(body);
    if (!hasPre && !stdMatch) return whole;
    if (hasPre && stdMatch) return whole; // 已成对
    rules++;
    const value = (stdMatch ? stdMatch[2] : preMatch[1]).trim();
    const missingPre = !hasPre;
    // 缺哪条补哪条；插在已有那条之后（保持「前缀在前、标准在后」的观感）
    const anchorMatch = hasPre ? preMatch : stdMatch;
    const idx = body.indexOf(anchorMatch[0]) + anchorMatch[0].length;
    const decl = missingPre
      ? `-webkit-backdrop-filter:${value}`
      : `backdrop-filter:${value}`;
    patched++;
    added.push(
      `${selector.trim().slice(-60)} → ${decl.split(":")[0]}: ${value}`,
    );
    const newBody = body.slice(0, idx) + ";" + decl + body.slice(idx);
    return `${selector}{${newBody}}`;
  });
  return { content: out, rules, patched, added };
}

/**
 * 对目录下所有 .css 执行兜底（递归），写回文件并打印统计。
 * @param {string} dir
 */
export async function ensureBackdropFilterPairInDir(dir) {
  const root = resolve(dir);
  let files = 0;
  let patchedTotal = 0;
  const samples = [];
  /** @param {string} d */
  async function walk(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.name.endsWith(".css")) {
        const src = await readFile(p, "utf8");
        const r = patchBackdropFilterPairs(src);
        if (r.patched > 0) {
          await writeFile(p, r.content, "utf8");
          files++;
          patchedTotal += r.patched;
          for (const a of r.added.slice(0, 3)) samples.push(`${e.name}: ${a}`);
        }
      }
    }
  }
  await walk(root);
  if (patchedTotal > 0) {
    console.log(
      `[backdrop-filter-pair] 已兜底补齐 ${patchedTotal} 条不完整声明（压缩链按同属性去重、只留一条）：${files} 个文件`,
    );
    for (const s of samples) console.log(`[backdrop-filter-pair]     ${s}`);
    console.log(
      "[backdrop-filter-pair]    产物已补成对（-webkit- 与标准版各一条），Chrome/Edge/Android 与 Safari 都有磨砂。",
    );
  } else {
    console.log("[backdrop-filter-pair] 齐全（每条 backdrop-filter 都成对）");
  }
  return { patchedTotal };
}

// 独立运行入口
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const dir = process.argv[2] ?? "./templates";
  await ensureBackdropFilterPairInDir(dir);
}

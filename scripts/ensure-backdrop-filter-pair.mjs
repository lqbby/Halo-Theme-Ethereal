// @ts-check
// 构建后处理：兜底补回被 CSS 工具链「去重」吃掉的前缀/标准声明对。
//
// 背景（2026-10-13 实测）：lightningcss/压缩链会把同一规则里的
//   backdrop-filter: X;  -webkit-backdrop-filter: X;
// 视为重复声明、只保留**最后一条**。主题惯例是「前缀在前、标准在后」（保留标准版 ✓），
// 一旦写成「标准在前、前缀在后」，产物里就只剩 `-webkit-` 版——
// **Chromium 只认无前缀**，该属性在现代浏览器上静默失效（Safari 因为认前缀反而正常，
// 属于最隐蔽的一类：本机测不出、换浏览器才炸）。
//
// 2026-10-20（bug-hunter round1）把覆盖属性从 backdrop-filter 扩到整组前缀对：
//   · backdrop-filter   —— banner 链接胶囊 / 随机鱼遮罩的磨砂（曾全站失效）
//   · box-decoration-break —— 多行链接的虚线下划线 / 圆角克隆（正文链接）
//   · appearance        —— 自绘控件的原生外观清除（任务清单复选框）
//
// 与 ensure-icon-mask-prefix 同理：不依赖工具链行为，直接对产物**双向补齐**——
// 只有前缀版的补标准版、只有标准版的补前缀版。压缩链按「同属性去重」只留一条，
// 这一步是让两端浏览器都拿得到该属性的唯一可靠办法。
//
// 以 Astro integration 挂载到 astro:build:done（见 astro.config.mjs），
// 也可独立运行：node scripts/ensure-backdrop-filter-pair.mjs [outDir]（默认 ./templates）
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 需要成对出现的属性（标准名；前缀名由 -webkit- 拼出） */
export const PREFIX_PAIR_PROPS = [
  "backdrop-filter",
  "box-decoration-break",
  "appearance",
];

// 最内层规则：选择器 { 声明块 }（@media/@layer 外层含 `{`，[^{}] 不会跨层）
const RULE = /([^{}]+)\{([^{}]*)\}/g;

/**
 * 给一段 CSS 双向补齐前缀对。
 * @param {string} content
 * @param {string[]} props
 * @returns {{ content: string, rules: number, patched: number, added: string[] }}
 */
export function patchPrefixPairs(content, props = PREFIX_PAIR_PROPS) {
  let rules = 0;
  let patched = 0;
  /** @type {string[]} */
  const added = [];
  const out = content.replace(RULE, (whole, selector, body) => {
    let newBody = body;
    for (const prop of props) {
      const pre = `-webkit-${prop}`;
      const stdRe = new RegExp(`(^|[^-\\w])${prop}\\s*:\\s*([^;}]+)`);
      const preRe = new RegExp(`${pre}\\s*:\\s*([^;}]+)`);
      const stdMatch = stdRe.exec(newBody);
      const preMatch = preRe.exec(newBody);
      if (!stdMatch && !preMatch) continue;
      if (stdMatch && preMatch) continue; // 已成对
      rules++;
      const value = (stdMatch?.[2] ?? preMatch?.[1] ?? "").trim();
      // stdMatch / preMatch 至少一个非空（上方的 continue 已排除双空），
      // ?? 只是让类型检查器看得见这层保证。
      const anchorMatch = /** @type {RegExpExecArray} */ (preMatch ?? stdMatch);
      const idx = newBody.indexOf(anchorMatch[0]) + anchorMatch[0].length;
      const decl = preMatch ? `${prop}:${value}` : `${pre}:${value}`;
      patched++;
      added.push(`${selector.trim().slice(-60)} → ${decl.split(":")[0]}: ${value}`);
      newBody = newBody.slice(0, idx) + ";" + decl + newBody.slice(idx);
    }
    return newBody === body ? whole : `${selector}{${newBody}}`;
  });
  return { content: out, rules, patched, added };
}

/** 兼容旧名（历史调用点 / 桩测） */
/** @param {string} content */
export const patchBackdropFilterPairs = (content) =>
  patchPrefixPairs(content, ["backdrop-filter"]);

/**
 * 对目录下所有 .css 执行兜底（递归），写回文件并打印统计。
 * @param {string} dir
 */
export async function ensureBackdropFilterPairInDir(dir) {
  const root = resolve(dir);
  let files = 0;
  let patchedTotal = 0;
  /** @type {string[]} */
  const samples = [];
  /** @param {string} d */
  async function walk(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.name.endsWith(".css")) {
        const src = await readFile(p, "utf8");
        const r = patchPrefixPairs(src);
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
      `[prefix-pair] 已兜底补齐 ${patchedTotal} 条不完整声明（压缩链按同属性去重、只留一条）：${files} 个文件`,
    );
    for (const s of samples) console.log(`[prefix-pair]     ${s}`);
    console.log(
      "[prefix-pair]    产物已补成对（-webkit- 与标准版各一条），Chrome/Edge/Android 与 Safari 都拿得到该属性。",
    );
  } else {
    console.log(
      "[prefix-pair] 齐全（backdrop-filter / box-decoration-break / appearance 都成对）",
    );
  }
  return { patchedTotal };
}

// 独立运行入口
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const dir = process.argv[2] ?? "./templates";
  await ensureBackdropFilterPairInDir(dir);
}

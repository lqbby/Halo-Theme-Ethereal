// @ts-check
// 构建后处理：压缩产物 HTML（templates/**/*.html）里**内联 <script>** 的体积。
//
// 目的：每个页面模板都带一大坨逐页重复的内联脚本（导航/两侧栏小组件/瞬间条/浮动按钮…），
// 而这些脚本**没有经过任何压缩**（Astro 的 is:inline 原样输出，行内缩进与注释全在）。
// 实测 29 个页面合计 4,457,292 B 的可压缩脚本体，去注释+折叠空白后降到 3,104,505 B（−30.3%）。
//
// 只做「去注释 + 折叠空白 + 重排（re-print）」，**不做**标识符改名、**不做**语法降级：
//   esbuild transform({ minifyWhitespace: true, minifyIdentifiers: false, minifySyntax: false })
// 这样语义变化面最小——不进 AST 语义改写，只丢注释与空白。
// ⚠️ 绝不用手写正则压缩：换行折叠会踩 ASI（自动分号插入）语义变化。
//
// 🔴 保护规则（任一命中即原样跳过）：
//   1. 有 src 属性（外部脚本，不归本脚本管）
//   2. type 存在且不是 JS（如 type="application/json" 的 theme-config）
//   3. 脚本体内含 Thymeleaf 内联表达式 —— 压缩器会把 /*…*/ 当普通注释删掉
//      ⇒ 表达式丢失、页面静默出错。见下方 TH_INLINE_RE，**不要退化成「含 `[[` 就跳过`」**：
//      仓库里有 ~112 段脚本因为正则字面量 `\[[^\]]*\]\(...\)`（Markdown 链接清理）
//      里出现两个连续 `[` 字符而被误判，白丢 1.3 MB 可压缩体。
//      ⚠️ 但 `th:inline="none"` 的脚本是**显式禁止内联**的，必须照压。
//   4. th:inline="javascript"（同上，双保险；覆盖不带注释包裹的 `[#…]` / `[(…)]` 块语法）
//   5. 体积 < MIN_LEN（压缩不值当，且改动噪音大）
//   6. esbuild 解析失败（不是合法 JS，如 HTML 注释包裹的老脚本）⇒ 跳过并告警
//
// 以 Astro integration 挂载到 astro:build:done（见 astro.config.mjs），
// 也可独立运行：node scripts/minify-inline-scripts.mjs [dir]（默认 ./templates）
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

/** 小于此体积的内联脚本不动（收益不值当） */
const MIN_LEN = 200;

// Thymeleaf 内联表达式的**开头**形态（紧跟在 `[[` / `[( ` 后面的必须是表达式前缀字符）：
//   /*[[${expr}]]*/  ·  /*[# th:each="…"]*/ … /*[/]*/  ·  [(${expr})]  ·  [[_${expr}_]] …
// ⚠️ 判据**不能**退化成 `includes("[[")` —— 见文件头保护规则第 3 条。
const TH_INLINE_RE = /\[\[\s*[$#@*~_]|\[\(\s*[$#@*~_]|\/\*\[/;

// 开标签属性 / 脚本体；结束标签用 [^>]*> 宽松匹配，兼容 `</script >`
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script[^>]*>/gi;

/**
 * 属性串里是否含某属性（宽松匹配 `attr=` / `attr =`）
 * @param {string} attrs
 * @param {string} name
 */
function hasAttr(attrs, name) {
  return new RegExp(`(?:^|\\s)${name}\\s*=`, "i").test(attrs);
}

/**
 * 取某属性的值（无引号/单/双引号三种写法）
 * @param {string} attrs
 * @param {string} name
 * @returns {string|null}
 */
function getAttr(attrs, name) {
  const m = attrs.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "i"),
  );
  if (!m) return null;
  return m[1].replace(/^["']|["']$/g, "").toLowerCase();
}

/**
 * 该内联脚本是否允许压缩。
 * @param {string} attrs 开标签属性串
 * @param {string} body 脚本体
 * @returns {string|null} null = 可压缩；否则返回跳过原因
 */
export function skipReason(attrs, body) {
  if (hasAttr(attrs, "src")) return "external";
  const type = getAttr(attrs, "type");
  if (
    type &&
    !/^(?:text\/javascript|application\/javascript|module)$/.test(type)
  ) {
    return `type=${type}`;
  }
  // th:inline="javascript" 的脚本体一定有内联表达式；th:inline="none" 则显式禁止内联
  const inline = getAttr(attrs, "th:inline");
  if (inline === "javascript") return "th:inline=javascript";
  if (inline !== "none" && TH_INLINE_RE.test(body)) return "thymeleaf-inline";
  if (body.trim().length < MIN_LEN) return "too-small";
  return null;
}

/**
 * 压缩单个 HTML 文件里的内联脚本。
 * @param {string} file
 * @returns {Promise<{before:number, after:number, count:number, skipped:Record<string,number>}>}
 */
async function minifyFile(file) {
  const html = await readFile(file, "utf8");
  /** @type {{before:number, after:number, count:number, skipped:Record<string,number>}} */
  const stat = { before: 0, after: 0, count: 0, skipped: {} };
  /** @type {{start:number, end:number, out:string}[]} */
  const replacements = [];

  for (const m of html.matchAll(SCRIPT_RE)) {
    const attrs = m[1];
    const body = m[2];
    const reason = skipReason(attrs, body);
    if (reason) {
      stat.skipped[reason] = (stat.skipped[reason] ?? 0) + 1;
      continue;
    }
    let out;
    try {
      const r = await transform(body, {
        loader: "js",
        target: "esnext",
        minifyWhitespace: true,
        minifyIdentifiers: false,
        minifySyntax: false,
        legalComments: "none",
      });
      out = r.code;
    } catch (err) {
      stat.skipped["parse-error"] = (stat.skipped["parse-error"] ?? 0) + 1;
      console.warn(
        `[minify-inline] 解析失败，跳过一段脚本（${file}）：${err instanceof Error ? err.message : err}`,
      );
      continue;
    }
    if (!out || out.length >= body.length) {
      stat.skipped["no-gain"] = (stat.skipped["no-gain"] ?? 0) + 1;
      continue;
    }
    const start = m.index + `<script${attrs}>`.length;
    replacements.push({ start, end: start + body.length, out });
    stat.before += body.length;
    stat.after += out.length;
    stat.count++;
  }

  if (replacements.length > 0) {
    let next = "";
    let cursor = 0;
    for (const r of replacements) {
      next += html.slice(cursor, r.start) + r.out;
      cursor = r.end;
    }
    next += html.slice(cursor);
    await writeFile(file, next);
  }
  return stat;
}

/**
 * 递归压缩目录下全部 HTML 里的内联脚本（含子目录）。
 * @param {string} dirPath
 */
export async function minifyInlineScriptsInDir(dirPath) {
  const total = {
    files: 0,
    count: 0,
    before: 0,
    after: 0,
    /** @type {Record<string, number>} */
    skipped: {},
  };
  /** @param {string} dir */
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      console.warn(`[minify-inline] 目录不存在，跳过：${dir}`);
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile() && e.name.endsWith(".html")) {
        const s = await minifyFile(p);
        if (s.count > 0) {
          total.files++;
          total.count += s.count;
          total.before += s.before;
          total.after += s.after;
        }
        for (const [k, v] of Object.entries(s.skipped)) {
          total.skipped[k] = (total.skipped[k] ?? 0) + v;
        }
      }
    }
  };
  await walk(dirPath);

  const saved = total.before - total.after;
  const pct =
    total.before > 0 ? ((saved / total.before) * 100).toFixed(1) : "0.0";
  console.log(
    `[minify-inline] 压缩 ${total.count} 段内联脚本（${total.files} 个 HTML）：` +
      `${(total.before / 1024).toFixed(0)}K → ${(total.after / 1024).toFixed(0)}K（-${pct}%）`,
  );
  const skippedStr = Object.entries(total.skipped)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`[minify-inline] 跳过 ${skippedStr || "（无）"}`);
  return total;
}

// 独立运行入口：node scripts/minify-inline-scripts.mjs [dir]
if (
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
) {
  const dir = process.argv[2] ?? "templates";
  minifyInlineScriptsInDir(dir).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

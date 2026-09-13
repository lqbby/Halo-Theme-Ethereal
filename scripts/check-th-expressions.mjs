#!/usr/bin/env node
/**
 * check-th-expressions.mjs —— Thymeleaf 属性表达式静态体检
 *
 * 背景（1.5.0 线上血案）：`th:classappend="${a}${b}"`（两个 ${} 紧挨着、中间无分隔）
 * 会让 Thymeleaf 抛 `TemplateProcessingException: Could not parse as expression`
 * ⇒ 页面 **HTTP 200 但响应在异常处被截断**（客户端拿到半个 DOM，看起来像"某块没渲染"）。
 * 这类错误在 `node --check` / grep 产物里**查不出来**，只能靠本脚本。
 *
 * 规则（依据仓库里已验证的线上事实）：
 *   ✅ `...${a} + ${b}...`      —— 有非空白分隔符，可用（Layout.astro:176 线上在跑）
 *   ✅ `|${a}${b}|`             —— `|...|` 字面量替换里允许紧邻（PostCard.astro:126 线上在跑）
 *   ❌ `...${a}${b}...`         —— 紧邻且无分隔 ⇒ Thymeleaf 解析失败（1.5.0 blog-changelog:349）
 *   ⚠️ `...${a} ${b}...`        —— 只有空白分隔，未在线上验证过，按警告处理
 *
 * 用法：node scripts/check-th-expressions.mjs      （有 ❌ 时退出码 1）
 *      node scripts/check-th-expressions.mjs --warn-only
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "templates"];
const EXT = /\.(astro|html)$/;
const ATTR_RE = /\bth:[\w-]+\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** 找出 value 里所有 ${...} / #{...} / *{...} / @{...} 标记的区间（支持嵌套花括号与引号） */
function scanExpressions(value) {
  const marker = /[#$*@]\{/g;
  const exprs = [];
  let m;
  while ((m = marker.exec(value)) !== null) {
    let i = m.index + 2;
    let depth = 1;
    let quote = null;
    while (i < value.length) {
      const ch = value[i];
      if (quote) {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === quote) quote = null;
        i++;
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        i++;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    if (depth !== 0) return { exprs, unbalancedAt: m.index };
    exprs.push({ start: m.index, end: i + 1 });
    marker.lastIndex = i + 1;
  }
  return { exprs, unbalancedAt: -1 };
}

function lineCol(text, index) {
  let line = 1;
  let last = -1;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\n") {
      line++;
      last = i;
    }
  }
  return { line, col: index - last };
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.test(name)) out.push(full);
  }
  return out;
}

const errors = [];
const warnings = [];

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const text = readFileSync(file, "utf8");
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    ATTR_RE.lastIndex = 0;
    let m;
    while ((m = ATTR_RE.exec(text)) !== null) {
      const raw = m[1] !== undefined ? m[1] : m[2];
      if (!raw || !raw.includes("{")) continue;
      const valueOffset = m.index + m[0].indexOf(raw);

      // |...| 字面量替换：内部允许紧邻，跳过
      const isLiteralSubst = /^\s*\|[\s\S]*\|\s*$/.test(raw);
      const { exprs, unbalancedAt } = scanExpressions(raw);

      if (unbalancedAt >= 0) {
        const p = lineCol(text, valueOffset + unbalancedAt);
        errors.push({
          rel,
          ...p,
          attr: m[0].split("=")[0].trim(),
          kind: "花括号不配对",
          snippet: raw.slice(0, 90),
        });
        continue;
      }
      if (isLiteralSubst || exprs.length < 2) continue;

      for (let i = 1; i < exprs.length; i++) {
        const gap = raw.slice(exprs[i - 1].end, exprs[i].start);
        if (gap.length === 0) {
          const p = lineCol(text, valueOffset + exprs[i - 1].start);
          errors.push({
            rel,
            ...p,
            attr: m[0].split("=")[0].trim(),
            kind: "两个表达式紧邻、无分隔符（Thymeleaf 会解析失败 ⇒ 200 但整页截断）",
            snippet: raw.slice(0, 90),
          });
        } else if (gap.trim() === "") {
          const p = lineCol(text, valueOffset + exprs[i - 1].start);
          warnings.push({
            rel,
            ...p,
            attr: m[0].split("=")[0].trim(),
            kind: "表达式间只有空白分隔（未验证，建议改用 `${a + b}` 或 `|...|`）",
            snippet: raw.slice(0, 90),
          });
        }
      }
    }
  }
}

const warnOnly = process.argv.includes("--warn-only");
for (const w of warnings)
  console.log(
    `⚠️  ${w.rel}:${w.line}:${w.col}  ${w.attr}\n     ${w.kind}\n     ${w.snippet}`,
  );
for (const e of errors)
  console.log(
    `❌ ${e.rel}:${e.line}:${e.col}  ${e.attr}\n     ${e.kind}\n     ${e.snippet}`,
  );

console.log(
  `\nThymeleaf 表达式体检：❌ ${errors.length} / ⚠️ ${warnings.length}（扫描 ${SCAN_DIRS.join(" + ")}）`,
);
if (errors.length && !warnOnly) process.exit(1);

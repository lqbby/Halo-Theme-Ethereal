// @ts-check
// Thymeleaf 表达式结构桩测（2026-10-28，因线上 500 事故新增）
//
// 事故：`<html th:classappend="${A} + ${B} + … + ${C}}">` —— 多了一个右花括号。
//   标准 Thymeleaf 解析器能接受 `${a} + ${b}` 的属性拼接（所以 validate-th 放行），
//   但 **Halo 的 ReactiveSpelVariableExpressionEvaluator** 只剥最外层 ${…}，
//   残留的 `${` 会抛 SpelParseException（EL1041E）⇒ 整站 500。
// 判据（只留两条，避免把 |…| 字面量里的 ${} 误报）：
//   E1 th:* 属性值里花括号必须配平（{ 数 == } 数）
//   E2 以 ${ 开头的值不得以 }} 结尾（典型的"多一个右括号"）
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
/** @type {string[]} */
const problems = [];

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

/**
 * @param {string} dir
 * @param {string[]} exts
 * @param {string[]} out
 */
function collect(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) collect(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

/**
 * @param {string} text
 * @param {string} label
 */
function scanText(text, label) {
  for (const m of text.matchAll(/\bth:([A-Za-z-]+)="([^"]*)"/g)) {
    const v = m[2];
    if (!v.includes("{")) continue;
    const open = (v.match(/\{/g) || []).length;
    const close = (v.match(/\}/g) || []).length;
    const line = text.slice(0, m.index).split("\n").length;
    if (open !== close) {
      problems.push(
        `${label}:${line} th:${m[1]} 花括号不配平（开 ${open} / 闭 ${close}）`,
      );
      continue;
    }
    const t = v.trim();
    if (t.startsWith("${") && t.endsWith("}}")) {
      problems.push(`${label}:${line} th:${m[1]} 以 "}}" 结尾（疑似多一个右括号）`);
    }
  }
}

const files = [
  ...collect(join(ROOT, "templates"), [".html"]),
  ...collect(join(ROOT, "src"), [".astro"]),
];
check("E0 扫描文件数 > 0", files.length > 0, true);
for (const f of files) {
  scanText(readFileSync(f, "utf8"), f.replace(ROOT, "").replace(/\\/g, "/"));
}

check(`E1/E2 th:* 表达式结构无问题（${problems.length} 处）`, problems.length, 0);
for (const p of problems.slice(0, 10)) console.log("    ", p);

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

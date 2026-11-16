#!/usr/bin/env node
/**
 * 「关于我」页面后台设置的健康检查（v1.4.95 起）。
 *
 * 需求背景：about 页有多张卡片、几十个设置项（子组数以现行 settings.yaml
 * 为准，当前 9 个），settings.yaml 里还用了
 * `id` + `if: "$get(<id>).value"` 做「主开关关掉 ⇒ 从属设置项自动隐藏」的联动。
 * 这类联动最容易出两种静默故障：
 *   A. `$get(x)` 引用的 id 不存在 ⇒ 相关设置项**永久隐藏**，后台看不到也改不了；
 *   B. 主开关的默认值只写在 schema 里、没写进 `about.value` ⇒ 老配置（没存过该键）
 *      的下属字段被误隐藏，但卡片其实是显示的 ⇒ 用户以为设置丢了。
 *
 * 断言项：
 *   1. settings.yaml 能被解析，且全仓 `$get(x)` 的 x 都在某个 `id:` 里定义过；
 *   2. 凡 schema 里带 `enable` 主开关的子组，`about.value` 里都写有默认值 true
 *      （子组清单由 schema 动态得出，不硬编码组名，新增子组自动纳管）；
 *   3. 已废弃的 `friends.shuffle` 不再残留（服务端随机后该开关无任何消费点）；
 *   4. about 下全部子组的 label 带序号（后台顺序与页面卡片顺序一致）；
 *   5. about.astro 里「本人项目 / 更新摘要」两卡的 th:if 带 `enable != false` 守卫。
 *
 * 用法（仓库根目录）：
 *   node scripts/verify-about-settings.mjs
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// js-yaml 不是本仓的直接依赖：旧写法写死 ../node_modules/js-yaml/index.js，
// 在 pnpm 隔离布局下该路径不存在、脚本根本跑不起来（校验形同虚设）。
// 先按裸包名解析（npm 扁平布局/将来升为直接依赖时命中），失败再去
// pnpm 的 .pnpm 存储里找 js-yaml@*。
const require = createRequire(import.meta.url);
function loadYaml() {
  try {
    return require("js-yaml");
  } catch {
    /* 落到 .pnpm 存储查找 */
  }
  const store = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "node_modules",
    ".pnpm",
  );
  if (existsSync(store)) {
    for (const entry of readdirSync(store)) {
      if (!entry.startsWith("js-yaml@")) continue;
      const p = join(store, entry, "node_modules", "js-yaml", "index.js");
      if (existsSync(p)) return require(p);
    }
  }
  throw new Error("找不到 js-yaml（裸包名与 .pnpm 存储均无）");
}
const yaml = loadYaml();

const settings = readFileSync("settings.yaml", "utf8");
const astro = readFileSync("src/pages/about.astro", "utf8");

let failed = 0;
const ok = (msg) => console.log("  ✅ " + msg);
const bad = (msg) => {
  console.log("  ❌ " + msg);
  failed += 1;
};

const c = yaml.load(settings);
const forms = (c.spec && c.spec.forms) || [];
if (!forms.length) bad("settings.yaml 里找不到 spec.forms");

const ids = new Set();
const ifs = [];
function walk(arr) {
  (arr || []).forEach((it) => {
    if (!it) return;
    if (it.id) ids.add(it.id);
    if (typeof it.if === "string") ifs.push({ field: it.name, expr: it.if });
    if (it.children) walk(it.children);
  });
}
forms.forEach((f) => walk(f.formSchema));

function find(arr, name) {
  for (const it of arr || []) {
    if (it && it.name === name) return it;
    const r = it && it.children ? find(it.children, name) : null;
    if (r) return r;
  }
  return null;
}
let about = null;
forms.forEach((f) => {
  const r = find(f.formSchema, "about");
  if (r) about = r;
});

console.log("1) settings.yaml 结构与 if 引用完整性");
if (!about) {
  bad("找不到 about 组");
} else {
  ok("about 组存在，id 共 " + ids.size + " 个 / if 共 " + ifs.length + " 处");
  let dangling = 0;
  for (const { field, expr } of ifs) {
    for (const m of expr.matchAll(/\$get\(([^)]+)\)/g)) {
      if (!ids.has(m[1])) {
        bad("字段 " + field + " 的 if 引用了未定义的 id: " + m[1]);
        dangling += 1;
      }
    }
  }
  if (!dangling) ok("所有 $get(x) 的 x 都有对应 id 定义");
}

console.log("2) about.value 默认值");
if (about) {
  // 带 enable 主开关的子组由 schema 动态得出（旧版硬编码三组名，
  // githubSnake / friends / server 后来新增的开关一直不在守门范围内）
  const switchGroups = (about.children || [])
    .filter((g) => (g.children || []).some((ch) => ch && ch.name === "enable"))
    .map((g) => g.name);
  for (const g of switchGroups) {
    const v = about.value[g] && about.value[g].enable;
    if (v === true) ok(g + ".enable 默认 true");
    else bad(g + ".enable 缺默认值（应为 true）—— 老配置会让从属字段被误隐藏");
  }
  if (about.value.friends && "shuffle" in about.value.friends)
    bad("friends.shuffle 仍残留在默认值里");
  else ok("friends.shuffle 已移除");

  const labels = about.children.map((g) => g.label || "");
  // 序号字形 ①–⑳ 是 Unicode 连续段（U+2460–U+2473），用区间匹配，
  // 旧正则只列到 ⑧，第 ⑨ 个子组（页脚）加入后恒报「序号不全」假阳性
  const numbered = labels.filter((l) => /^[①-⑳]/.test(l)).length;
  if (numbered === labels.length) ok(labels.length + " 个子组 label 均带序号");
  else bad("子组 label 序号不全：" + labels.join(" | "));
}

console.log("3) about.astro 卡片开关守卫");
for (const key of ["projects", "highlights"]) {
  const re = new RegExp("cfg\\?\\." + key + "\\?\\.enable != false");
  if (re.test(astro)) ok(key + " 卡片 th:if 含 enable 守卫");
  else bad(key + " 卡片 th:if 缺 enable 守卫");
}

console.log(failed ? "\n❌ 失败 " + failed + " 项" : "\n✅ 全部通过");
process.exit(failed ? 1 : 0);

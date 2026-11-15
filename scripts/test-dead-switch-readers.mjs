// @ts-check
// 「读取点存在、schema 缺字段」桩测（2026-10-20，bug-hunter round2）
//
// 背景：两个功能各有读取点，但后台 schema 里没有对应字段 ⇒ 用户关不掉：
//   · Navbar.astro 读 style.styleSwitches.enable_random_post（注释写着「后台可关」，实际无此开关）
//   · links.astro 读 links.features.enable_search（友链页搜索框无法隐藏）
// 判据：下列「读者路径」必须在 settings.yaml 里有同名 name 字段（且默认值与读者语义一致：缺省视为开启）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS = join(ROOT, "settings.yaml");

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

const lines = readFileSync(SETTINGS, "utf8").replace(/\r/g, "").split("\n");

/** 在某个 group 的 children 段里找字段名（group 名 -> 是否含该字段） */
/** @param {string} groupName @param {string} fieldName */
function groupHasField(groupName, fieldName) {
  const at = lines.findIndex((l) => l.trim() === `name: ${groupName}`);
  if (at < 0) return false;
  const gIndent = lines[at].search(/\S/);
  for (let i = at + 1; i < lines.length; i++) {
    const ind = lines[i].search(/\S/);
    if (lines[i].trim() && ind <= gIndent && /- \$formkit/.test(lines[i])) break;
    if (new RegExp(`^\\s+name:\\s*${fieldName}\\s*$`).test(lines[i])) return true;
  }
  return false;
}

const CASES = [
  ["styleSwitches", "enable_random_post", "Navbar 随机一篇按钮"],
  ["features", "enable_search", "友链页搜索框"],
];

for (const [group, field, label] of CASES) {
  check(`D1 ${group}.${field} 在 schema 中可配置（${label}）`, groupHasField(group, field), true);
}

/** 在 group 作用域内定位字段的 name 行下标（找不到返回 -1）；与 groupHasField 同一作用域口径 */
/** @param {string} groupName @param {string} fieldName */
function fieldLineInGroup(groupName, fieldName) {
  const gAt = lines.findIndex((l) => l.trim() === `name: ${groupName}`);
  if (gAt < 0) return -1;
  const gIndent = lines[gAt].search(/\S/);
  for (let i = gAt + 1; i < lines.length; i++) {
    const ind = lines[i].search(/\S/);
    if (lines[i].trim() && ind <= gIndent && /- \$formkit/.test(lines[i])) break;
    if (new RegExp(`^\\s+name:\\s*${fieldName}\\s*$`).test(lines[i])) return i;
  }
  return -1;
}

// 默认值必须与读者语义一致（读者用 `== null || x` 或 `!= false` ⇒ 缺省=开启）
// 字段块按缩进收口（到下一个同级列表项为止），value 行做整行锚定匹配——
// 固定行窗口 + 未锚定正则会让相邻字段的 value 或帮助文本里的 "value: true" 假通过
for (const [group, field] of CASES) {
  const name = `${group}.${field} 默认 true（保持现有观感）`;
  const at = fieldLineInGroup(group, field);
  if (at < 0) {
    check(name, "字段不存在", true);
    continue;
  }
  const fieldIndent = lines[at].search(/\S/);
  let end = at + 1;
  while (
    end < lines.length &&
    !(lines[end].trim().startsWith("- ") && lines[end].search(/\S/) <= fieldIndent)
  ) {
    end++;
  }
  const seg = lines.slice(at, end).join("\n");
  check(name, /^\s*value:\s*true\s*$/m.test(seg), true);
}

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exitCode = (failures === 0 ? 0 : 1);

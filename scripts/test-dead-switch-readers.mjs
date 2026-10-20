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

// 默认值必须与读者语义一致（读者用 `== null || x` 或 `!= false` ⇒ 缺省=开启）
for (const [group, field] of CASES) {
  const at = lines.findIndex((l) => l.trim() === `name: ${field}`);
  const seg = at >= 0 ? lines.slice(at, at + 8).join("\n") : "";
  check(`${group}.${field} 默认 true（保持现有观感）`, /value:\s*true/.test(seg), true);
}

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

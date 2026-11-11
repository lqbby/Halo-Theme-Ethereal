// @ts-check
// 主题设置表单结构守卫（2026-11-11，v1.7.50 修复回归）
//
// 背景：v1.7.46 删掉 auth 组唯一字段 loginPage 后，settings.yaml 末尾留下一个
// 空分组：
//     - group: auth
//       label: 认证
//       formSchema:        ← 无值 = null，不是空数组
// YAML 本身合法，但 Halo 2.27.2 的 Setting 校验要求 formSchema 为数组，
// null 直接触发 SchemaViolationException（400 "Failed to validate
// v1alpha1/Setting"），ThemeReconciler 反复重入队失败，Setting 资源建不出来，
// 后台「主题 → 设置」整页空白。2026-11-10 14:49 起日志里刷了上百条该错。
// 修复：删掉空的 auth 分组（全仓零引用，删了不丢功能）。
//
// 判据（行级解析，不引 yaml 依赖）：
//   S1 每个 group 都有 formSchema，且其后（到下一 group 或文件尾之间）
//      至少含一个 `- $formkit:` 表单项 —— 空分组 / null formSchema 直接失败
//   S2 group 名不重复
//   S3 至少含 1 个 group
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
/** group 行：`    - group: <name>` */
const groupIdx = lines
  .map((l, i) => ({ l, i }))
  .filter(({ l }) => /^    - group: \S+/.test(l));
const groupNames = groupIdx.map(({ l }) => l.replace(/^    - group: /, ""));

console.log(`[S1] 每个 group 的 formSchema 非空（至少 1 个表单项）`);
for (let g = 0; g < groupIdx.length; g++) {
  const start = groupIdx[g].i;
  const end = g + 1 < groupIdx.length ? groupIdx[g + 1].i : lines.length;
  const block = lines.slice(start, end);
  const hasFormSchema = block.some((l) => /^      formSchema:/.test(l));
  const itemCount = block.filter((l) => /^        - \$formkit:/.test(l)).length;
  check(`${groupNames[g]} 有 formSchema`, hasFormSchema, true);
  check(`${groupNames[g]} 表单项数 > 0`, itemCount > 0, true);
}

console.log(`[S2] group 名不重复`);
check("重复 group 数", groupNames.length - new Set(groupNames).size, 0);

console.log(`[S3] 至少 1 个 group`);
check("group 总数 > 0", groupNames.length > 0, true);

console.log(
  `\n通过 ${failures === 0 ? "全部" : "部分"}（失败 ${failures} 项）${failures ? " ❌" : " ✅ 全部通过"}`,
);
process.exit(failures ? 1 : 0);

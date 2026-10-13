// @ts-check
// 后台「文章卡片布局」整理 桩测（2026-10-13，v1.7.39）
//
// 需求：把乱掉的「文章卡片布局」设置理清。
// 整理内容：
//   ① 重排为三块：布局/外观（defaultMode→coverPosition→descriptionLines→grid）
//      → 顶部精选卡片（enable→source→postMobile→random→randomMobile）
//      → 系列卡片条（enable→count→mobile）；**所有 name 路径不变**（不动用户已存配置）
//   ② 与卡片布局无关的「瞬间条」两个字段移出，独立成 `layout.homeMoments` 分组
//      （读取点保留旧路径 `postList.showHomeMoments/homeMomentsCount` 兜底）
// 判据：
//   S1 postList 子项顺序符合「布局/外观 → 精选 → 系列」三段
//   S2 postList 里不再有 showHomeMoments / homeMomentsCount
//   S3 存在独立分组 homeMoments，含 show / count 两字段（默认 true/10）
//   S4 HomeMoments.astro 读新路径且带旧路径兜底（`?: ...postList?...`）
//   S5 grid 子组三个子字段完好（重排不得丢字段）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS = join(ROOT, "settings.yaml");
const HM = join(ROOT, "src/components/HomeMoments.astro");

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
/** 取某 group 的 children 子项名序列（按出现顺序，只取直接子项） */
function childrenOf(groupName) {
  const at = lines.findIndex((l) => l.trim() === `name: ${groupName}`);
  if (at < 0) return null;
  const gIndent = lines[at].search(/\S/);
  const cIndent = gIndent + 2; // 子项 `- $formkit` 的缩进
  const out = [];
  let seenChildren = false;
  for (let i = at; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "children:") {
      seenChildren = true;
      continue;
    }
    if (!seenChildren) continue;
    const ind = l.search(/\S/);
    if (l.trim() && ind <= gIndent && /^- \$formkit/.test(l.trim())) break; // 组结束
    const m = /^\s*-\s\$formkit:\s*(\S+)/.exec(l);
    if (m && ind === cIndent) {
      // 该子项的 name 在紧随其后、缩进 +2 的行
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
        const mm = /^\s*name:\s*(\S+)/.exec(lines[j]);
        if (mm && lines[j].search(/\S/) === cIndent + 2) {
          out.push(mm[1]);
          break;
        }
        if (
          /^\s*-\s\$formkit:/.test(lines[j]) &&
          lines[j].search(/\S/) === cIndent
        )
          break;
      }
    }
  }
  return out;
}

const pl = childrenOf("postList");
const hm = childrenOf("homeMoments");
console.log("postList 子项:", pl);
console.log("homeMoments 子项:", hm);

const expectedOrder = [
  "defaultMode",
  "coverPosition",
  "descriptionLines",
  "grid",
  "featuredEnable",
  "featuredSource",
  "featuredPostMobile",
  "featuredRandom",
  "featuredRandomMobile",
  "seriesEnable",
  "seriesCount",
  "seriesMobile",
];
check(
  "S1 postList 顺序 = 布局/外观 → 精选卡片 → 系列卡片条",
  JSON.stringify(pl),
  JSON.stringify(expectedOrder),
);
check(
  "S2 postList 不再含瞬间条字段",
  pl && (pl.includes("showHomeMoments") || pl.includes("homeMomentsCount")),
  false,
);
check(
  "S3 独立分组 homeMoments（show / count）",
  hm && hm.join(",") === "show,count",
  true,
);
check(
  "S3b homeMoments 默认值 true / 10",
  /name: homeMoments[\s\S]{0,120}?value:\s*\n\s+show: true\n\s+count: 10/.test(
    lines.join("\n"),
  ),
  true,
);
{
  const src = readFileSync(HM, "utf8");
  check(
    "S4 HomeMoments 读新路径 + 旧路径兜底",
    /layout\?\.homeMoments\?\.show \?: theme\.config\?\.layout\?\.postList\?\.showHomeMoments/.test(
      src,
    ) &&
      /layout\?\.homeMoments\?\.count \?: theme\.config\?\.layout\?\.postList\?\.homeMomentsCount/.test(
        src,
      ),
    true,
  );
}
check(
  "S5 grid 子组三字段完好",
  childrenOf("grid")?.join(",") === "masonry,coverFullWidth,coverAutoHeight",
  true,
);

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

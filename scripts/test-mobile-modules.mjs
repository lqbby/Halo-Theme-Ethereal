// @ts-check
// 首页三模块「移动端显示开关」+ 移动端小组件补「最近评论」桩测（2026-10-13，v1.7.37）
//
// 需求：① 给「系列 / 摇一篇（随机一篇）/ 热门文章（右侧卡）」三个模块加移动端显示开关；
//       ② 修移动端小组件选项里缺「最近评论」。
// 判据：
//   M1 settings：三个开关齐备（key / 默认 true / 挂在各自模块的启用开关下 / 说明缺省视为开启）
//   M2 settings：移动端小组件列表含 recent-comments 选项（右栏有、原移动端缺）
//   M3 FeaturedCards：th:with 两个移动端旗标（== false 口径）+ 行级两类名 + 移动端三条隐藏规则
//   M4 SeriesStrip：section 带 ss-hide-mobile 类（== false 口径）+ 移动端隐藏规则
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS = join(ROOT, "settings.yaml");
const FC = join(ROOT, "src/components/FeaturedCards.astro");
const SS = join(ROOT, "src/components/SeriesStrip.astro");

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

const settings = readFileSync(SETTINGS, "utf8").replace(/\r/g, "");

for (const [name, key, gate] of [
  [
    "featuredRandomMobile",
    "postList_featuredRandomMobile",
    "$get(postList_featuredRandom).value === true",
  ],
  [
    "featuredPostMobile",
    "postList_featuredPostMobile",
    "$get(postList_featuredEnable).value === true",
  ],
  [
    "seriesMobile",
    "postList_seriesMobile",
    "$get(postList_seriesEnable).value === true",
  ],
]) {
  const re = new RegExp(
    `name: ${name}[\\s\\S]{0,220}?key: ${key}[\\s\\S]{0,220}?value: true`,
  );
  check(
    `M1 ${name} 开关齐备（key/默认 true/挂在模块开关下/缺省说明）`,
    re.test(settings) &&
      settings.includes(`if: "${gate}"`) &&
      new RegExp(`name: ${name}[\\s\\S]{0,320}?缺省视为开启`).test(settings),
    true,
  );
}

{
  // 移动端列表段内应出现 recent-comments 选项，且左栏段内不应出现
  const lines = settings.split("\n");
  const at = (exact) => lines.findIndex((l) => l.trim() === exact);
  const iW = at("name: widgets");
  const iM = at("name: mobileWidgets");
  const iR = at("name: rightWidgets");
  const seg = (a, b) => lines.slice(a, b).join("\n");
  check(
    "M2a 移动端列表含「最近评论」选项",
    /- label: 最近评论\n\s+value: recent-comments/.test(seg(iM, iR)),
    true,
  );
  check(
    "M2b 左栏列表未被误加（保持原样）",
    /value: recent-comments/.test(seg(iW, iM)),
    false,
  );
}

{
  const fc = readFileSync(FC, "utf8");
  check(
    "M3a th:with 两个移动端旗标（== false 口径）",
    /fcHideRandomMobile=\$\{theme\.config\?\.layout\?\.postList\?\.featuredRandomMobile == false\}/.test(
      fc,
    ) &&
      /fcHidePostMobile=\$\{theme\.config\?\.layout\?\.postList\?\.featuredPostMobile == false\}/.test(
        fc,
      ),
    true,
  );
  check(
    "M3b 行级两类名",
    /\(fcHideRandomMobile \? ' fc-hide-random-mobile' : ''\)/.test(fc) &&
      /\(fcHidePostMobile \? ' fc-hide-post-mobile' : ''\)/.test(fc),
    true,
  );
  const flat = fc.replace(/\s+/g, " ");
  check(
    "M3c 移动端三条隐藏规则（含两卡都关时整行隐藏）",
    [
      ".featured-row.fc-hide-random-mobile .featured-card--random { display: none; }",
      ".featured-row.fc-hide-post-mobile .featured-card--post { display: none; }",
      ".featured-row.fc-hide-random-mobile.fc-hide-post-mobile { display: none; }",
    ].every((r) => flat.includes(r)),
    true,
  );
}

{
  const ss = readFileSync(SS, "utf8");
  check(
    "M4 SeriesStrip 带 ss-hide-mobile 类 + 移动端隐藏规则",
    /seriesMobile == false \? ' ss-hide-mobile' : ''/.test(ss) &&
      /\.series-strip\.ss-hide-mobile \{\s*display: none;/.test(
        ss.replace(/\s+/g, " "),
      ),
    true,
  );
}

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

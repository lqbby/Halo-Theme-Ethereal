// @ts-check
// 首页三模块「显示范围」+ 移动端小组件补「最近评论」桩测（2026-10-13，v1.7.40）
//
// 需求：① 三个模块（系列条 / 随机一篇卡 / 热门·最近文章卡）的「全局 + 移动端」
//          两个开关统一换成四选一下拉（桌面+移动端 / 仅桌面端 / 仅移动端 / 关闭），
//          写法对齐主题既有的三选开关范式（banner_wave）；
//       ② 移动端小组件选项补「最近评论」（右栏有、移动端原缺）。
// 判据：
//   M1 settings：三个显示范围下拉齐备（四选项 / 默认 all / key 正确）
//   M2 settings：移动端小组件列表含 recent-comments；左栏未被误加
//   M3 FeaturedCards：两种 mode 变量 + 五类隐藏类 + 三类 CSS（移动端/桌面端/两卡都关）
//   M4 SeriesStrip：seriesMode 守卫 + 两种隐藏类 + 两个断点的 CSS
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
const lines = settings.split("\n");

// M1：三个显示范围下拉——按 YAML 行缩进取字段块（不依赖跨行贪婪正则）
/** 取 settings 里某个 `name: X` 字段的整块（到下一个同级 `- $formkit` 或更浅缩进为止） */
function fieldBlock(name) {
  const at = lines.findIndex((l) => l.trim() === `name: ${name}`);
  if (at < 0) return "";
  const indent = lines[at].search(/\S/);
  const out = [];
  for (let i = at; i < lines.length; i++) {
    const l = lines[i];
    if (i > at) {
      const ind = l.search(/\S/);
      if (l.trim() && ind >= 0 && ind < indent) break;
      if (/^\s*-\s\$formkit:/.test(l) && ind <= indent - 2) break;
    }
    out.push(l);
  }
  return out.join("\n");
}

for (const [name, key] of [
  ["featuredRandomDisplay", "postList_featuredRandomDisplay"],
  ["featuredPostDisplay", "postList_featuredPostDisplay"],
  ["seriesDisplay", "postList_seriesDisplay"],
]) {
  const body = fieldBlock(name);
  const optValues = [
    ...body.matchAll(/^\s+- label: .+\n\s+value: (\S+)$/gm),
  ].map((m) => m[1]);
  check(
    `M1 ${name} 四选一下拉（key / 默认 all / 四选项 all/desktop/mobile/off）`,
    body.includes(`key: ${key}`) &&
      /^\s+value: all$/m.test(body) &&
      ["all", "desktop", "mobile", "off"].every((v) => optValues.includes(v)),
    true,
  );
}

{
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
    "M3a 两个显示范围变量（含旧开关兜底）",
    /fcRandomMode=\$\{theme\.config\?\.layout\?\.postList\?\.featuredRandomDisplay \?: \(theme\.config\?\.layout\?\.postList\?\.featuredRandom == false \? 'off'/.test(
      fc,
    ) &&
      /fcPostMode=\$\{theme\.config\?\.layout\?\.postList\?\.featuredPostDisplay \?: \(theme\.config\?\.layout\?\.postList\?\.featuredPostMobile == false \? 'desktop'/.test(
        fc,
      ),
    true,
  );
  check(
    "M3b 五类隐藏类（随机/右卡 × 移动端/桌面端 + 两卡都关）",
    [
      "fc-hide-random-mobile",
      "fc-hide-random-desktop",
      "fc-hide-post-mobile",
      "fc-hide-post-desktop",
      "fc-both-off",
    ].every((c) => fc.includes(`' ${c}'`)),
    true,
  );
  const flat = fc.replace(/\s+/g, " ");
  check(
    "M3c CSS：移动端隐藏 / 桌面端隐藏（≥768px）/ 两卡都关",
    flat.includes(
      ".featured-row.fc-hide-random-mobile .featured-card--random { display: none; }",
    ) &&
      flat.includes(
        ".featured-row.fc-hide-post-mobile .featured-pins { display: none; }",
      ) &&
      flat.includes(
        ".featured-row.fc-hide-random-desktop .featured-card--random { display: none; }",
      ) &&
      flat.includes(
        ".featured-row.fc-hide-post-desktop .featured-pins { display: none; }",
      ) &&
      flat.includes(".featured-row.fc-both-off { display: none; }") &&
      /@media \(min-width: 768px\) \{[\s\S]{0,300}?fc-hide-random-desktop/.test(
        fc,
      ),
    true,
  );
  check(
    "M3d 右卡与随机卡各自按 mode 出/隐",
    fc.includes(
      "th:if=\"${fcItems != null and #lists.size(fcItems) > 0 and fcPostMode != 'off'}\"",
    ) && fc.includes("th:if=\"${fcRandom and fcRandomMode != 'off'}\""),
    true,
  );
}

{
  const ss = readFileSync(SS, "utf8");
  check(
    "M4 SeriesStrip：守卫改读 seriesDisplay（旧 keys 兜底）+ 两种隐藏类 + 两断点 CSS",
    /postList\?\.seriesDisplay[\s\S]{0,200}?seriesEnable == false \? 'off'[\s\S]{0,200}?seriesMobile == false \? 'desktop'/.test(
      ss,
    ) &&
      ss.includes("(seriesMode == 'desktop' ? ' ss-hide-mobile' : '')") &&
      ss.includes("(seriesMode == 'mobile' ? ' ss-hide-desktop' : '')") &&
      /\.series-strip\.ss-hide-mobile \{\s*display: none;/.test(
        ss.replace(/\s+/g, " "),
      ) &&
      /@media \(min-width: 768px\) \{[\s\S]{0,120}?ss-hide-desktop/.test(ss),
    true,
  );
}

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

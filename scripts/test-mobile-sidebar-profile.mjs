// @ts-check
// 移动端侧栏「个人简介 / 公告 默认直出」桩测（2026-10-12，v1.7.35）
//
// 背景：个人简介与公告在桌面不是小部件列表项，而是左右侧栏按各自设置直出的
//   「定位卡」。移动端侧栏替代两栏后若只渲染 mobileWidgets，这两块会整块消失
//   （用户报「移动端个人简介小组件不显示，这个应该是默认就有的」）。
// 判据：
//   H1 MobileSideBar 引入 Profile / Announcement 组件
//   H2 模板首位直出 Profile（enable_profile != false 同语义）
//   H3 模板次位直出 Announcement（enable != false 口径与 SideBar.astro 一致）
//   H4 两者都带「列表已含同名条目则跳过」去重守卫（防上游旧配置重复渲染）
//   H5 原有 mobileWidgets 迭代与整体门控（列表非空才挂载）保持不动
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMP = join(ROOT, "src/components/widget/MobileSideBar.astro");

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

const src = readFileSync(COMP, "utf8");
const flat = src.replace(/\s+/g, " ");

check(
  "H1 引入 Profile / Announcement",
  /import Profile from "\.\/Profile\.astro";/.test(src) &&
    /import Announcement from "\.\/Announcement\.astro";/.test(src),
  true,
);

check(
  "H2 模板首位直出个人简介（enable_profile != false）",
  /sidebar\?\.profile\?\.enable_profile != false[\s\S]{0,160}?<Profile class="onload-animation" \/>/.test(
    src,
  ),
  true,
);

check(
  "H3 模板次位直出公告（enable != false）",
  /sidebar\?\.announcement\?\.enable != false[\s\S]{0,180}?<Announcement class="onload-animation" \/>/.test(
    src,
  ),
  true,
);

check(
  "H4 去重守卫（列表含同名条目则跳过）",
  flat.includes("#lists.isEmpty(mobileWidgets.?[value == 'profile'])") &&
    flat.includes("#lists.isEmpty(mobileWidgets.?[value == 'announcement'])"),
  true,
);

check(
  "H5 原有迭代与整体门控未动",
  /th:each="widget, widgetStat : \$\{mobileWidgets\}"/.test(src) &&
    /mobileWidgets != null and not #lists\.isEmpty\(mobileWidgets\)/.test(src),
  true,
);

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

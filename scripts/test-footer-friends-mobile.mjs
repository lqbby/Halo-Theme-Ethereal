// @ts-check
// 页脚友链「移动端默认折叠」桩测（2026-10-12，v1.7.33）
//
// 需求：「设置页脚友情链接在移动端默认关闭」——新增设置项（缺省视为开启），
// 移动端（<768px）折叠胶囊列表、标题行右侧箭头展开/收起；桌面端零影响。
// 判据：
//   F1 settings.yaml：friendLinks 组有 mobile_collapsed（key/默认 true/help 说明缺省开启）
//   F2 组件根元素：classappend 含 hbf-mobile-collapsed（`!= false` 缺省开启口径）
//   F3 组件标题行：有 .hbf-toggle 按钮（aria-expanded 初值 false + 词条 aria-label）
//   F4 CSS：移动端三条规则（箭头显隐 / 折叠隐藏 / 展开恢复 display:flex）+ 箭头旋转
//   F5 脚本：单例守卫（两份页脚只绑一次）+ closest(".hbf-root") 实例作用域 + hbf-open 切换
//   F6 i18n 三语并集：footer.friendLinks.toggleAria 存在于 default/zh_CN/zh_TW
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS = join(ROOT, "settings.yaml");
const COMP = join(ROOT, "src/components/FooterFriendLinks.astro");
const I18N = join(ROOT, "i18n");

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
const comp = readFileSync(COMP, "utf8");

check(
  "F1a settings.yaml 有 mobile_collapsed（key + 默认 true + 缺省开启说明）",
  /name: mobile_collapsed/.test(settings) &&
    /key: friend_links_mobile_collapsed/.test(settings) &&
    /label: 移动端默认折叠/.test(settings) &&
    /缺省视为开启/.test(settings) &&
    /key: friend_links_mobile_collapsed[\s\S]{0,200}?value: true/.test(
      settings,
    ),
  true,
);

check(
  "F2 根元素 classappend 含 hbf-mobile-collapsed（!= false 口径）",
  /mobile_collapsed != false \? ' hbf-mobile-collapsed' : ''/.test(comp),
  true,
);

check(
  "F3 标题行有 .hbf-toggle（aria-expanded=false + toggleAria 词条）",
  /class="hbf-toggle"[\s\S]{0,200}?aria-expanded="false"/.test(comp) &&
    /footer\.friendLinks\.toggleAria/.test(comp),
  true,
);

const cssFlat = comp.replace(/\s+/g, " ");
check(
  "F4 CSS 移动端三条规则 + 展开旋转",
  [
    ".hbf-root.hbf-mobile-collapsed .hbf-toggle { display: inline-flex; }",
    ".hbf-root.hbf-mobile-collapsed .hbf-list { display: none; }",
    ".hbf-root.hbf-mobile-collapsed.hbf-open .hbf-list { display: flex; }",
    ".hbf-root.hbf-open .hbf-toggle svg { transform: rotate(180deg); }",
  ].every((r) => cssFlat.includes(r)),
  true,
);

check(
  "F5 脚本：单例守卫 + closest 作用域 + hbf-open 切换 + aria 同步",
  comp.includes("if (window.__hbfToggleBound) return;") &&
    comp.includes('btn.closest(".hbf-root")') &&
    comp.includes('classList.toggle("hbf-open")') &&
    comp.includes('setAttribute("aria-expanded"'),
  true,
);

for (const f of ["default", "zh_CN", "zh_TW"]) {
  const s = readFileSync(join(I18N, `${f}.properties`), "utf8");
  check(
    `F6 ${f} 有 footer.friendLinks.toggleAria`,
    /^footer\.friendLinks\.toggleAria=.+$/m.test(s.replace(/\r/g, "")),
    true,
  );
}

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

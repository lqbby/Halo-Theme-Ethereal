// @ts-check
// 页脚友链「移动端不显示」桩测（2026-10-12，v1.7.34，取代 v1.7.33 的折叠方案）
//
// 需求：「移动端默认页脚没有任何友情链接相关的东西」——<768px 整块不输出
// （标题/数量/申请按钮/胶囊列表全不出现），桌面端零影响。
// 判据：
//   G1 settings.yaml：friendLinks 组有 mobile_hidden（key/默认 true/缺省视为开启）
//   G2 组件根元素：classappend 含 hbf-mobile-hidden（`!= false` 缺省开启口径）
//   G3 CSS：@media (max-width:767.98px) 下 .hbf-root.hbf-mobile-hidden display:none
//   G4 无折叠方案残留：无 .hbf-toggle / hbf-open / hbf-mobile-collapsed / 绑定脚本
//   G5 i18n：toggleAria 已移除（不留死词条，三语）
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
const cssFlat = comp.replace(/\s+/g, " ");

check(
  "G1 settings.yaml 有 mobile_hidden（key + 默认 true + 缺省开启说明）",
  /name: mobile_hidden/.test(settings) &&
    /key: friend_links_mobile_hidden/.test(settings) &&
    /label: 移动端不显示/.test(settings) &&
    /缺省视为开启/.test(settings) &&
    /key: friend_links_mobile_hidden[\s\S]{0,200}?value: true/.test(settings),
  true,
);

check(
  "G2 根元素 classappend 含 hbf-mobile-hidden（!= false 口径）",
  /mobile_hidden != false \? ' hbf-mobile-hidden' : ''/.test(comp),
  true,
);

check(
  "G3 CSS：移动端下整块 display:none",
  cssFlat.includes(".hbf-root.hbf-mobile-hidden { display: none; }"),
  true,
);

check(
  "G4 无折叠方案残留（无 toggle / hbf-open / 绑定脚本）",
  !/hbf-toggle|hbf-open|hbf-mobile-collapsed|__hbfToggleBound/.test(comp),
  true,
);

for (const f of ["default", "zh_CN", "zh_TW"]) {
  const s = readFileSync(join(I18N, `${f}.properties`), "utf8");
  check(
    `G5 ${f} 已移除 footer.friendLinks.toggleAria（不留死词条）`,
    /footer\.friendLinks\.toggleAria/.test(s),
    false,
  );
}

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

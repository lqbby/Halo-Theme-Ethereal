// @ts-check
// 瞬间条（.moment-marquee-anchor）translate 基值守卫桩测（2026-10-10，1.7.13）
//
// 背景（线上实测「瞬间条从菜单栏下面钻出来」）：瞬间条与 #main-grid / #banner-wrapper
// 同帧消费 --banner-height-extend 做 is-home 位移。后两者有显式 `translate: 0 0`
// 基值（非首页侧也是长度）⇒ 换页时 length↔length 可插值、随分类栏/波浪同步滑动；
// 瞬间条缺此基值时非首页侧计算值为 `none`，`none↔长度` 不可插值（CSS Transforms 2），
// 在把离散过渡按规范实现的引擎（WebKit）上表现为瞬间条不跟分类栏走、单独跳变，
// 观感即「从菜单栏下面钻出来」。首帧还需与网格同用 html:not(.page-ready) 门。
//
// 判据（源码级）：
//   G1 components.css 基值规则含 .moment-marquee-anchor 且值为 `translate: 0 0`
//   G2 基值规则三者同列（#main-grid / #banner-wrapper / .moment-marquee-anchor 同块）
//   G3 html:not(.page-ready) 门同时覆盖 #main-grid 与 .moment-marquee-anchor
//   G4 global.css is-home 工具：网格与瞬间条同被赋 translate-y-(--banner-height-extend)
//   G5 两侧均非 none（可插值前提）：基值为长度、is-home 值为长度表达式
//   G6 触发侧：MainGridLayout 的 #home-moments-wrap 带 moment-marquee-anchor 类
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPONENTS = join(ROOT, "src/styles/components.css");
const GLOBAL = join(ROOT, "src/styles/global.css");
const LAYOUT = join(ROOT, "src/layouts/MainGridLayout.astro");

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

const comp = readFileSync(COMPONENTS, "utf8").replace(/\s+/g, " ");
const glob = readFileSync(GLOBAL, "utf8").replace(/\s+/g, " ");
const layout = readFileSync(LAYOUT, "utf8").replace(/\s+/g, " ");

check(
  "G1 基值规则含瞬间条且值为 translate: 0 0",
  /\.enable-banner \.moment-marquee-anchor \{\s*translate: 0 0;/.test(comp),
  true,
);
check(
  "G2 基值规则三者同列",
  /\.enable-banner #main-grid,\s*\.enable-banner #banner-wrapper,\s*\.enable-banner \.moment-marquee-anchor \{/.test(
    comp,
  ),
  true,
);
check(
  "G3 page-ready 门覆盖网格与瞬间条",
  /html:not\(\.page-ready\) #main-grid,\s*html:not\(\.page-ready\) \.moment-marquee-anchor \{\s*transition: none;/.test(
    comp,
  ),
  true,
);
check(
  "G4 is-home 工具：网格与瞬间条同赋 translate-y",
  glob.includes(
    "&.enable-banner #main-grid { @apply translate-y-(--banner-height-extend);",
  ) &&
    glob.includes(
      "&.enable-banner .moment-marquee-anchor { @apply translate-y-(--banner-height-extend);",
    ),
  true,
);
{
  // G5 语义：两态都必须是「长度」（非 none）才可插值——直接断言两处值来源
  const baseIsLength =
    /\.enable-banner \.moment-marquee-anchor \{\s*translate: 0 0;/.test(comp);
  const homeIsLength = glob.includes(
    "&.enable-banner .moment-marquee-anchor { @apply translate-y-(--banner-height-extend);",
  );
  check("G5 两态均非 none（可插值前提）", baseIsLength && homeIsLength, true);
}
check(
  "G6 #home-moments-wrap 携带 moment-marquee-anchor 类",
  /id="home-moments-wrap"[^>]*class="[^"]*moment-marquee-anchor/.test(layout),
  true,
);

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

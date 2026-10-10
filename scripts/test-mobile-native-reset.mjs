// @ts-check
// 移动端换页「1.5.65 复刻」桩测（2026-10-11，v1.7.21）
//
// 背景：1.7.20 揭示门控在移动端三运动叠加（淡出/瞬移/淡入+横幅滑动）被
// 用户感知为「像打架一样」；用户点名要 1.5.65 的手感。1.5.65 的换页复位 =
// content:scroll 双 rAF → window.scrollTo({top:0,behavior:"smooth"})（原生
// 平滑、合成器驱动、无门控/无锁步/无兜底）。移动端（粗指针）整链路回退该
// 行为；桌面保留 1.7.20 门控路径。
//
// 判据（源码级）：
//   M1 isCoarsePointer 助手（pointer: coarse）
//   M2 visit:start：gateRevealForReset 与 deferHomeClassForFollow 均含
//      !coarseMobile（移动端不门控、不推迟翻转）
//   M3 content:scroll 移动端分支：原生 scrollTo smooth（reduce→auto），
//      位于门控分支之后、横幅锁步分支之前；armGuard=false
//   M4 落点兜底挂载条件含 armGuard（移动端不挂，避免与原生 smooth 打架）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "src/scripts/app.ts");

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

const flat = readFileSync(APP, "utf8").replace(/\s+/g, " ");

check(
  "M1 isCoarsePointer 助手（pointer: coarse）",
  /function isCoarsePointer\(\): boolean \{ return !!\( window\.matchMedia && window\.matchMedia\("\(pointer: coarse\)"\)\.matches \); \}/.test(
    flat,
  ),
  true,
);

check(
  "M2 visit:start：门控与推迟翻转均排除移动端",
  /const coarseMobile = isCoarsePointer\(\);/.test(flat) &&
    /gateRevealForReset = needsScrollWait && !reduceMotion && !coarseMobile;/.test(
      flat,
    ) &&
    /deferHomeClassForFollow = needsScrollWait && !reduceMotion && !coarseMobile &&/.test(
      flat,
    ),
  true,
);

check(
  "M3 content:scroll 移动端分支：原生 smooth（reduce→auto）且位于门控后/锁步前",
  (() => {
    const gateIdx = flat.indexOf("const gated = gateRevealForReset;");
    const coarseIdx = flat.indexOf("} else if (isCoarsePointer()) {");
    const bannerIdx = flat.indexOf(
      '} else if (document.body.classList.contains("enable-banner")) {',
      coarseIdx,
    );
    const smooth = flat.indexOf(
      'window.scrollTo({ top: 0, behavior: reduceNow ? "auto" : "smooth", });',
    );
    const armOff = flat.indexOf("armGuard = false;", coarseIdx);
    return (
      gateIdx > 0 &&
      coarseIdx > gateIdx &&
      bannerIdx > coarseIdx &&
      smooth > coarseIdx &&
      smooth < bannerIdx &&
      armOff > coarseIdx &&
      armOff < bannerIdx
    );
  })(),
  true,
);

check(
  "M4 落点兜底挂载条件含 armGuard（移动端不挂）",
  /if \(needsScrollWait && armGuard\) armLandingGuard\(preResetY, resetInstant\);/.test(
    flat,
  ),
  true,
);

check(
  "M5 移动端不放撑高（animation:out:start 条件含 !isCoarsePointer，1.5.65 复刻）",
  /if \( !visit\?\.history\?\.popstate && !visit\?\.to\?\.hash && bannerMoves && !isCoarsePointer\(\) \) \{/.test(
    flat,
  ),
  true,
);

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

// @ts-check
// 换页「上下抖动 / 一卡一卡」修复桩测（2026-10-10，v1.7.19 → v1.7.22 定稿）
//
// v1.7.19（跟随模式）：is-home 翻转推迟到锁步同帧 + 滚动跟随 translate
//   实时进度 ⇒ 反向段 25px→2px（本文件 F1/F3 仍锁定该能力，保留于
//   scroll-manager 作为备用路径）。
// v1.7.20（揭示门控）：新内容挂 nav-resetting 不可见 → 瞬移归顶 → 揭示。
// v1.7.22 定稿（用户拍板「都用 1.5.65 这样的」）：全设备统一原生 smooth
//   回顶——与 1.5.65 逐条同构（双 rAF + scrollTo smooth）。
// v1.7.23/24（换页重执行减负）：themeLazyInit 批量测量 + ignore 名单。
// v1.7.26（「2.0 式距离分档」试行）：长距瞬时/短距锁步/其它平滑三档。
// v1.7.27 定稿（用户实机否决瞬时档 + 主流调研）：三档全部退役，回归单档
//   原生平滑（= 1.5.65 = 1.7.22 定稿行为；1.7.25 全原生平滑已实跑 8 小时
//   零抱怨）。锁步能力保留在 scroll-manager 源码中但不再被 app.ts 引用
//   （tree-shake 出产物；复启用需恢复 import）。
//
// 判据（源码级）：
//   F1 scroll-manager：follow 能力保留（备用路径，判据同 v1.7.19）
//   F2 app.ts 现役接线（v1.7.22）：门控/推迟机制整体移除；content:scroll
//      复位 = 双 rAF 原生 smooth（reduce→auto）；page:view 无条件
//      syncHomeClass；点击换页恒隐藏撑高；out:start 无撑高展示分支
//   F3 运行语义仿真：含 CSS 启动延迟的 tr 序列 ⇒ 跟随合成位置单调
//      （能力保留判据）+ ease 自走对照组必出反向段
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCROLL = join(ROOT, "src/utils/scroll-manager.ts");
const APP = join(ROOT, "src/scripts/app.ts");
const TRANSITION = join(ROOT, "src/styles/transition.css");

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

const scrollSrc = readFileSync(SCROLL, "utf8");
const appSrc = readFileSync(APP, "utf8");
/** 压掉空白便于跨行匹配 */
const flatScroll = scrollSrc.replace(/\s+/g, " ");
const flatApp = appSrc.replace(/\s+/g, " ");

// ── F1 scroll-manager follow 模式 ──
check(
  "F1a lockstepScrollToTop 接受 syncEl 形参",
  /export function lockstepScrollToTop\(syncEl\?: HTMLElement \| null\): void \{/.test(
    flatScroll,
  ),
  true,
);
check(
  "F1b 读 --banner-height-extend 作位移基准",
  /getPropertyValue\( "--banner-height-extend",?\s*\)/.test(flatScroll),
  true,
);
check(
  "F1c readTr 读 computed translate（含 none 归 0）",
  /getComputedStyle\(grid\)\.translate/.test(flatScroll) &&
    /if \(!v \|\| v === "none"\) return 0;/.test(flatScroll),
  true,
);
check(
  "F1d leavingHome 方向判据（tr 现值 vs extendPx/2）",
  /const leavingHome = readTr\(\) > extendPx \/ 2;/.test(flatScroll),
  true,
);
check(
  "F1e 跟随写入 y = startY × (1 - clamped progress)",
  /window\.scrollTo\(0, Math\.round\(startY \* \(1 - clamped\)\)\);/.test(
    flatScroll,
  ),
  true,
);
check(
  "F1f 超时兜底 duration+250 且终点瞬时归顶",
  /now - startTime > duration \+ 250/.test(flatScroll) &&
    /window\.scrollTo\(0, 0\);/.test(flatScroll),
  true,
);
check(
  "F1g ease 自走路径保留（无位移场景回退）",
  /PAGE_SWITCH_EASE\(progress\)/.test(flatScroll),
  true,
);

// ── F2 app.ts 现役接线（v1.7.22 定稿：全设备 1.5.65 原生 smooth）──
check(
  "F2a 门控/推迟机制已整体移除（无 gateRevealForReset / deferHomeClassForFollow / nav-resetting / isCoarsePointer）",
  /gateRevealForReset/.test(flatApp) === false &&
    /deferHomeClassForFollow/.test(flatApp) === false &&
    /nav-resetting/.test(flatApp) === false &&
    /isCoarsePointer/.test(flatApp) === false,
  true,
);
check(
  "F2b content:scroll = 单档原生平滑（v1.7.27：瞬时/锁步/距离门控全退役）",
  (() => {
    const i = flatApp.indexOf('spMark("reset", "pre="');
    if (i < 0) return false;
    const seg = flatApp.slice(i, i + 2400);
    const smooth = seg.indexOf('behavior: reduceNow ? "auto" : "smooth"');
    const rafChain = flatApp.indexOf(
      "requestAnimationFrame(() => requestAnimationFrame(() =>",
    );
    const noLockstep = seg.indexOf("lockstepScrollToTop(") < 0;
    const noThreshold = seg.indexOf("* 1.5;") < 0;
    const noSmart = seg.indexOf("smartScrollTo(0)") < 0;
    return smooth > 0 && rafChain > 0 && noLockstep && noThreshold && noSmart;
  })(),
  true,
);
check(
  "F2c page:view 无条件 syncHomeClass（无推迟/兜底分支）",
  /initContentEnhance\(\); syncHomeClass\(\); syncBannerOverlay\(\);/.test(
    flatApp,
  ),
  true,
);
check(
  "F2d visit:start 点击换页恒隐藏撑高、无展示点（1.5.65 复刻）",
  (() => {
    const visitStart = flatApp.indexOf('hooks.on( "visit:start"');
    const seg = flatApp.slice(visitStart, visitStart + 1800);
    const hide = seg.indexOf("hidePageHeightExtend();");
    const show = seg.indexOf("showPageHeightExtend();");
    // 点击路径 hide；else（popstate/hash）show —— show 只出现在 else 分支
    return visitStart > 0 && hide > 0 && show > hide;
  })(),
  true,
);
check(
  "F2e animation:out:start 无撑高展示、无档位场景标记（v1.7.27 全退役）",
  (() => {
    const i = flatApp.indexOf('"animation:out:start"');
    const seg = flatApp.slice(i, i + 900);
    return (
      seg.indexOf("showPageHeightExtend") < 0 &&
      seg.indexOf("lockstepSceneForReset") < 0
    );
  })(),
  true,
);
check(
  "F2f transition.css 门控规则已移除",
  /nav-resetting/.test(readFileSync(TRANSITION, "utf8")) === false,
  true,
);

// ── F3 运行语义仿真：含 CSS 启动延迟的 tr 序列 ⇒ 合成位置单调 ──
{
  const extendPx = 250;
  const startY = 1749;
  // 模拟 CSS transition 采样：前 2 帧滞留（启动延迟），随后 ease 曲线到 0
  /** @param {number} x */
  const ease = (x) => 1 - Math.pow(1 - x, 3); // 近似缓出，形状不影响单调性判据
  const trSeq = [250, 250, 250]; // 2+ 帧启动延迟（tr 不动）
  for (let i = 1; i <= 40; i++) trSeq.push(extendPx * (1 - ease(i / 40)));
  /** 与源码同构的跟随写入 */
  let y = startY;
  const series = [];
  for (const tr of trSeq) {
    const progress = Math.min(Math.max(1 - tr / extendPx, 0), 1);
    y = Math.round(startY * (1 - progress));
    series.push(-y + tr); // 合成位置（gridTop 的平移分量）：须随 tr 单调
  }
  let monotonic = true;
  let direction = 0; // 首个有效方向（离开首页时合成递增、进入时递减，不定死）
  for (let i = 1; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    if (Math.abs(d) <= 1) continue; // 取整容差
    const sign = d > 0 ? 1 : -1;
    if (direction === 0) direction = sign;
    else if (sign !== direction) monotonic = false; // 出现反向 = 抖动
  }
  check(
    "F3a 仿真：含 2 帧 CSS 启动延迟时合成位置仍单调（无反向段）",
    monotonic,
    true,
  );
  check("F3b 仿真：终点归顶", y, 0);
  // 对照组：ease 自走 + 同样的 CSS 启动延迟 ⇒ 必出反向段（证明修复必要）
  {
    const ctrl = [];
    for (let i = 0; i < trSeq.length; i++) {
      const p = Math.min(i / 40, 1);
      const yy = Math.round(startY * (1 - (1 - Math.pow(1 - p, 3))));
      ctrl.push(-yy + trSeq[i]);
    }
    let hasReverse = false;
    for (let i = 1; i < ctrl.length; i++) {
      if (ctrl[i] > ctrl[i - 1] + 24) hasReverse = true;
    }
    check(
      "F3c 对照：ease 自走 + CSS 启动延迟 ⇒ 出现反向段（>24px）",
      hasReverse,
      true,
    );
  }
}

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

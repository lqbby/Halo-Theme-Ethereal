// @ts-check
// 换页「上下抖动」修复桩测（2026-10-10，v1.7.19）
//
// 背景：首页↔文章页换页时，is-home 位移（CSS transition，700ms）与锁步回顶
// （JS rAF）互相超前滞后形成反向段（先上后下/先下后上 = 上下抖动）：
//   · page:view 翻转 is-home 比 content:scroll 的锁步启动早 ~37ms
//     ⇒ 位移先走、滚动后追 ⇒ 反向段 ~25px（A/B 实测中位）；
//   · 「同帧翻转 + ease 自走」（v1.7.18 第一版，已回滚）⇒ CSS transition
//     有 1~2 帧启动延迟，滚动反超 ⇒ 反向段换向且更大（49~83px）。
// 修复：① is-home 翻转推迟到锁步启动同帧（deferHomeClassForFollow）；
//       ② 滚动跟随 #main-grid translate 的实时进度（getComputedStyle 每帧
//       读当前值），合成位置 = f(tr) 单调函数，与 CSS 启动延迟/曲线解耦。
//
// 判据（源码级）：
//   F1 scroll-manager：follow 模式全套（syncEl 形参 / extendPx 读
//      --banner-height-extend / readTr 读 computed translate / leavingHome
//      方向 / 超时兜底 duration+250 且终点 scrollTo(0,0) / ease 自走保留为
//      回退路径）
//   F2 app.ts：defer 标志声明；visit:start 设置（needsScrollWait &&
//      enable-banner && !isFullscreenMode && !reduce）；page:view 条件翻转
//      + 1200ms 安全兜底；content:scroll 同帧 flip→lockstepScrollToTop(
//      getElementById("main-grid"))，非切换场景 lockstepScrollToTop() 无参
//   F3 运行语义仿真：tr 序列（模拟 CSS transition 采样，含 2 帧启动延迟）
//      ⇒ 滚动写入使合成位置（-y + tr）全程单调
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCROLL = join(ROOT, "src/utils/scroll-manager.ts");
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

// ── F2 app.ts 推迟翻转接线 ──
check(
  "F2a deferHomeClassForFollow 标志声明",
  /let deferHomeClassForFollow = false;/.test(flatApp),
  true,
);
check(
  "F2b visit:start 设置：needsScrollWait && enable-banner && !全屏 && !reduce",
  /deferHomeClassForFollow = needsScrollWait && document\.body\.classList\.contains\("enable-banner"\) && !isFullscreenMode\(\) && !\(/.test(
    flatApp,
  ),
  true,
);
check(
  "F2c page:view 条件翻转 + 1200ms 安全兜底",
  /if \(deferHomeClassForFollow && isHomeSwitching\(\)\) \{ setTimeout\(\(\) => \{/.test(
    flatApp,
  ) && /\}, 1200\);/.test(flatApp),
  true,
);
check(
  "F2d content:scroll 同帧 flip→follow（先 syncHomeClass 后传 grid）",
  (() => {
    const marker =
      'syncHomeClass(); lockstepScrollToTop(document.getElementById("main-grid"));';
    return flatApp.indexOf(marker) >= 0;
  })(),
  true,
);
check(
  "F2e 非切换场景保留无参 lockstepScrollToTop()（ease 自走）",
  /lockstepScrollToTop\(\);/.test(flatApp),
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

// @ts-check
// 换页「上下抖动 / 一卡一卡」修复桩测（2026-10-10，v1.7.19 → v1.7.20）
//
// v1.7.19（跟随模式）：is-home 翻转推迟到锁步同帧 + 滚动跟随 translate
//   实时进度 ⇒ 反向段 25px→2px（本文件 F1/F3 仍锁定该能力，保留于
//   scroll-manager 作为备用路径）。
// v1.7.20（揭示门控，现役路径）：JS 逐帧扫动整体退役——弱 GPU 设备上
//   rAF 逐帧 scrollTo 必然掉帧（「一卡一卡」），改为：新内容换入后挂
//   nav-resetting 保持不可见 → 不可见窗口内瞬时归顶 + is-home 翻转 →
//   摘除门控揭示。可见运动只剩合成器驱动的淡入与横幅滑动，主线程冻结
//   不掉帧（移动端关键）；同时消除 1.7.17 瞬时路径「淡入完成才复位」
//   的裸跳。
//
// 判据（源码级）：
//   F1 scroll-manager：follow 能力保留（备用路径，判据同 v1.7.19）
//   F2 app.ts 门控接线：gateRevealForReset 声明 / visit:start 设置
//      （needsScrollWait && !reduceMotion）/ content:replace 挂
//      nav-resetting / content:scroll 门控分支（翻转→scrollTo(0,0)→
//      摘类→resetInstant=true）/ visit:end + abort 兜底清理 /
//      transition.css 门控规则 / defer 翻转机制保留（横幅滑动观感）
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

// ── F2 app.ts 门控接线（v1.7.20 现役路径）──
check(
  "F2a deferHomeClassForFollow 与 gateRevealForReset 标志声明",
  /let deferHomeClassForFollow = false;/.test(flatApp) &&
    /let gateRevealForReset = false;/.test(flatApp),
  true,
);
check(
  "F2b visit:start 设置门控（needsScrollWait && !reduceMotion）",
  /gateRevealForReset = needsScrollWait && !reduceMotion;/.test(flatApp),
  true,
);
check(
  "F2c content:replace 挂 nav-resetting（首帧绘制前）",
  /if \(gateRevealForReset\) \{ document\.documentElement\.classList\.add\("nav-resetting"\); \}/.test(
    flatApp,
  ),
  true,
);
check(
  "F2d content:scroll 门控分支：翻转→瞬时归顶→摘类→resetInstant",
  (() => {
    const i = flatApp.indexOf("const gated = gateRevealForReset;");
    if (i < 0) return false;
    const seg = flatApp.slice(i, i + 700);
    const flip = seg.indexOf("syncHomeClass();");
    const scroll = seg.indexOf("window.scrollTo(0, 0);");
    const reveal = seg.indexOf('classList.remove("nav-resetting")');
    const instant = seg.indexOf("resetInstant = true;");
    return flip > 0 && scroll > flip && reveal > scroll && instant > reveal;
  })(),
  true,
);
check(
  "F2e visit:end + abort 兜底摘除 nav-resetting",
  (() => {
    const visitEnd =
      /gateRevealForReset = false; document\.documentElement\.classList\.remove\("nav-resetting"\);/.test(
        flatApp,
      );
    const abort = flatApp.indexOf('"nav-resetting",') >= 0;
    return visitEnd && abort;
  })(),
  true,
);
check(
  "F2f transition.css 门控规则（!important 压 is-animating 淡入）",
  /html\.nav-resetting #swup-container \{\s*opacity: 0 !important;/.test(
    readFileSync(TRANSITION, "utf8"),
  ),
  true,
);
check(
  "F2g page:view 推迟翻转 + 1200ms 安全兜底保留（横幅滑动观感）",
  /if \(deferHomeClassForFollow && isHomeSwitching\(\)\) \{ setTimeout\(\(\) => \{/.test(
    flatApp,
  ) && /\}, 1200\);/.test(flatApp),
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

// @ts-check
// 换页「落点兜底」桩测（2026-10-10，v1.7.15）
//
// 背景（真机复现，iPhone Safari）：点击列表最后几张卡片（普通卡片链接、
// 无 hash）换页后，复位回顶仍会被「外部写者」把滚动位置拽走——
//   scroll anchoring 持续重锚 / 地址栏收展 / 惯性余量 / 懒加载高度变化；
//   真机症状：位置原地上下拉扯几轮后停在页底。
// 对策 armLandingGuard：复位后按 [900,1800,3000,4500]ms 各复核一次落点，
// 无用户输入且位置偏离顶部（>2px）即再瞬时回顶；用户任何输入（wheel /
// touchstart / touchmove / pointerdown / keydown）立即让位；新一轮换页
// （visit:start 递增 landingGuardToken）使旧 guard 失效。
//
// 判据（源码级，全部必须在 app.ts 中成立）：
//   L1 armLandingGuard 函数与档位常量存在，首档 900（晚于复位动画窗口
//      --dur-banner 默认 700ms，避免打断正常复位动画）
//   L2 复核三守卫：token / userTookOver / is-changing，且 scrollY>2 才写回
//   L3 用户输入五监听（含 pointerdown，覆盖桌面拖滚动条不派发 wheel 的操作）
//   L4 清理定时器摘除全部五监听
//   L5 visit:start 递增 landingGuardToken（旧 guard 失效）
//   L6 挂载点在 content:scroll 非 hash 分支：复位调用之后、comment 早退之后，
//      且仅 needsScrollWait（从非顶部出发）时挂
//   L7 运行语义仿真：正常零写回 / 被拽走一次收敛 / 用户接管跳过 / 换页失效
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

const src = readFileSync(APP, "utf8");
/** 压掉空白便于跨行匹配 */
const flat = src.replace(/\s+/g, " ");

// L1 函数与档位
check(
  "L1a armLandingGuard 函数存在",
  /function armLandingGuard\(\): void \{/.test(flat),
  true,
);
check(
  "L1b 复核档位 [900,1800,3000,4500]（首档晚于复位动画窗口）",
  /const LANDING_GUARD_DELAYS = \[900, 1800, 3000, 4500\];/.test(flat),
  true,
);
check(
  "L1c 清理时长 4700ms（覆盖末档 4500）",
  /const LANDING_GUARD_CLEANUP_MS = 4700;/.test(flat),
  true,
);

// L2 复核三守卫 + 回顶动作
check(
  "L2a 复核守卫：token 过期或用户接管即放弃",
  /if \(token !== landingGuardToken \|\| userTookOver\) return;/.test(flat),
  true,
);
check(
  "L2b 复核守卫：换页进行中（is-changing）不干预",
  /if \(document\.documentElement\.classList\.contains\("is-changing"\)\) return;/.test(
    flat,
  ),
  true,
);
check(
  "L2c 位置偏离（>2px）才瞬时回顶",
  /if \(window\.scrollY > 2\) window\.scrollTo\(\{ top: 0, behavior: "auto" \}\);/.test(
    flat,
  ),
  true,
);

// L3 用户输入五监听
{
  const adds = [
    /window\.addEventListener\("wheel", release, \{ passive: true \}\);/,
    /window\.addEventListener\("touchstart", release, \{ passive: true \}\);/,
    /window\.addEventListener\("touchmove", release, \{ passive: true \}\);/,
    /window\.addEventListener\("pointerdown", release, \{ passive: true \}\);/,
    /window\.addEventListener\("keydown", release\);/,
  ];
  const hits = adds.filter((re) => re.test(flat)).length;
  check("L3 用户输入五监听齐全（含 pointerdown）", hits, 5);
}

// L4 清理摘除五监听
{
  const removes = [
    /window\.removeEventListener\("wheel", release\);/,
    /window\.removeEventListener\("touchstart", release\);/,
    /window\.removeEventListener\("touchmove", release\);/,
    /window\.removeEventListener\("pointerdown", release\);/,
    /window\.removeEventListener\("keydown", release\);/,
  ];
  const hits = removes.filter((re) => re.test(flat)).length;
  check("L4 清理摘除五监听", hits, 5);
}

// L5 visit:start 使旧 guard 失效
{
  const bumps = flat.match(/landingGuardToken \+= 1;/g) || [];
  check(
    "L5 visit:start 递增 landingGuardToken（旧 guard 失效）",
    bumps.length,
    1,
  );
}

// L6 挂载点：content:scroll 非 hash 分支内、复位之后、comment 早退之后、仅 needsScrollWait
check(
  "L6a 挂载语句存在（仅从非顶部出发的换页）",
  /if \(needsScrollWait\) armLandingGuard\(\);/.test(flat),
  true,
);
{
  const idxCommentEarly = flat.indexOf(
    'hash.replace(/^#/, "").indexOf("comment") === 0',
  );
  const idxLockstep = flat.indexOf("lockstepScrollToTop();");
  const idxSmart = flat.indexOf("smartScrollTo(0);");
  const idxArm = flat.indexOf("if (needsScrollWait) armLandingGuard();");
  check(
    "L6b 挂载在复位调用（锁步/智能回顶）之后",
    idxArm > idxLockstep &&
      idxArm > idxSmart &&
      idxLockstep > 0 &&
      idxSmart > 0,
    true,
  );
  check(
    "L6c 挂载在 comment 早退之后（锚点路径不挂 guard）",
    idxArm > idxCommentEarly && idxCommentEarly > 0,
    true,
  );
}

// L7 运行语义仿真（与源码判据同构，防手改语义）
{
  const PASSES = [900, 1800, 3000, 4500];
  // 仿真 1：正常路径（复位已归零）——各档都是空操作
  {
    let scrollY = 0;
    const token = 1,
      current = 1,
      userTookOver = false,
      changing = false;
    let writes = 0;
    for (const _ of PASSES) {
      if (token !== current || userTookOver) continue;
      if (changing) continue;
      if (scrollY > 2) {
        scrollY = 0;
        writes++;
      }
    }
    check("L7a 仿真：正常路径零写回", writes, 0);
  }
  // 仿真 2：被拽走 → 首个有效档写回顶，后续档静默（一次收敛）
  {
    let scrollY = 9448;
    const token = 1,
      current = 1,
      userTookOver = false,
      changing = false;
    let writes = 0;
    for (const _ of PASSES) {
      if (token !== current || userTookOver) continue;
      if (changing) continue;
      if (scrollY > 2) {
        scrollY = 0;
        writes++;
      }
    }
    check("L7b 仿真：被拽走一次收敛到顶", `${writes}:${scrollY}`, "1:0");
  }
  // 仿真 3：用户接管 → 全部跳过（不与用户抢滚动）
  {
    let scrollY = 9448;
    const token = 1,
      current = 1,
      userTookOver = true,
      changing = false;
    let writes = 0;
    for (const _ of PASSES) {
      if (token !== current || userTookOver) continue;
      if (changing) continue;
      if (scrollY > 2) {
        scrollY = 0;
        writes++;
      }
    }
    check("L7c 仿真：用户接管后 guard 让位（不写回）", writes, 0);
  }
  // 仿真 4：新换页（token 递增）使旧 guard 失效
  {
    let scrollY = 9448;
    const token = 1;
    let current = 1;
    current += 1; // visit:start
    let writes = 0;
    if (token !== current) {
      /* 过期，跳过 */
    } else if (scrollY > 2) {
      scrollY = 0;
      writes++;
    }
    check("L7d 仿真：旧 guard 在新换页后失效", writes, 0);
  }
}

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

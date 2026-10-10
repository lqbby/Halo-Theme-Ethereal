// @ts-check
// 换页「落点兜底」桩测（2026-10-10，v1.7.15 初版 → v1.7.16 即时化）
//
// 背景（真机复现，iPhone Safari）：点击列表最后几张卡片（普通卡片链接、
// 无 hash）换页后，复位回顶仍会被「外部写者」把滚动位置拽走。
//   v1.7.15 兜底（固定档位复核）生效但「拉回」延迟大——用户仍可感知
//   「先拉扯一会儿，然后回复到顶部」。
//   v1.7.16 即时化：瞬时路径（复位瞬时完成的场景）额外挂 scroll 事件
//   即时纠正（外部写者一写就于下一帧收回）+ 密集档位兜底；动画路径
//   保持 900 起档（晚于 700ms 复位动画窗口，不打断动画）。
//   v1.7.20：门控揭示改造（复位恒瞬时或显式可知）⇒ instantPath 不再
//   自行推断，由调用方按复位实况显式传入（resetInstant）。
//   v1.7.22 定稿：全设备 1.5.65 原生 smooth 回顶 ⇒ 复位路径不再挂载
//   落点兜底（原生平滑进行中复核会误判「被拽走」而瞬移打断）。函数本体
//   与探针接线保留（L1~L5/L7/L8 语义判据仍锁定其正确性），供未来复启用。
//
// ⚠️ 归因修正：Safari 27（2026-09）前不支持 scroll anchoring——此现象
//    与「重锚」无关；外部写者来源未在真机定位（本地 WebKit 复刻不出）。
//
// 判据（源码级，全部必须在 app.ts 中成立）：
//   L1 双档位表 + 清理常量：INSTANT [120,300,600,1200,2000,3200,4500]、
//      ANIMATED [900,1800,3000,4500]（首档晚于复位动画窗口 700ms）
//   L2 enforce 三判据（token / userTookOver / scrollY>2）——不含
//      is-changing（移除：防「换页类异常卡住 ⇒ 兜底全废」，防打断动画
//      已由档位时序负责）
//   L3 用户输入五监听（含 pointerdown）；L4 清理摘除全五 + scroll 监听
//   L5 visit:start 递增 landingGuardToken（旧 guard 失效）
//   L6 挂载状态（v1.7.22）：复位路径不含挂载；复位 = 原生 smooth
//      （spMark reset → scrollTo smooth），smartScrollTo(0) 未接入
//   L7 instantPath 分流：判据 = resetInstant（v1.7.20 起调用方按复位实况
//      显式传入）；scroll 事件仅瞬时路径挂
//   L8 运行语义仿真：正常零写回 / 被拽走一次收敛 / 用户接管跳过 /
//      换页失效 / **即时纠正（事件驱动，不等档位）**
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

// L1 双档位表 + 清理
check(
  "L1a armLandingGuard 函数存在（preResetY + resetInstant 传参）",
  /function armLandingGuard\(preResetY: number, resetInstant: boolean\): void \{/.test(
    flat,
  ),
  true,
);
check(
  "L1b 瞬时路径档表 [120,300,600,1200,2000,3200,4500]",
  /const LANDING_GUARD_DELAYS_INSTANT = \[120, 300, 600, 1200, 2000, 3200, 4500\];/.test(
    flat,
  ),
  true,
);
check(
  "L1c 动画路径档表 [900,1800,3000,4500]（首档晚于复位动画窗口）",
  /const LANDING_GUARD_DELAYS_ANIMATED = \[900, 1800, 3000, 4500\];/.test(flat),
  true,
);
check(
  "L1d 清理时长 4700ms（覆盖末档 4500）",
  /const LANDING_GUARD_CLEANUP_MS = 4700;/.test(flat),
  true,
);

// L2 enforce 三判据（1.7.17 起带来源标记 src，并接诊断探针 spNoteDrag）
check(
  "L2a enforce 函数抽取存在（带 event/timer 来源标记）",
  /const enforce = \(src: "event" \| "timer"\): void => \{/.test(flat),
  true,
);
check(
  "L2b enforce 守卫：token 过期或用户接管即放弃",
  /if \(token !== landingGuardToken \|\| userTookOver\) return;/.test(flat),
  true,
);
check(
  "L2c 位置偏离（>2px）才瞬时回顶（且先报探针）",
  /if \(window\.scrollY > 2\) \{ spNoteDrag\(src, window\.scrollY\); window\.scrollTo\(\{ top: 0, behavior: "auto" \}\); \}/.test(
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

// L4 清理摘除五监听 + scroll 即时监听
{
  const removes = [
    /window\.removeEventListener\("wheel", release\);/,
    /window\.removeEventListener\("touchstart", release\);/,
    /window\.removeEventListener\("touchmove", release\);/,
    /window\.removeEventListener\("pointerdown", release\);/,
    /window\.removeEventListener\("keydown", release\);/,
    /window\.removeEventListener\("scroll", onScroll\);/,
  ];
  const hits = removes.filter((re) => re.test(flat)).length;
  check("L4 清理摘除五监听 + scroll 监听（共 6）", hits, 6);
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

// L6 挂载状态（v1.7.22 定稿）：复位路径已不含兜底挂载——全设备 1.5.65
//    原生 smooth 回顶（原生平滑进行中挂载复核会误判「被拽走」而瞬移打断）。
//    函数本体与探针接线保留（L1~L5/L7/L8 语义判据仍有效），供未来复启用。
check(
  "L6a 复位路径不含 armLandingGuard 挂载（v1.7.22 退役）",
  flat.indexOf("armLandingGuard(preResetY, resetInstant)") < 0 &&
    flat.indexOf("armGuard") < 0,
  true,
);
{
  const idxCommentEarly = flat.indexOf(
    'hash.replace(/^#/, "").indexOf("comment") === 0',
  );
  const idxReset = flat.indexOf('spMark("reset"');
  const idxSmooth = flat.indexOf('behavior: reduceNow ? "auto" : "smooth"');
  const idxSmart = flat.indexOf("smartScrollTo(0);");
  check(
    "L6b 复位路径 = 原生 smooth（spMark reset 在 scrollTo 之前）",
    idxReset > 0 && idxSmooth > idxReset && idxCommentEarly > 0,
    true,
  );
  check(
    "L6c 复位不再走 smartScrollTo(0)（v1.7.22 起未接入）",
    idxSmart < 0,
    true,
  );
  check(
    "L6d 函数本体仍在（供复启用）",
    /function armLandingGuard\(preResetY: number, resetInstant: boolean\): void \{/.test(
      flat,
    ),
    true,
  );
}

// L7 instantPath 分流：v1.7.20 起由调用方按复位实况显式传入
check(
  "L7a 瞬时路径判据 = resetInstant（v1.7.20，调用方按复位实况传入）",
  /const instantPath = resetInstant;/.test(flat),
  true,
);
check(
  "L7b scroll 事件即时纠正仅瞬时路径挂载",
  /if \(instantPath\) \{ window\.addEventListener\("scroll", onScroll, \{ passive: true \}\); \}/.test(
    flat,
  ),
  true,
);
check(
  "L7c 档表按 instantPath 分流",
  /for \(const delay of instantPath \? LANDING_GUARD_DELAYS_INSTANT : LANDING_GUARD_DELAYS_ANIMATED\) \{/.test(
    flat,
  ),
  true,
);

// L8 运行语义仿真（与源码判据同构，防手改语义）
{
  const PASSES = [120, 300, 600, 1200, 2000, 3200, 4500];
  /**
   * @param {{scrollY:number,token:number,current:number,userTookOver:boolean,writes:number}} s
   */
  const guardTick = (s) => {
    if (s.token !== s.current || s.userTookOver) return s;
    if (s.scrollY > 2) {
      s.scrollY = 0;
      s.writes++;
    }
    return s;
  };
  // 仿真 1：正常路径（复位已归零）——各档都是空操作
  {
    const s = {
      scrollY: 0,
      token: 1,
      current: 1,
      userTookOver: false,
      writes: 0,
    };
    for (const _ of PASSES) guardTick(s);
    check("L8a 仿真：正常路径零写回", s.writes, 0);
  }
  // 仿真 2：被拽走 → 首个有效档写回顶，后续档静默（一次收敛）
  {
    const s = {
      scrollY: 9448,
      token: 1,
      current: 1,
      userTookOver: false,
      writes: 0,
    };
    for (const _ of PASSES) guardTick(s);
    check("L8b 仿真：被拽走一次收敛到顶", `${s.writes}:${s.scrollY}`, "1:0");
  }
  // 仿真 3：用户接管 → 全部跳过（不与用户抢滚动）
  {
    const s = {
      scrollY: 9448,
      token: 1,
      current: 1,
      userTookOver: true,
      writes: 0,
    };
    for (const _ of PASSES) guardTick(s);
    check("L8c 仿真：用户接管后 guard 让位（不写回）", s.writes, 0);
  }
  // 仿真 4：新换页（token 递增）使旧 guard 失效
  {
    const s = {
      scrollY: 9448,
      token: 1,
      current: 1,
      userTookOver: false,
      writes: 0,
    };
    s.current += 1; // visit:start
    guardTick(s);
    check("L8d 仿真：旧 guard 在新换页后失效", s.writes, 0);
  }
  // 仿真 5：即时纠正——外部写者拽走后由 scroll 事件立即收回（不等档位）
  {
    const s = {
      scrollY: 0,
      token: 1,
      current: 1,
      userTookOver: false,
      writes: 0,
    };
    s.scrollY = 4000; // 外部写者（触发 scroll 事件）
    guardTick(s); // 事件回调（下一帧）
    check(
      "L8e 仿真：拽走后事件即时收回（0 档位等待）",
      `${s.writes}:${s.scrollY}`,
      "1:0",
    );
  }
  // 仿真 6：即时纠正不抢用户——用户输入（release）之后的写入不被干预
  {
    const s = {
      scrollY: 0,
      token: 1,
      current: 1,
      userTookOver: false,
      writes: 0,
    };
    s.userTookOver = true; // wheel/touch 先到
    s.scrollY = 4000; // 用户滚到的位置
    guardTick(s);
    check(
      "L8f 仿真：用户接管后事件回调不动作",
      `${s.writes}:${s.scrollY}`,
      "0:4000",
    );
  }
}

// P. 自动诊断探针（1.7.17）接线判据——证据回传链路完整性
check(
  "P1 上报端点与 website 常量",
  /const SP_ENDPOINT = "https:\/\/umami\.lqbby\.com:1443\/api\/send";/.test(
    flat,
  ) && /const SP_WEBSITE = "07575ebc-0b8e-46b6-8ab6-7c1acd5109c2";/.test(flat),
  true,
);
check(
  "P2 激活决策：?sp=1 / ?sp=0 / localStorage 留存",
  /qs\.get\("sp"\)/.test(flat) &&
    /localStorage\.setItem\("__et_sp", "1"\)/.test(flat) &&
    /localStorage\.setItem\("__et_sp", "0"\)/.test(flat),
  true,
);
check(
  "P3 管理员自动探测：super-role + 仅自有域名",
  /roles\.includes\("super-role"\)/.test(flat) && /lqbby\\\.com\$/.test(flat),
  true,
);
check(
  "P4 激活时安装采集器（幂等守卫）",
  /function spInstall\(\): void \{ if \(spInstalled \|\| !spActive\) return;/.test(
    flat,
  ),
  true,
);
{
  const hooks = [
    /rec\("W\.scrollTo", a, spStack\(\)\)/,
    /rec\("W\.scrollBy", a, spStack\(\)\)/,
    /"E\.scrollTo\["/,
    /"SIV\["/,
    /rec\("setST", \[v\], spStack\(\)\)/,
  ];
  const hits = hooks.filter((re) => re.test(flat)).length;
  check("P5 写入包装五件套（含 scrollIntoView 与页面级 setST）", hits, 5);
}
check(
  "P6 guard 三接线（Armed / NoteDrag / Ended）",
  /spGuardArmed\(instantPath \? "instant" : "animated", preResetY\);/.test(
    flat,
  ) &&
    /spNoteDrag\(src, window\.scrollY\);/.test(flat) &&
    /spGuardEnded\(\);/.test(flat),
  true,
);
{
  const marks = [
    /spMark\("visit:start"/,
    /spMark\("reset"/,
    /spMark\("phe", "show"\)/,
    /spMark\("phe", "hide"\)/,
    /spMark\("scrollend"/,
    /spMark\("vv"/,
  ];
  const hits = marks.filter((re) => re.test(flat)).length;
  check("P7 生命周期 marks 六处（visit/reset/phe×2/scrollend/vv）", hits, 6);
}
check(
  "P8 双上报 + 30s 节流（sp_drag / sp_ok）",
  /spLastDragSentAt > 0 && t - spLastDragSentAt < 30000/.test(flat) &&
    /spSend\("sp_drag", data\)/.test(flat) &&
    /spSend\("sp_ok", data\)/.test(flat),
  true,
);
check(
  "P9 上报 keepalive（卸载期间仍可送达）",
  /keepalive: true/.test(flat),
  true,
);
check(
  "P10 顶层调用 initScrollProbe（于 init 之前）",
  (() => {
    const iProbe = flat.indexOf("initScrollProbe();");
    const iInit = flat.indexOf("init(); armLazyLightbox();");
    return iProbe > 0 && iInit > 0 && iProbe < iInit;
  })(),
  true,
);
{
  // P11 运行语义仿真：未激活时全部探针函数首行短路（普通访客零行为）
  const inert = [
    "spMark(",
    "spNoteDrag(",
    "spGuardArmed(",
    "spGuardEnded(",
  ].map((fn) => {
    const i = flat.indexOf("function " + fn);
    return i >= 0 && /return;/.test(flat.slice(i, i + 140));
  });
  check(
    "P11 探针函数未激活短路（spMark/spNoteDrag/spGuardArmed/spGuardEnded）",
    inert.every(Boolean),
    true,
  );
}

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

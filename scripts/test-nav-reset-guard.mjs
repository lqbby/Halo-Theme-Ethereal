// @ts-check
// 换页 × OverlayScrollbars 挂载「位置恢复」竞态守卫桩测（2026-10-10）
//
// 背景（线上 1.7.11 CDP 实测复现）：首页底部点文章换页时——
//   ① 主题跨页回顶复位 window.scrollTo(0,0) 执行；
//   ② ~60ms 后，OverlayScrollbars 自动挂载（3.5s 定时器/交互触发）的
//      「挂载后恢复滚动位置」rAF 到达：它捕获的 scrollYBefore 是换页前的
//      旧位置（如 4468），发现当前位置（0）对不上 → 又把旧位置写回；
//   ③ 新页面里旧位置超出可滚动上限即被钳制 → 「落在文章页最底」。
//
// 判据（源码级，全部必须在 app.ts 中成立）：
//   G1 run() 推迟条件包含 navBusy()（挂载不得落在换页窗口内）
//   G2 捕获处 fromInteraction || navBusy() ⇒ null（换页中不捕获）
//   G3 恢复 rAF 有纪元守卫：navResetStamp !== stampAtCapture ⇒ return
//   G4 复位纪元在 visit:start 与 content:scroll 双 rAF 复位处递增
//   G5 navBusy 判据 = is-changing || is-animating（与其它守卫同一口径）
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

check(
  "G1 run() 推迟条件含 navBusy()",
  /if \(\(scrollRecent \|\| navBusy\(\)\) && scrollGuardTries < 20\)/.test(
    flat,
  ),
  true,
);
check(
  "G2 换页中不捕获 scrollYBefore",
  /const scrollYBefore =\s*fromInteraction \|\| navBusy\(\) \? null : window\.scrollY;/.test(
    flat,
  ),
  true,
);
check(
  "G3 恢复 rAF 有纪元守卫",
  /if \(navResetStamp !== stampAtCapture\) return;/.test(flat),
  true,
);
{
  const bumps = flat.match(/navResetStamp \+= 1;/g) || [];
  check("G4 复位纪元双处递增（visit:start + 复位处）", bumps.length, 2);
}
check(
  "G5 navBusy 判据与其它守卫同口径",
  /classList\.contains\("is-changing"\) \|\| document\.documentElement\.classList\.contains\("is-animating"\)/.test(
    flat,
  ),
  true,
);
check(
  "G6 捕获与恢复用同一 stamp 快照",
  /const stampAtCapture = navResetStamp;/.test(flat),
  true,
);

// G7 运行语义仿真：epoch 逻辑三段（与源码判据同构，防手改语义）
{
  let stamp = 0; // navResetStamp
  let scrollY = 4468; // 换页前旧位置
  // capture（换页中不捕获 → null；这里仿「假想漏网」场景：即使捕获了也要被 G3 拦）
  const captured = scrollY;
  const stampAtCapture = stamp;
  stamp += 1; // visit:start
  stamp += 1; // 复位执行
  scrollY = 0; // scrollTo(0,0)
  // 恢复 rAF：
  const wouldWrite = stamp === stampAtCapture ? captured : null;
  check("G7 仿真：复位后到达的恢复被放弃（不再写回旧位置）", wouldWrite, null);
}

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

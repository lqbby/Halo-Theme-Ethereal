// @ts-check
// 动画速度档位系统「三处同步」桩测（2026-10-11，v1.7.28）
//
// 背景：档位系统有三处必须保持数值一致的来源（源码注释里的 ⚠️ 警告）：
//   ① src/styles/speed.css 的 balanced 块（:root 默认变量）
//   ② src/utils/speed-style.ts 的 SPEED_CUSTOM_DEFAULTS（自定义档缺省）
//   ③ settings.yaml 动画速度组 speedCustom value（后台表单缺省显示）
// 此前仅靠注释提醒，易漂移。本桩测把它们锁死，并校验：
//   · speed.css 四档块（balanced/relaxed/optimal/snappy）各定义全部 10 变量
//   · theme-transition.ts 的 SPEED_TIER_DURATION 覆盖 relaxed/optimal/snappy
//     （v1.7.28 补全——此前仅 snappy），且逐缓动曲线满足
//     snappy < optimal < 原值 < relaxed 单调关系
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEED_CSS = join(ROOT, "src/styles/speed.css");
const SPEED_STYLE = join(ROOT, "src/utils/speed-style.ts");
const THEME_TRANSITION = join(ROOT, "src/utils/theme-transition.ts");
const SETTINGS = join(ROOT, "settings.yaml");

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

const VARS = [
  "dur-swup",
  "dur-entry",
  "dur-entry-step",
  "dur-entry-max",
  "content-delay",
  "dur-scroll",
  "dur-float",
  "dur-banner",
  "dur-banner-transition",
  "marquee-speed",
];

/** 解析 speed.css 某档块的变量表 */
function parseCssTier(tier) {
  const css = readFileSync(SPEED_CSS, "utf8");
  const re = new RegExp(`html\\[data-speed="${tier}"\\]\\s*\\{([\\s\\S]*?)\\}`);
  const m = css.match(re);
  if (!m) return null;
  /** @type {Record<string,string>} */
  const out = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/--([\w-]+):\s*([\d.]+)/);
    if (mm) out[mm[1]] = mm[2];
  }
  return out;
}

// ── T1 四档块齐全 + 各定义全部变量 ──
for (const tier of ["balanced", "relaxed", "optimal", "snappy"]) {
  const t = parseCssTier(tier);
  const missing = VARS.filter((v) => !t || !(v in t));
  check(
    `T1 ${tier} 档定义全部 ${VARS.length} 变量`,
    missing.length === 0 ? "齐全" : `缺 ${missing.join(",")}`,
    "齐全",
  );
}

// ── T2 speed.css balanced ≡ SPEED_CUSTOM_DEFAULTS ──
const balanced = parseCssTier("balanced") || {};
const styleTs = readFileSync(SPEED_STYLE, "utf8");
const defaultsBlock = styleTs.match(
  /SPEED_CUSTOM_DEFAULTS = \{([\s\S]*?)\} as const/,
)?.[1];
/** @type {Record<string,string>} */
const defaults = {};
for (const line of (defaultsBlock || "").split("\n")) {
  const mm = line.match(/(\w+):\s*(\d+)/);
  if (mm) defaults[mm[1]] = mm[2];
}
const CSS_KEY = {
  swup: "dur-swup",
  entry: "dur-entry",
  entryStep: "dur-entry-step",
  entryMax: "dur-entry-max",
  contentDelay: "content-delay",
  scroll: "dur-scroll",
  float: "dur-float",
  banner: "dur-banner",
  carouselTransition: "dur-banner-transition",
  marqueeSpeed: "marquee-speed",
};
let drift12 = [];
for (const [k, v] of Object.entries(CSS_KEY)) {
  if (defaults[k] !== balanced[v])
    drift12.push(`${k}: style=${defaults[k]} css=${balanced[v]}`);
}
check(
  "T2 speed.css balanced ≡ SPEED_CUSTOM_DEFAULTS（10 项）",
  drift12.length === 0 ? "一致" : drift12.join("; "),
  "一致",
);

// ── T3 settings.yaml speedCustom value ≡ SPEED_CUSTOM_DEFAULTS ──
const yaml = readFileSync(SETTINGS, "utf8").replace(/\r/g, "");
const scIdx = yaml.indexOf("name: speedCustom");
const scValue = yaml
  .slice(scIdx, scIdx + 1200)
  .match(/value:\s*\n((?:\s+\w+: \d+\n)+)/)?.[1];
/** @type {Record<string,string>} */
const yamlDefaults = {};
for (const line of (scValue || "").split("\n")) {
  const mm = line.match(/(\w+):\s*(\d+)/);
  if (mm) yamlDefaults[mm[1]] = mm[2];
}
let drift13 = [];
for (const [k, v] of Object.entries(defaults)) {
  if (yamlDefaults[k] !== v)
    drift13.push(`${k}: yaml=${yamlDefaults[k]} style=${v}`);
}
check(
  "T3 settings.yaml speedCustom ≡ SPEED_CUSTOM_DEFAULTS（10 项）",
  drift13.length === 0 ? "一致" : drift13.join("; "),
  "一致",
);

// ── T4 theme-transition SPEED_TIER_DURATION 覆盖三档 + 单调关系 ──
const tt = readFileSync(THEME_TRANSITION, "utf8");
const tierBlock = tt.match(
  /SPEED_TIER_DURATION:[\s\S]*?= \{([\s\S]*?)\n\};/,
)?.[1];
const baseBlock = tt.match(/EASING_DURATION:[\s\S]*?= \{([\s\S]*?)\n\};/)?.[1];
const EASINGS = [
  "default",
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "expo-out",
  "back-out",
];
/** @param {string} block @param {string} tier */
function parseTier(block, tier) {
  const re = new RegExp(`${tier}: \\{([\\s\\S]*?)\\n  \\}`);
  const m = (block || "").match(re);
  if (!m) return null;
  /** @type {Record<string,number>} */
  const out = {};
  for (const mm of m[1].matchAll(/(?:"([a-z-]+)"|([a-z-]+)):\s*(\d+)/g))
    out[mm[1] || mm[2]] = Number(mm[3]);
  return out;
}
/** @type {Record<string,number>} */
const base = {};
for (const mm of (baseBlock || "").matchAll(
  /(?:"([a-z-]+)"|([a-z-]+)):\s*(\d+)/g,
))
  base[mm[1] || mm[2]] = Number(mm[3]);

for (const tier of ["relaxed", "optimal", "snappy"]) {
  const t = parseTier(tierBlock, tier);
  const missing = EASINGS.filter((e) => !t || !(e in t));
  check(
    `T4a ${tier} 档覆盖全部 7 条缓动曲线（v1.7.28 补全）`,
    missing.length === 0 ? "齐全" : `缺 ${missing.join(",")}`,
    "齐全",
  );
}
let mono = [];
const relaxedT = parseTier(tierBlock, "relaxed");
const optimalT = parseTier(tierBlock, "optimal");
const snappyT = parseTier(tierBlock, "snappy");
for (const e of EASINGS) {
  const r = relaxedT?.[e] ?? 0;
  const o = optimalT?.[e] ?? 0;
  const s = snappyT?.[e] ?? 0;
  const b = base[e] ?? 0;
  if (!(s < o && o < b && b < r))
    mono.push(`${e}: snappy=${s} optimal=${o} base=${b} relaxed=${r}`);
}
check(
  "T4b 逐曲线单调 snappy < optimal < 原值(balanced) < relaxed",
  mono.length === 0 ? "单调" : mono.join("; "),
  "单调",
);

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

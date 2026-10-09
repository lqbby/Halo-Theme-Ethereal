// @ts-check
// 距离门控滚动桩测（smartScrollTo 家族）
//
// 被测（**同一判据的两处实现，必须同步**）：
//   ① `src/utils/scroll-manager.ts` 的 `smartScrollTo`（TS，供 app.ts / moment 页等 import）
//   ② `src/components/control/BackToTop.astro` 内联的 `__smartScrollTo`（is:raw is:inline，
//      无法 import，故手抄一份；改阈值/判据时两处必须一致）
// 另核 ③ `lockstepScrollToTop` 的「大位移短路」（>1.5 屏直接瞬时到顶）
//
// 断言链：
//   SS-1 长距离（>1.5 屏）⇒ behavior:"auto"（瞬时）
//   SS-2 短距离 ⇒ behavior:"smooth"
//   SS-3 恰好 1.5 屏 ⇒ smooth（判据是 `>`，边界不瞬时）
//   SS-4 reduce-motion ⇒ 一律瞬时（短距离也瞬时）
//   SS-5 两处实现判定完全一致（8 用例矩阵）
//   SS-6 innerHeight 缺失时回退 800（阈值 1200）
//   SS-7 锁步回顶的大位移短路存在（源码判据）
//   SS-8 产物核对：页面含内联 __smartScrollTo、assets 含 scroll-manager chunk
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCROLL = join(ROOT, "src/utils/scroll-manager.ts");
const BACKTOTOP = join(ROOT, "src/components/control/BackToTop.astro");
const TEMPLATES = join(ROOT, "templates");

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

/**
 * 从源码抽出函数体：从 header 起、到下一个「指定缩进的收口行」止；再剥 TS 类型注解。
 * @param {string} src @param {string} header @param {string} closeIndent
 */
function extractFn(src, header, closeIndent = "\n}") {
  const start = src.indexOf(header);
  if (start < 0) throw new Error("找不到函数：" + header);
  const end = src.indexOf(closeIndent, start);
  if (end < 0) throw new Error("找不到函数结尾：" + header);
  return src
    .slice(start, end + closeIndent.length)
    .replace(/: number/g, "")
    .replace(/: void/g, "")
    .replace(/^export /, "");
}

/**
 * 把函数体编译成可调用函数（函数体里通过全局 window 取环境）
 * @param {string} body @param {string} name
 */
function compile(body, name) {
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\n return ${name};`)();
}

const smartTS = compile(
  extractFn(readFileSync(SCROLL, "utf8"), "export function smartScrollTo"),
  "smartScrollTo",
);
const smartInline = compile(
  extractFn(
    readFileSync(BACKTOTOP, "utf8"),
    "function __smartScrollTo(top)",
    "\n  }",
  ),
  "__smartScrollTo",
);

/**
 * 跑 fn(0) 并返回实际行为（"auto" / "smooth"），window 由 mock 提供。
 * @param {(top: number) => unknown} fn
 * @param {{ h?: number, y?: number, reduce?: boolean }} opt
 */
function behavior(fn, opt) {
  /** @type {any[]} */
  const calls = [];
  const win = {
    innerHeight: opt.h === undefined ? 900 : opt.h,
    scrollY: opt.y || 0,
    matchMedia: (/** @type {string} */ q) => ({
      matches:
        q.indexOf("prefers-reduced-motion") >= 0 ? opt.reduce === true : false,
    }),
    scrollTo: (/** @type {unknown} */ arg) => calls.push(arg),
    scroll: (/** @type {unknown} */ arg) => calls.push(arg),
  };
  const prev = /** @type {any} */ (globalThis).window;
  /** @type {any} */ (globalThis).window = win;
  try {
    fn(0);
  } finally {
    /** @type {any} */ (globalThis).window = prev;
  }
  const first = /** @type {any} */ (calls[0]);
  return first ? first.behavior : "(no call)";
}

// 阈值：innerHeight 900 ⇒ 1.5 屏 = 1350；scrollY=3000 + top=0 ⇒ 距离 3000
check(
  "SS-1 TS 版：长距离 3000>1350 ⇒ auto",
  behavior(smartTS, { y: 3000 }),
  "auto",
);
check(
  "SS-1 内联版：长距离 3000>1350 ⇒ auto",
  behavior(smartInline, { y: 3000 }),
  "auto",
);
check(
  "SS-2 TS 版：短距离 300<1350 ⇒ smooth",
  behavior(smartTS, { y: 300 }),
  "smooth",
);
check(
  "SS-2 内联版：短距离 300<1350 ⇒ smooth",
  behavior(smartInline, { y: 300 }),
  "smooth",
);
check(
  "SS-3 TS 版：恰好 1350 ⇒ smooth（判据是 >）",
  behavior(smartTS, { y: 1350 }),
  "smooth",
);
check(
  "SS-3 内联版：恰好 1350 ⇒ smooth",
  behavior(smartInline, { y: 1350 }),
  "smooth",
);
check(
  "SS-4 TS 版：reduce-motion 下短距离也 auto",
  behavior(smartTS, { y: 300, reduce: true }),
  "auto",
);
check(
  "SS-4 内联版：reduce-motion 下短距离也 auto",
  behavior(smartInline, { y: 300, reduce: true }),
  "auto",
);

// SS-5 两处实现一致性：同矩阵全等
{
  /** @type {{ h?: number, y?: number, reduce?: boolean }[]} */
  const cases = [
    { y: 0, h: 900 },
    { y: 100, h: 900 },
    { y: 1349, h: 900 },
    { y: 1350, h: 900 },
    { y: 1351, h: 900 },
    { y: 2400, h: 1600 },
    { y: 300, h: 900, reduce: true },
    { y: 5000, h: 0 },
  ];
  let same = 0;
  for (const c of cases) {
    if (behavior(smartTS, c) === behavior(smartInline, c)) same++;
  }
  check("SS-5 两处实现判定一致（8/8 用例）", same, cases.length);
}

check(
  "SS-6 TS 版：innerHeight=0 ⇒ 回退 800（阈值 1200，1500 为长距离）",
  behavior(smartTS, { y: 1500, h: 0 }),
  "auto",
);
check("SS-6 内联版：同判据", behavior(smartInline, { y: 1500, h: 0 }), "auto");

// SS-7 锁步大位移短路（源码级判据）
{
  const src = readFileSync(SCROLL, "utf8");
  check(
    "SS-7a 锁步短路常量存在",
    src.indexOf(
      "const LOCKSTEP_MAX_SMOOTH = (window.innerHeight || 800) * 1.5;",
    ) >= 0,
    true,
  );
  check(
    "SS-7b 锁步短路早退分支存在",
    /if \(startY > LOCKSTEP_MAX_SMOOTH\) \{\s*window\.scrollTo\(0, 0\);\s*return;/.test(
      src,
    ),
    true,
  );
}

// SS-8 产物核对（构建后才有意义；未构建则跳过并提示）
if (existsSync(TEMPLATES)) {
  const idx = join(TEMPLATES, "index.html");
  const page = existsSync(idx) ? readFileSync(idx, "utf8") : "";
  check(
    "SS-8a 页面含内联 __smartScrollTo",
    page.indexOf("__smartScrollTo") >= 0,
    true,
  );
  const assets = join(TEMPLATES, "assets");
  const hasChunk = existsSync(assets)
    ? readdirSync(assets).some(
        (f) => f.startsWith("scroll-manager.") && f.endsWith(".js"),
      )
    : false;
  check("SS-8b 产物含 scroll-manager chunk", hasChunk, true);
} else {
  console.log("⏭  SS-8 跳过（无 templates/，未构建）");
}

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

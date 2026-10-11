// @ts-check
// 刷新自恢复（防「首帧画顶部」闪现）桩测（2026-10-11，v1.7.30）
//
// 背景：底部刷新时浏览器原生滚动恢复发生在首帧之后（headless 实测 ~200ms）：
//   先画页面顶部（首页即 Banner 与三枚链接胶囊闪现）→ 再跳到恢复位置。
// 方案：「先藏、就位、再显」——内联恢复脚本（两外壳）+ app.ts 位置记录器
//   + CSS 隐藏门。判据：
//   R1 Layout.astro / pages/layout.astro 各含恢复脚本，且脚本体**逐字一致**（两外壳约定）
//   R2 脚本含关键防护：scrollRestoration=manual、reload-restoring 类、
//      到位判据(|y-target|<2)、稳定 8 帧收尾、1200ms 兜底
//   R3 app.ts 有位置记录器（ethereal-scroll: 键 + pagehide 补终值 + 500ms 限频 + 仅记非顶部）
//   R4 transition.css 隐藏门只动 opacity、不含 transition（#banner-wrapper 属 is-home
//      位移族，禁止附加过渡——见 test-marquee-translate-base 的家族契约）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LAYOUT = join(ROOT, "src/layouts/Layout.astro");
const PLUGIN_LAYOUT = join(ROOT, "src/pages/layout.astro");
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

/** 提取含 ethereal-scroll: 的内联脚本体（含 <script ...> 两标记之间部分） */
function extractRestoreScript(file) {
  const src = readFileSync(file, "utf8");
  const i = src.indexOf("ethereal-scroll:");
  if (i < 0) return null;
  const start = src.lastIndexOf("<script is:inline", i);
  const end = src.indexOf("</script>", i);
  if (start < 0 || end < 0) return null;
  return src.slice(start, end).replace(/\s+/g, " ").trim();
}

const s1 = extractRestoreScript(LAYOUT);
const s2 = extractRestoreScript(PLUGIN_LAYOUT);

check("R1a Layout.astro 含恢复脚本", !!s1, true);
check("R1b 两外壳脚本体逐字一致（归一化空白后）", s1 === s2 && !!s2, true);

const body = s1 || "";
check(
  "R2 关键防护齐全（manual / 类 / 到位 / 稳定 / 兜底）",
  [
    'history.scrollRestoration = "manual"',
    'classList.add("reload-restoring")',
    "Math.abs(y - target) < 2",
    "stable >= 8",
    "setTimeout(finish, 1200)",
  ].every((k) => body.includes(k)),
  true,
);
check(
  "R2b 双保险守卫（data-swup-ignore-script + readyState 仅真实载入）",
  body.includes("<script is:inline data-swup-ignore-script>") &&
    body.includes('document.readyState !== "loading"'),
  true,
);

const app = readFileSync(APP, "utf8");
check(
  "R3 app.ts 记录器（键 / pagehide / 限频 / 仅非顶部）",
  app.includes('"ethereal-scroll:" + location.pathname') &&
    app.includes('window.addEventListener("pagehide", storeScrollY)') &&
    app.includes("}, 500);") &&
    app.includes("if (y <= 0) return;"),
  true,
);

const css = readFileSync(TRANSITION, "utf8");
const cssFlat = css.replace(/\s+/g, " ");
check(
  "R4a 隐藏门规则存在（#main-grid + #banner-wrapper → opacity: 0）",
  /html\.reload-restoring #main-grid, html\.reload-restoring #banner-wrapper \{ opacity: 0; \}/.test(
    cssFlat,
  ),
  true,
);
{
  const i = cssFlat.indexOf("html.reload-restoring #main-grid");
  const seg = cssFlat.slice(i, i + 220);
  check(
    "R4b 隐藏门不含任何 transition（位移族契约）",
    seg.includes("transition") === false,
    true,
  );
}
check(
  "R4c 瞬间条（#home-moments-wrap）在门内——visibility 隐藏（避开其 700ms 通用过渡）",
  /html\.reload-restoring #home-moments-wrap \{ visibility: hidden; \}/.test(
    cssFlat,
  ),
  true,
);

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

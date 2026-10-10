// @ts-check
// Banner 链接胶囊规则桩测（2026-10-11，v1.7.25 修复「显示错误」）
//
// 背景：v1.7.0 包A 移植 banner 链接行时只落了 .banner-link 圆钮基样式，
//   模板会按「填了名称」给条目追加 .banner-link-text 类，但对应胶囊规则
//   在主线从未写入 ⇒ 图标+文字挤在 44px 圆钮里重叠溢出（首次配置即暴露）。
//   自上游 v2.0.0 ethereal-up2/components.css 逐条移植下述规则。
//
// 判据（源码级，components.css）：
//   C1 .banner-link 圆钮基样式（宽高 2.75rem / 圆角 / 毛玻璃）
//   C2 .banner-link:hover / :active 反馈
//   C3 .banner-link svg 固定 1.25rem + fill:currentColor
//   C4 .banner-link-text 胶囊（width:auto / padding 0 1rem / gap 0.5rem / 0.9rem）
//   C5 banner-title-enter 重新开标题时的入场含 #banner-links（210ms 档）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS = join(ROOT, "src/styles/components.css");

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

const css = readFileSync(CSS, "utf8");
const flat = css.replace(/\s+/g, " ");

check(
  "C1 .banner-link 圆钮基样式",
  /\.banner-link \{ display: inline-flex; align-items: center; justify-content: center; width: 2\.75rem; height: 2\.75rem; border-radius: 9999px;/.test(
    flat,
  ),
  true,
);
check(
  "C2 hover / active 反馈",
  /\.banner-link:hover \{ color: #fff; background: rgba\(255, 255, 255, 0\.26\); \}/.test(
    flat,
  ) && /\.banner-link:active \{ transform: scale\(0\.95\); \}/.test(flat),
  true,
);
check(
  "C3 svg 固定 1.25rem + fill:currentColor",
  /\.banner-link svg \{ width: 1\.25rem; height: 1\.25rem; fill: currentColor; \}/.test(
    flat,
  ),
  true,
);
check(
  "C4 .banner-link-text 胶囊规则",
  /\.banner-link-text \{ width: auto; padding: 0 1rem; gap: 0\.5rem; font-size: 0\.9rem; \}/.test(
    flat,
  ),
  true,
);
check(
  "C5 banner-title-enter 入场含 #banner-links（210ms 档）",
  /\.banner-title-enter #banner-subtitle-wrapper, \.banner-title-enter #banner-links \{/.test(
    flat,
  ) &&
    /\.banner-title-enter #banner-links \{ animation-delay: min\(210ms, var\(--dur-entry-max, 400ms\)\); \}/.test(
      flat,
    ),
  true,
);

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

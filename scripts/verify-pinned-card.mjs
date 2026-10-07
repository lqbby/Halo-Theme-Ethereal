#!/usr/bin/env node
/**
 * 置顶卡片保护断言（v1.4.77 起）。
 *
 * 需求背景：访客样式切换面板（DisplaySettings）允许访客改文章布局 / 卡片样式 /
 * 瀑布流。任何一次改动都可能「顺手」碰到置顶卡片（.post-card.is-pinned）的
 * 样式、布局或交互。本脚本在构建后对产物做静态断言，把这条硬约束钉住。
 *
 * 断言项：
 *   1. 置顶高亮规则存在于产物 CSS（outline + box-shadow 都在）；
 *   2. 置顶规则写在 #post-list-container 的 ID 选择器下（特异性足以胜过
 *      访客可切换的类选择器）；
 *   3. 置顶规则**不含** border（瀑布流下会改盒模型尺寸、与 JS 计算高度互相干扰）；
 *   4. is-pinned 类是服务端按 post.spec.pinned 渲染的，产物 HTML 里仍有该门控；
 *   5. 置顶徽章（PostMeta 的「置顶」字样）门控仍在。
 *
 * 用法：
 *   node scripts/verify-pinned-card.mjs [templatesDir]
 * 默认 templatesDir = ./templates
 */

import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2] || "templates";
const failures = [];
const notes = [];

function readAllCss(root) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".css"))
        out.push([p, fs.readFileSync(p, "utf8")]);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

if (!fs.existsSync(dir)) {
  console.error(`✗ 找不到产物目录：${dir}`);
  process.exit(1);
}

// ── 1 & 2 & 3：从产物 CSS（含外链页面级 CSS）里找置顶规则 ──
const cssFiles = readAllCss(path.join(dir, "assets"));
// 页面级样式可能内联在 HTML 里（<4KB 时 Astro 不外链），一并纳入
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith(".html")) continue;
  const html = fs.readFileSync(path.join(dir, f), "utf8");
  const m = html.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || [];
  if (m.length) cssFiles.push([path.join(dir, f), m.join("\n")]);
}

const pinnedRe = /#post-list-container\s+\.post-card\.is-pinned\s*\{([^}]*)\}/g;
let sawPinned = false;
let sawOutline = false;
let sawShadow = false;
let sawBorder = false;
const where = [];

for (const [file, css] of cssFiles) {
  let m;
  pinnedRe.lastIndex = 0;
  while ((m = pinnedRe.exec(css)) !== null) {
    sawPinned = true;
    where.push(file);
    const body = m[1];
    if (/outline\s*:/.test(body)) sawOutline = true;
    if (/box-shadow\s*:/.test(body)) sawShadow = true;
    if (/(^|[;{\s])border\s*:/.test(body)) sawBorder = true;
  }
}

if (!sawPinned) {
  failures.push(
    "产物 CSS 中找不到 `#post-list-container .post-card.is-pinned { ... }` 规则 —— 置顶高亮丢失，或选择器被降级为非 ID 形式",
  );
} else {
  notes.push(`置顶规则命中（${where.length} 处，特异性 = ID + 2 class）`);
  if (!sawOutline) failures.push("置顶规则缺少 outline（描边丢失）");
  if (!sawShadow) failures.push("置顶规则缺少 box-shadow（光晕丢失）");
  if (sawBorder)
    failures.push(
      "置顶规则出现了 border —— 瀑布流下卡片由 JS 绝对定位并写死 width/height，border 会改变盒模型尺寸、与 JS 计算互相干扰。请改用 outline",
    );
}

// ── 4：is-pinned 的服务端门控仍在产物 HTML 里 ──
const htmlFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".html"));
let sawClassAppend = false;
let sawPinnedGate = false;
for (const f of htmlFiles) {
  const html = fs.readFileSync(path.join(dir, f), "utf8");
  if (/post\.spec\.pinned\s*==\s*true\s*\?\s*' is-pinned'/.test(html)) {
    sawClassAppend = true;
  }
  if (/post\.spec\.pinned\s*==\s*true/.test(html)) sawPinnedGate = true;
}
if (!sawPinnedGate) {
  failures.push(
    "产物 HTML 中找不到 `post.spec.pinned == true` 门控 —— 置顶判定链路断了（th:classappend 或置顶徽章被移除）",
  );
} else {
  notes.push("置顶门控 post.spec.pinned == true 仍在产物 HTML 中");
  if (!sawClassAppend) {
    failures.push(
      "找不到 `post.spec.pinned == true ? ' is-pinned'` 的 th:classappend —— 卡片高亮类不再随置顶状态输出",
    );
  } else {
    notes.push("th:classappend 的 ' is-pinned' 分支完好");
  }
}

// ── 5：置顶徽章文案（i18n 或字面量）仍在 ──
let sawBadge = false;
for (const f of htmlFiles) {
  const html = fs.readFileSync(path.join(dir, f), "utf8");
  if (/material-symbols--pinboard/.test(html)) sawBadge = true;
}
if (!sawBadge)
  failures.push("产物中找不到置顶徽章图标 material-symbols--pinboard");
else notes.push("置顶徽章图标 material-symbols--pinboard 存在");

// ── 输出 ──
for (const n of notes) console.log(`  · ${n}`);
if (failures.length) {
  console.error("\n✗ 置顶卡片保护断言失败：");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✓ 置顶卡片保护断言全部通过");

#!/usr/bin/env node
/**
 * 置顶精选宽卡（PinnedCard）产物断言 —— 跑构建产物，不是源码。
 *
 * 为什么必须钉住（这里错一处的后果是「文章凭空少一篇 / 同一篇出现两次」）：
 *   置顶文章不再渲染在 #post-list-container 里，而是提到容器**之外**的精选宽卡；
 *   于是列表项的 th:if 与精选卡的 th:if 必须**严格互补**，否则：
 *     · 都成立 → 同一篇渲染两次（置顶文章出现两张卡）；
 *     · 都不成立 → 置顶文章在本页彻底消失。
 *
 * 断言项：
 *   1. 精选卡块存在、且其 th:if 要求「置顶 + 第 1 页」；
 *   2. 列表项的 th:if 是它的**逻辑补**（¬置顶 ∨ 非首页）—— 附带布尔恒等式说明；
 *   3. 精选卡块在 #post-list-container **之前**（红线位置：列表最上方、整行）；
 *   4. 精选卡渲染在容器之外（不得带 .post-card-item —— 那会被瀑布流脚本绝对定位）；
 *   5. 交互面齐全：hover 上浮 / active 按压 / focus-visible 焦点环 / prefers-reduced-motion 降级；
 *   6. 深浅色都走主题 token（无写死的浅色/深色表面、无 border 改盒模型）；
 *   7. i18n：组件用的 #{post.pinned} / #{post.readMore} 在 3 份 properties 里都有定义；
 *   8. 既有置顶高亮规则（#post-list-container .post-card.is-pinned）未被破坏
 *      —— 与 scripts/verify-pinned-card.mjs 的口径一致（三条布局下都要成立）。
 *
 * 用法：node scripts/test-pinned-card.mjs [templates/index.html]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const target = process.argv[2] || path.join(ROOT, "templates", "index.html");
const html = fs.readFileSync(target, "utf8");

let pass = 0;
const fails = [];
function check(label, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fails.push(label);
    console.log(`  ✗ ${label}${extra ? "  → " + extra : ""}`);
  }
}

/** 读产物里的 CSS：Astro 会把 <style is:global> 外链成 assets/*.css，故两处都要看 */
function allCss() {
  const dir = path.join(path.dirname(target), "assets");
  let out = "";
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".css"))
        out += fs.readFileSync(path.join(dir, f), "utf8") + "\n";
    }
  }
  return out;
}
const css = allCss();
const inlineCss = (html.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join(
  "\n",
);
const cssAll = css + "\n" + inlineCss;

console.log(
  `被测产物：${target}（${html.length} 字符；外链 CSS ${css.length} 字符）\n`,
);

// ---- 1/2. 两个互补的 th:if ----
console.log("[1/2] 精选卡与列表项的 th:if 必须严格互补");

const pinnedCondRe =
  /th:if="(\$\{post\.spec\.pinned == true and posts\.page == 1\})"/;
const listCondRe =
  /th:if="(\$\{post\.spec\.pinned != true or posts\.page != 1\})"/;

const mCard = pinnedCondRe.exec(html);
const mList = listCondRe.exec(html);
check("精选卡 th:if = 置顶 且 第 1 页", !!mCard, mCard ? "" : "未找到");
check("列表项 th:if = 非置顶 或 非第 1 页", !!mList, mList ? "" : "未找到");
// 布尔恒等式：¬(P ∧ Q) ≡ ¬P ∨ ¬Q。两条字面量互为补 ⇒ 任一 (pinned, page) 组合下
// 恰好一条成立：置顶+首页→只进精选卡；其余→只进列表。两处都不成立 = 文章消失（不允许）。
// 同时暴露一个安全兜底：posts.page 意外为 null 时，精选卡不渲染、列表项条件为真
// ⇒ 置顶文章**退回列表**，不会丢。
check(
  "互补性由布尔恒等式保证（¬(P∧Q) ≡ ¬P∨¬Q），且 page 为 null 时安全退回列表",
  !!mCard && !!mList,
);

// ---- 3. 位置：精选卡在列表容器之前 ----
console.log("\n[3] 位置：精选卡在列表容器之前（整行、最上方）");
const iCard = html.indexOf(
  'class="contents" th:each="post, postStat : ${posts.items}"',
);
const iContainer = html.indexOf('id="post-list-container"');
check("能找到精选卡块", iCard > -1, String(iCard));
check("能找到列表容器", iContainer > -1, String(iContainer));
check(
  "精选卡块在 #post-list-container 之前",
  iCard > -1 && iCard < iContainer,
  `${iCard} < ${iContainer}`,
);

// ---- 4. 必须在容器之外（不能是 .post-card-item）----
console.log(
  "\n[4] 精选卡不得参与瀑布流定位（不能在容器内、不带 .post-card-item）",
);
const cardBlockStart = html.lastIndexOf("<div", iCard);
const cardBlock = html.slice(cardBlockStart, iContainer);
check(
  "精选卡块内不含 post-card-item",
  !cardBlock.includes("post-card-item"),
  cardBlock.slice(0, 120),
);
check(
  "精选卡用独立类名 post-pinned-item",
  cardBlock.includes("post-pinned-item"),
);
check(
  "精选卡根节点是整卡 <a>（可点区域最大化）",
  cardBlock.includes("post-pinned-card") && cardBlock.includes("card-base"),
);

// ---- 5. 交互面 ----
console.log("\n[5] 交互面：hover / active / focus-visible / reduced-motion");
check(
  ".post-pinned-card 样式进入产物 CSS",
  cssAll.includes(".post-pinned-card"),
);
check(
  "hover 有上浮位移",
  /\.post-pinned-card:hover\s*\{[^}]*translateY\(-2px\)/.test(cssAll),
);
check(
  "active 有按压反馈",
  /\.post-pinned-card:active\s*\{[^}]*scale\(0?\.995\)/.test(cssAll),
);
check(
  "focus-visible 有焦点环",
  /\.post-pinned-card:focus-visible\s*\{[^}]*outline/.test(cssAll),
);
check(
  "封面有 hover 缩放",
  /\.post-pinned-card:hover\s+\.post-pinned-card-img\s*\{[^}]*scale\(/.test(
    cssAll,
  ),
);
check(
  "有 prefers-reduced-motion 降级",
  /prefers-reduced-motion[\s\S]{0,600}\.post-pinned-card/.test(cssAll),
);
check(
  "降级里关掉了位移与缩放",
  /prefers-reduced-motion[\s\S]{0,600}transform:\s*none/.test(cssAll),
);

// ---- 6. 主题 token / 盒模型 ----
console.log("\n[6] 视觉走主题 token，且不改盒模型");
check(
  "表面用 card-base（--card-bg + --radius-large）",
  cardBlock.includes("card-base"),
);
check(
  "环/光晕用 box-shadow（不用 border 改盒模型）",
  /\.post-pinned-card\s*\{[^}]*box-shadow/.test(cssAll),
);
check(
  "无写死浅色表面的 border-color（走 color-mix + token）",
  !/\.post-pinned-card[^{]*\{[^}]*border:\s*\d/.test(cssAll),
);
check(
  "封面靠 .post-pinned-card-cover 的 overflow:hidden 裁切，圆角由 card-base 承担",
  /\.post-pinned-card-cover\s*\{[^}]*overflow:\s*hidden/.test(cssAll) &&
    cardBlock.includes("card-base"),
);

// ---- 6b. 打磨细节（这几条都是「看着不对 → 量出来才对症」修出来的）----
// ⚠️ 断言必须按**压缩后**的产物写：颜色被压成 #0000006b（8 位 hex）、
//    媒体查询被写成 `(width<=767.98px)`（没有 min-width 字样）——按源码格式写必然假阴性。
console.log("\n[6b] 打磨细节：箭头对比度 / 页脚分隔 / 桌面栅格比例 / 移动端");
check(
  "悬停箭头有半透明深色圆底（否则白箭头在浅封面上不可见）",
  /\.post-pinned-card-arrow-chip\{[^}]*width:2\.85rem[^}]*\}/.test(cssAll) &&
    /\.post-pinned-card-arrow-chip\{[^}]*background:(#000000[0-9a-f]{2}|rgb\(0 0 0)/.test(
      cssAll,
    ),
);
check(
  "箭头圆底做了背景模糊（提升可读性）",
  /arrow-chip\{[^}]*backdrop-filter/.test(cssAll),
);
check(
  "页脚（置顶/日期/统计）有上沿分隔线",
  /\.post-pinned-card-foot\{[^}]*border-top/.test(cssAll),
);
check(
  "桌面栅格 40/60（与参考设计一致）",
  /\.post-pinned-card\{[^}]*grid-template-columns:minmax\(0,\s*40%\)/.test(
    cssAll,
  ),
);
check(
  "移动端改为上下结构且封面 16:9",
  /@media\s*\(width<=767\.98px\)\{\.post-pinned-card\{grid-template-columns:minmax\(0,\s*1fr\)\}/.test(
    cssAll,
  ) &&
    /@media\s*\(width<=767\.98px\)[\s\S]{0,300}\.post-pinned-card-cover\{aspect-ratio:16\/9\}/.test(
      cssAll,
    ),
);
check(
  "移动端常显「阅读全文」（触屏没有 hover）",
  /@media\s*\(width<=767\.98px\)[\s\S]{0,600}\.post-pinned-readmore\{opacity:1/.test(
    cssAll,
  ),
);
check(
  "正文高度节流（封面不被裁得过狠）：标题/摘要行数受限、内边距收紧",
  /\.post-pinned-card-title\{[^}]*-webkit-line-clamp:2/.test(cssAll) &&
    /\.post-pinned-card-body\{[^}]*padding:1\.15rem/.test(cssAll),
);

// ---- 7. i18n ----
console.log("\n[7] i18n 键三份齐全且被使用");
for (const [file, word] of [
  ["default.properties", "Pinned"],
  ["zh_CN.properties", "置顶"],
  ["zh_TW.properties", "置頂"],
]) {
  const p = path.join(ROOT, "i18n", file);
  const txt = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  check(
    `${file} 有 post.pinned`,
    new RegExp(`^post\\.pinned=${word}`, "m").test(txt),
  );
  check(`${file} 有 post.readMore`, /^post\.readMore=.+/m.test(txt));
}
check("组件里用了 #{post.pinned}", html.includes("#{post.pinned}"));
check("组件里用了 #{post.readMore}", html.includes("#{post.readMore}"));

// ---- 8. 既有置顶高亮未被破坏 ----
console.log("\n[8] 既有置顶高亮规则（三布局通用）仍在");
check(
  "保留 #post-list-container .post-card.is-pinned 的 outline 高亮",
  /#post-list-container\s+\.post-card\.is-pinned\s*\{[^}]*outline/.test(cssAll),
);
check(
  "该规则仍不含 border（瀑布流下会改盒模型）",
  !/#post-list-container\s+\.post-card\.is-pinned\s*\{[^}]*border:/.test(
    cssAll,
  ),
);
check(
  "PostCard 仍按 post.spec.pinned 渲染 is-pinned 门控",
  /th:classappend="\$\{\(coverEmpty \? ' no-cover' : ' has-cover'\) \+ \(post\.spec\.pinned == true \? ' is-pinned' : ''\)\}"/.test(
    html,
  ),
);

console.log(
  `\n通过 ${pass} 项${fails.length ? `，失败 ${fails.length} 项：\n - ${fails.join("\n - ")}` : "，全部通过"}`,
);
process.exit(fails.length ? 1 : 0);

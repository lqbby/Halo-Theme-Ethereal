#!/usr/bin/env node
/**
 * 首页「系列」卡片条（SeriesStrip）回归。
 *
 * 设计沿革（别把这两版搞混）：
 *   · 1.5.32 —— 「一个系列一张卡」，一行 4 张，封面取该系列最新一篇；放在两卡行**下面**。
 *   · 1.5.33 —— 改成参考站 daily.yybb.us 的形态：**一套系列切换按钮 + 每个系列一个面板**，
 *     面板里是该系列的**全部文章**（一排 4 张，点 ‹ › 右移）；整块挪到两卡行**上面**。
 *     所以 1.5.32 那批断言（__count / __excerpt / series.latest / 箭头整块 hidden）全部作废，
 *     本文件是按新形态重写的版本。
 *
 * 覆盖三层，都是「不测就会静默坏」的点：
 *   [A] 产物静态断言 —— 门控顺序 / tablist 与面板结构 / 卡片要素 / 空属性坑 /
 *       只在首页出现 / 位置在两卡行之上 / CSS 分块与哈希
 *   [B] i18n 与后台设置 —— 用到的键必须在三份 .properties 里都存在；死键已清；settings 字段齐全
 *   [C] 行为脚本（迷你 DOM 跑真产物 js）—— 面板切换 / roving tabindex / 键盘导航 /
 *       按一张卡步进 / 边界置灰（而非隐藏）/ 无溢出 / reduced-motion /
 *       重复执行幂等 / resize 只挂一个监听 / 无容器不抛
 *
 * 关键背景（踩过的坑，写进断言防复发）：
 *   · th:if(3) 早于 th:with(4) ⇒ 插件版本守卫必须在 finder 调用**之前**的层，
 *     否则旧插件（1.0.3）下首页会 500。断言 A1/A2 用「出现位置先后」锁死这个顺序。
 *   · Thymeleaf 3.1.5 对 null 求值的 th:src / th:href **不是删属性，而是写空值**
 *     （`src=""` / `href=""`）⇒ 必须有 th:if 兜住。断言 A4/A5。
 *   · 判空若写在 <section> 内部，系列为 0 时首页会留一条空 <section>（1rem 死空白）。断言 A6。
 *   · 封顶写成 `not (ps.index >= 30)`：`>` 在 HTML 属性里会被转义成 `&gt;`（断言里先还原）。
 *
 * 用法：node scripts/test-series-strip.mjs [templates/assets/series-strip.js]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const target = process.argv[2] || "templates/assets/series-strip.js";
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const tplDir = (() => {
  const guess = path.resolve(path.dirname(target), "..");
  return fs.existsSync(path.join(guess, "index.html"))
    ? guess
    : path.join(repoRoot, "templates");
})();
const themeRoot = fs.existsSync(path.join(tplDir, "..", "i18n"))
  ? path.resolve(tplDir, "..")
  : repoRoot;

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

const read = (p) => fs.readFileSync(p, "utf8");
/** HTML 实体还原（`&gt;` → `>`），让断言能写「人话」 */
const unesc = (s) =>
  s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");

const rawIndex = read(path.join(tplDir, "index.html"));
const index = unesc(rawIndex);
const js = read(target);

/**
 * 只取本组件在首页里的那段标记（#series-strip → #post-list-container），
 * 免得断言误伤页面别处的同名 class。
 */
const stripHtml = (() => {
  const idAt = index.indexOf('id="series-strip"');
  if (idAt < 0) return "";
  // 必须从 `<section` 起切（A6 要断言 section 起始标签本身）
  const from = Math.max(index.lastIndexOf("<section", idAt), 0);
  const b = index.indexOf('id="post-list-container"', idAt);
  return index.slice(from, b > from ? b : undefined);
})();

// ================== [A] 产物静态断言 ==================
console.log("\n[A] 产物静态断言");

check(
  "index.html 里有系列条容器 #series-strip",
  index.includes('id="series-strip"'),
);
check(
  "A1 插件版本守卫存在（ethereal-companion >=1.1.0，实体会被还原成 >）",
  index.includes("pluginFinder.available('ethereal-companion', '>=1.1.0')"),
);
const iGate = index.indexOf("pluginFinder.available('ethereal-companion'");
const iFinder = index.indexOf("recentCommentsSeriesFinder.listLatest");
check(
  "A2 版本守卫出现在 finder 调用之前（th:if 早于 th:with，顺序反了旧插件会 500）",
  iGate >= 0 && iFinder > iGate,
  `gate=${iGate} finder=${iFinder}`,
);
check(
  "A3 listLatest 的入参是 th:with 里声明的 seriesLimit（同层后向引用）",
  index.includes(
    "seriesList=${recentCommentsSeriesFinder.listLatest(seriesLimit)}",
  ),
);
check(
  "A3b seriesLimit 由 settings 的 seriesCount 经 #conversions 转 Integer 得来（不传 sort）",
  index.includes(
    "seriesLimit=${theme.config?.layout?.postList?.seriesCount != null ? #conversions.convert(theme.config?.layout?.postList?.seriesCount, 'java.lang.Integer') : 4}",
  ),
);
check(
  'A4 <img> 有 th:if 兜住（th:src 为 null 会写出 src="" 去打当前页）',
  /<img[^>]*series-strip-card__img[^>]*th:if="\$\{not #strings\.isEmpty\(post\.cover\)\}"/.test(
    stripHtml,
  ),
);
check(
  'A5 卡片 <a> 有 th:if 兜住 permalink（th:href 为 null 会写出 href=""）',
  /<a[^>]*th:if="\$\{not \(ps\.index >= 30\) and post\.permalink != null\}"/.test(
    stripHtml,
  ),
);
check(
  "A5b 不再出现 `post.permalink : null` 这种空 href 写法",
  !index.includes("post.permalink : null"),
);
// ⚠️ 1.5.35 起卡片 <a> 的 class 是 "series-strip-card card-base"（接管纹理/外壳）
//    ⇒ 这里只能按前缀匹配，别再写死 `class="series-strip-card"`（会整条断言静默失败）。
const iCard = stripHtml.indexOf('class="series-strip-card');
check(
  "A5c 卡片 <a> 的 href 直接取 post.permalink",
  // ⚠️ 不能用 `<a[^>]*th:href`：同一个标签里的 th:if 含 `>=`，那个 `>` 会截断 [^>]*
  iCard >= 0 &&
    stripHtml.slice(iCard, iCard + 400).includes('th:href="${post.permalink}"'),
);
check(
  "A5d 卡片 <a> 挂 card-base（接管 .card-base::before 纹理 + 卡片外壳 outline）",
  /class="series-strip-card card-base"/.test(stripHtml),
);
check(
  "A5e tab 按钮挂 btn-card（接管主题按钮底色 / 悬停 / 卡片外壳）",
  /class="series-strip__tab btn-card"/.test(stripHtml),
);
check(
  'A6 判空罩在 <section> 外面（th:if="${not #lists.isEmpty(seriesList)}" 在 section 上）',
  /<section[^>]*id="series-strip"[^>]*th:if="\$\{not #lists\.isEmpty\(seriesList\)\}"/.test(
    stripHtml,
  ) ||
    /<section[^>]*th:if="\$\{not #lists\.isEmpty\(seriesList\)\}"[^>]*id="series-strip"/.test(
      stripHtml,
    ),
);
check(
  "A7 可见数写在 section 的 style 上（桌面 7 / 平板 3 / 手机 2）",
  // ⚠️ 1.5.50 起整页宽 ⇒ 容器宽度翻倍，桌面可见数 5 → 7（维持卡宽 ≈184px 的密度）。
  index.includes(
    "--series-visible-desktop:7;--series-visible-tablet:3;--series-visible-mobile:2",
  ),
);
check(
  "A8 卡片要素齐全（cover / img / placeholder / issue / title）",
  ["__cover", "__img", "__placeholder", "__issue", "__title"].every((s) =>
    stripHtml.includes("series-strip-card" + s),
  ),
);
check(
  "A8b 旧版「系列摘要 / 篇数」要素已彻底移除（__count / __excerpt）",
  !stripHtml.includes("series-strip-card__count") &&
    !stripHtml.includes("series-strip-card__excerpt"),
);
check(
  "A8c 期号优先取 post.order，缺失时按该系列内时间倒推（size - index）",
  stripHtml.includes(
    "#{seriesStrip.issue(${post.order != null ? post.order : #lists.size(s.posts) - ps.index})}",
  ),
);
check(
  "A8d 封面 loading/fetchpriority 走 th:attr 条件下发（首系列首卡 eager+high，其余 lazy+auto）",
  // ⚠️ 判据必须**只针对这一张 img 的开标签**：
  //    stripHtml 从 <section id="series-strip"> 切到 #post-list-container，中间**还夹着两卡行**
  //    （FeaturedCards 的封面本来就写着静态 `loading="eager" fetchpriority="high"`）
  //    ⇒ 用「整段里不存在 loading=」当判据会误报（1.5.37 实测，A8d 因此误报）。
  (() => {
    const tag =
      (/<img[^>]*series-strip-card__img[^>]*>/.exec(stripHtml) || [])[0] || "";
    if (!tag) return false;
    return (
      /th:attr="loading=\$\{st\.index == 0 and ps\.index == 0 \? 'eager' : 'lazy'\},fetchpriority=\$\{st\.index == 0 and ps\.index == 0 \? 'high' : 'auto'\}"/.test(
        tag,
      ) && !/\sloading="/.test(tag)
    );
  })(),
  (/(<img[^>]*series-strip-card__img[^>]*>)/.exec(stripHtml) || [])[1]?.slice(
    0,
    120,
  ) || "未找到 series-strip-card__img",
);

const tplVer = (() => {
  const m = /version:\s*"([0-9.]+)"/.exec(
    read(path.join(themeRoot, "theme.yaml")),
  );
  return m ? m[1] : "";
})();
check(
  `A9 首页引了 series-strip.js 且 ?v= 与 theme.yaml 版本一致（${tplVer}）`,
  tplVer !== "" && index.includes(`assets/series-strip.js?v=${tplVer}`),
  `theme.yaml=${tplVer}`,
);
check(
  "A10 只有首页带系列条（category/tag/archives 用同一 PostList 但不该有）",
  (() => {
    for (const f of ["category.html", "tag.html", "archives.html"]) {
      const p = path.join(tplDir, f);
      if (fs.existsSync(p) && read(p).includes("series-strip-card"))
        return false;
    }
    return true;
  })(),
);

// ---- 系列切换按钮（tablist） ----
check(
  "A11 tablist 容器存在（role=tablist + data-series-tabs + 只在 >1 个系列时渲染）",
  /<div[^>]*role="tablist"[^>]*data-series-tabs[^>]*th:if="\$\{#lists\.size\(seriesList\) > 1\}"/.test(
    stripHtml,
  ) ||
    /<div[^>]*th:if="\$\{#lists\.size\(seriesList\) > 1\}"[^>]*role="tablist"[^>]*data-series-tabs/.test(
      stripHtml,
    ),
);
check(
  "A12 tab 以 th:each 遍历 seriesList 渲染（role=tab + data-series-tab）",
  /<button[^>]*th:each="s, st : \$\{seriesList\}"[^>]*role="tab"[^>]*th:data-series-tab="\$\{st\.index\}"/.test(
    stripHtml,
  ),
);
check(
  "A13 tab 的 aria-selected / tabindex 是 roving 的（仅首个为 true / 0）",
  stripHtml.includes(
    "th:aria-selected=\"${st.index == 0 ? 'true' : 'false'}\"",
  ) && stripHtml.includes("th:tabindex=\"${st.index == 0 ? '0' : '-1'}\""),
);
check(
  "A14 tab 与面板用 aria-controls / aria-labelledby 双向绑定",
  stripHtml.includes('th:aria-controls="|series-panel-${st.index}|"') &&
    // ⚠️ 面板侧 1.5.37 起带三元兜底（见 A16b）⇒ 只断言「引用了 tab 的 id 形态」
    stripHtml.includes("'series-tab-' + st.index") &&
    stripHtml.includes('th:id="|series-tab-${st.index}|"'),
);

// ---- 每个系列一个面板 ----
check(
  "A15 面板以 th:each 遍历 seriesList 渲染（role=tabpanel + data-series-panel）",
  // ⚠️ 别用 `[^>]*` 跨属性：面板开标签的 aria-labelledby 里含 `#lists.size(seriesList) > 1`，
  //    产物里是 `&gt;`，而本文件的 unesc() 会把它还原成**裸 `>`** ⇒ 直接打断「非 > 字符」的匹配
  //    （1.5.37 实测，A15 因此误报）。正解 = `[\s\S]*?` + 明确终点（最后一个属性 + `>`）抠开标签。
  (() => {
    const m =
      /<div[^>]*th:each="s, st : \$\{seriesList\}"[\s\S]*?th:data-series-panel="\$\{st\.index\}">/.exec(
        stripHtml,
      );
    if (!m) return false;
    const tag = m[0];
    return (
      tag.includes('class="series-strip__panel"') &&
      tag.includes('role="tabpanel"') &&
      tag.includes('th:id="|series-panel-${st.index}|"')
    );
  })(),
);
check(
  "A16 非首个面板 SSR 就带 is-hidden（首屏只露第 0 个，不等 JS）",
  stripHtml.includes("th:classappend=\"${st.index != 0 ? ' is-hidden' : ''}\""),
);
check(
  "A16b 面板 aria-labelledby 恒可解析：多系列指向 tab，单系列兜底到段头标题（否则 axe 报 dangling reference）",
  // tablist 有 th:if="size > 1" ⇒ 单系列时页面没有 #series-tab-0。面板若无条件引用它，
  // 就是「指向不存在元素」的 ARIA 引用（axe 硬性违规）。兜底目标必须是**恒存在**的节点。
  (() => {
    const m = /th:aria-labelledby="([^"]*)"/.exec(stripHtml);
    return (
      !!m &&
      m[1].includes("'series-tab-' + st.index") &&
      m[1].includes("series-strip-title") &&
      stripHtml.includes('id="series-strip-title"')
    );
  })(),
  (/(th:aria-labelledby="[^"]*")/.exec(stripHtml) || [])[1] ||
    "未找到 th:aria-labelledby",
);
check(
  "A16c 面板不再无条件写 aria-labelledby=（旧写法在单系列下是悬空引用；且三元里禁套 |…|）",
  !stripHtml.includes('th:aria-labelledby="|series-tab-${st.index}|"') &&
    !/th:aria-labelledby="\$\{[^"]*\$\{/.test(stripHtml),
  (/(th:aria-labelledby="[^"]*")/.exec(stripHtml) || [])[1] ||
    "未找到 th:aria-labelledby",
);
check(
  "A17 卡片渲染在面板的横向轨道里（viewport 先于 card 出现）",
  stripHtml.includes("data-series-viewport") &&
    stripHtml.indexOf("data-series-viewport") <
      stripHtml.indexOf("series-strip-card"),
);
check(
  "A18 系列条排在两卡行之上（本轮位置互换生效）",
  (() => {
    const iSeries = index.indexOf('id="series-strip"');
    const iFeatured = index.indexOf('id="featured-cards"');
    return iSeries >= 0 && (iFeatured < 0 || iSeries < iFeatured);
  })(),
  `series=${index.indexOf('id="series-strip"')} featured=${index.indexOf('id="featured-cards"')}`,
);

/** 承载系列条样式的外链分块（含容器查询几何常量），且引用它的每一页哈希一致。
 *
 * ⚠️⚠️ 分块名取决于「**谁渲染这个组件**」——Astro 把组件级 `<style is:global>` 归到
 * 渲染它的那个 .astro 模块的 CSS chunk 上：
 *   · 1.5.49 及以前：`<SeriesStrip />` 在 `PostList.astro` 里 ⇒ 落 `PostList.<hash>.css`
 *   · 1.5.50 起： 两块横带搬进 `MainGridLayout.astro` ⇒ 落 `MainGridLayout.<hash>.css`
 * 所以必须**按内容**定位，写死文件名会在「组件搬家」那一轮集体假失败。 */
const cssChunks = fs
  .readdirSync(path.join(tplDir, "assets"))
  .filter((f) => f.endsWith(".css"))
  .filter((f) =>
    read(path.join(tplDir, "assets", f)).includes(".series-strip-card"),
  );
check(
  "A19 承载系列条样式的分块存在且只有一份",
  cssChunks.length === 1,
  cssChunks.join(","),
);
if (cssChunks.length === 1) {
  const css = read(path.join(tplDir, "assets", cssChunks[0]));
  check(
    "A20 样式里有容器查询 + 吸附 + 卡片宽度公式",
    css.includes("container-type:inline-size") &&
      css.includes("scroll-snap-type") &&
      css.includes("100cqi"),
  );
  check(
    "A21 卡片宽度是 (100cqi - (V-1)*gap - 2*edge - 1px)/V 形式",
    /100cqi.*var\(--series-visible\).*\/.*var\(--series-visible\)/s.test(css) ||
      css.includes("--series-card-w"),
  );
  check(
    "A22 隐藏面板 / 置灰箭头 / 选中标签的样式都在",
    css.includes(".series-strip__panel.is-hidden") &&
      /\.series-strip__nav:disabled\s*\{[^}]*opacity:\s*0?\.3/.test(css) &&
      /\.series-strip__tab\[aria-selected/.test(css),
  );

  // ---- 1.5.35：系列条接入主题卡片体系（纹理 / 外壳）+ 收紧间距 ----
  // ⚠️ 产物 CSS 是压缩过的（几乎单行）⇒ 不能用 `^` 行锚点判「某条规则里有没有 X」，
  //    必须按选择器抠出规则块再判。
  const blockOf = (sel) => {
    const i = css.indexOf(sel + "{");
    if (i < 0) return "";
    return css.slice(i, css.indexOf("}", i) + 1);
  };
  const baseCard = blockOf(".series-strip-card");
  check(
    "A22b 卡片走 card-base：position:relative + isolation:isolate（= 纹理 ::before 的包含块 + 层叠上下文），且底层规则不再自带 box-shadow",
    // 🔴 `position: relative` 是**必须**的，不是可选优化：`.card-base` 自己没设 position，
    //    上游靠 `will-change: transform` 当绝对定位后代的包含块；本卡片为省合成层把它打回
    //    `auto` ⇒ 少了 position，纹理 ::before(absolute/inset:0) 会一路往上落到整页那个
    //    `relative` 容器上 ⇒ **整页背景铺满纹理**（2026-09-18 LQ 实测，1.5.36 修复）。
    /position:\s*relative/.test(baseCard) &&
      /isolation:\s*isolate/.test(baseCard) &&
      // ⚠️ 不能用裸 /box-shadow/：transition 简写里有 `...,box-shadow .2s` ⇒ 只认「声明」
      !/box-shadow\s*:/.test(baseCard) &&
      /will-change:\s*auto/.test(baseCard),
    baseCard.slice(0, 260),
  );
  check(
    "A22c 基线投影只在卡片外壳关闭时声明（未分层的全局样式否则会顶掉外壳暗晕）",
    /box-shadow/.test(
      blockOf(":root:not(.mods-card-shell) .series-strip-card"),
    ) &&
      /box-shadow/.test(
        blockOf(":root:not(.mods-card-shell) .series-strip-card:hover"),
      ),
  );
  check(
    "A22d 外壳开启时卡片把描边交还给外壳 outline（border 置透明）",
    /border-color:\s*(transparent|#0000|rgba\(0,\s*0,\s*0,\s*0\))/.test(
      blockOf(":root.mods-card-shell .series-strip-card"),
    ) &&
      /outline-color/.test(
        blockOf(":root.mods-card-shell .series-strip-card:hover"),
      ),
  );
  check(
    "A22e tab 底色/按压走主题按钮 token（暗色下 --card-bg ≈ 页面底 ⇒ 原来看起来没描边）",
    /background:\s*var\(--btn-regular-bg\)/.test(
      blockOf(".series-strip__tab"),
    ) && /--btn-regular-bg-active/.test(blockOf(".series-strip__tab:active")),
  );
  check(
    "A22f 间距收紧已进产物（区块下沿 .75rem / 视口下沿 .625rem）",
    /margin-bottom:\s*0?\.75rem/.test(blockOf("#series-strip")) &&
      /padding-bottom:\s*0?\.625rem/.test(blockOf(".series-strip__viewport")),
  );

  // ---- 1.5.36：系列切换并进段头行（卡片上方 ~75px 空白 → 12px） ----
  const tabsBlock = blockOf(".series-strip__tabs");
  check(
    "A22g 系列切换并入段头行：tabs 不再独立占行（无非 0 的 margin-bottom）+ 改 flex:auto + min-width:0（缺 min-width 会被内容撑开、挤掉右侧箭头）",
    // ⚠️ 压缩器会把 `flex: 1 1 auto` 压成等价简写 `flex:auto` ⇒ 两种形态都收
    /flex:\s*(auto|1 1 auto)/.test(tabsBlock) &&
      /min-width:\s*0/.test(tabsBlock) &&
      // 允许「整条声明不存在」或「margin-bottom:0」；只要出现非 0 值就失败
      !/margin-bottom:\s*(?!0)/.test(tabsBlock),
    tabsBlock.slice(0, 200),
  );
  check(
    "A22h 段头 DOM 顺序：tabs 位于 navs 之前（= 已并进 head 行；反了说明退回「标题/箭头一行 + tabs 一行」的旧两行布局）",
    (() => {
      const a = stripHtml.indexOf("series-strip__tabs");
      const b = stripHtml.indexOf("series-strip__navs");
      return a >= 0 && b >= 0 && a < b;
    })(),
    `tabs@${stripHtml.indexOf("series-strip__tabs")} navs@${stripHtml.indexOf("series-strip__navs")}`,
  );

  // ---- 1.5.37：滚动真相源 / 焦点环容身空间 / 减动效收口 ----
  check(
    "A22i 视口不声明 scroll-behavior（scrollBy({behavior:'auto'}) 的语义是「沿用计算值」⇒ CSS 写 smooth 会让减动效静默失效）",
    !/scroll-behavior/.test(blockOf(".series-strip__viewport")),
    blockOf(".series-strip__viewport").slice(0, 200),
  );
  check(
    "A22j 轨道内距 ≥ 4px（卡片焦点环 2px 描边 + 2px offset，小于 4px 会被滚动容器裁掉）",
    /--series-edge:\s*(?:[4-9]px|1[0-9]px)/.test(blockOf("#series-strip")) ||
      /--series-edge:\s*calc\(/.test(blockOf("#series-strip")),
    blockOf("#series-strip").slice(0, 180),
  );
  check(
    "A22k tabs 容器 padding + 等量负 margin（缺 padding 切环 / 缺 margin 撑高段头并吃掉视觉间距）",
    (() => {
      const pad = /padding:\s*(-?[0-9.]+)px/.exec(tabsBlock);
      const mar = /margin:\s*(-[0-9.]+)px/.exec(tabsBlock);
      return (
        !!pad &&
        !!mar &&
        Number(pad[1]) >= 4 &&
        Number(mar[1]) === -Number(pad[1])
      );
    })(),
    tabsBlock.slice(0, 240),
  );
  check(
    "A22l 减动效收口已进产物（transition:none!important + hover/focus 位移归零）",
    // ⚠️ 本页 CSS 分块里可能还并入了 FeaturedCards 等组件的 reduce 块 ⇒ 不能只看第一处
    //    prefers-reduced-motion，要按「.series-strip-* 出现在同一个 reduce 块里」来判。
    [
      ...css.matchAll(/@media\s*\(?\s*prefers-reduced-motion:\s*reduce\s*\)?/g),
    ].some((m) => {
      const chunk = css.slice(m.index, m.index + 1200);
      return (
        /transition:\s*none\s*!important/.test(chunk) &&
        /\.series-strip-card[^{]*\{[^}]*transform:\s*none\s*!important/.test(
          chunk,
        )
      );
    }),
    (css.match(/prefers-reduced-motion/g) || []).length + " 处",
  );

  const users = [];
  const chunkRe = new RegExp(
    cssChunks[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  for (const f of fs.readdirSync(tplDir)) {
    if (!f.endsWith(".html")) continue;
    const m = chunkRe.exec(read(path.join(tplDir, f)));
    if (m) users.push([f, m[0]]);
  }
  const uniq = new Set(users.map((u) => u[1]));
  check(
    "A23 引用该样式分块的每一页都是同一个哈希（改 CSS 后旧哈希会变孤儿）",
    uniq.size === 1 && users.length > 0,
    `pages=${users.length} hashes=${[...uniq].join(",")}`,
  );
}

// ================== [B] i18n 与设置 ==================
console.log("\n[B] i18n 与后台设置");

const usedKeys = [
  ...new Set(
    [...stripHtml.matchAll(/#\{(seriesStrip\.[A-Za-z0-9_.]+)/g)].map(
      (m) => m[1],
    ),
  ),
];
check(
  "B1 产物里引用了 seriesStrip.* 的键（≥5：title/navPrev/navNext/tabsAria/issue）",
  usedKeys.length >= 5,
  usedKeys.join(","),
);

const i18nFiles = [
  "default.properties",
  "zh_CN.properties",
  "zh_TW.properties",
];
const i18nText = Object.fromEntries(
  i18nFiles.map((f) => [f, read(path.join(themeRoot, "i18n", f))]),
);
for (const f of i18nFiles) {
  const missing = usedKeys.filter(
    (k) =>
      !new RegExp("^" + k.replace(/\./g, "\\.") + "=", "m").test(i18nText[f]),
  );
  check(`B2 ${f} 覆盖了全部键`, missing.length === 0, missing.join(","));
}
// zh_CN / zh_TW 必须是中文化文案（不能留英文占位）
check(
  "B3 zh_CN 的 seriesStrip.title 是中文",
  /^seriesStrip\.title=[^\x00-\x7F]/m.test(i18nText["zh_CN.properties"]),
);
check(
  "B3b zh_CN / zh_TW 都有 tabsAria 与 issue 键且是中文",
  ["zh_CN.properties", "zh_TW.properties"].every(
    (f) =>
      /^seriesStrip\.tabsAria=[^\x00-\x7F]/m.test(i18nText[f]) &&
      // ⚠️ issue 的值以 `{0}` 开头，不能只判「首个字符非 ASCII」
      /^seriesStrip\.issue=.*[^\x00-\x7F]/m.test(i18nText[f]),
  ),
);
check(
  "B3c issue 带 {0} 占位（Thymeleaf MessageFormat 才能吃到期号）",
  i18nFiles.every((f) => /^seriesStrip\.issue=.*\{0\}/m.test(i18nText[f])),
);
check(
  "B4 旧版死键已清理（countLabel / cardAria 不该再留在任何一份 properties 里）",
  i18nFiles.every(
    (f) =>
      !/^seriesStrip\.countLabel=/m.test(i18nText[f]) &&
      !/^seriesStrip\.cardAria=/m.test(i18nText[f]),
  ),
);

const settings = read(path.join(themeRoot, "settings.yaml"));
check(
  "B5 settings 的 postList 组含 seriesEnable 开关",
  /name:\s*seriesEnable/.test(settings),
);
check(
  "B6 settings 的 postList 组含 seriesCount 数字",
  /name:\s*seriesCount/.test(settings),
);
check(
  "B7 seriesCount 有 1..24 的约束与联动显隐",
  /min:\s*1/m.test(settings) &&
    /max:\s*24/m.test(settings) &&
    /if:\s*"\$get\(postList_seriesEnable\)\.value === true"/.test(settings),
);
check(
  "B8 postList 默认值里带上了新字段",
  /seriesEnable:\s*true/.test(settings) && /seriesCount:\s*4/.test(settings),
);
check(
  "B9 后台文案已改成「多系列切换」口径（不再是「一个系列一张卡」）",
  /label:\s*显示「系列」卡片条/.test(settings) &&
    /label:\s*系列数量（切换按钮）/.test(settings) &&
    settings.includes("在首页精选卡片上方显示系列卡"),
);

// settings 里声明了的字段，TypeScript 侧的 PostList 也必须声明 —— 否则模板里
// `theme.config?.layout?.postList?.seriesEnable` 在 astro check 下是隐式 any / 报错。
// （src/ 不进发布包，但它是「三处一致」的第三处，漏了会慢慢漂移。）
const cfgTypes = read(path.join(repoRoot, "src", "types", "config.ts"));
check(
  "B10 PostList 类型补齐 settings.yaml 已声明的字段（series / featured / homeMoments）",
  [
    "showHomeMoments",
    "homeMomentsCount",
    "featuredEnable",
    "featuredSource",
    "featuredRandom",
    "seriesEnable",
    "seriesCount",
  ].every((k) => new RegExp(`\\b${k}\\?:`).test(cfgTypes)),
  ["showHomeMoments", "seriesEnable", "seriesCount"]
    .filter((k) => !new RegExp(`\\b${k}\\?:`).test(cfgTypes))
    .join(","),
);

// ================== [C] 行为脚本 ==================
console.log("\n[C] 行为脚本（迷你 DOM 跑真产物 js）");

try {
  execFileSync(process.execPath, ["--check", target], { stdio: "pipe" });
  check("C1 产物 js 语法通过 node --check", true);
} catch (e) {
  check(
    "C1 产物 js 语法通过 node --check",
    false,
    String(e.message).slice(0, 120),
  );
}
check(
  "C1b 产物 js 不再写 data-series-at-end（1.5.37 判定为死属性：CSS/脚本/页面全仓无消费方）",
  !js.includes("data-series-at-end"),
);

/** 只支持本用例用到的选择器：tag / .class / #id / [attr] */
function match(el, sel) {
  return sel
    .trim()
    .split(/(?=[.#[])/)
    .filter(Boolean)
    .every((p) => {
      if (p.startsWith("#")) return el._attrs.id === p.slice(1);
      if (p.startsWith(".")) return el._cls.has(p.slice(1));
      if (p.startsWith("[")) return p.slice(1, -1) in el._attrs;
      return el.tagName === p.toUpperCase();
    });
}

function mkEl(tag, attrs = {}) {
  const el = {
    tagName: String(tag).toUpperCase(),
    parentNode: null,
    _attrs: { ...attrs },
    _children: [],
    _cls: new Set(
      String(attrs.class || "")
        .split(/\s+/)
        .filter(Boolean),
    ),
    dataset: {},
    _listeners: {},
    _focused: false,
    disabled: false,
    offsetLeft: 0,
    scrollLeft: 0,
    scrollWidth: 0,
    clientWidth: 0,
    scrollCalls: [],
    get className() {
      return [...el._cls].join(" ");
    },
    classList: {
      add: (...n) => n.forEach((x) => el._cls.add(x)),
      remove: (...n) => n.forEach((x) => el._cls.delete(x)),
      contains: (x) => el._cls.has(x),
    },
    getAttribute(k) {
      return k in el._attrs ? el._attrs[k] : null;
    },
    setAttribute(k, v) {
      el._attrs[k] = String(v);
    },
    removeAttribute(k) {
      delete el._attrs[k];
    },
    addEventListener(t, fn) {
      (el._listeners[t] = el._listeners[t] || []).push(fn);
    },
    dispatch(t, ev) {
      (el._listeners[t] || []).forEach((fn) => fn(ev || {}));
    },
    appendChild(c) {
      c.parentNode = el;
      el._children.push(c);
      return c;
    },
    // 1.5.36 起需要：桩件按生产结构把 tabs 插到 navs 之前（head > [title, tabs, navs]）
    insertBefore(c, ref) {
      const i = ref ? el._children.indexOf(ref) : -1;
      c.parentNode = el;
      if (i < 0) el._children.push(c);
      else el._children.splice(i, 0, c);
      return c;
    },
    contains(node) {
      return node === el || el._descend().includes(node);
    },
    closest(sel) {
      let n = el;
      while (n) {
        if (match(n, sel)) return n;
        n = n.parentNode;
      }
      return null;
    },
    focus() {
      el._focused = true;
    },
    getBoundingClientRect() {
      return { width: 200 };
    },
    scrollBy(opt) {
      el.scrollCalls.push(opt);
      el.scrollLeft += opt.left;
    },
    _descend(out = []) {
      el._children.forEach((c) => {
        out.push(c);
        c._descend(out);
      });
      return out;
    },
    querySelector(sel) {
      return el._descend().find((n) => match(n, sel)) || null;
    },
    querySelectorAll(sel) {
      return el._descend().filter((n) => match(n, sel));
    },
  };
  return el;
}

const CARD_W = 200;
const GAP = 12;
const STEP = CARD_W + GAP; // 212 —— 脚本步长 = cards[1].offsetLeft - cards[0].offsetLeft

/**
 * 造一个「首页 series-strip」桩。
 * @param cards 每个面板的卡片数数组（长度 = 系列数；1 个时按真实模板不渲染 tablist）
 * @param visible 可见卡片数（决定 viewport.clientWidth）
 */
function makeStrip({ cards, visible = 4 }) {
  const section = mkEl("section", {
    id: "series-strip",
    class: "series-strip onload-animation",
  });
  const head = mkEl("div", { class: "series-strip__head" });
  const navs = mkEl("div", {
    class: "series-strip__navs",
    "data-series-navs": "",
  });
  const prev = mkEl("button", {
    class: "series-strip__nav series-strip__nav--prev",
    "data-series-dir": "prev",
  });
  const next = mkEl("button", {
    class: "series-strip__nav series-strip__nav--next",
    "data-series-dir": "next",
  });
  navs.appendChild(prev);
  navs.appendChild(next);
  head.appendChild(navs);

  let tabsBox = null;
  const tabs = [];
  if (cards.length > 1) {
    tabsBox = mkEl("div", {
      class: "series-strip__tabs",
      "data-series-tabs": "",
      role: "tablist",
    });
    cards.forEach((_, i) => {
      const t = mkEl("button", {
        class: "series-strip__tab",
        role: "tab",
        "data-series-tab": String(i),
        "aria-selected": i === 0 ? "true" : "false",
        tabindex: i === 0 ? "0" : "-1",
      });
      tabs.push(t);
      tabsBox.appendChild(t);
    });
    // ⚠️ 1.5.36 起 tabs 并进 head 行（生产结构 head > [title, tabs, navs]）⇒ 桩件同步，
    //    否则桩件与生产 DOM 不同构，将来「DOM 顺序」类回归根本测不出来。
    head.insertBefore(tabsBox, navs);
  }
  section.appendChild(head);

  const panels = [];
  const viewports = [];
  const tracks = [];
  cards.forEach((count, i) => {
    const panel = mkEl("div", {
      class: "series-strip__panel" + (i === 0 ? "" : " is-hidden"),
      "data-series-panel": String(i),
      role: "tabpanel",
    });
    const vp = mkEl("div", {
      class: "series-strip__viewport",
      "data-series-viewport": "",
    });
    const track = mkEl("div", {
      class: "series-strip__track",
      "data-series-track": "",
    });
    for (let c = 0; c < count; c++) {
      const a = mkEl("a", {
        class: "series-strip-card",
        href: `/p${i}-${c}`,
      });
      a.offsetLeft = c * STEP;
      track.appendChild(a);
    }
    vp.appendChild(track);
    vp.scrollWidth = count * STEP;
    vp.clientWidth = visible * STEP;
    panel.appendChild(vp);
    section.appendChild(panel);
    panels.push(panel);
    viewports.push(vp);
    tracks.push(track);
  });

  return {
    section,
    navs,
    prev,
    next,
    tabsBox,
    tabs,
    panels,
    viewports,
    tracks,
    visible,
  };
}

function makeWindow({ reducedMotion = false } = {}) {
  const win = {
    _resize: [],
    addEventListener(t, fn) {
      if (t === "resize") win._resize.push(fn);
    },
    removeEventListener() {},
    matchMedia() {
      return { matches: reducedMotion };
    },
  };
  return win;
}

/** 在给定 window 桩里 eval 一次产物 js（不传 win 就新建一个） */
function runJs(strip, { win, reducedMotion = false } = {}) {
  const doc = {
    _sections: strip ? [strip.section] : [],
    querySelectorAll(sel) {
      return sel === "#series-strip" ? doc._sections : [];
    },
    querySelector(sel) {
      return doc.querySelectorAll(sel)[0] || null;
    },
  };
  const w = win || makeWindow({ reducedMotion });
  const fn = new Function("document", "window", js);
  fn(doc, w);
  return { doc, win: w };
}

const clipped = (p) => p._cls.has("is-hidden");
const sel = (t) => t.getAttribute("aria-selected");
const tix = (t) => t.getAttribute("tabindex");

// ---------- 主场景：2 个系列（6 / 7 篇），可见 4 ----------
{
  const strip = makeStrip({ cards: [6, 7], visible: 4 });
  const { win } = runJs(strip);

  check(
    "C2 首屏只显示第 0 个面板，其余 SSR/JSS 状态都是隐藏",
    !clipped(strip.panels[0]) && clipped(strip.panels[1]),
  );
  check(
    "C3 tab 初始态是 roving tabindex（首个 true/0，其余 false/-1）",
    sel(strip.tabs[0]) === "true" &&
      tix(strip.tabs[0]) === "0" &&
      sel(strip.tabs[1]) === "false" &&
      tix(strip.tabs[1]) === "-1",
  );
  check(
    "C4 初始停在左头 ⇒ ‹ 置灰、› 可用（不是整块隐藏）",
    strip.prev.disabled === true && strip.next.disabled === false,
  );

  // ---- 箭头步进 ----
  strip.next.dispatch("click");
  check(
    "C5 点 › 向右滚「一张卡」（step = 卡宽 + gap = 212px）",
    strip.viewports[0].scrollCalls.length === 1 &&
      strip.viewports[0].scrollCalls[0].left === STEP,
    JSON.stringify(strip.viewports[0].scrollCalls),
  );
  check(
    "C6 默认 behavior=smooth",
    strip.viewports[0].scrollCalls.every((c) => c.behavior === "smooth"),
  );
  strip.prev.dispatch("click");
  check(
    "C7 点 ‹ 向左滚一张卡",
    strip.viewports[0].scrollCalls.length === 2 &&
      strip.viewports[0].scrollCalls[1].left === -STEP,
  );

  // ---- 边界置灰 ----
  const vp0 = strip.viewports[0];
  vp0.scrollLeft = vp0.scrollWidth - vp0.clientWidth; // 6*212 - 4*212 = 424
  strip.section.dispatch("scroll", { target: vp0 });
  check(
    "C8 滚到右头 ⇒ › 置灰、‹ 恢复（scroll 事件复算）",
    strip.next.disabled === true && strip.prev.disabled === false,
  );
  vp0.scrollLeft = 0;
  strip.section.dispatch("scroll", { target: vp0 });
  check(
    "C9 滚回左头 ⇒ ‹ 置灰、› 恢复",
    strip.prev.disabled === true && strip.next.disabled === false,
  );

  // ---- 切换系列 ----
  strip.tabsBox.dispatch("click", { target: strip.tabs[1] });
  check(
    "C10 点第 2 个 tab ⇒ 面板切换（is-hidden 转移）",
    clipped(strip.panels[0]) && !clipped(strip.panels[1]),
  );
  check(
    "C11 切换后 tab 的 aria-selected / tabindex 同步",
    sel(strip.tabs[1]) === "true" &&
      tix(strip.tabs[1]) === "0" &&
      sel(strip.tabs[0]) === "false" &&
      tix(strip.tabs[0]) === "-1",
  );
  check(
    "C12 切换后新面板回到最左 + 箭头按新面板复算（7 篇 ⇒ › 可用）",
    strip.viewports[1].scrollLeft === 0 &&
      strip.prev.disabled === true &&
      strip.next.disabled === false,
  );
  check(
    "C12b 切换不动原面板的滚动位置（各面板独立记忆）",
    strip.viewports[0].scrollLeft === 0,
  );

  // ---- 只有当前面板的 scroll 才复算 ----
  strip.prev.disabled = true; // 哨兵：若被误复算会被改成 false
  strip.section.dispatch("scroll", { target: strip.viewports[0] });
  check("C13 非当前面板的 scroll 不影响箭头状态", strip.prev.disabled === true);

  // ---- 键盘导航（WAI-ARIA tabs roving tabindex） ----
  const noop = () => {};
  strip.tabsBox.dispatch("keydown", {
    key: "ArrowRight",
    preventDefault: noop,
  });
  check(
    "C14 → 键切到下一个 tab 并把焦点移过去（1 → 回绕 0）",
    !clipped(strip.panels[0]) && strip.tabs[0]._focused === true,
  );
  strip.tabsBox.dispatch("keydown", { key: "End", preventDefault: noop });
  check(
    "C15 End 跳到最后一个 tab",
    !clipped(strip.panels[1]) && strip.tabs[1]._focused === true,
  );
  strip.tabsBox.dispatch("keydown", { key: "ArrowLeft", preventDefault: noop });
  check(
    "C16 ← 键回到上一个 tab",
    !clipped(strip.panels[0]) && strip.tabs[0]._focused === true,
  );
  strip.tabsBox.dispatch("keydown", { key: "Home", preventDefault: noop });
  check(
    "C17 Home 跳回第一个 tab",
    !clipped(strip.panels[0]) && strip.tabs[0]._focused === true,
  );
  strip.tabsBox.dispatch("keydown", { key: "Enter", preventDefault: noop });
  check(
    "C18 非导航键不劫持（Enter 不该被 preventDefault，交给浏览器默认行为）",
    (() => {
      let prevented = false;
      strip.tabsBox.dispatch("keydown", {
        key: "Enter",
        preventDefault() {
          prevented = true;
        },
      });
      return prevented === false;
    })(),
  );

  // ---- 事件委托：点在 tab 内部子元素上也能切 ----
  const icon = mkEl("span", { class: "icon" });
  strip.tabs[1].appendChild(icon);
  strip.tabsBox.dispatch("click", { target: icon });
  check(
    "C19 点在 tab 内部子元素上也能切换（closest 事件委托）",
    !clipped(strip.panels[1]),
  );

  check(
    "C20 resize 监听只挂一次",
    win._resize.length === 1,
    String(win._resize.length),
  );

  // ---- 重复执行（Swup 换页克隆重执行）不应重复绑定 ----
  const before = strip.viewports[1].scrollCalls.length;
  runJs(strip, { win });
  check(
    "C21 重执行后元素上的幂等标记仍在（dataset.seriesBound=1）",
    strip.section.dataset.seriesBound === "1",
    JSON.stringify(strip.section.dataset),
  );
  strip.next.dispatch("click");
  check(
    "C21b 重执行后点击仍只滚一次（没叠出第二套监听）",
    strip.viewports[1].scrollCalls.length === before + 1,
    `${before} → ${strip.viewports[1].scrollCalls.length}`,
  );
  check(
    "C21c 重执行不会叠出第二个 resize 监听",
    win._resize.length === 1,
    String(win._resize.length),
  );
}

// ---------- 单系列：没有 tablist，箭头照常 ----------
{
  const strip = makeStrip({ cards: [6], visible: 4 });
  let threw = null;
  try {
    runJs(strip);
  } catch (e) {
    threw = e;
  }
  check(
    "C22 只有一个系列（无 tablist）时代码不抛",
    threw === null,
    threw && String(threw.message),
  );
  check(
    "C23 单系列下箭头状态照常计算（左头 ⇒ ‹ 置灰）",
    strip.prev.disabled === true && strip.next.disabled === false,
  );
  strip.next.dispatch("click");
  check(
    "C24 单系列下 › 步进仍是 212px",
    strip.viewports[0].scrollCalls.length === 1 &&
      strip.viewports[0].scrollCalls[0].left === STEP,
  );
}

// ---------- 装得下：两个箭头都置灰（而不是整块隐藏） ----------
{
  const strip = makeStrip({ cards: [3], visible: 4 });
  const { win } = runJs(strip);
  check(
    "C25 无溢出（3 卡 ≤ 可见 4）⇒ 两个箭头都置灰而非隐藏",
    strip.prev.disabled === true && strip.next.disabled === true,
  );
  // 变窄后重新出现溢出 ⇒ resize 复算应把 › 放开
  strip.viewports[0].clientWidth = 2 * STEP; // 636 > 424
  win._resize.forEach((fn) => fn());
  check(
    "C26 resize 后可见数变小 ⇒ › 重新可用（复算生效）",
    strip.next.disabled === false && strip.prev.disabled === true,
  );
}

// ---------- reduced-motion ----------
{
  const strip = makeStrip({ cards: [6], visible: 4 });
  runJs(strip, { reducedMotion: true });
  strip.next.dispatch("click");
  check(
    "C27 prefers-reduced-motion ⇒ behavior=auto（不跟用户偏好对着干）",
    strip.viewports[0].scrollCalls[0].behavior === "auto",
    JSON.stringify(strip.viewports[0].scrollCalls[0]),
  );
  check(
    "C27b reduced-motion 下点箭头后置灰状态立即复算（不等 scroll 事件）",
    strip.prev.disabled === false,
  );
}

// ---------- 页面没有系列条 ----------
{
  let threw = null;
  try {
    runJs(null);
  } catch (e) {
    threw = e;
  }
  check(
    "C28 页面上没有 #series-strip 时不抛异常",
    threw === null,
    threw && String(threw.message),
  );
}

console.log(
  `\n通过 ${pass} 项${fails.length ? `，失败 ${fails.length} 项：\n - ${fails.join("\n - ")}` : "，全部通过"}`,
);
process.exit(fails.length ? 1 : 0);

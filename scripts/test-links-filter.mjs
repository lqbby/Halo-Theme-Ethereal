// 友链页「就地筛选」桩测（jsdom 真执行内联/打包脚本）
//
// 目的：在不部署、不截图的前提下，证明 links 页的就地筛选（搜索框 + 分组胶囊）
// 在**真实渲染出的友链 DOM** 上行为正确：
//   - 初始：全部分组的卡片可见
//   - 点分组胶囊：只显示该分组，其他分组区整体隐藏（不跳转、不重载）
//   - 搜索：按「卡片全文 + 所属分组名」匹配，无结果显示空态块
//   - 组合：分组胶囊 + 搜索同时生效
//
// 桩来源：线上真实友链页 HTML（SITE，默认 https://www.lqbby.com/links）
//   —— 卡片是 SSR 渲染的，与主题产出结构一致，比手写 stub 更可信。
//   线上目前只有 1 个分组，脚本会**克隆**出一个第二分组，以覆盖跨分组筛选路径。
// 被测脚本：构建产物 public/assets/links.bundle.js（即包内 templates/assets/links.bundle.js）。
//
// 运行：
//   NODE_PATH="C:/Users/LQ/.workbuddy/binaries/node/workspace/node_modules" \
//   "C:/Users/LQ/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" scripts/test-links-filter.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
// jsdom 在 ESM + NODE_PATH 下 import 会 ERR_MODULE_NOT_FOUND，改用 createRequire
const { JSDOM } = require(process.env.JSDOM_MODULE || "jsdom");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = process.env.SITE || "https://www.lqbby.com/links";
const LOCAL_HTML = process.env.LINKS_HTML || "";
const BUNDLE = join(ROOT, "public/assets/links.bundle.js");

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "✅" : "❌"} ${name}：实得 ${JSON.stringify(actual)} / 应有 ${JSON.stringify(expected)}`,
  );
}

async function loadHtml() {
  if (LOCAL_HTML) return readFileSync(LOCAL_HTML, "utf8");
  const res = await fetch(SITE, {
    headers: { "User-Agent": "Mozilla/5.0 (links-filter-stub-test)" },
  });
  if (!res.ok) throw new Error(`fetch ${SITE} → HTTP ${res.status}`);
  return res.text();
}

// ── 把真实 SSR 页「改造」成新结构：加 id / data-link-section / 搜索框 / 胶囊 / 空态块。
//    真实页仍是旧版（无这些新元素），故在桩里手工补齐——补齐方式与 links.astro 的
//    SSR 输出逐字对齐（class 名、属性名、data 值哨兵 __all__）。
function prepare(dom, html) {
  const { document } = dom.window;
  const firstCard = document.querySelector("a[data-link-group]");
  if (!firstCard)
    throw new Error("桩页里找不到 a[data-link-group]（结构变了？）");
  const grid = firstCard.closest("div.space-y-8");
  if (!grid) throw new Error("桩页里找不到分区分组容器 div.space-y-8");
  grid.id = "links-grid";

  const sections = Array.from(grid.children).filter(
    (el) => el.tagName === "SECTION",
  );
  if (sections.length === 0) throw new Error("分组容器里没有 SECTION");

  const groupNames = [];
  for (const section of sections) {
    const card = section.querySelector("a[data-link-group]");
    const name = card.getAttribute("data-link-group");
    section.setAttribute("data-link-section", name);
    if (!groupNames.includes(name)) groupNames.push(name);
  }

  // 克隆第一组 → 第二个分组，覆盖「跨分组」路径（线上目前只有 1 组）
  const CLONE = "桩测试组";
  const clone = sections[0].cloneNode(true);
  clone.setAttribute("data-link-section", CLONE);
  for (const card of clone.querySelectorAll("a[data-link-group]")) {
    card.setAttribute("data-link-group", CLONE);
  }
  grid.appendChild(clone);
  groupNames.push(CLONE);

  // 搜索框 + 分组胶囊（与 links.astro SSR 结构一致）
  const block = document.createElement("div");
  block.className = "mb-6";
  block.innerHTML =
    '<div class="links-search mb-3">' +
    '<input id="links-search" type="text" class="links-search-input" placeholder="搜索友链..."/>' +
    "</div>" +
    '<div id="links-filter" class="flex flex-wrap gap-2">' +
    [null, ...groupNames]
      .map((name, i) => {
        const value = name === null ? "__all__" : name;
        const label = name === null ? "全部" : name;
        return `<button type="button" class="btn-card link-chip${
          i === 0 ? " is-active" : ""
        } h-9" data-link-group-filter="${value}" aria-pressed="${
          i === 0 ? "true" : "false"
        }">${label}</button>`;
      })
      .join("") +
    "</div>";
  grid.parentNode.insertBefore(block, grid);

  // 空态块（JS 控制显隐）
  const empty = document.createElement("div");
  empty.id = "links-empty";
  empty.className = "hidden py-12 text-center";
  empty.textContent = "找不到相关结果。";
  grid.parentNode.insertBefore(empty, grid.nextSibling);

  return { groupNames, CLONE };
}

function boot(dom) {
  const { window } = dom;
  window.eval(readFileSync(BUNDLE, "utf8"));
  // jsdom 构造完成后 readyState 通常已是 complete；兜底手动派发一次
  if (window.document.readyState === "loading") {
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  }
}

function visibleCards(dom) {
  const { document } = dom.window;
  return Array.from(document.querySelectorAll("a[data-link-group]")).filter(
    (a) => a.style.display !== "none",
  );
}
function visibleSections(dom) {
  const { document } = dom.window;
  return Array.from(document.querySelectorAll("[data-link-section]")).filter(
    (s) => s.style.display !== "none",
  );
}
function emptyHidden(dom) {
  return dom.window.document
    .getElementById("links-empty")
    .classList.contains("hidden");
}
function clickChip(dom, value) {
  const btn = dom.window.document.querySelector(
    `[data-link-group-filter="${value}"]`,
  );
  btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
}
function typeSearch(dom, text) {
  const input = dom.window.document.getElementById("links-search");
  input.value = text;
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

const html = await loadHtml();
const dom = new JSDOM(html, {
  runScripts: "outside-only",
  pretendToBeVisual: true,
});
const { groupNames, CLONE } = prepare(dom, html);
const FIRST = groupNames[0];
const allCards =
  dom.window.document.querySelectorAll("a[data-link-group]").length;
const perGroup = allCards / 2;

console.log(`桩页：${SITE}`);
console.log(
  `分组 = ${groupNames.join(" / ")}（克隆组 ${CLONE}）；卡片合计 ${allCards}（每组 ${perGroup}）\n`,
);

boot(dom);

// 1) 初始态：全部可见、无空态
check("初始·可见卡片", visibleCards(dom).length, allCards);
check("初始·可见分组区", visibleSections(dom).length, 2);
check("初始·空态隐藏", emptyHidden(dom), true);

// 2) 点第一个分组胶囊 → 只留该组
clickChip(dom, FIRST);
check(`点「${FIRST}」·可见卡片`, visibleCards(dom).length, perGroup);
check(`点「${FIRST}」·可见分组区`, visibleSections(dom).length, 1);
check(
  `点「${FIRST}」·可见区名正确`,
  visibleSections(dom)[0].getAttribute("data-link-section"),
  FIRST,
);

// 3) 换第二个分组
clickChip(dom, CLONE);
check(`点「${CLONE}」·可见卡片`, visibleCards(dom).length, perGroup);

// 4) 回到全部
clickChip(dom, "__all__");
check("回「全部」·可见卡片", visibleCards(dom).length, allCards);
check(
  "回「全部」·aria-pressed 正确",
  dom.window.document
    .querySelector('[data-link-group-filter="__all__"]')
    .getAttribute("aria-pressed"),
  "true",
);

// 5) 搜索：按分组名命中第二个分组（haystack 含分组名）
typeSearch(dom, CLONE);
check(`搜索「${CLONE}」·可见卡片`, visibleCards(dom).length, perGroup);

// 6) 搜索真实卡片名（从 DOM 动态取第一个卡片名）
const sampleName = dom.window.document
  .querySelector("a[data-link-group] .font-bold, a[data-link-group] div")
  .textContent.trim();
typeSearch(dom, sampleName.slice(0, 4));
check(
  `搜索真实卡片名「${sampleName.slice(0, 4)}」·可见卡片>0`,
  visibleCards(dom).length > 0,
  true,
);

// 7) 无结果 → 空态出现
typeSearch(dom, "zzz_绝不存在的关键词_qqq");
check("搜索无结果·可见卡片", visibleCards(dom).length, 0);
check("搜索无结果·可见分组区", visibleSections(dom).length, 0);
check("搜索无结果·空态显示", emptyHidden(dom), false);

// 8) 清空搜索 → 恢复
typeSearch(dom, "");
check("清空搜索·可见卡片", visibleCards(dom).length, allCards);

// 9) 组合：分组胶囊 + 搜索无结果
clickChip(dom, FIRST);
typeSearch(dom, "zzz_绝不存在的关键词_qqq");
check("组合（分组+无结果）·可见卡片", visibleCards(dom).length, 0);
check("组合（分组+无结果）·空态显示", emptyHidden(dom), false);

console.log(
  failures === 0
    ? "\n✔ 友链就地筛选桩测全部通过"
    : `\n✖ 有 ${failures} 项未通过`,
);
process.exit(failures === 0 ? 0 : 1);

// 项目集页「就地筛选（纯客户端）」桩测（jsdom 真执行打包脚本）
//
// 被测：public/assets/portfolio-filter.js（= 包内 templates/assets/portfolio-filter.js），
//       源码 src/scripts/assets/portfolio-filter.ts。
//
// 桩 DOM 按 portfolio.astro / PortfolioCard.astro 的 SSR 契约手写：
//   #pf-filter [data-pf-dim][data-pf-value] / #pf-active-tag [data-pf-tag-text]
//   #pf-page / #pf-featured / #pf-all / #pf-all-head / #pf-all-count / #pf-empty / #pf-empty-clear
//   [data-list-item] + [data-pf-platform] [data-pf-type] + 隐藏 [data-pf-tag]
//
// 断言：初始读 ?tag= 深链、平台/类型胶囊切换 + 再点取消、标签 ✕ 清除、
//       推荐区隐藏、计数联动、空态与「查看全部」显隐、aria-pressed。
//
// 运行：
//   NODE_PATH="C:/Users/LQ/.workbuddy/binaries/node/workspace/node_modules" \
//   "C:/Users/LQ/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" scripts/test-portfolio-filter.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.JSDOM_MODULE || "jsdom");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(ROOT, "public/assets/portfolio-filter.js");
const URL_WITH_TAG = "https://example.test/portfolio?tag=Tech";

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "✅" : "❌"} ${name}：实得 ${JSON.stringify(actual)} / 应有 ${JSON.stringify(expected)}`,
  );
}

// 卡片：platform / type / 标签（标签用隐藏节点，tags 与 techStacks 合集）
function card(platform, type, tags) {
  const tagNodes = tags
    .map((t) => `<span data-pf-tag="1" class="hidden">${t}</span>`)
    .join("");
  return `<article data-list-item="1" data-pf-platform="${platform}" data-pf-type="${type}">${tagNodes}</article>`;
}

function pill(dim, value, label, active) {
  return `<button type="button" class="btn-card pf-chip${
    active ? " is-active" : ""
  }" data-pf-dim="${dim}" data-pf-value="${value}" aria-pressed="${
    active ? "true" : "false"
  }">${label}</button>`;
}

const HTML = `<!doctype html><html><body>
  <div id="pf-filter">
    <div class="row-platform">
      ${pill("platform", "__all__", "全部平台", true)}
      ${pill("platform", "web", "Web", false)}
      ${pill("platform", "app", "App", false)}
    </div>
    <div class="row-type">
      ${pill("type", "__all__", "全部类型", true)}
      ${pill("type", "tool", "工具", false)}
      ${pill("type", "lib", "库", false)}
    </div>
  </div>
  <div id="pf-active-tag" class="pf-active" hidden>
    <span class="pf-active__label">标签筛选</span>
    <button type="button" class="pf-active__chip"><span data-pf-tag-text="1">Tech</span></button>
  </div>
  <div id="pf-page" class="pf-page">
    <div id="pf-featured">
      <h2 class="pf-sec">推荐项目</h2>
      <div class="pf-grid">${card("web", "tool", ["Tech"])}</div>
    </div>
    <div id="pf-all">
      <h2 id="pf-all-head" class="pf-sec">全部项目<span id="pf-all-count" class="pf-sec__count">3</span></h2>
      <div class="pf-grid">
        ${card("web", "tool", ["Tech", "Astro"])}
        ${card("web", "tool", ["Vue"])}
        ${card("app", "tool", ["Tech"])}
      </div>
    </div>
    <div id="pf-empty" class="pf-empty" hidden>
      <p>暂无项目</p>
      <a id="pf-empty-clear" href="/portfolio" class="pf-empty__link" hidden>查看全部</a>
    </div>
  </div>
</body></html>`;

const dom = new JSDOM(HTML, { url: URL_WITH_TAG, runScripts: "outside-only" });
const { window } = dom;
window.eval(readFileSync(BUNDLE, "utf8"));
if (window.document.readyState === "loading") {
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
}
const doc = window.document;

const allCards = () =>
  Array.from(doc.querySelectorAll("#pf-all [data-list-item]"));
const visibleIdx = () =>
  allCards()
    .map((el, i) => (el.style.display === "none" ? -1 : i))
    .filter((i) => i >= 0);
const countText = () => doc.getElementById("pf-all-count").textContent;
const clickPill = (dim, value) => {
  const btn = doc.querySelector(
    `[data-pf-dim="${dim}"][data-pf-value="${value}"]`,
  );
  if (!btn) throw new Error(`找不到胶囊 ${dim}=${value}`);
  btn.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true, cancelable: true }),
  );
};
const clickTagChip = () => {
  doc
    .querySelector("#pf-active-tag .pf-active__chip")
    .dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
};
const isHidden = (id) => doc.getElementById(id).hidden === true;
const pressed = (dim, value) =>
  doc
    .querySelector(`[data-pf-dim="${dim}"][data-pf-value="${value}"]`)
    .getAttribute("aria-pressed");

// 1) 初始化读 ?tag=Tech 深链：命中 card0/card2，推荐区隐藏，标签 chip 显示
check("初始·可见卡片序号", visibleIdx().join(","), "0,2");
check("初始·全部区计数", countText(), "2");
check("初始·推荐区隐藏", isHidden("pf-featured"), true);
check("初始·标签 chip 显示", isHidden("pf-active-tag"), false);
check(
  "初始·标签 chip 文案",
  doc.querySelector("[data-pf-tag-text]").textContent,
  "Tech",
);
check(
  "初始·全部区标题贴顶（pf-sec--first）",
  doc.getElementById("pf-all-head").classList.contains("pf-sec--first"),
  true,
);
check("初始·空态隐藏", isHidden("pf-empty"), true);

// 2) 叠加平台 web → 只剩 card0（web + Tech）
clickPill("platform", "web");
check("叠平台 web·可见卡片序号", visibleIdx().join(","), "0");
check("叠平台 web·计数", countText(), "1");
check("叠平台 web·胶囊 aria-pressed", pressed("platform", "web"), "true");
check("叠平台 web·「全部平台」已取消", pressed("platform", "__all__"), "false");

// 3) 再点同一个平台胶囊 → 取消除该维度（仍保留 tag=Tech）
clickPill("platform", "web");
check("再点取消平台·可见卡片序号", visibleIdx().join(","), "0,2");
check("再点取消平台·计数", countText(), "2");
check("再点取消平台·「全部平台」恢复", pressed("platform", "__all__"), "true");

// 4) 点「全部平台」哨兵 → 与取消等价
clickPill("platform", "app");
clickPill("platform", "app"); // 先取消回来
clickPill("platform", "__all__");
check("点「全部平台」哨兵·计数", countText(), "2");

// 5) 清除标签 chip → 无筛选，全部 3 张可见，推荐区恢复，chip 隐藏
clickTagChip();
check("清标签·可见卡片序号", visibleIdx().join(","), "0,1,2");
check("清标签·计数", countText(), "3");
check("清标签·推荐区恢复", isHidden("pf-featured"), false);
check("清标签·标签 chip 隐藏", isHidden("pf-active-tag"), true);
check("清标签·空态仍隐藏", isHidden("pf-empty"), true);
check("清标签·「查看全部」仍隐藏", isHidden("pf-empty-clear"), true);
check(
  "清标签·全部区标题去掉贴顶",
  doc.getElementById("pf-all-head").classList.contains("pf-sec--first"),
  false,
);

// 6) 叠加两个维度：app + tool → card2
clickPill("platform", "app");
clickPill("type", "tool");
check("app+tool·可见卡片序号", visibleIdx().join(","), "2");
check("app+tool·计数", countText(), "1");

// 7) 选到一个没有项目的类型 lib → 0 结果：空态 + 「查看全部」出现
clickPill("type", "lib");
check("lib·可见卡片数", visibleIdx().length, 0);
check("lib·计数 0", countText(), "0");
check("lib·空态显示", isHidden("pf-empty"), false);
check("lib·「查看全部」显示", isHidden("pf-empty-clear"), false);

// 8) 点空态里的「查看全部」之外——直接清回去，验证入场类挂上
clickPill("type", "__all__");
clickPill("platform", "__all__");
check("清回全部·可见卡片数", visibleIdx().length, 3);
check(
  "清回全部·可见卡片挂 list-item-enter（入场反馈）",
  allCards().filter((el) => el.classList.contains("list-item-enter")).length,
  3,
);

console.log(failures === 0 ? "\n全部通过 ✅" : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);

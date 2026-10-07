// 文章正文内容增强（L2 交互层）：代码块复制+语言标签、标题锚点、表格横滚。
// 与 vditor-mde 的关系：vditor-mde 服务端已把 markdown 渲染成 HTML（#content 里
// 是 <pre><code class="language-xxx">、<li class="vditor-task">、<table> 等），前端
// render.js 只做特殊图表（math/mermaid/mindmap）与自定义组件（git/drive/gallery）增强。
// 本模块只扫描「服务端已产出」的标准结构做轻量交互增强，不移动 code 节点（避免
// 干扰 vditor 前端高亮时序），代码高亮前后都能安全运行。
import { copyText } from "./clipboard";

/**
 * 从 code 的 className 提取语言标识（高亮前后 language-xxx 都在）。
 */
function langOf(code: HTMLElement): string {
  const m = code.className.match(/language-([\w+-]+)/);
  return m ? m[1] : "";
}

/**
 * 代码块：注入语言标签（CSS attr 渲染）+ 右上角复制按钮。
 * 语言标签用 pre[data-lang]::before 由 CSS 读取，避免 JS 拼接标签文本。
 * 复制按钮为绝对定位子元素，不改变 code 节点位置，兼容 vditor hljs 高亮。
 */
function enhanceCodeBlocks(root: Element) {
  root.querySelectorAll<HTMLElement>("pre").forEach((pre) => {
    if (pre.dataset.codeEnhanced) return;
    const code = pre.querySelector<HTMLElement>("code[class*='language-']");
    if (!code) return;
    const lang = langOf(code);
    if (!lang) return;

    pre.dataset.codeEnhanced = "1";
    pre.dataset.lang = lang;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "code-copy-btn";
    btn.setAttribute("aria-label", "复制代码");
    btn.title = "复制代码";
    btn.innerHTML =
      '<span class="code-copy-icon"></span><span class="code-copy-label">复制</span>';
    btn.addEventListener("click", () => {
      void copyText(code.textContent || "").then((ok) => {
        if (!ok) return;
        btn.classList.add("copied");
        const label = btn.querySelector(".code-copy-label");
        if (label) label.textContent = "已复制";
        window.setTimeout(() => {
          btn.classList.remove("copied");
          if (label) label.textContent = "复制";
        }, 1500);
      });
    });
    pre.appendChild(btn);
  });
}

/**
 * 表格：包一层 .md-table-scroll 容器实现移动端横向滚动。
 * （table 本身无 wrapper 时 overflow 不生效，见 markdown.css 注释。）
 * 不触碰 table 内部结构，只把 table 包进一个 div。
 */
function enhanceTables(root: Element) {
  root.querySelectorAll<HTMLElement>("table").forEach((table) => {
    if (table.dataset.tableEnhanced) return;
    const parent = table.parentElement;
    if (!parent) return;
    table.dataset.tableEnhanced = "1";
    const wrapper = document.createElement("div");
    wrapper.className = "md-table-scroll";
    table.replaceWith(wrapper);
    wrapper.appendChild(table);
  });
}

/**
 * 标题：注入 # 锚点链接，hover 标题时显示，点击原生跳转到对应锚点。
 * Lute 已给每个标题生成 id（<h2 id="xxx">），直接复用。
 */
function enhanceHeadings(root: Element) {
  root.querySelectorAll<HTMLElement>("h2[id], h3[id]").forEach((heading) => {
    if (heading.dataset.headingEnhanced) return;
    // 短代码 callout 内的 h3 是分节标题，稍后被 renderShortcodes 替换为组件，不注入锚点
    // （否则 h3.textContent 会多出 "#" 干扰 parseSections 的标题提取）
    if (heading.closest(".callout[data-subtype^='ethereal-']")) return;
    heading.dataset.headingEnhanced = "1";
    const anchor = document.createElement("a");
    anchor.className = "heading-anchor";
    anchor.href = `#${heading.id}`;
    anchor.setAttribute("aria-label", "锚点链接");
    anchor.textContent = "#";
    heading.appendChild(anchor);
  });
}

/**
 * 内容增强入口：扫描 .custom-md 正文做 L2 交互增强 + L3 短代码渲染。
 * 幂等：给 .custom-md 打 data-content-enhanced 标记，Swup 换页后新节点会重新执行。
 * 首刷由 app.ts 挂 DOMContentLoaded（晚于 post.astro 的 processAndInsert 克隆正文），
 * Swup 换页由 page:view hook 调用。
 */
export function initContentEnhance() {
  const root = document.querySelector<HTMLElement>(".custom-md");
  if (!root || root.dataset.contentEnhanced) return;
  root.dataset.contentEnhanced = "1";

  enhanceCodeBlocks(root);
  enhanceTables(root);
  enhanceHeadings(root);

  // L3 短代码：动态 import，避免非短代码页面加载解析逻辑。
  import("./shortcode").then(({ renderShortcodes }) => {
    renderShortcodes(root);
  });
}

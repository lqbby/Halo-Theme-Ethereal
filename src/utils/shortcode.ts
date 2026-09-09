// 文章正文短代码（转译复用 content-widgets 插件）：
// markdown 写 > [!ethereal-xxx]，Lute 服务端渲染成
// <div class="callout" data-subtype="ethereal-xxx">，内容走正常 markdown 渲染（富文本）。
// 本模块把 callout 转译成 <xhhao-com-*> 标签，再调插件 mount 渲染组件。
//
// 设计（2026-09-08，转译复用插件）：
//  - 7 种高频块级组件用 callout 语法（markdown 友好，向后兼容已有文章），
//    转译成插件标签，渲染与样式全部交给插件；
//  - 其余 19 种组件（note/result/card-list/compare/copy/command-group +
//     badge/key/status/blur/annotation/tip/emoji-clock/reading-time/button）
//    直接写 <xhhao-com-*> 标签即可——Lute 对自定义标签原样保留，插件直接渲染，
//    无需主题转译。
//
// 语法约定（callout 内用 ### 分节，每节 = 标题 + 富文本正文）：
//   tab       每节「### 标签名」，正文为该页内容
//   collapse  每节「### 标题」，正文为折叠体（转译成 xhhao-com-folding）
//   timeline  每节「### 时间 | 标题」，正文为描述
//   steps     每节「### 标题」，序号自动递增
//   progress  每节「### 百分比 | 标签」
//   chat      每节「### [self|system]名字」，正文为气泡内容
//   columns   每节「### 列标题」，正文为该栏内容

interface Section {
  title: string;
  body: HTMLElement;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c];
  });
}

/** 创建 xhhao-com 标签（attrs + innerHTML） */
function xtag(
  tag: string,
  attrs: Record<string, string> = {},
  innerHTML = "",
): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (innerHTML) e.innerHTML = innerHTML;
  return e;
}

/**
 * 从 callout 的 .callout-content 里按 <h3> 分节：每个 h3 是一个 Section，
 * 标题 = h3 文本，正文 = 到下一个 h3 之间的节点（克隆，保留富文本结构）。
 */
function parseSections(callout: HTMLElement): Section[] {
  const content = callout.querySelector<HTMLElement>(".callout-content");
  if (!content) return [];
  const sections: Section[] = [];
  let current: Section | null = null;
  Array.from(content.childNodes).forEach((node) => {
    const isH3 =
      node.nodeType === Node.ELEMENT_NODE &&
      (node as HTMLElement).tagName === "H3";
    if (isH3) {
      current = {
        title: ((node as HTMLElement).textContent || "").trim(),
        body: document.createElement("div"),
      };
      sections.push(current);
    } else if (current) {
      if (node.nodeType === Node.TEXT_NODE && !(node.textContent || "").trim())
        return;
      current.body.appendChild(node.cloneNode(true));
    }
  });
  return sections;
}

// ---------- 7 种转译函数：Section[] → xhhao-com 标签 ----------

function xTab(sections: Section[]): HTMLElement {
  const root = xtag("xhhao-com-tab", {
    tabs: sections.map((s) => s.title).join(","),
    active: "1",
  });
  sections.forEach((s) => {
    root.appendChild(xtag("xhhao-com-tab-panel", {}, s.body.innerHTML));
  });
  return root;
}

function xFolding(sections: Section[]): HTMLElement {
  const wrap = document.createElement("div");
  sections.forEach((s) => {
    wrap.appendChild(
      xtag("xhhao-com-folding", { title: s.title }, s.body.innerHTML),
    );
  });
  return wrap;
}

function xTimeline(sections: Section[]): HTMLElement {
  const root = xtag("xhhao-com-timeline");
  sections.forEach((s) => {
    const sep = s.title.indexOf("|");
    const time = sep >= 0 ? s.title.slice(0, sep).trim() : "";
    const title = sep >= 0 ? s.title.slice(sep + 1).trim() : "";
    let inner = "";
    if (title) inner += `<p><strong>${escapeHtml(title)}</strong></p>`;
    inner += s.body.innerHTML;
    root.appendChild(xtag("xhhao-com-timeline-item", { time }, inner));
  });
  return root;
}

function xStepper(sections: Section[]): HTMLElement {
  const root = xtag("xhhao-com-stepper");
  sections.forEach((s) => {
    root.appendChild(
      xtag("xhhao-com-step", { title: s.title }, s.body.innerHTML),
    );
  });
  return root;
}

function xProgress(sections: Section[]): HTMLElement {
  const wrap = document.createElement("div");
  sections.forEach((s) => {
    const sep = s.title.indexOf("|");
    const pctStr = sep >= 0 ? s.title.slice(0, sep).trim() : s.title;
    const label = sep >= 0 ? s.title.slice(sep + 1).trim() : "";
    const pct = Math.min(100, Math.max(0, parseInt(pctStr, 10) || 0));
    wrap.appendChild(
      xtag("xhhao-com-progress", {
        value: String(pct),
        max: "100",
        ...(label ? { label } : {}),
      }),
    );
  });
  return wrap;
}

function xChat(sections: Section[]): HTMLElement {
  const root = xtag("xhhao-com-chat");
  sections.forEach((s) => {
    let name = s.title;
    const attrs: Record<string, string> = {};
    if (/^\[self\]/i.test(name)) {
      attrs.self = "";
      name = name.replace(/^\[self\]/i, "").trim();
    } else if (/^\[system\]/i.test(name)) {
      attrs.system = "";
      name = name.replace(/^\[system\]/i, "").trim();
    }
    if (name) attrs.name = name;
    root.appendChild(xtag("xhhao-com-chat-item", attrs, s.body.innerHTML));
  });
  return root;
}

function xSplit(sections: Section[]): HTMLElement {
  const root = xtag("xhhao-com-split", {
    cols: String(sections.length),
    gap: "1rem",
  });
  sections.forEach((s) => {
    let inner = "";
    if (s.title) inner += `<p><strong>${escapeHtml(s.title)}</strong></p>`;
    inner += s.body.innerHTML;
    root.appendChild(xtag("div", {}, inner));
  });
  return root;
}

const TRANSLATORS: Record<string, (sections: Section[]) => HTMLElement> = {
  tab: xTab,
  collapse: xFolding,
  timeline: xTimeline,
  steps: xStepper,
  progress: xProgress,
  chat: xChat,
  columns: xSplit,
};

/** 调用插件 mount（幂等，已挂载的带 data-xhhao-com-mounted 标记会跳过） */
function mountWidgets(root: Element) {
  const w = (
    window as unknown as {
      XhhaoComContentWidgets?: { mount?: (r?: Element) => void };
    }
  ).XhhaoComContentWidgets;
  if (w && typeof w.mount === "function") {
    w.mount(root);
  }
}

/**
 * 扫描 .custom-md 内的 > [!ethereal-*] callout 块，转译成 xhhao-com 标签，
 * 再调插件 mount 渲染。
 */
export function renderShortcodes(root: Element) {
  let translated = false;
  root
    .querySelectorAll<HTMLElement>(".callout[data-subtype^='ethereal-']")
    .forEach((callout) => {
      const type = (callout.dataset.subtype || "").replace(/^ethereal-/, "");
      const translator = TRANSLATORS[type];
      if (!translator) return;
      const sections = parseSections(callout);
      if (!sections.length) return;
      callout.replaceWith(translator(sections));
      translated = true;
    });
  if (translated) mountWidgets(root);
}

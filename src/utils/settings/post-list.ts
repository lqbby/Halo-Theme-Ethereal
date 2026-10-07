import {
  getVisitorSwitches,
  carrierBool,
  carrierStr,
} from "./visitor-switches";

export type PostListLayoutMode = "list" | "grid";

/* ── 文章布局（列表/网格） ── */

/**
 * 服务端默认布局（后台 theme.config.layout.postList.defaultMode）。
 *
 * 必须走 ConfigCarrier，**不能**读 `#post-list-container` 的类或
 * data-server-layout：显示设置面板是 `client:only` 岛，在 parse 到 body
 * 后段的 PostList 之前就完成初始化（实测面板 t≈99ms 取值时 Container
 * 尚未入 DOM，t≈176ms 才有），此时读容器会一律落到 "list" 兜底，
 * 导致「站点默认就是网格」却被判成偏离默认、还原按钮常显。
 * ConfigCarrier 是 body 首元素，面板取值时已就位。
 */
export function getDefaultPostListLayout(): PostListLayoutMode {
  return carrierStr("layoutDefault", "list") === "grid" ? "grid" : "list";
}

// 出场动画期间暂存的待应用动作：快速连点布局/瀑布流时不再丢弃，
// 出场结束后按序一并应用（同一操作的多次切换以最后一次为准）
let pendingLayoutActions: Array<() => void> = [];

/** 完整的内容区出场→入场过渡：切换列表/网格或瀑布流时，
 *  1) 给 #content-wrapper 挂 content-exit-animating 播旧内容淡出下滑动画；
 *  2) 出场结束后按序应用所有待执行动作（首个动作入队在前、出场期间新到达的
 *     追加在后，保证后点的最后一次切换生效）；
 *  3) 再挂 content-entrance-animating 重放与页面入场同款的 fade-in-up 动画
 *     （含 --content-delay 错峰），入场结束摘除类。
 *  入场用独立类而非 onload-animation：后者会被 app.ts 的 animationend 委托
 *  在同一事件里立即移除（出场动画结束的事件冒泡到 document 时新类已挂上），
 *  导致入场无法播放。 */
function triggerContentTransition(afterExit: () => void): void {
  const content = document.getElementById("content-wrapper");
  if (!content) return;
  // 出场动画进行中：追加待执行动作，出场结束后一并应用（不丢操作）
  if (content.classList.contains("content-exit-animating")) {
    pendingLayoutActions.push(afterExit);
    return;
  }
  // 新一段过渡开始：清掉可能因中途换页残留的旧动作（旧元素的 animationend
  // 不会触发，避免把上一次的布局动作误应用到新页面），并把首个动作入队——
  // 这样出场期间新到的动作追加在后，出场结束时按序执行、最后一次切换生效
  pendingLayoutActions = [];
  pendingLayoutActions.push(afterExit);
  content.classList.remove("content-entrance-animating");
  void content.offsetWidth;
  content.classList.add("content-exit-animating");
  // animationend 会冒泡：内容卡片（.onload-animation，fade-in-up）的 animationend
  // 会冒泡到 #content-wrapper，若不校验 e.target 会被子元素提前触发、腰斩真实退场
  // 动画。注意不能用 { once: true }——一旦被子元素冒泡「消耗」，自身事件将永不被
  // 捕获、content-exit-animating 永久残留，故改为显式 removeEventListener。
  const onExitEnd = (e: AnimationEvent) => {
    if (e.target !== content) return;
    content.removeEventListener("animationend", onExitEnd);
    content.classList.remove("content-exit-animating");
    const actions = pendingLayoutActions;
    pendingLayoutActions = [];
    actions.forEach((a) => a());
    void content.offsetWidth;
    content.classList.add("content-entrance-animating");
    const onEnterEnd = (ev: AnimationEvent) => {
      if (ev.target !== content) return;
      content.removeEventListener("animationend", onEnterEnd);
      content.classList.remove("content-entrance-animating");
    };
    content.addEventListener("animationend", onEnterEnd);
  };
  content.addEventListener("animationend", onExitEnd);
}

export function getStoredPostListLayout(): PostListLayoutMode | null {
  if (!getVisitorSwitches().postListLayout) return null;
  const stored = localStorage.getItem("postListLayout");
  return stored === "list" || stored === "grid" ? stored : null;
}

export function applyPostListLayout(mode: PostListLayoutMode): void {
  const container = document.getElementById("post-list-container");
  if (!container) return;
  // 过渡进行中：交给队列按序应用（此时容器仍是旧态，不能按容器判断「已相同」，
  // 否则快速连点回旧布局会被误判为无需切换而丢操作）
  const transitioning = document
    .getElementById("content-wrapper")
    ?.classList.contains("content-exit-animating");
  if (!transitioning) {
    const isGridNow = container.classList.contains("post-grid-mode");
    if ((mode === "grid") === isGridNow) return; // 已是目标布局，无需切换
  }
  triggerContentTransition(() => {
    container.classList.toggle("post-grid-mode", mode === "grid");
    container.classList.toggle("post-list-mode", mode === "list");
    // 布局类变化后触发瀑布流重排/复位（post-list-layout.js 暴露的入口）
    (window as any).__postListRelayout?.();
  });
}

export function setPostListLayout(mode: PostListLayoutMode): void {
  localStorage.setItem("postListLayout", mode);
  applyPostListLayout(mode);
}

/* ── 瀑布流（仅网格布局下生效） ── */

export function getDefaultPostListMasonry(): boolean {
  return carrierBool("masonryDefault", false);
}

export function getStoredPostListMasonry(): boolean {
  if (!getVisitorSwitches().cardStyle) return getDefaultPostListMasonry();
  const stored = localStorage.getItem("postListMasonry");
  return stored == null ? getDefaultPostListMasonry() : stored === "true";
}

/** 应用瀑布流：data-masonry 是瀑布流脚本的启用依据，换值后触发重排/复位 */
export function applyPostListMasonry(enabled: boolean): void {
  const container = document.getElementById("post-list-container");
  if (!container) return;
  // 过渡进行中：交给队列按序应用（同理，容器仍是旧态，不能按容器短路）
  const transitioning = document
    .getElementById("content-wrapper")
    ?.classList.contains("content-exit-animating");
  if (!transitioning) {
    const masonryNow = container.getAttribute("data-masonry") !== "false";
    if (masonryNow === enabled) return; // 已是目标状态，无需切换
  }
  triggerContentTransition(() => {
    container.setAttribute("data-masonry", enabled ? "true" : "false");
    // 瀑布流启用/关闭后触发重排/复位（post-list-layout.js 暴露的入口）
    (window as any).__postListRelayout?.();
  });
}

export function setPostListMasonry(enabled: boolean): void {
  localStorage.setItem("postListMasonry", String(enabled));
  applyPostListMasonry(enabled);
}

/* ── 分区恢复默认 ── */

/** 清掉访客覆盖后回到服务端默认布局。默认值取自 ConfigCarrier
 *  （不依赖容器是否已入 DOM；data-server-layout 仅作兜底）。
 *  已是默认布局时 applyPostListLayout 内部会跳过，无需在此重复判断 */
export function resetPostListLayout(): void {
  localStorage.removeItem("postListLayout");
  const container = document.getElementById("post-list-container");
  const server = container?.dataset.serverLayout;
  const target =
    server === "grid" || server === "list"
      ? server
      : getDefaultPostListLayout();
  applyPostListLayout(target);
}

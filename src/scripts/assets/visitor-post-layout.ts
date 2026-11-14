// @ts-nocheck —— legacy 手写脚本迁入源码目录（保持 ES5 原样，不做类型改造）
import { getVisitorSwitches } from "../../utils/settings/visitor-switches";

// localStorage 安全访问：隐私模式/禁存储下 getItem/removeItem 会抛 SecurityError
// （如 Safari 无痕），裸调会让访客布局覆盖脚本中断（布局开关静默失效）。
function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {}
}
// 访客文章布局覆盖（显示设置面板「列表/网格」切换）
// 同步脚本（无 defer/async）：在 PostList 容器解析后立即执行，首帧绘制前完成换类；
// Swup 换页后由 SwupScriptsPlugin 重执行（同 post-list-layout.js / collapse.js）。
// 执行顺序约定：必须先于 post-list-layout.js（PostList.astro 中标签顺序保证），
// 使瀑布流初始化直接读取覆盖后的布局类。
(function () {
  var container = document.getElementById("post-list-container");
  if (!container) return;

  // 记录服务端渲染的初始布局，供面板「恢复默认」还原；
  // 已记录则跳过（防止同容器重复执行时把覆盖后的类误当默认值）
  if (!container.dataset.serverLayout) {
    container.dataset.serverLayout = container.classList.contains(
      "post-grid-mode",
    )
      ? "grid"
      : "list";
  }

  // 开关关闭（或总开关关闭）时忽略并清理访客选择，与 fixed 色调语义一致。
  // 改用设置模块的 getVisitorSwitches() 单一真相源，消除与 setting-utils 的抄写重复。
  if (!getVisitorSwitches().appearance) {
    storageRemove("postListLayout");
    return;
  }

  if (!getVisitorSwitches().appearance) {
    storageRemove("postListMasonry");
    return;
  }

  var masonry = storageGet("postListMasonry");
  var masonryChanged = false;
  if (
    (masonry === "true" || masonry === "false") &&
    container.getAttribute("data-masonry") !== masonry
  ) {
    container.setAttribute("data-masonry", masonry);
    masonryChanged = true;
  }

  var mode = storageGet("postListLayout");
  var layoutChanged = false;
  if (
    (mode === "list" || mode === "grid") &&
    mode !== container.dataset.serverLayout
  ) {
    container.classList.toggle("post-grid-mode", mode === "grid");
    container.classList.toggle("post-list-mode", mode === "list");
    layoutChanged = true;
  }

  // 布局类或瀑布流属性变化后触发瀑布流重排/复位（post-list-layout.js 暴露的入口，
  // 首载时其尚未执行、由它自己的 init 读取已覆盖的类与 data-masonry）
  if (
    (layoutChanged || masonryChanged) &&
    typeof window.__postListRelayout === "function"
  ) {
    window.__postListRelayout();
  }
})();

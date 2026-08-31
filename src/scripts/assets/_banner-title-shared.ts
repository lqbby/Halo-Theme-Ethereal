// @ts-nocheck —— banner 标题效果共享工具（banner-typewriter / banner-drop 共用）
// _ 前缀共享模块不产独立 js，由 esbuild 内联进引用它的脚本（同 _theme-config.ts）。
// 提取自两脚本逐字重复的初始化骨架：取元素 → 「文字隐藏」判定 → 销毁旧实例
// → 读 #banner-subtitles-data 文案 → 建新实例。两脚本的差异点（打字机的
// 清空文本 + 光标重挂）通过 onElementReady 回调插在销毁之后、读文案之前，
// 保证与原内联版的执行顺序完全一致。

// 副标题被「文字隐藏」开关挡住时不初始化（两脚本判定逐字相同）
export function isBannerTextHidden(el) {
  var overlay = el.closest("#banner-overlay");
  return !!(overlay && overlay.classList.contains("banner-text-hidden"));
}

// 读取 #banner-subtitles-data 的多行文案（去首尾空白、滤空行）；无数据返回 null
export function readBannerSubtitleLines() {
  var dc = document.getElementById("banner-subtitles-data");
  if (!dc) return null;
  var raw = dc.textContent.trim();
  if (!raw) return null;
  var lines = raw
    .split("\n")
    .map(function (l) {
      return l.trim();
    })
    .filter(Boolean);
  return lines.length === 0 ? null : lines;
}

// 初始化骨架。
// instanceKey：实例在元素上的字段名（__twInstance / __dropInstance）；
// createEffect(el, lines)：构造效果实例；
// onElementReady(el)：可选，脚本专属处理，在销毁旧实例之后、读文案之前调用。
export function initBannerSubtitle(instanceKey, createEffect, onElementReady) {
  var el = document.getElementById("banner-subtitle");
  if (!el) return;
  if (isBannerTextHidden(el)) return;
  if (el[instanceKey]) {
    el[instanceKey].destroy();
    delete el[instanceKey];
  }
  if (onElementReady) onElementReady(el);
  var lines = readBannerSubtitleLines();
  if (!lines) return;
  el[instanceKey] = createEffect(el, lines);
}

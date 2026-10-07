/**
 * #5：复制到剪贴板 —— 全站唯一实现。
 *
 * 此前 4 处各自重写（post-share.ts / links.bundle.js / external-link-redirect.ts /
 * gallery-info-panel.ts），且只有 post-share 带了 execCommand 兜底：其余三处在
 * 无 Clipboard API（非安全上下文 http、旧浏览器）或权限被拒时静默失败，用户点了没反应。
 * 统一后所有调用点自动获得兜底路径。
 *
 * 返回 Promise<boolean> 表示**是否真的复制成功**，由调用方决定 UI 反馈——
 * 不再出现「明明失败却显示已复制」的假成功。
 */
export function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => legacyCopy(text),
    );
  }
  return Promise.resolve(legacyCopy(text));
}

/**
 * execCommand 兜底：Clipboard API 不可用/被拒时仍可复制。
 * 返回 execCommand 的真实结果；DOM 清理放 finally，避免异常时残留隐藏 textarea。
 */
function legacyCopy(text: string): boolean {
  let ok = false;
  let ta: HTMLTextAreaElement | null = null;
  try {
    ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
  }
  return ok;
}

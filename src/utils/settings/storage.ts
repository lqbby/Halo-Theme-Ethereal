/* ── localStorage 安全访问 ─────────────────────────────────────
 * 隐私模式 / 禁用存储时 localStorage 的 getItem/setItem/removeItem 会抛
 * SecurityError（如 Safari 无痕），裸调会中断显示设置面板的初始化。
 * 统一在此兜底：读不到按「未存」处理；写/删失败静默忽略（仅本次会话
 * 不持久化）。与经典脚本侧各自的 storageGet 语义一致。
 * 本模块无模块级副作用，可被经典脚本安全导入（同 visitor-switches 的约定）。 */
export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 存储不可用：静默忽略 */
  }
}

export function storageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 存储不可用：静默忽略 */
  }
}

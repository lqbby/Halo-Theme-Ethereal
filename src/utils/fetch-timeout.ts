/**
 * 带超时的 fetch —— 「接口挂住」不能变成「页面永久 loading / 按钮永久 disabled」。
 *
 * 为什么必须统一走这里（bug-hunter 第 13 轮，全族回扫）：
 *   浏览器/反代都有「连接建了但永不返回」的形态（代理黑洞、CF 回源挂住、容器被 pause）。
 *   裸 `fetch()` 在这种情况下**永不 settle** ⇒ 挂在它后面的 `.catch`/`.finally` 永不执行：
 *     · 表单提交按钮停在「发布中…」且 `disabled` 永不复位（wishes 的 submit/polish 就是这种）；
 *     · 小组件停在「加载中」占位、拉取失败提示永远不出现。
 *   本仓既有范式是 `list-filter.ts` 里的 `FETCH_TIMEOUT = 10000` + AbortController，
 *   这里把它抽成共享工具，新代码一律用它。
 *
 * 语义：
 *   · 超时 = `AbortController.abort()` ⇒ fetch 以 `AbortError` reject
 *     ⇒ 调用方**既有**的 `.catch()` 分支会正常接管（无需另加分支）。
 *   · `timeoutMs` 缺省 10000（与 list-filter 同量级）；传 0/负数表示不超时。
 *   · ⚠️ 会覆盖 `init.signal`：需要外部取消能力的调用方不要用本函数（目前无此调用方）。
 */
export const FETCH_TIMEOUT_MS = 10000;

export function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const base: RequestInit = Object.assign({}, init || {});
  if (!(timeoutMs > 0) || typeof AbortController !== "function") {
    return fetch(input, base);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, timeoutMs);
  base.signal = ctrl.signal;
  return fetch(input, base).finally(() => {
    clearTimeout(timer);
  });
}

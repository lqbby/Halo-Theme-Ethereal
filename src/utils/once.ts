// ethereal 主题 —— 「每个 key 只跑一次」守卫的唯一真相源。
// 替代散落在各脚本的 `if (window.__xBound) return; window.__xBound = true;`
// 样板（A 类：Swup page:view 钩子注册；B 类：泛型 DOM 初始化）。
// 状态存于共享全局，故可跨 Swup 换页、跨多个 IIFE 产物副本去重。

type OnceState = Record<string, true>;

function state(): OnceState {
  const w = window as unknown as { __etherealOnce?: OnceState };
  if (!w.__etherealOnce) w.__etherealOnce = {};
  return w.__etherealOnce;
}

/** 整个页面生命周期内，`fn` 按 `key` 至多执行一次。
 *  可安全重复调用（如每次 Swup 换页），只有首个匹配 `key` 的调用会执行 `fn`。 */
export function onceBound(key: string, fn: () => void): void {
  const s = state();
  if (s[key]) return;
  s[key] = true;
  fn();
}

type SwupLike = {
  hooks?: {
    on: (event: string, handler: () => void, opts?: { once?: boolean }) => void;
  };
};

function getSwup(): SwupLike | undefined {
  return (window as unknown as { swup?: SwupLike }).swup;
}

/** 在 Swup 的 `page:view` 钩子上注册 `handler`，按 `key` 只注册一次，
 *  无论 SwupScriptsPlugin 把本片段（重）执行多少次。
 *  若 Swup 尚未就绪，则等待 `swup:enable` 事件。
 *  注意：handler 本身在「每次」换页仍会触发 —— 去重的只是「注册」动作。 */
export function onPageView(key: string, handler: () => void): void {
  onceBound("swup:page-view:" + key, () => {
    const swup = getSwup();
    if (swup && swup.hooks) {
      swup.hooks.on("page:view", handler);
    } else {
      document.addEventListener("swup:enable", function () {
        const s = getSwup();
        if (s && s.hooks) s.hooks.on("page:view", handler);
      });
    }
  });
}

/** 在非 `page:view` 的 Swup 钩子上注册 `handler`（如 `visit:end`）。
 *  与 onPageView 不同：此处「不做」注册去重——调用方应自带幂等语义
 *  （如 Swup 的 `{ once: true }` 选项，handler 触发一次后即解绑），
 *  因为某些钩子需要在每次换页脚本重执行时重新注册一次性处理器。
 *  若 Swup 尚未就绪，则等待 `swup:enable` 事件触发一次注册。 */
export function onSwupHook(
  hook: string,
  _key: string,
  handler: () => void,
  opts?: { once?: boolean },
): void {
  const reg = () => {
    const swup = getSwup();
    if (swup && swup.hooks) swup.hooks.on(hook, handler, opts);
  };
  const swup = getSwup();
  if (swup && swup.hooks) {
    reg();
  } else {
    document.addEventListener("swup:enable", reg, { once: true });
  }
}

/** 等价于 `if (!window.__xBound) return; window.__xBound = true;`，
 *  但状态统一到共享全局 `window.__etherealOnce`。
 *  返回 true 表示 `key` 已绑定（调用方应跳过）；返回 false 表示首次绑定。
 *  用于「每 key 只初始化一次」的 DOM / 监听器守卫（B 类）。 */
export function guardOnce(key: string): boolean {
  const s = state();
  if (s[key]) return true;
  s[key] = true;
  return false;
}

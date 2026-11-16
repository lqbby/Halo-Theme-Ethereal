import { getVisitorSwitches, carrierStr } from "./visitor-switches";
import { storageGet, storageRemove, storageSet } from "./storage";

/* ── 导航栏滚动行为（访客可覆盖后台默认值） ───────────────────────
 * 后台 select（菜单栏设置 → 导航栏滚动行为）定默认值，是唯一事实来源；
 * 老 navbarFixed 开关已彻底移除，不再兼容兜底（缺失时默认 auto_hide）。
 * 访客在显示设置面板「外观 → 导航栏」切换后写入 localStorage；
 * VisitorStyleBoot.astro 首帧把生效值换算进 html[data-navbar-fixed]，
 * navbar-collapse.ts 只读该属性的 "true"/"false"（true=always 永不收拢，
 * false=auto_hide 下滚收菜单胶囊）。
 * 取值与后台 select 的 auto_hide / always 对齐。 */

export type NavbarScrollMode = "auto_hide" | "always";

const MODES: NavbarScrollMode[] = ["auto_hide", "always"];

function normalize(value: string | null | undefined): NavbarScrollMode | null {
  return value != null && (MODES as string[]).indexOf(value) !== -1
    ? (value as NavbarScrollMode)
    : null;
}

export function getDefaultNavbarScroll(): NavbarScrollMode {
  return (
    normalize(carrierStr("navbarScrollDefault", "auto_hide")) ?? "auto_hide"
  );
}

export function getStoredNavbarScroll(): NavbarScrollMode {
  if (!getVisitorSwitches().appearance) return getDefaultNavbarScroll();
  const stored = normalize(storageGet("navbarScroll"));
  return stored ?? getDefaultNavbarScroll();
}

/** 写入访客偏好并立即换算进 html[data-navbar-fixed]；切换时无条件清两处
 *  残留——#navbar-wrapper 的 navbar-hidden 与 body 的 dynamic-navbar-hidden：
 *  下滚隐藏态切「始终展开」时 scroll-manager 提前 return，此后不再维护这两类；
 *  不清则侧边栏/TOC 停在无导航栏基准被固定导航栏遮住，直到重载或切回
 *  auto_hide 再滚动（B2）。切回 auto_hide 时同理先清，导航栏立即重现，
 *  此后按滚动方向重新判断。
 *  切换后派发 navbarBehaviorChange（rainzt 同名事件）：navbar-collapse.ts
 *  监听后复位收拢态（always 去收拢、切回 auto_hide 按当前滚动位置重算）。 */
export function setNavbarScroll(mode: NavbarScrollMode): void {
  storageSet("navbarScroll", mode);
  document.documentElement.dataset.navbarFixed =
    mode === "always" ? "true" : "false";
  document
    .getElementById("navbar-wrapper")
    ?.classList.remove("navbar-hidden");
  document.body.classList.remove("dynamic-navbar-hidden");
  window.dispatchEvent(new CustomEvent("navbarBehaviorChange"));
}

/** 清除访客偏好并恢复后台默认值。 */
export function resetNavbarScroll(): void {
  storageRemove("navbarScroll");
  setNavbarScroll(getDefaultNavbarScroll());
}

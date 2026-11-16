import { getVisitorSwitches, carrierStr } from "./visitor-switches";
import { storageGet, storageRemove, storageSet } from "./storage";

/* ── 导航栏滚动行为（访客可覆盖后台默认值） ───────────────────────
 * 后台 select（菜单栏设置 → 导航栏滚动行为）定默认值；老 navbarFixed 开关
 * 的兼容兜底在 ConfigCarrier data-navbar-scroll-default 与 Layout.astro
 * th:data-navbar-fixed 的 SpEL 里（新字段为空时沿用旧值）。
 * 访客在显示设置面板「外观 → 导航栏」切换后写入 localStorage；
 * VisitorStyleBoot.astro 首帧把生效值换算进 html[data-navbar-fixed]，
 * scroll-manager / scrollDownToContent 只读该属性的 "true"/"false"。
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

/** 写入访客偏好并立即换算进 html[data-navbar-fixed]；切回滚动收缩时
 *  顺带清除可能残留的 navbar-hidden（导航栏立即重新出现，此后按滚动方向判断）。 */
export function setNavbarScroll(mode: NavbarScrollMode): void {
  storageSet("navbarScroll", mode);
  document.documentElement.dataset.navbarFixed =
    mode === "always" ? "true" : "false";
  if (mode === "auto_hide") {
    document
      .getElementById("navbar-wrapper")
      ?.classList.remove("navbar-hidden");
  }
}

/** 清除访客偏好并恢复后台默认值。 */
export function resetNavbarScroll(): void {
  storageRemove("navbarScroll");
  setNavbarScroll(getDefaultNavbarScroll());
}

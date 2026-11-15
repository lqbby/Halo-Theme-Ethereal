import { getVisitorSwitches, carrierBool } from "./visitor-switches";
import { storageGet, storageRemove, storageSet } from "./storage";
import { applyPostListMasonry, getDefaultPostListMasonry } from "./post-list";

/* ── 卡片样式（悬浮效果 / 高级材质） ── */

export function getDefaultCardHoverLift(): boolean {
  return carrierBool("cardHoverLift", true);
}

export function getDefaultNavbarBlur(): boolean {
  return carrierBool("navbarBlur", false);
}

export function getStoredNavbarBlur(): boolean {
  if (!getVisitorSwitches().appearance) return getDefaultNavbarBlur();
  const stored = storageGet("navbarBlur");
  return stored == null ? getDefaultNavbarBlur() : stored === "true";
}

export function setNavbarBlur(enabled: boolean): void {
  storageSet("navbarBlur", String(enabled));
  document.body.classList.toggle("navbar-blur-enabled", enabled);
}

/* ── 宽屏布局（魔改：访客可覆盖后台 mods.pageWidth） ── */

// 后台默认值受总开关与 pageWidth 逐项门控（与 Layout.astro 服务端类挂载同源）。
// 注意：ConfigCarrier 暴露的属性是 data-page-wide-default（dataset.pageWideDefault），
// 此前误写成 carrierBool("pageWide") 永远命中 fallback=true，导致前端「宽屏布局」
// 开关不随后台 mods.pageWidth 联动（后台关掉、前端仍默认开）。
export function getDefaultPageWide(): boolean {
  return carrierBool("pageWideDefault", true);
}

// 独立存储：UI 放在「卡片样式」区显示，但存储与生命周期不与 card_hover_lift/navbar_blur
// 联动（cardStyle 后台关闭仅隐藏开关，pageWide 已存偏好仍生效）
export function getStoredPageWide(): boolean {
  const stored = storageGet("pageWide");
  return stored == null ? getDefaultPageWide() : stored === "true";
}

export function setPageWide(enabled: boolean): void {
  storageSet("pageWide", String(enabled));
  // 与服务端 th:classappend 同类名 mods-page-wide（挂在 <html>）
  document.documentElement.classList.toggle("mods-page-wide", enabled);
}

export function resetPageWide(): void {
  storageRemove("pageWide");
  setPageWide(getDefaultPageWide());
}

/* ── 卡片纹理（魔改：访客可覆盖后台 mods.cardPattern 的细纹理背景） ── */

// 后台默认值受总开关与 cardPattern 门控（与 Layout.astro 服务端类挂载同源）。
export function getDefaultCardPattern(): boolean {
  return carrierBool("cardPatternDefault", true);
}

// 独立存储：访客可覆盖后台 mods.cardPattern；存储生命周期与卡片样式区联动
// （cardStyle 后台关闭时隐藏开关，但已存偏好仍由首帧脚本生效，同 pageWide）。
export function getStoredCardPattern(): boolean {
  if (!getVisitorSwitches().appearance) return getDefaultCardPattern();
  const stored = storageGet("cardPattern");
  return stored == null ? getDefaultCardPattern() : stored === "true";
}

export function setCardPattern(enabled: boolean): void {
  storageSet("cardPattern", String(enabled));
  // 与服务端 th:classappend 同类名 mods-card-pattern（挂在 <html>）
  document.documentElement.classList.toggle("mods-card-pattern", enabled);
}

export function resetCardPattern(): void {
  storageRemove("cardPattern");
  setCardPattern(getDefaultCardPattern());
}

/* ── 卡片外壳（魔改：1px 主色描边 + 外侧暗晕的全站开关） ── */

// 后台默认值受总开关与 cardShell 门控（与 Layout.astro 服务端类挂载同源）。
// ConfigCarrier 暴露的是 data-card-shell-default（dataset.cardShellDefault）。
export function getDefaultCardShell(): boolean {
  return carrierBool("cardShellDefault", false);
}

// 独立存储：访客可覆盖后台 mods.cardShell；存储生命周期与卡片样式区联动
// （cardStyle 后台关闭时隐藏开关，但已存偏好仍由首帧脚本生效，同 pageWide）。
export function getStoredCardShell(): boolean {
  if (!getVisitorSwitches().appearance) return getDefaultCardShell();
  const stored = storageGet("cardShell");
  return stored == null ? getDefaultCardShell() : stored === "true";
}

export function setCardShell(enabled: boolean): void {
  storageSet("cardShell", String(enabled));
  // 与服务端 th:classappend 同类名 mods-card-shell（挂在 <html>）
  document.documentElement.classList.toggle("mods-card-shell", enabled);
}

export function resetCardShell(): void {
  storageRemove("cardShell");
  setCardShell(getDefaultCardShell());
}

/* ── 分区恢复默认 ── */

export function resetCardStyle(): void {
  storageRemove("cardHoverLift");
  storageRemove("navbarBlur");
  storageRemove("postListMasonry");
  storageRemove("cardShell");
  document.body.classList.toggle(
    "card-hover-lift-enabled",
    getDefaultCardHoverLift(),
  );
  document.body.classList.toggle("navbar-blur-enabled", getDefaultNavbarBlur());
  // 卡片外壳是挂在 <html> 的作用域类（同 cardPattern），恢复默认即回后台值
  document.documentElement.classList.toggle(
    "mods-card-shell",
    getDefaultCardShell(),
  );
  // 瀑布流默认值已生效时 applyPostListMasonry 内部会跳过
  applyPostListMasonry(getDefaultPostListMasonry());
}

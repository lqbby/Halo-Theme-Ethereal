import { getVisitorSwitches, carrierBool } from "./visitor-switches";
import { applyPostListMasonry, getDefaultPostListMasonry } from "./post-list";

/* ── 卡片样式（悬浮效果 / 高级材质） ── */

export function getDefaultCardHoverLift(): boolean {
  return carrierBool("cardHoverLift", true);
}

export function getDefaultNavbarBlur(): boolean {
  return carrierBool("navbarBlur", false);
}

export function getStoredCardHoverLift(): boolean {
  if (!getVisitorSwitches().cardStyle) return getDefaultCardHoverLift();
  const stored = localStorage.getItem("cardHoverLift");
  return stored == null ? getDefaultCardHoverLift() : stored === "true";
}

export function getStoredNavbarBlur(): boolean {
  if (!getVisitorSwitches().cardStyle) return getDefaultNavbarBlur();
  const stored = localStorage.getItem("navbarBlur");
  return stored == null ? getDefaultNavbarBlur() : stored === "true";
}

export function setCardHoverLift(enabled: boolean): void {
  localStorage.setItem("cardHoverLift", String(enabled));
  document.body.classList.toggle("card-hover-lift-enabled", enabled);
}

export function setNavbarBlur(enabled: boolean): void {
  localStorage.setItem("navbarBlur", String(enabled));
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
  const stored = localStorage.getItem("pageWide");
  return stored == null ? getDefaultPageWide() : stored === "true";
}

export function setPageWide(enabled: boolean): void {
  localStorage.setItem("pageWide", String(enabled));
  // 与服务端 th:classappend 同类名 mods-page-wide（挂在 <html>）
  document.documentElement.classList.toggle("mods-page-wide", enabled);
}

export function resetPageWide(): void {
  localStorage.removeItem("pageWide");
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
  if (!getVisitorSwitches().cardStyle) return getDefaultCardPattern();
  const stored = localStorage.getItem("cardPattern");
  return stored == null ? getDefaultCardPattern() : stored === "true";
}

export function setCardPattern(enabled: boolean): void {
  localStorage.setItem("cardPattern", String(enabled));
  // 与服务端 th:classappend 同类名 mods-card-pattern（挂在 <html>）
  document.documentElement.classList.toggle("mods-card-pattern", enabled);
}

export function resetCardPattern(): void {
  localStorage.removeItem("cardPattern");
  setCardPattern(getDefaultCardPattern());
}

/* ── 分区恢复默认 ── */

export function resetCardStyle(): void {
  localStorage.removeItem("cardHoverLift");
  localStorage.removeItem("navbarBlur");
  localStorage.removeItem("postListMasonry");
  document.body.classList.toggle(
    "card-hover-lift-enabled",
    getDefaultCardHoverLift(),
  );
  document.body.classList.toggle("navbar-blur-enabled", getDefaultNavbarBlur());
  // 瀑布流默认值已生效时 applyPostListMasonry 内部会跳过
  applyPostListMasonry(getDefaultPostListMasonry());
}

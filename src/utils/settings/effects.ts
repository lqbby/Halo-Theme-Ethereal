/* ── 樱花特效（显示设置面板 + 后台默认值） ─────────────────────
 * 与 sakura.js（源码 src/scripts/assets/sakura.ts）同一套开关语义：
 *   · 后台「样式开关 → 樱花特效」= 全站默认值（ConfigCarrier data-sakura-default）
 *   · 访客在显示设置面板切换 ⇒ localStorage 键 `sakuraEnabled` 覆盖默认值
 *   · 总开关（visitorStyle.enable）关闭时忽略 localStorage、跟随全局默认
 * `applySakura` 派发 `sakuraToggle` 事件，由 sakura.js 实时启停绘制循环。
 *
 * 本模块无模块级副作用，可被经典脚本安全导入（同 visitor-switches 的约定）。
 */
import { carrierBool, getVisitorSwitches } from "./visitor-switches";

/** 后台「样式开关 → 樱花特效」（缺省 false = 关闭） */
export function getDefaultSakuraEnabled(): boolean {
  return carrierBool("sakuraDefault", false);
}

/** 当前生效值：可切换时 localStorage 覆盖默认，否则跟随默认 */
export function getStoredSakuraEnabled(): boolean {
  if (!getVisitorSwitches().effects) return getDefaultSakuraEnabled();
  const stored = localStorage.getItem("sakuraEnabled");
  return stored == null ? getDefaultSakuraEnabled() : stored === "true";
}

/** 应用开关：派发 sakuraToggle，由 /assets/sakura.js 实时启停 */
export function applySakura(enabled: boolean): void {
  window.dispatchEvent(
    new CustomEvent("sakuraToggle", { detail: { enabled } }),
  );
}

export function setSakuraEnabled(enabled: boolean): void {
  localStorage.setItem("sakuraEnabled", String(enabled));
  applySakura(enabled);
}

/** 恢复默认：清掉 localStorage 覆盖，交回全局默认（与 sakura.js 的忽略语义一致） */
export function resetSakura(): void {
  localStorage.removeItem("sakuraEnabled");
  applySakura(getDefaultSakuraEnabled());
}

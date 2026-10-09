/* ── 访客样式切换（显示设置面板） ─────────────────────────────
 * 这是「访客样式开关」的唯一真相源（seam）：后台 theme.config → ConfigCarrier
 * data 属性 → 本模块读取并缓存为 VisitorSwitches。其余模块（post-list /
 * card-style / wallpaper）与首帧脚本统一消费 getVisitorSwitches()，避免
 * 在多处重写 `enable && visitorX` 门控（改键名需多处处同步的问题见 visitor-post-layout）。
 *
 * 本文件无任何模块级副作用（不含 matchMedia 监听），可被经典脚本
 * （src/scripts/assets/visitor-post-layout.ts）安全导入而不会重复注册主题监听。
 */

export interface VisitorSwitches {
  enable: boolean;
  /** 外观页（色相 + 文章布局 + 卡片样式） */
  appearance: boolean;
  /** 壁纸页（壁纸模式 + 壁纸设置 + 透明设置） */
  wallpaper: boolean;
  /** 特效页（樱花等） */
  effects: boolean;
  /** 全屏布局（全屏模式下的经典 / 沉浸 Hero） */
  fullscreenLayout: boolean;
}

export function getCarrier(): HTMLElement | null {
  return document.getElementById("config-carrier");
}

/** ConfigCarrier 布尔属性缺省视为 true（与模板 `!= false` 语义一致） */
export function carrierBool(name: string, fallback: boolean): boolean {
  const raw = getCarrier()?.dataset?.[name];
  if (raw == null || raw === "") return fallback;
  return raw === "true";
}

/** ConfigCarrier 字符串属性缺省返回 fallback（与模板 `#strings.defaultString` 语义一致） */
export function carrierStr(name: string, fallback: string): string {
  const raw = getCarrier()?.dataset?.[name];
  return raw == null || raw === "" ? fallback : raw;
}

let cachedVisitorSwitches: VisitorSwitches | null = null;

function readVisitorSwitches(): VisitorSwitches {
  const enable = carrierBool("visitorEnable", true);
  return {
    enable,
    appearance: enable && carrierBool("visitorAppearance", true),
    wallpaper: enable && carrierBool("visitorWallpaper", true),
    fullscreenLayout: enable && carrierBool("visitorFullscreenLayout", true),
    effects: enable && carrierBool("visitorEffects", true),
  };
}

/** 访客开关结果缓存：ConfigCarrier 的 data 属性是服务端静态值、运行期不变，
 *  避免每个 getStored* 内部重复调用时各做多次 getElementById */
export function getVisitorSwitches(): VisitorSwitches {
  if (!cachedVisitorSwitches) cachedVisitorSwitches = readVisitorSwitches();
  return cachedVisitorSwitches;
}

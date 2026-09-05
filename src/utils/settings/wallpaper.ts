import {
  bannerExtendVh,
  calcBannerHeightExtend,
  stableViewportHeight,
} from "../../constants/constants.ts";
import {
  getVisitorSwitches,
  getCarrier,
  carrierBool,
} from "./visitor-switches";

/* ── 壁纸参数（全屏透明模式） ── */

export interface WallpaperParams {
  opacity: number;
  blur: number;
  cardAlpha: number;
}

/** 解析数值配置：空值/非法值回退到 fallback */
function parseNum(raw: string | undefined, fallback: number): number {
  const n = Number.parseFloat(raw ?? "");
  return Number.isFinite(n) ? n : fallback;
}

export function getDefaultWallpaperParams(): WallpaperParams {
  const d = getCarrier()?.dataset ?? {};
  return {
    opacity: parseNum(d.wallpaperOpacity, 0.8),
    blur: parseNum(d.wallpaperBlur, 10),
    cardAlpha: parseNum(d.wallpaperCardAlpha, 0.6),
  };
}

export function getStoredWallpaperParams(): WallpaperParams {
  const defaults = getDefaultWallpaperParams();
  if (!getVisitorSwitches().transparent) return defaults;
  return {
    opacity: parseNum(
      localStorage.getItem("wallpaperOpacity") ?? undefined,
      defaults.opacity,
    ),
    blur: parseNum(
      localStorage.getItem("wallpaperBlur") ?? undefined,
      defaults.blur,
    ),
    cardAlpha: parseNum(
      localStorage.getItem("wallpaperCardAlpha") ?? undefined,
      defaults.cardAlpha,
    ),
  };
}

export function applyWallpaperParams(params: WallpaperParams): void {
  const body = document.body;
  if (!body) return;
  body.style.setProperty(
    "--transparent-wallpaper-opacity",
    String(params.opacity),
  );
  body.style.setProperty("--transparent-wallpaper-blur", `${params.blur}px`);
  body.style.setProperty("--transparent-card-alpha", String(params.cardAlpha));
}

export function setWallpaperParam(
  key: "wallpaperOpacity" | "wallpaperBlur" | "wallpaperCardAlpha",
  value: number,
): void {
  localStorage.setItem(key, String(value));
  applyWallpaperParams(getStoredWallpaperParams());
}

/* ── 壁纸模式（关闭/横幅/全屏/全屏透明） ── */

export type BannerDisplayMode =
  "disabled" | "banner" | "fullscreen" | "transparent";

const BANNER_DISPLAY_MODES: BannerDisplayMode[] = [
  "disabled",
  "banner",
  "fullscreen",
  "transparent",
];

function isBannerDisplayMode(value: unknown): value is BannerDisplayMode {
  return (
    typeof value === "string" &&
    (BANNER_DISPLAY_MODES as string[]).includes(value)
  );
}

export function getDefaultBannerDisplay(): BannerDisplayMode {
  const raw = getCarrier()?.dataset?.bannerDisplayDefault;
  return isBannerDisplayMode(raw) ? raw : "banner";
}

export function getStoredBannerDisplay(): BannerDisplayMode {
  if (!getVisitorSwitches().wallpaperMode) return getDefaultBannerDisplay();
  const stored = localStorage.getItem("bannerDisplay");
  return isBannerDisplayMode(stored) ? stored : getDefaultBannerDisplay();
}

/** 按目标模式重算 --banner-height-extend px（全屏 65vh / 横幅 30vh），与
 *  constants.ts 的 calcBannerHeightExtend 同式（head 内联脚本亦如此，数值
 *  来源 constants.ts，勿硬编码）。disabled/transparent 模式不使用延伸量
 *  （横幅隐藏 / 固定定位覆写），按横幅值写入即可 */
function applyBannerExtend(mode: BannerDisplayMode): void {
  // 用稳定视口高度（移动端 = svh 实测值）而非 window.innerHeight：访客可能在
  // 页面已滚动（地址栏收起）时切换模式，用 innerHeight 会算出偏大的延伸量，
  // 与 CSS 侧 svh 几何脱节，波浪与 banner 底边错位
  const offset = calcBannerHeightExtend(
    stableViewportHeight(),
    bannerExtendVh(mode === "fullscreen"),
  );
  document.documentElement.style.setProperty(
    "--banner-height-extend",
    `${offset}px`,
  );
}

/** 应用壁纸模式：写 html[data-banner-display] + 切 body.enable-banner +
 *  重算延伸像素；切换时临时加 html.banner-mode-transitioning 启用平滑过渡
 *  （components.css 中同名规则），并派发 bannerModeChange 事件供外部监听 */
export function applyBannerDisplay(mode: BannerDisplayMode): void {
  const root = document.documentElement;
  const body = document.body;
  const enableBanner = mode === "banner" || mode === "fullscreen";

  // 过渡：先加类并强制重排建立「from」态（旧值 + 已启用的过渡），再改值
  root.classList.add("banner-mode-transitioning");
  void root.offsetWidth;
  root.setAttribute("data-banner-display", mode);
  applyBannerExtend(mode);
  body.classList.toggle("enable-banner", enableBanner);

  const dur =
    parseFloat(getComputedStyle(root).getPropertyValue("--dur-banner")) || 700;
  window.setTimeout(
    () => root.classList.remove("banner-mode-transitioning"),
    dur + 100,
  );

  window.dispatchEvent(new CustomEvent("bannerModeChange", { detail: mode }));
}

export function setBannerDisplay(mode: BannerDisplayMode): void {
  localStorage.setItem("bannerDisplay", mode);
  applyBannerDisplay(mode);
}

/* ── 波浪（横幅底部动效） ── */

export function getDefaultWave(): boolean {
  return carrierBool("waveDefault", true);
}

export function getStoredWave(): boolean {
  if (!getVisitorSwitches().wallpaperSettings) return getDefaultWave();
  const stored = localStorage.getItem("bannerWave");
  return stored == null ? getDefaultWave() : stored === "true";
}

/** 应用波浪开关：关闭时给 body 加 wave-disabled（CSS 隐藏容器）；
 *  开启时移除，由后台默认档位决定显示。desktop_only 档位的移动端隐藏是
 *  纯 CSS（@media(pointer:coarse) + #wave-container[data-wave-mode]），
 *  无运行时脚本（1.3.37 起 wave.ts 已删除） */
export function applyWave(enabled: boolean): void {
  document.body.classList.toggle("wave-disabled", !enabled);
}

export function setWave(enabled: boolean): void {
  localStorage.setItem("bannerWave", String(enabled));
  applyWave(enabled);
}

/* ── 首页壁纸标题（banner 标题层显隐，随壁纸设置区开关联动） ── */

export function getDefaultBannerTitle(): boolean {
  return carrierBool("bannerTitleDefault", true);
}

export function getStoredBannerTitle(): boolean {
  if (!getVisitorSwitches().wallpaperSettings) return getDefaultBannerTitle();
  const stored = localStorage.getItem("bannerTitle");
  return stored == null ? getDefaultBannerTitle() : stored === "true";
}

/** 应用首页壁纸标题：关闭时 opacity 渐隐，开启时 fade-in-up 入场动画 */
export function applyBannerTitle(enabled: boolean): void {
  document.body.classList.toggle("banner-title-disabled", !enabled);
  if (enabled) {
    // 清除 app.ts MutationObserver 固化的内联 opacity/animation，
    // 否则 CSS 入场动画无法重新触发
    const title = document.getElementById("banner-title");
    const sub = document.getElementById("banner-subtitle-wrapper");
    for (const el of [title, sub]) {
      if (el) {
        el.style.opacity = "";
        el.style.animation = "";
      }
    }
    // 添加入场动画 class，动画结束后移除
    const overlay = document.getElementById("banner-overlay");
    if (overlay) {
      overlay.classList.add("banner-title-enter");
      // 副标题是最后一个入场动画（delay 130ms + 300ms），必须等它结束再移除
      // banner-title-enter：绑在 overlay 上的 animationend 会因冒泡在标题动画
      // 结束（~350ms）即触发，提前移除会截断副标题淡入并重触发其动画。
      // removed 守卫确保只移除一次；setTimeout 兜底防止 reduced-motion 等
      // 无 animationend 事件时 class 残留、阻断下次重新入场。
      let removed = false;
      const doRemove = () => {
        if (removed) return;
        removed = true;
        overlay.classList.remove("banner-title-enter");
      };
      overlay.addEventListener("animationend", (e) => {
        if (
          e.target instanceof HTMLElement &&
          e.target.id === "banner-subtitle-wrapper"
        ) {
          doRemove();
        }
      });
      // ⚠️ 移动端（<768px）副标题由 CSS 隐藏（#banner-subtitle-wrapper 的
      // hidden md:flex），display:none 的元素不跑动画、animationend 永不触发，
      // 上面的监听形同虚设 → 兜底时长按标题动画收尾（delay 130ms + 300ms + 余量）
      // 收紧到 500ms，避免 class 在移动端多挂 300ms 影响下次重新入场。
      const subVisible =
        !!sub && window.getComputedStyle(sub).display !== "none";
      setTimeout(doRemove, subVisible ? 800 : 500);
    }
  }
}

export function setBannerTitle(enabled: boolean): void {
  localStorage.setItem("bannerTitle", String(enabled));
  applyBannerTitle(enabled);
}

/* ── 分区恢复默认 ── */

export function resetWallpaperParams(): void {
  localStorage.removeItem("wallpaperOpacity");
  localStorage.removeItem("wallpaperBlur");
  localStorage.removeItem("wallpaperCardAlpha");
  applyWallpaperParams(getDefaultWallpaperParams());
}

export function resetWallpaperMode(): void {
  localStorage.removeItem("bannerDisplay");
  applyBannerDisplay(getDefaultBannerDisplay());
}

export function resetWave(): void {
  localStorage.removeItem("bannerWave");
  applyWave(getDefaultWave());
}

export function resetBannerTitle(): void {
  localStorage.removeItem("bannerTitle");
  applyBannerTitle(getDefaultBannerTitle());
}

/**
 * 主题配置（head 内联的 #theme-config JSON）的唯一真相源。
 *
 * #4：缓存载体统一为 window.__themeConfig。此前经典脚本（esbuild IIFE，经
 * src/scripts/assets/_theme-config.ts）与 Vite 模块各自持有一份互不感知的缓存
 * （全局 __themeConfig vs 本文件模块级变量），同一元素被解析两遍，且
 * setThemeConfig() 的热更新只在一侧生效。现两侧共用同一份：
 *   - 经典侧经 _theme-config.ts（barrel）转发到本模块；
 *   - setThemeConfig() 的写回对经典侧与 Vite 侧同时可见。
 * 注：缓存永不清除——与原有两侧行为一致（配置在单次页面生命周期内不变）。
 */
export type ThemeConfig = Record<string, unknown> | null;

interface ThemeConfigWindow {
  __themeConfig?: ThemeConfig;
}

function themeConfigWindow(): ThemeConfigWindow {
  return window as unknown as ThemeConfigWindow;
}

export function getThemeConfig(): ThemeConfig {
  const w = themeConfigWindow();
  if (w.__themeConfig !== undefined) return w.__themeConfig;
  let config: ThemeConfig = null;
  try {
    const el = document.getElementById("theme-config");
    if (el?.textContent) {
      config = JSON.parse(el.textContent) as Record<string, unknown>;
    }
  } catch {
    config = null;
  }
  w.__themeConfig = config;
  return config;
}

/**
 * 写入配置缓存。
 * 用于前端修改配置（如在线状态 PUT 写回）后同步缓存，
 * 使同会话内后续读取立即拿到最新值，实现无需刷新的"热更新"。
 */
export function setThemeConfig(config: Record<string, unknown>): void {
  themeConfigWindow().__themeConfig = config;
}

/**
 * #6：配置下钻 adapter。
 * 此前 banner-carousel / banner-src-switch / wave 各自从 getThemeConfig() 重算
 * style.<section>，配置结构变更要改多处。现下钻集中一地，调用方只声明要哪一段。
 * 语义对齐原写法 `cfg && cfg.style && cfg.style.X ? cfg.style.X : null`：
 * 缺失或非对象一律返回 null。
 */
export function getStyleSection(
  section: string,
): Record<string, unknown> | null {
  const cfg = getThemeConfig();
  const style = cfg?.style;
  if (!style || typeof style !== "object") return null;
  const value = (style as Record<string, unknown>)[section];
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/** style.bannerStyle —— banner 单图 / 轮播 / 移动端独立来源等配置 */
export function getBannerConfig(): Record<string, unknown> | null {
  return getStyleSection("bannerStyle");
}

/** style.styleSwitches —— 波浪等各开关 */
export function getStyleSwitches(): Record<string, unknown> | null {
  return getStyleSection("styleSwitches");
}

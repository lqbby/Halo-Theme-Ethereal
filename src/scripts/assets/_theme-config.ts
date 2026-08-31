// 共享：#theme-config JSON 解析缓存 —— 经典脚本侧 barrel
//
// #4：本模块退化为转发层。真相源是 src/utils/theme-config.ts，缓存载体统一为
// window.__themeConfig，经典脚本与 Vite 模块共用同一份（此前两套缓存互不感知、
// 同一元素被解析两遍，且 setThemeConfig 热更新只在 Vite 侧生效）。
// 经典脚本（wave / banner-carousel / banner-src-switch / post-like / post-reward /
// _banner-title-shared / WelcomePopup）继续 import 本文件，路径与契约不变。
// 本模块被各脚本入口 import，esbuild 内联进各自的 IIFE，无加载顺序依赖。
//
// 经典脚本多为 legacy 手写 ES5，此处统一以 any 视图转发（对齐本模块历史签名），
// 避免 Record<string, unknown> 下钻时的类型摩擦。
import {
  getBannerConfig as _getBannerConfig,
  getStyleSection as _getStyleSection,
  getStyleSwitches as _getStyleSwitches,
  getThemeConfig as _getThemeConfig,
  setThemeConfig as _setThemeConfig,
} from "../../utils/theme-config";

export function getThemeConfig(): any {
  return _getThemeConfig();
}

export function setThemeConfig(config: Record<string, unknown>): void {
  _setThemeConfig(config);
}

/** #6：style.bannerStyle 下钻 adapter（配置结构变更单点） */
export function getBannerConfig(): any {
  return _getBannerConfig();
}

/** #6：style.styleSwitches 下钻 adapter */
export function getStyleSwitches(): any {
  return _getStyleSwitches();
}

/** #6：通用 style.<section> 下钻 */
export function getStyleSection(section: string): any {
  return _getStyleSection(section);
}

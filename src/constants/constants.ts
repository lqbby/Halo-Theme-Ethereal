// Banner 高度体系（权威定义，单一来源）：
//   --banner-height：banner 基础高度（非首页及首页顶部），恒定 35vh
//   --banner-height-home：首页 banner 总高 = 基础 + 延伸（横幅模式 65vh / 全屏 100vh）
//   --banner-height-extend：首页延伸量（横幅模式 30vh / 全屏 65vh），JS 换算成
//     像素后写入 CSS 变量（向下取整到 4px 倍数，见 BANNER_EXTEND_ROUNDING）
//   对应关系：BANNER_HEIGHT_HOME = BANNER_HEIGHT + BANNER_HEIGHT_EXTEND
// 注意同步点（改这里必须同步）：
//   - src/styles/variables.css 的 --banner-height / --banner-height-home /
//     --banner-height-extend 默认值（html[data-banner-display="fullscreen"]）
//   - src/layouts/Layout.astro head 内联脚本（延伸量 px 换算，注入本文件常量）
//   - src/utils/banner-sync.ts（波浪同步 / resize 重算，直接 import 本文件）
// 取整步长：banner 底边 = wrapper top(-extend) + 高度 的像素对齐依赖 JS 的
// 精确 px，CSS 默认 vh 值仅作首帧兜底；取 4px 倍数为避免 sub-pixel 缝隙
export const BANNER_EXTEND_ROUNDING = 4;

export const PAGE_SIZE = 8;

export const LIGHT_MODE = "light",
  DARK_MODE = "dark",
  AUTO_MODE = "auto";
export const DEFAULT_THEME = AUTO_MODE;

// Banner height unit: vh
export const BANNER_HEIGHT = 35;
export const BANNER_HEIGHT_EXTEND = 30;
export const BANNER_HEIGHT_HOME = BANNER_HEIGHT + BANNER_HEIGHT_EXTEND;

// 全屏模式（displayMode == 'fullscreen'）：首页 banner 延伸至整屏
export const BANNER_HEIGHT_EXTEND_FULLSCREEN = 65;
export const BANNER_HEIGHT_HOME_FULLSCREEN =
  BANNER_HEIGHT + BANNER_HEIGHT_EXTEND_FULLSCREEN;

/** 按展示模式返回首页 banner 高度（vh） */
export function bannerHomeVh(fullscreen: boolean): number {
  return fullscreen ? BANNER_HEIGHT_HOME_FULLSCREEN : BANNER_HEIGHT_HOME;
}

/** 按展示模式返回 banner 延伸高度（vh） */
export function bannerExtendVh(fullscreen: boolean): number {
  return fullscreen ? BANNER_HEIGHT_EXTEND_FULLSCREEN : BANNER_HEIGHT_EXTEND;
}

/** 计算 banner 延伸高度（像素），用于 CSS 变量 --banner-height-extend */
export function calcBannerHeightExtend(
  innerHeight: number,
  vh: number = BANNER_HEIGHT_EXTEND,
): number {
  let offset = Math.floor(innerHeight * (vh / 100));
  return offset - (offset % BANNER_EXTEND_ROUNDING);
}

// 全屏首页波浪下移量已内联进 components.css #wave-container 的全屏规则
// （transform: translateY(... + 20%)）：波浪整体下移、只露出波峰层。用百分比
// 使 h-28/h-32/h-36 各断点等比下移（translateY 的 % 即元素自身高度），固定
// 像素会在不同断点留下不同大小的残余实心带。仅全屏首页生效，横幅模式与
// 其他页面保持原样

// The height the main panel overlaps the banner, unit: rem
export const MAIN_PANEL_OVERLAPS_BANNER_HEIGHT = 3.5;

// Page width: rem
export const PAGE_WIDTH = 75;

// Banner 响应式常量
export const BANNER_MIN_HEIGHT_PX = 180;
export const BANNER_TABLET_BREAKPOINT = 768;
export const BANNER_TITLE_MIN_SIZE_REM = 1.8;
export const BANNER_TITLE_MAX_SIZE_REM = 3.5;
export const BANNER_TITLE_VW_MULTIPLIER = 0.007;

// 移动端副标题字号阶梯（断点 → rem）
export const BANNER_SUBTITLE_480 = 1.0;
export const BANNER_SUBTITLE_640 = 1.125;
export const BANNER_SUBTITLE_767 = 1.25;
export const BANNER_SUBTITLE_DEFAULT = 1.5;

// Swup visit:end 恢复延迟（ms）
export const SWUP_VISIT_END_DELAY = 200;

/**
 * banner 几何的视口基准高度（像素）。
 *
 * 移动端地址栏展开/收起会让 window.innerHeight 随滚动连续变化（等价于 dvh），
 * 而 CSS 侧移动端已统一改用 svh（地址栏展开时的高度，滚动全程恒定，见
 * variables.css）计算 --banner-height / --banner-height-home / 首帧
 * --banner-height-extend。若继续取运行期 innerHeight，收起地址栏后算出的延伸
 * 像素会偏大：banner 底边（svh 恒定）与波浪底边（随延伸量变化）分离，滚动中
 * 表现为"波浪条错位"，壁纸框高度变化还会让 object-cover 反复重裁。
 *
 * 因此移动端一律以 CSS 的 svh 实测值为基准：用临时探针元素读 100svh 的布局
 * 高度，保证 JS 写入的像素与 CSS 几何严格同基准（也不受"刷新时恢复滚动位置、
 * 地址栏已是收起态"影响）。桌面端无地址栏，直接用 innerHeight；探针读不到
 * （老浏览器不支持 svh）时同样回落 innerHeight。
 *
 * ⚠️ 本文件会进入服务端预渲染 bundle（wallpaper.ts → 访客设置面板 SSR），
 * 因此这里只允许函数定义，禁止任何模块级 window/document 访问；本函数本身
 * 也只允许在浏览器端调用（load / resize / 切换壁纸模式），不在滚动帧内调用。
 */
export function stableViewportHeight(): number {
  if (window.innerWidth >= BANNER_TABLET_BREAKPOINT) {
    return window.innerHeight;
  }
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:0;width:0;height:100svh;visibility:hidden;pointer-events:none;";
  document.documentElement.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height > 0 ? height : window.innerHeight;
}

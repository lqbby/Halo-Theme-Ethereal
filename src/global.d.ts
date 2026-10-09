import type { AstroIntegration } from "@swup/astro";

declare global {
  interface Window {
    // type from '@swup/astro' is incorrect
    swup: AstroIntegration;
    __etherealOriginalHistory?: {
      pushState?: History["pushState"];
      replaceState?: History["replaceState"];
    };
    __etherealSwupHandlersBound?: boolean;
    SearchWidget?: {
      open: () => void;
    };
    // #theme-config JSON 解析缓存（scripts/assets/theme-config.ts 与 public 脚本共享契约）
    __themeConfig?: unknown;
    // 分享海报 qrcode.bundle.js 懒加载状态（scripts/assets/post-share.ts）
    __etherealQRState?: "loading" | "loaded" | "failed";
    __etherealQRCallbacks?: (() => void)[] | null;
    // 当前文章 URL 同步（scripts/assets/post-share.ts）
    __etherealSyncCurrentPostUrl?: () => void;
    __etherealSyncCurrentPostUrlBound?: boolean;
    // 全屏沉浸（hero）滚动脚本防重复绑定标记（scripts/assets/fullscreen-hero.ts）
    __fullscreenHeroBound?: boolean;
    // 相册页「就地筛选」替换列表区后重建 PhotoSwipe 灯箱
    // （content-media.ts → app.ts 暴露，public/assets/list-filter.js 调用）
    __etherealRefreshPhotosGallery?: () => void;
    // 樱花特效（scripts/assets/sakura.ts）：初始化守卫 + 管理器调试/扩展入口
    __sakuraInitialized?: boolean;
    __etherealSakura?: {
      init: () => void;
      stop: () => void;
      getIsRunning: () => boolean;
    };
  }
}

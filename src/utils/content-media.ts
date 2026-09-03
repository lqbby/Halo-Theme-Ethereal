// 图片灯箱 & 相册图库
type Destroyable = { destroy?: () => void };

let lightbox: Destroyable | undefined;
let isLoadingContentPhotoSwipe = false;
let photosGalleryLightbox: Destroyable | undefined;
let isLoadingPhotosGalleryLightbox = false;

// 与 content-photoswipe.ts 的 gallery 选择器保持一致
const CONTENT_GALLERY_SELECTOR =
  ".custom-md img, #post-cover img, .moment-media img, #photo-detail-image";

async function initContentLightbox() {
  if (lightbox || isLoadingContentPhotoSwipe) return;
  isLoadingContentPhotoSwipe = true;
  try {
    await import("photoswipe/style.css");
    const { initContentPhotoSwipe } =
      await import("../utils/content-photoswipe");
    lightbox = initContentPhotoSwipe();
  } catch (error) {
    console.error("[Ethereal] Failed to initialize content images", error);
  } finally {
    isLoadingContentPhotoSwipe = false;
  }
}

// P5（1.3.3）：灯箱懒触发。PhotoSwipe 全家桶 ~80KB（photoswipe-lightbox.esm +
// photoswipe.esm + 样式），但首屏几乎从不点击图片；此前每次 page:view 都 eagerly
// init，首页也要白拉全套模块。改为武装一个 capture 阶段的轻量委托监听，只有
// click 真正命中图库图片时才动态拉起 PhotoSwipe，并在 init 完成后重放本次 click
// 交给它的委托处理器开图。
function handleLazyLightboxClick(event: MouseEvent) {
  if (event.button !== 0 || event.defaultPrevented) return;
  const target = event.target as Element | null;
  if (!target?.closest(CONTENT_GALLERY_SELECTOR)) return;
  document.removeEventListener("click", handleLazyLightboxClick, true);
  // 拦下本次 click（避免图片被链接包裹时的意外跳转），init 后重放交给 PhotoSwipe
  event.preventDefault();
  event.stopPropagation();
  void initContentLightbox().then(() => {
    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
  });
}

function armLazyLightbox() {
  // 已就绪或加载中 → PhotoSwipe 自己的监听在工作，无需武装
  if (lightbox || isLoadingContentPhotoSwipe) return;
  document.removeEventListener("click", handleLazyLightboxClick, true);
  document.addEventListener("click", handleLazyLightboxClick, true);
}

async function initPhotosGallery() {
  if (photosGalleryLightbox || isLoadingPhotosGalleryLightbox) return;
  if (!document.getElementById("photos-gallery")) return;
  isLoadingPhotosGalleryLightbox = true;
  try {
    await import("photoswipe/style.css");
    const { initPhotosGalleryLightbox } =
      await import("../utils/photos-gallery-lightbox");
    photosGalleryLightbox = initPhotosGalleryLightbox();
  } catch (error) {
    console.error("[Ethereal] Failed to initialize photos gallery", error);
  } finally {
    isLoadingPhotosGalleryLightbox = false;
  }
}

function destroyAll() {
  lightbox?.destroy?.();
  lightbox = undefined;
  photosGalleryLightbox?.destroy?.();
  photosGalleryLightbox = undefined;
}

export { armLazyLightbox, initContentLightbox, initPhotosGallery, destroyAll };

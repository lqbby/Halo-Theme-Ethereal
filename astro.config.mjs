// @ts-check
import { defineConfig } from "astro/config";
import fs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import swup from "@swup/astro";

import { stripHtmlCommentsInDir } from "./scripts/strip-html-comments.mjs";
import { minifyInlineScriptsInDir } from "./scripts/minify-inline-scripts.mjs";
import { ensureIconMaskPrefixInDir } from "./scripts/ensure-icon-mask-prefix.mjs";
import {
  compileAssets,
  copyVendorAssets,
  compressAssetsInDir,
} from "./scripts/build-assets.mjs";

import Icons from "unplugin-icons/vite";
import svelte from "@astrojs/svelte";
import icon from "astro-icon";

// 从 theme.yaml 读取主题版本号（Halo 主题版本的唯一来源），构建期注入全局
// ASSET_VERSION，用于静态资源缓存指纹（如 post.bundle.js?v=1.0.6）。
// 后续升级主题只需改 theme.yaml 一处，避免两处版本号失步导致缓存不失效。
const themeYaml = fs.readFileSync(
  new URL("./theme.yaml", import.meta.url),
  "utf8",
);
const themeVersion =
  (themeYaml.match(/^[ \t]*version:\s*["']?([^"'\r\n]+)["']?/m) ||
    [])[1]?.trim() || "0.0.0";

// 构建完成后剥离产物 HTML 中的 <!-- --> 开发注释
/** @type {import("astro").AstroIntegration} */
const stripHtmlComments = {
  name: "strip-html-comments",
  hooks: {
    "astro:build:done": async ({ dir }) => {
      const out = fileURLToPath(dir);
      await stripHtmlCommentsInDir(out);
      // 本地 1.5.66 追加步骤：压缩产物 HTML 里的内联 <script>（去注释 + 折叠空白）。
      // 页面模板逐页重复的内联脚本是发布包体积的大头，且 Astro 的 is:inline 原样
      // 输出、不做任何压缩。保护规则见 scripts/minify-inline-scripts.mjs。
      // ⚠️ 上游 v2.0.0 无此步（合并时被丢掉，已补回）。
      await minifyInlineScriptsInDir(out);
    },
  },
};

// 构建后处理：兜底补回 iconify 图标遮罩被 CSS 工具链裁掉的 -webkit- 前缀
// （缺前缀会让 Chromium<120 上的图标被裁切，详见脚本内注释与 issue #83）
/** @type {import("astro").AstroIntegration} */
const ensureIconMaskPrefix = {
  name: "ensure-icon-mask-prefix",
  hooks: {
    "astro:build:done": async ({ dir }) => {
      await ensureIconMaskPrefixInDir(fileURLToPath(dir));
    },
  },
};

// 经典脚本资产管线：
//  - build:start：把 src/scripts/assets/*.ts 编译为 IIFE 经典脚本输出到 public/assets/
//    （须先于 Astro 拷贝 public/，见 scripts/build-assets.mjs），并采集 public/assets
//    全部 *.js 文件名作为 build:done 压缩白名单
//  - build:done：压缩 outDir/assets/ 下由 public/ 拷贝来的经典脚本
//    （只压缩白名单内的 public 产物，跳过 Astro/Vite 的 hashed module 产物）
/** @type {import("astro").AstroIntegration} */
const buildAssets = {
  name: "build-assets",
  hooks: {
    "astro:build:start": async () => {
      await compileAssets();
      await copyVendorAssets();
      const names = await fs.promises.readdir(
        join(fileURLToPath(new URL("./public/assets/", import.meta.url))),
      );
      publicAssetJs = names.filter((f) => f.endsWith(".js"));
    },
    "astro:build:done": async ({ dir }) => {
      await compressAssetsInDir(
        join(fileURLToPath(dir), "assets"),
        publicAssetJs,
      );
    },
  },
};

// build:start 时从 public/assets 采集的经典脚本文件名，供 build:done 压缩白名单使用
/** @type {string[]} */
let publicAssetJs = [];

export default defineConfig({
  base: "/themes/Ethereal",
  build: {
    assets: "assets",
    format: "file",
  },
  outDir: "./templates",
  integrations: [
    stripHtmlComments,
    buildAssets,
    ensureIconMaskPrefix,
    swup({
      theme: false,
      animationClass: "transition-swup-", // see https://swup.js.org/options/#animationselector
      // the default value `transition-` cause transition delay
      // when the Tailwind class `transition-all` is used
      // 两侧栏本身都**不是**容器（换页不更新）：小组件全是全局配置，不做替换能省掉
      // 每页重跑脚本（音乐播放器重建、天气重复扫描、一言换句）与状态重置；唯一「按页
      // 变化」的内容是目录，故只为目录各留一个槽位容器：#sidebar-toc / #right-sidebar-toc。
      // ⚠️ 容器必须在每个主题页存在，否则 app.ts 的 page:load 守卫会让整站换页 abort
      containers: [
        "#swup-container",
        "#toc-container",
        "#toc-popup",
        "#sidebar-toc",
        "#right-sidebar-toc",
      ],
      // 跨页回顶滚动统一走距离门控（app.ts 的 smartScrollTo，见 scroll-manager.ts）：
      // app.ts 在 content:scroll 接管，插件的 betweenPages 被跳过。
      // 🔴 samePageWithHash 已关（2026-10-08）：同页锚点/目录点击改由
      //    app.ts 的 TableOfContents.handleAnchorClick 接管 + 距离门控 ——
      //    插件走主线程逐帧 JS 插值（scrl），长文点目录有拉扯感。
      // 注：@swup/astro 类型声明为 boolean，但运行时会透传给 SwupScrollPlugin
      // 选项对象（enabledPlugins 的 options === true ? {} : options 分支），
      // 故此处需绕过类型限制
      smoothScrolling: /** @type {any} */ ({
        animateScroll: {
          betweenPages: false,
          samePageWithHash: false,
          samePage: false,
        },
      }),
      cache: false, // 禁用缓存，避免友链页面内容不完整
      // I25：删除 preload——cache:false 下 @swup/astro 强制禁用 preload（死配置），
      // 保留会误导未来误启用（每 hover = 整页 HTML 拉取，成为带宽放大面）
      accessibility: true,
      updateHead: true,
      updateBodyClass: false,
      globalInstance: true,
      ignore: [
        // 认证 / 后台 / 用户中心等非主题页面：直接整页跳转，
        // 避免 Swup 先播放下场动画再跳转导致瞬间样式散架
        "/login",
        "/logout",
        "/register",
        "/console",
        "/uc",
        "/admin",
      ],
    }),
    icon({
      include: {
        mdi: ["comment-text-outline"],
        "material-symbols": [
          "close-rounded",
          "home-outline-rounded",
          "keyboard-arrow-up-rounded",
          "format-list-bulleted-rounded",
        ],
      },
    }),
    svelte(),
    critters({
      Critters: {
        // 默认渲染模式（critters 用 puppeteer 渲染页面提取视口内 critical CSS；
        // reduce 模式不渲染 ⇒ 不知道视口内元素 ⇒ critical 提取失败，已弃用）
        inlineFonts: true,
        compress: true,
        preload: "media",
        pruneSource: false,
      },
    }),
  ],
  vite: {
    define: {
      ASSET_VERSION: JSON.stringify(themeVersion),
    },
    plugins: [
      // Tailwind v4 已移除 safelist 选项（v3 遗留，会被静默忽略）：
      // navbar-blur 类在 Navbar.astro 源码中以字面量存在，内容检测会自动生成
      tailwindcss(),
      Icons(),
    ],
  },
});

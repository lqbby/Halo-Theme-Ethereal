// 经典脚本 / 静态资源的内容指纹（构建期）
//
// 背景：/assets/* 的 ?v= 原先统一用 ASSET_VERSION（= theme.yaml 的主题版本），
// 但部署常常只换内容不升版本（脚本热更），此时 ?v= 不变，浏览器与 CDN 会
// 继续命中旧缓存（statistics-dashboard.js 曾因此出现「新代码已部署、访客
// 仍跑旧脚本」的不生效问题）。这里改为按文件内容算 sha256 短哈希：
// 内容变 → URL 变 → 缓存必然失效；内容不变 → URL 不变 → 缓存照常复用。
//
// 读取对象优先 public/ 下的构建产物：经典脚本在 astro:build:start 已由
// build-assets 管线编译/拷贝到 public/assets/，页面渲染时读到的就是将要
// 发布的那一份（esbuild 已内联其 import 的共享模块），哈希与最终内容
// 严格对应（build:done 的二次压缩是确定性变换，不影响对应关系）。
// 产物缺失时（如脱离构建管线单独渲染）退回源码文件，再退回 ASSET_VERSION。
//
// ⚠️ 本模块用 node:fs / node:crypto，只能在 .astro frontmatter（构建期）
// import，禁止被客户端代码（src/scripts/**、Svelte 组件等）引用。

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cache = new Map<string, string>();

function shortHash(file: string): string | undefined {
  try {
    return createHash("sha256")
      .update(readFileSync(file))
      .digest("hex")
      .slice(0, 8);
  } catch {
    return undefined;
  }
}

/**
 * 返回 public/ 下静态资源的内容版本标识。
 * @param relPath 相对 public/ 的路径，如 "assets/statistics-dashboard.js"、
 * "assets/wishes.css"、"assets/images/ghs.png"
 */
export function assetVersion(relPath: string): string {
  const cached = cache.get(relPath);
  if (cached) return cached;

  const root = process.cwd();
  let version = shortHash(join(root, "public", relPath));

  // 经典脚本源码兜底（public 产物尚未生成时）
  if (!version && relPath.startsWith("assets/") && relPath.endsWith(".js")) {
    const base = relPath.slice("assets/".length, -".js".length);
    version =
      shortHash(join(root, "src/scripts/assets", `${base}.ts`)) ??
      shortHash(join(root, "src/scripts/assets", `${base}.js`)) ??
      shortHash(join(root, "src/scripts/vendor", `${base}.js`));
  }

  version ??= ASSET_VERSION;
  cache.set(relPath, version);
  return version;
}

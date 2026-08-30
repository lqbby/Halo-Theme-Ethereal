// @ts-nocheck
// 本文件是一次性构建工具，产物（public/assets/images/pattern-*.png）已提交进仓库，
// 不参与 CI 与 astro build。依赖 @resvg/resvg-js 是原生二进制、仅重新生成纹理时才需要
// （届时临时 npm i 即可），为它常驻 devDependencies 会无谓拖慢 CI 安装，
// 故关闭类型检查而不是引入依赖。
//
// 把装饰性手绘 SVG 纹理（各 ~395KB，含大量路径）预渲染成 PNG 平铺图。
// 位图背景在滚动时走 GPU 合成、无需主线程逐帧重栅格化 SVG 路径，
// 直接消除「背景图导致滚动卡顿」。按 background-size:400px 的宽度比例渲染 2x(800) 保 retina 清晰。
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "public", "assets", "images");
const SRC_DIR = join(process.cwd(), "scripts", "pattern-src");
const jobs = [
  { svg: "pattern-light.svg", png: "pattern-light.png" },
  { svg: "pattern-dark.svg", png: "pattern-dark.png" },
];

for (const { svg, png } of jobs) {
  const svgStr = readFileSync(join(SRC_DIR, svg), "utf8");
  // fitTo width=800（2x of 显示 400），高度按 SVG 宽高比自动 → 与 background-size:400px 一致
  const resvg = new Resvg(svgStr, {
    fitTo: { mode: "width", value: 800 },
    // 透明背景保留，让卡片底色透出（与 SVG 行为一致）
    background: undefined,
  });
  const buf = resvg.render().asPng();
  writeFileSync(join(OUT_DIR, png), buf);
  console.log(`✅ ${svg} -> ${png} (${(buf.length / 1024).toFixed(1)} KB)`);
}

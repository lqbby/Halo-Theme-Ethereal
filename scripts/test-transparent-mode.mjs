// @ts-check
// 全屏透明模式「恢复整屏壁纸」桩测（2026-10-13，v1.7.43）
//
// 背景：1.5.66 起该模式的壁纸层被压成 opacity: 0（怕与页面底纹打架），连带让
//   「壁纸透明度 / 背景模糊度」两个后台参数全场景空转、整页发白 —— 用户实报
//   「透明显示不正常」。实测（横幅模式下把两参数推到极端值）确认零变化后，
//   v1.7.43 恢复该模式的整屏壁纸，并把页面底纹从该模式移出（回到「壁纸处不铺底纹」）。
// 判据：
//   T1 壁纸层 opacity 写回 --transparent-wallpaper-opacity（不是 0）
//   T2 页面底纹生效模式只剩 disabled（transparent 已移出）
//   T3 三个透明变量由 Layout.astro 从 layout.bannerLayout.* 注入
//   T4 两个参数的 help 不再声称「暂不生效」，且写明生效范围
//   T5 该模式的壁纸模糊仍挂在 --transparent-wallpaper-blur 上
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS = join(ROOT, "src/styles/components.css");
const LAYOUT = join(ROOT, "src/layouts/Layout.astro");
const SETTINGS = join(ROOT, "settings.yaml");

let failures = 0;
/**
 * @param {string} name
 * @param {unknown} actual
 * @param {unknown} expected
 */
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "✅" : "❌"} ${name}：实得 ${JSON.stringify(actual)} / 应有 ${JSON.stringify(expected)}`,
  );
}

const css = readFileSync(CSS, "utf8");
const flat = css.replace(/\s+/g, " ");

check(
  "T1 透明模式壁纸层写回 --transparent-wallpaper-opacity",
  /html\[data-banner-display="transparent"\] #banner-wrapper \{[\s\S]{0,900}?opacity: var\(--transparent-wallpaper-opacity, 0\.8\) !important;/.test(
    css,
  ),
  true,
);
{
  // ⚠️ 只看「声明行」——注释里会提到 opacity: 0 !important;（讲怎么重新停用），别被它误判
  const body =
    /html\[data-banner-display="transparent"\] #banner-wrapper \{([\s\S]*?)\}/.exec(
      css,
    );
  check(
    "T1b 壁纸层没有真正的 opacity: 0 声明（注释提及不算）",
    !!body && /^\s*opacity:\s*0\s*!important;\s*$/m.test(body[1]),
    false,
  );
}
check(
  "T2 页面底纹生效模式只剩 disabled（transparent 已移出）",
  /:root\.mods-page-pattern\[data-banner-display="disabled"\] body::before \{/.test(
    flat,
  ) &&
    !/:root\.mods-page-pattern\[data-banner-display="transparent"\]/.test(flat),
  true,
);
{
  const lay = readFileSync(LAYOUT, "utf8");
  check(
    "T3 三个透明变量从 layout.bannerLayout.* 注入",
    /--transparent-wallpaper-opacity: \$\{theme\.config\?\.layout\?\.bannerLayout\?\.wallpaperOpacity \?: 0\.8\}/.test(
      lay,
    ) &&
      /--transparent-wallpaper-blur: \$\{theme\.config\?\.layout\?\.bannerLayout\?\.wallpaperBlur \?: 10\}px/.test(
        lay,
      ) &&
      /--transparent-card-alpha: \$\{theme\.config\?\.layout\?\.bannerLayout\?\.cardOpacity \?: 0\.6\}/.test(
        lay,
      ),
    true,
  );
}
{
  const st = readFileSync(SETTINGS, "utf8").replace(/\r/g, "");
  check(
    "T4a 壁纸透明度 help：不再「暂不生效」且写明仅全屏透明生效",
    /label: 壁纸透明度[\s\S]{0,400}?v1\.7\.43 起该模式恢复铺整屏壁纸/.test(
      st,
    ) && !/label: 壁纸透明度[\s\S]{0,400}?暂不生效/.test(st),
    true,
  );
  check(
    "T4b 背景模糊度 help：写明生效范围（全屏透明 / 全屏 hero；横幅不生效）",
    /label: 背景模糊度[\s\S]{0,500}?生效范围[\s\S]{0,300}?横幅[\s\S]{0,80}?不生效/.test(
      st,
    ),
    true,
  );
}
check(
  "T5 透明模式壁纸模糊仍读 --transparent-wallpaper-blur",
  /html\[data-banner-display="transparent"\] #banner img[\s\S]{0,400}?filter: blur\(var\(--transparent-wallpaper-blur, 10px\)\)/.test(
    css,
  ),
  true,
);

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

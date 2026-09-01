// @ts-check
// theme-package 的 essential 模式会把项目根目录所有 *.yaml/*.yml 打进主题包
// （为携带 theme.yaml / settings.yaml），导致 pnpm 开发锁文件混入安装包。
// 打包期间把 pnpm 的 yaml 临时改名移出（*.yaml 匹配不到 .bak 后缀），结束后恢复。
import { spawnSync } from "node:child_process";
import { rename } from "node:fs/promises";
import { join } from "node:path";

const DEV_YAML = ["pnpm-lock.yaml", "pnpm-workspace.yaml"];

const moved = [];
for (const name of DEV_YAML) {
  try {
    await rename(
      join(process.cwd(), name),
      join(process.cwd(), `.${name}.bak`),
    );
    moved.push(name);
  } catch (err) {
    if (/** @type {{ code?: string }} */ (err).code !== "ENOENT") throw err;
  }
}
try {
  // theme-package 二进制不保证在 PATH（沙箱 / CI 环境差异会导致
  // "'theme-package' 不是内部或外部命令"）。直接调本地 CLI 的入口文件，
  // 与 theme-package 命令等价，且不依赖 .bin 是否在 PATH。
  const result = spawnSync(
    process.execPath,
    ["node_modules/@halo-dev/theme-package-cli/index.js"],
    { stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
} finally {
  for (const name of moved) {
    await rename(
      join(process.cwd(), `.${name}.bak`),
      join(process.cwd(), name),
    );
  }
}

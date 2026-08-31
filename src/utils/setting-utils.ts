/* setting-utils.ts —— 桶（barrel）文件。
 *
 * 历史：原 640 行「浅模块」(grab-bag)，5 组无关功能各含
 * getDefault/getStored/apply/set/reset。架构评审候选 #3 将其按功能深化为
 * src/utils/settings/{scheme,visitor-switches,post-list,card-style,wallpaper}.ts
 * 独立模块（ deepening：接口成为真实测试面、locality 提升）。
 *
 * 本文件仅做重导出，保持所有现有导入点（src/scripts/app.ts 等）零改动；
 * 需要细粒度依赖时可直接 import 对应 settings/* 子模块。若需回退，删掉
 * settings/ 目录并把下方 5 行替换为原实现即可。
 */
export * from "./settings/visitor-switches";
export * from "./settings/scheme";
export * from "./settings/post-list";
export * from "./settings/card-style";
export * from "./settings/wallpaper";

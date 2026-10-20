# bug-hunter 测试报告（Ethereal 主题 · 2026-10-20）

> 审计目标：`D:/WorkBuddy sjk/halo/ethereal`（Halo 主题源码）+ 线上 `http://nas.lqbby.com:8090`
> 模式：auto（发现即修）· 范围：源码静态 + 构建产物 + 线上 UI/交互
> 结局：**5 轮后寿命归零**（`life=0`），共 **4 个真实缺陷，全部修复并复验**

## 一、逐轮总览

| 轮 | 通道 | 候选 | 真 bug | 备注 |
|---|---|---|---|---|
| 1 | 静态不变量 8 族（th:* 注释 / th:with 前向引用 / 前缀对 / 实例作用域 / 重复 id / i18n / 裸 href / will-change） | 126 | **2** | CSS 前缀对顺序 ⇒ 产物丢失属性 |
| 2 | 线上 17 页矩阵 + 设置深层键 | 16 + 17 页 | **2** | 两个「有读取点、schema 无字段」的死开关 |
| 3 | 6 个新规则族（schema `if` 死条件 / inline 重复绑定 / 单文件重复 id / th:if+th:unless / innerHTML） | 71 | 0 | 全为取证后排除 |
| 4 | 交互 + 移动端 + 无障碍（6 页×2 断点 + 3 条交互路径） | — | 0 | 溢出/alt/无名元素均为 0 |
| 5 | 逐组件交互（11 小组件 + 筛选/弹窗/键盘/手势） | — | 0 | 两个候选均实测清白 |

## 二、已修复（4 项，全部 fixed）

| # | 缺陷 | 证据 | 修复 | 复验 |
|---|---|---|---|---|
| 1 | `markdown.css:19` `box-decoration-break` 写成「标准在前、前缀在后」 | 线上产物只有标准版（Safari<18 丢属性） | 交换顺序 | 新产物 **std1/pre1** ✓ |
| 2 | `markdown.css:748` `appearance` 同问题 | 同上（任务清单复选框） | 交换顺序 | 新产物 **std/pre 成对** ✓ |
| 3 | 构建期守卫只覆盖 `backdrop-filter` 一个属性 | 守卫源码 + 产物 85 条不完整声明 | 泛化为 `PREFIX_PAIR_PROPS` **双向补齐** | 全站补 **85 条 / 10 个 CSS 文件** ✓ |
| 4 | `styleSwitches.enable_random_post`、`links.features.enable_search` 有读取点、schema 无字段 | Navbar 注释写「后台可关」但后台没有；友链搜索框同理 | 补 schema 字段（默认 true，观感不变） | `test-dead-switch-readers` 4/4 绿 ✓ |

**新增回归资产**：`test-css-prefix-order.mjs`、`test-dead-switch-readers.mjs` ⇒ 桩测总数 **17 → 19，全绿**。
**交付**：`Ethereal-1.7.44.zip`（3.09MB）· 提交 `5453473`。

## 三、未修复 / 不可修复（均为非主题代码）

1. `data-statistics` 插件 Uptime 接口 **500**（全站每页一条控制台错误）—— Uptime Kuma 侧不可达，属基础设施。
2. `ReferenceError: vditorRender / Vditor is not defined` —— vditor-mde 插件注入脚本的加载时序，主题源码无引用。
3. 无障碍「点击目标 <24px」44/35/19 处 —— 抽样全为正文内联文字链接与带 aria 的拖拽手柄，WCAG 2.5.8 行内豁免。

## 四、覆盖情况（6/17 = 35.3%）

已覆盖：i18n、设置 schema↔读取点、静态页、线上运行面、首页、页脚。
挖掘中：样式系统、文章页、构建与打包、Banner、侧栏小组件。
未覆盖：布局与外壳、导航栏、文章列表与卡片、目录 TOC、访客样式面板、客户端脚本、移动端细节。

## 五、遗留风险与建议

- **低**：Safari<18 之外的旧内核（如老微信内核）仍可能因缺 `-webkit-` 别名丢属性——守卫已双向补齐，此风险已闭合。
- **中**：13 个模块的**逐组件交互矩阵**（弹窗/Esc/键盘焦点/手势）尚未系统化；本轮追番详情弹窗与图库灯箱因选择器与真实 DOM 不符**未得出结论**，属明确的覆盖债务。
- **建议**：把「每个组件的交互冒烟」固化成 Playwright 脚本（复用本轮的 `_components_round5.mjs` 骨架，按真实 class/id 修正选择器），目标 30 秒内跑完全站交互冒烟。

## 六、方法论沉淀

- 错题集新增 2 条：①「守卫只守单点 = 假安全」；②「运行时注入测不出构建期去重，验证必须落在产物层」。
- 一轮扫描器 20+ 规则族可复用：`_tmp/_scan_round1.py`、`_scan_round2.py`、`_scan_round3.py`、`_components_round5.mjs`。
- 状态可续：`life=0`（需 reset 才能继续），覆盖清单与 findings 在 `.workbuddy/bug-hunter/`。

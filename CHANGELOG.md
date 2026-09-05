# Changelog

本文件按版本记录 Ethereal 主题的变更历史。

## [v1.3.32] - 2026-09-05

### 新增：瞬间走马灯滚动速度纳入动画速度档位（可自定义）

- **诉求**：首页「瞬间」走马灯的滚动速度此前由 JS 硬编码（约 48px/s），完全不受「动画速度」档位控制——疾速档下其他入场动画都已加快，走马灯却仍慢悠悠滚动，观感割裂；后台「自定义动画时长」里也没有对应项，无法单独调节。

- **改动**：
  - 新增全局变量 `--marquee-speed`（走马灯滚动速度，px/s，无单位），四档速度：均衡 48（原值，零回归）/ 舒缓 36 / 最优 60 / 疾速 80。
  - `src/components/HomeMoments.astro`：走马灯内联脚本改为读取 `getComputedStyle(document.documentElement).getPropertyValue("--marquee-speed")` 计算滚动时长（`duration = max(20, groupWidth / speed)`），fallback 48。
  - `src/styles/speed.css`：四档各补 `--marquee-speed`。
  - `src/utils/speed-style.ts`：`SPEED_CUSTOM_DEFAULTS` 增 `marqueeSpeed: 48`，th:style 拼接 `--marquee-speed`（无 ms 后缀）。
  - `settings.yaml`：「自定义动画时长」组新增 `marqueeSpeed`（瞬间走马灯速度，px/s，20–200，默认 48）。
  - `src/types/config.ts`：`speedCustom` 增 `marqueeSpeed`，并补上此前遗漏的 `speedTier` 档位 `"optimal"`。

### 统一：导航抽屉交互动画接入速度档位

- 移动端抽屉菜单的展开/淡入动画此前硬编码，疾速档下不随档位加快。现将以下动画统一改用 `--dur-*` 变量：
  - `#nav-menu-overlay` 遮罩淡入 `250ms` → `--dur-swup`；
  - `#nav-menu-panel` 抽屉滑入 `250ms` → `--dur-swup`；
  - `.nav-drawer-link` 菜单项错峰入场 `300ms` → `--dur-entry`；
  - `.floating-controls` 浮动按钮淡出 `200ms` → `--dur-swup`。
  - 均衡档下基本无感（250→200ms 微调、300→300ms 零变），疾速/舒缓档下随档位统一变化。

## [v1.3.31] - 2026-09-05

### 修复：刷新后滚到底部，滚动条挂载瞬间页面跳动

- **现象（用户「网站滚到下面再刷新，刷新成功之后一秒内它会滚动一点小距离」）**：刷新后浏览器把滚动位置恢复到底部，紧接着 OverlayScrollbars 懒挂载（3.5s 兜底）触发，页面自动跳动一小段距离。

- **根因**：1.3.9 起为把滚动条挂载的长任务移出 Lighthouse TBT 窗口，将挂载时机从「入场动画结束（~1s）」推迟到「首次滚动 / 3.5s 兜底」。挂载会**同步 appendChild 重组 body 子元素**（一次全量重排长任务），扰动滚动几何；挂载推迟后正好撞上「刷新后滚动位置已恢复到底部」的状态，重组导致滚动位置被钳制/微调，跳动变得可见（挂载在 ~1s 早期时用户尚未滚远，几乎无感）。

- **修复**（`src/scripts/app.ts` 的 `initCustomScrollbar`）：
  - `runWhenIdle` 区分触发源：`wheel`/`touchmove`/`keydown` 传 `fromInteraction=true`，3.5s 兜底定时器传 `false`。
  - `mount` 仅在**自动兜底触发**（`fromInteraction=false`，用户未在滚动）时保护滚动位置——挂载前记录 `window.scrollY`，挂载完成后下一帧（等 OS 完成初始布局）若偏差 `> 1px` 则 `scrollTo` 恢复，消除跳动。
  - 用户主动滚动触发时**不恢复**：wheel 的默认滚动发生在事件处理返回之后，此刻恢复会把用户刚滚到的位置拉回滚动前，反成新跳动。

- **性能不变**：保留 3.5s 懒挂载，mount 长任务仍在 TTI 之后，不回退 1.3.9 的性能优化。

## [v1.3.30] - 2026-09-04

### 修复：朋友圈加载瞬间「先渲染单栏，再渲染双栏」闪烁（FOUC）

- **现象（用户「观感不流畅，加载的瞬间先渲染单栏，再渲染双栏」）**：1.3.29 的 `.friends-timeline` 默认是 `flex-direction: column`（单栏），双栏由 `friends.bundle.js`（defer 脚本）在首帧渲染后才加 `.masonry-active` 切换，导致首帧先显示「30 张卡片竖排单栏」、再跳成两栏，观感闪烁。

- **根因**：defer 脚本执行晚于浏览器首帧渲染；首帧时 CSS 还是单栏，双栏结构尚未建立。

- **修复**（`src/styles/components.css`）：`.friends-timeline` 默认改用 **CSS columns 双栏兜底**——`column-count: 1`（移动）/ `2`（≥768px）+ `.friends-timeline-group { break-inside: avoid }`，让**首帧即按 columns 双栏渲染**（消除「单栏→双栏」跳变）；JS 就绪后 `rebuildMasonry` 加 `.masonry-active`（`display: flex` 覆盖 columns）切回 flex 两列 + 最短列优先瀑布流。因首帧 columns balance 与 JS 最短列优先在朋友圈卡片高度差异小的场景下分配结果接近，「columns 双栏→flex 双栏」的切换几乎无感；「加载更多」仍走 flex 增量追加、不重排。

- **JS 无需改动**：`rebuildMasonry` 天然兼容——首帧无 `.friends-timeline-column`，它先空摘旧列、再加 `.masonry-active` 切 flex、按最短列优先重建。

## [v1.3.29] - 2026-09-04

### 朋友圈双栏改为「最短列优先」瀑布流（对齐首页文章卡片）

- **需求（用户「能做到和首页文章卡片一样的瀑布流吗？要符合主题设计」）**：1.3.28 的「奇偶交替」只保证数量均衡，但朋友圈卡片高度不一（有无摘要、标题行数、日期分组头是否显示），奇偶交替会让一列偏高一列偏矮，观感不如首页文章列表的 masonry 瀑布流。

- **修复**（`src/scripts/assets/friends.bundle.js`）：`rebuildMasonry` 的分配算法从「奇偶交替」改为**「最短列优先」（greedy shortest-column-first）**——每个 group 追加到当前 `offsetHeight` 较小的列（`offsetHeight` 已含列内子元素与 gap，append 后即时更新），高度不一的卡片自然均衡到两列、两列齐平，视觉对齐首页 `post-list-layout.js` 的 masonry 算法。

- **保留**：仍为 flex 两列（非绝对定位）——朋友圈卡片头像固定 48px、无封面图，卡片高度由文本决定且加载前后稳定，无需首页那样「绝对定位 + 封面图 load 重排」；`<768px` 单列铺平、resize 跨断点重建、Swup 重执行守卫、`groups` 原始顺序数组重建等 1.3.28 机制均不变。

## [v1.3.28] - 2026-09-04

### 修复：朋友圈双栏布局「加载更多」只加载右边一列

- **现象（用户反馈「朋友圈页面加载不合理，双栏布局。只加载右边的，观感不好。」）**
  - 首批可见 30 条在左右两列分布均衡（左 13 / 右 17），但点击「加载更多」后第二批 23 条**全部堆到右列、左列纹丝不动**（实测 `batch2Left:0, batch2Right:23`）。

- **根因**：`.friends-timeline` 原先用 CSS `columns: 2` 的 masonry（`column-count`），浏览器的**列平衡（column balancing）按 DOM 顺序「连续分段」**分配多列——首批 30 个 group 恰好填满第一段后被两列平衡；「加载更多」新增的第二批 group 在 DOM 顺序上靠后，被列平衡算法整体续排到右列末尾，左列不补位。

- **修复**（`src/scripts/assets/friends.bundle.js` + `src/styles/components.css`）：
  - 弃用 CSS columns，改为 **flex 两列 + JS 手动按原始索引奇偶交替分配**：`.friends-timeline` 默认单列（无 JS 兜底），桌面（`window.innerWidth >= 768`）加 `.masonry-active` 并创建左右两个 `.friends-timeline-column`，把可见 group 按 `i % 2` 交替 append 进两列——新增内容自然分散左右，不再「只加载右边」。
  - `rebuildMasonry` 以 init 时捕获的原始顺序 `groups` 数组为准重建（不依赖当前 DOM 顺序），可反复调用；`<768px` 时单列铺平恢复原始顺序。
  - `updateDisplay`（分批隐藏/显示）末尾统一调用 `rebuildMasonry`，加载更多、resize 跨断点都会正确重建。
  - resize 监听用 `window.__etherealFriendsMasonryResizeBound` 全局守卫只注册一次，避免 Swup 换页重执行脚本时监听累积；`setup` 每次重查 DOM 防闭包引用旧页面元素。

## [v1.3.27] - 2026-09-04

### 修复：刷新后「首次点击菜单/分类失效，约 4 秒后恢复」的真正根因

- **现象（用户澄清「刷新之后只有滚动一下才能点击正常跳转」→「大概 4 秒钟后可以第一次点击成功，4 秒钟前不行」）**
  - 刷新后立即点击顶部导航菜单或分类栏任何链接都失效，约 4 秒后首次点击才成功。此前误判为「第二次点击成功」「滚动一下才能点」，实为同一现象的不同触发方式。

- **真正根因**：`app.ts` 的 `initCustomScrollbar()` 用 `runWhenIdle` 把 **OverlayScrollbars 初始化**延迟到「首次用户交互」或「固定 3.5s 兜底」。首次交互包含 `pointerdown`（点击按下）——用户刷新后首次**点击**菜单时，`pointerdown` 触发 OverlayScrollbars 初始化，**同步 appendChild 移动全部 body 子元素**（包裹进滚动容器 viewport），干扰了同一次点击的 click 事件处理 → 点击失效。3.5s 兜底（叠加动态 `import("overlayscrollbars")` 的加载时间 ≈ **4 秒**）后 mount 完成、DOM 稳定，点击恢复。

- **为何 1.3.26 未解决**：1.3.26 的 `loadOnIdle: false` 只是让 Swup 同步初始化（消除 `requestIdleCallback` 延迟），但真正的「点击失效」来自 OverlayScrollbars 初始化时的 DOM 移动，与 Swup 初始化时机无关。

- **修复**（`app.ts`）：`runWhenIdle` 移除 `pointerdown` / `touchstart` 触发（点击/触摸不再触发 mount），改为 `wheel`（桌面滚轮）/ `touchmove`（移动端触摸滚动）/ `keydown`（键盘）+ 3.5s 兜底。点击不再触发 DOM 移动，首次点击即正常；滚动/键盘/兜底仍保证 OverlayScrollbars 最终初始化。

- **验证**：agent-browser 环境原生滚动条为 overlay（`scrollbarGap=0`），被 `cancel: { nativeScrollbarsOverlaid: true }` 取消初始化，故此前在该环境永远测不出此 bug（`window.swup` 就绪 + 点击成功）；用户 Windows 经典滚动条环境（`scrollbarGap≈17`）正常初始化，可复现。

## [v1.3.26] - 2026-09-04

### 修复：刷新页面后「首次点击菜单/分类跳转失败，第二次才成功」

- **现象（用户反馈「刷新页面之后，点击第一个菜单跳转都无效，顶部菜单栏和下面的分类栏都一样，第二次之后都跳转成功了」）**
  - 页面加载/刷新后，第一次点击顶部导航菜单或分类栏的任何链接都无跳转反应，第二次点击才正常

- **根因**：`@swup/astro` 的 `loadOnIdle` 选项**默认为 `true`**，生成的 Swup 初始化脚本通过 `onIdleAfterLoad(initSwup)` 延迟执行——即「等 `load` 事件 + `requestIdleCallback`（且**无 timeout 兜底**）后」才 `new Swup` 并挂 `window.swup` / `clickDelegate` 事件委托。刷新后若浏览器一直未进入空闲（或空闲时机晚于用户第一次点击），`window.swup` 尚未就绪，分类栏兜底逻辑 `if (window.swup) ... else location.href` 与 Swup 事件委托都拿不到实例，首次点击导航失效；第二次点击时 swup 已初始化完成才恢复。

- **修复**（`astro.config.mjs`）：在 `swup({...})` 配置中显式加 `loadOnIdle: false`，让 `@swup/astro` 改为**同步静态 import** Swup + 插件，脚本末尾直接 `initSwup()`（`new Swup` + `window.swup = r`），不再等待 `load`/空闲。构建产物 `page.C67wxfCi.js` 末尾为 `window.swup=r}pe();`，不含 `requestIdleCallback`/`onIdle`/`load` 监听，首屏 DOMContentLoaded 前即就绪。

- **结果**：刷新后首次点击菜单/分类即可正常跳转（真实浏览器验证：`/` → 首次点击 `/categories` 即成功跳转，`window.swup` 为 `object`）。

## [v1.3.25] - 2026-09-04

### 修复：番剧 tab 切换「先变白」+ 朋友圈「加载更多」按钮消失

- **番剧页白屏闪烁（用户反馈「点击按钮跳转，下面的番剧图先变白然后跳转」）**
  - **现象**：tab 切换瞬间，框三整块番剧网格先变白（透明度降到 0）+ 下沉 2rem，再淡入新内容
  - **根因**：1.3.24 引入的入场动画 `bangumi-list-enter{opacity:0} + fade-in-up(translate:0 2rem)`——切换时整个 `#bangumi-list` 先变纯白再下移淡入，被感知为「先变白再跳转」
  - **修复**（`src/pages/bangumis.astro`）：彻底删除所有 opacity/translate 过渡动画类（`bangumi-list-loading` / `bangumi-list-enter` 及对应 keyframes），点击即 `setActiveTab + pushState` 即时反馈，fetch 完成直接 `innerHTML` 替换，无任何退场/入场动画；图片加载期由 `bg-(--btn-regular-bg)` 兜底，不再整块白

- **朋友圈「加载更多」按钮消失（用户反馈「页面最下方没有加载更多按钮」）**
  - **现象**：朋友圈底部没有「加载更多」按钮，动态只显示前 20 条
  - **根因**（两层）：
    1. **配置默认值自相矛盾**：`settings.yaml` 里 `fetchLimit`（拉取总条数）默认 20，`pageSize`（每次加载数量）默认 30，`fetchLimit(20) < pageSize(30)` → 只拉 20 条 → load-more 显示条件 `current < groups.length`（20 < 20）永不成立 → 按钮隐藏
    2. **旧配置结构未迁移**：`ac8bf5f`（v1.3.0 起）把 `friends` 设置从顶层 Tab 合并进 `extendPages` 分组后，`friends.astro` 只读 `theme.config.extendPages.friends.*`，但存量 configMap 仍是顶层 `friends` 键（`extendPages` 为空 `{}`），导致 `extendPages.friends` 恒为 null、回落硬编码 `limit: 20`
  - **修复**：
    - `settings.yaml`：`fetchLimit` 默认 `20 → 60`，help 注明「必须大于每次加载数量，否则按钮不显示」
    - `src/pages/friends.astro`：配置读取改为向后兼容——`friendsCfg = extendPages.friends ?: friends`，`fetchLimit`/`pageSize`/`blacklist`/`enable_random_fish` 统一从 `friendsCfg` 读，且 fetchLimit 硬编码回落从 `20` 改为 `60`（与 settings.yaml 默认对齐）
    - `src/layouts/MainGridLayout.astro`：随机钓鱼按钮门控的 `enable_random_fish` 同样改为向后兼容读取
  - **结果**：朋友圈渲染 60 条动态，60 组 > pageSize 30 → 「加载更多」按钮正常显示，点击分批展开剩余 30 条

## [v1.3.24] - 2026-09-04

### 修复：朋友圈两栏布局「单列右空」+ 番剧页 tab 按钮响应慢

- **朋友圈布局（用户反馈「布局都乱了」）**
  - **现象**：1.3.23 改 grid 双栏后，日期头 `grid-column:1/-1` 强制满宽断行 + 大多数日期组只有 1 条动态，导致右列 100% 空，整页看似单列布局「碎了」
  - **根因**：CSS Grid 的满宽日期头与稀疏单条日期组在「双栏视觉」上本质矛盾——断行后每组只填左列、右列空，无法靠 grid 的 align-items:stretch 掩盖
  - **修复**（`src/pages/friends.astro` + `src/styles/components.css` + `src/scripts/assets/friends.bundle.js`）：改用 **CSS columns 双栏 masonry**——`column-count:2`（≥768px）天然平衡变高卡片；每 (date + row) 包成 `.friends-timeline-group` 配 `break-inside:avoid`，保证日期与卡片不被分到两列；日期头改为左色条 + 日历图标的列内紧凑分组头；load-more 改为隐藏整组（`group.style.display`），避免日期孤儿；group/blacklist 脚本在 row 被合并/移除后清理空 group
  - **结构变化**：`friends.astro` 的内层 `th:with` div 去掉 `th:remove="tag"`、加 `class="friends-timeline-group"`（每条动态一个真实包裹）

- **番剧页按钮响应（用户反馈「按钮响应很慢」）**
  - **现象**：tab 点击后内容「消失再出现」，整体感知约 400-500ms，按钮发滞
  - **根因**：`loadArchive` 串行做了 200ms 退场淡出+下沉（`bangumi-list-exit`）+ 200ms 入场（`bangumi-list-enter`），让 ~280ms 的 fetch 夹在两段动画中间显得很慢；点击到首次视觉变化虽然即时开始退场，但用户主观把「200ms 整块淡出」算成响应耗时
  - **修复**（`src/pages/bangumis.astro`）：改为**点击即 `setActiveTab + pushState` 给即时反馈**（tab 高亮 + URL 同步瞬时完成），fetch 期间内容保持可见只轻微变透明（`bangumi-list-loading` 透明度 0.55，150ms 平滑过渡，禁点击），不再整块退场；fetch 完成后换 innerHTML + 重播 150ms `fade-in-up` 入场；移除 `transitionend` + 400ms 兜底定时器（已不需要等退场）。fetch 是硬下限（~280ms）无法压缩，但点击到「有反馈」从 ~200ms（等退场结束）压到 0ms，主观响应感显著提升

## [v1.3.23] - 2026-09-04

### 优化：番剧页计数行移至框三 + 朋友圈改双栏网格布局

- **番剧页计数行下移（参考 Firefly bilibili 页）**：框一 PageHeader 改回静态（无计数/筛选徽章），把「共 N 部」+「已筛选」徽章移到框三顶部（`#bangumi-list` 内），随局部 PJAX 整体替换自动更新；删除 `syncHeader()` 跨框同步逻辑
- **朋友圈改双栏**：`flex` 纵向时间轴（带虚线/圆点）改为 `display:grid; grid-template-columns:repeat(2,1fr)` 桌面双栏、移动单列；日期头 `grid-column:1/-1` 跨两列；卡片直接作为 grid item（去掉 col-line/col-card 包裹层）

### 修复：overlayscrollbars 挂载兜底改固定延迟，彻底移出 TBT 窗口

- **现象**：1.3.9 用 `requestIdleCallback(run)`（无 timeout）做兜底，但实测仍会在主线程**首个空闲点**触发挂载——19:16 / 19:17 两份报告中 overlayscrollbars 长任务分别落在 1.66s / 2.68s，都在 FCP→TTI 的 TBT 窗口内，长任务未真正消除
- **根因**：Lighthouse 4x CPU 节流下主线程总会有空闲间隙，`requestIdleCallback` 无 timeout 只是「不强制在 1.5s」，不等于「延到 TTI 之后」
- **修复**（`src/scripts/app.ts` `runWhenIdle`）：去掉 `requestIdleCallback` 兜底，统一改为「首次用户交互（pointerdown / wheel / touchstart / keydown）触发 + `setTimeout(run, 3500)` 固定延迟兜底」。3.5s 远在 TTI(~1.7s) 之后，且 Lighthouse 不模拟交互，故该长任务在报告中彻底消失；等待期间原生滚动条正常工作，切换不可感知

## [v1.3.9] - 2026-09-03

### 优化：自定义滚动条挂载延后到「首次交互 / 主线程空闲」，移出 TBT 统计窗口

- **现象**：Lighthouse 主线程明细中 overlayscrollbars 挂载是首页一次 ~127ms 的归因长任务（start ~1687ms，仍落在 FCP→TTI 的 TBT 统计窗口内），拉高 TBT
- **根因**：旧逻辑用 `requestIdleCallback(task, { timeout: 1500 })` 错峰，`timeout` 会在主线程持续忙碌（图片解码 / 内联脚本执行）时**强制**把挂载塞进忙窗口执行，成为长任务；自定义滚动条纯属装饰，无需抢首屏
- **修复**（`src/scripts/app.ts` `runWhenIdle`）：挂载时机改为「首次用户交互（pointerdown / wheel / touchstart / keydown）或 `requestIdleCallback` 真正空闲」二选一，去掉 `timeout` 强制；Lighthouse 不模拟交互，故交互触发在报告中不再出现，空闲兜底也会自然落在忙期之后。Safari 无空闲回调时退化为 3s 延迟（原为立即执行）。原生滚动条在等待期间正常工作，切换不可感知

## [v1.3.8] - 2026-09-03

### 修复：首页 banner 冗余 `<link rel=preload>` 触发「preloaded but not used」警告

- **现象**：Lighthouse 报首页 banner 图 `<link rel=preload>`「preloaded but not used」——SSR 固定预加载亮色壁纸 `srcX`，但暗色模式下 `banner-theme-switch.js` 会把 `<img>.src` 切到 `data-theme-src`（暗色壁纸），亮色 preload 永不使用
- **根因**：主题暗色是 `html.dark` 类切换（后台默认 / 手动开关 / 自动模式驱动），而 `<link rel=preload>` 的 `media` 只能匹配媒体查询、匹配不了类——无法用 `media="(prefers-color-scheme: dark)"` 正确门控（只在「自动模式 + 系统深色」时命中，手动/默认暗色仍失效）
- **修复**（`src/layouts/MainGridLayout.astro` + `src/utils/image-suffix.ts`）：移除冗余的 banner `<link rel=preload>` 及仅供它使用的 `carouselHasImg` / `carouselFirst` / `carouselFirstSrcX` 局部变量。banner `<img>` 本身已带 `loading=eager` + `fetchpriority=high`（单图与轮播首图均是），预加载扫描器可直接发现并高优先级拉取，preload 完全冗余；删掉后警告在亮 / 暗 / 手动全部场景消失，LCP 影响可忽略

## [v1.3.7] - 2026-09-03

### 修复：banner_width=0 仍显示 `?w=0`（字符串 `"0"` 类型陷阱，1.3.6 修复未生效的根因）

- **现象**：部署 1.3.6 并后台设 `banner_width=0` 后，线上首页 banner 仍输出 `?w=0`。实测 DB（`/registry/configmaps/Ethereal-configMap`）中 `banner_width` 存储为 **字符串 `"0"`**——Halo 后台 FormKit 的 `number` 字段以字符串形式落库
- **根因**：主题 Thymeleaf 表达式里 `w == 0` 是整数比较，SpEL 对 `String "0" == Integer 0` 判 `false`，导致 `CDN_SUFFIX_RAW` 首条短路与 `w0Strip()` 的剥离分支双双失效；`suffix` 走 `provider == 'lsky' ? '?w=' + w` 拼出 `?w=0`。1.3.6 的 `w0Strip` 逻辑本身正确，但被 `w == 0` 这个类型陷阱挡在门外
- **修复**（`src/utils/image-suffix.ts`）：新增统一判定常量 `W_IS_ZERO = "(w == 0 or w == '0')"`，同时兼容数字 `0` 与字符串 `'0'`，并替换 `CDN_SUFFIX_RAW` 与 `w0Strip()` 两处 `w == 0`。因 `CDN_SUFFIX_RAW` 为 banner / 卡片封面 / 文章图 / 头像四路宽度共用，此修复一并覆盖 `card_cover_width` / `article_image_width` / `avatar_size` 设为 0 时的同类隐患

## [v1.3.6] - 2026-09-03

### 修复：banner_width=0（原图）时剥离 src 自带的 `?w=0` 冗余后缀

- **现象**：后台图片处理宽度设为 0（期望原图）时，首页 banner 的 `<img>` / `<link rel=preload>` / 暗色壁纸 URL 仍出现 `?w=0`。根因是 Lsky 图床原图链接默认就带 `?w=0`，用户 banner src / darkSrc 配置里复制的是这份 URL；主题 CDN 后缀逻辑（`CDN_SUFFIX_RAW` 首条 `w == 0 ? ''`）本就保证 w=0 时不追加后缀，但 src 自带的 `?w=0` 会原样透传到最终 URL
- **修复**（`src/utils/image-suffix.ts`）：新增 `w0Strip()` 辅助，banner 全链路 URL 生成统一改走它——单图 `srcX`/`darkSrcX`（`bannerMediaVars`）、轮播首图 `carouselFirstSrcX`（`bannerThWith`）、轮播逐张 `carouselImgSrcExpr` / `carouselDarkImgSrcExpr`、移动端复用 `bannerMediaVars`。当 `w == 0` 时经 `#strings.replace` 剥离 `?w=0` 与 `?width=0`（Lsky/Halo 两种原图标记），非 0 时沿用原「src + (可加后缀 ? suffix : '')」逻辑不变

## [v1.3.5] - 2026-09-03

### 性能：`#main-grid` CLS 修复（0.097 → 目标 <0.05）

Lighthouse 13.4.1（2026-09-03 12:29 桌面档）对 `www.lqbby.com` 的审计报 CLS **0.097**，其中 `#main-grid`（2697×1496 巨型网格）一项贡献 **0.096（99.4%）**。

- **`transition: all` 是元凶**：`MainGridLayout.astro` 的 `#main-grid` 类串长期带 `transition duration-[var(--dur-banner,700ms)]`（即 `transition-property: all`），首次绘制后任何布局属性（`top` / `min-height` / `grid-template-*`）变化都会被动画化 700ms，期间浏览器每帧重排一次巨型元素，被 Layout Instability API 计入 CLS 会话窗口
- **去掉 Tailwind `transition duration-...`**（MainGridLayout.astro）：首帧与运行期不再有过渡开销，CLS 巨型位移不再每帧计入
- **显式补回 `transition: translate`**（components.css）：Tailwind 的 `transition` utility 默认 `transition-property` 不含独立 `translate` 属性（只含 `transform`），所以 `home-switch` 时网格 `translate: 0 var(--banner-height-extend)` 的同帧切换**原来就不靠 Tailwind 类**——靠的是 `#main-panel-wrapper` 的 `html.home-switch` `top` transition（L300-303）。但为防御万一与保持显式，CSS 显式声明 `transition: translate var(--dur-banner, 700ms) cubic-bezier(0.4, 0, 0.2, 1)`
- **`html:not(.page-ready)` 首帧禁用**（components.css）：复用 `#wave-container` 已用的同款范式（L370-372）。`translate: none` ↔ 长度值不可插值（CSS Transforms 2），首帧启用过渡会形成瞬移；同时首帧 `--banner-height-extend` 从 vh 兜底切到 JS px 时，禁用过渡可避免该过渡被纳入 CLS 计分窗口。`app.ts` 双 rAF 后加 `page-ready` 恢复

### 无障碍：Lighthouse axe-core 92 → 100（三处全部修复）

- **`#back-to-toc-btn` `aria-allowed-attr`**：原脚本 `syncTocBtnState()` 把 `aria-expanded` 写到外层 `<div id="back-to-toc-btn">`（`getTocBtn()` 返回 div），div 无隐式 role，挂 `aria-expanded` 触发 axe 违规。改为写到内层 `<button>`（SSR 已正确写在 button 上）—— class 仍在 div（CSS `.toc-active` 在外层），运行时与首屏一致
- **`.home-moment-link` `target-size`（520.7×20，需 ≥24×24）**：补 `min-h-[24px]`，使跑马灯条目点击区高度达标
- **`a.btn-regular`「更多」`target-size`（70×32，最小可点空间被压到 70×6）**：根因是 CSS 绘制顺序——`#home-moments-marquee` 是 `position: relative`（Group 3：positioned），`.home-moment-link` 是 static（Group 2）但被父级提到 Group 3 一起绘制；而「更多」是 Group 2，画在 marquee **下面**，跑马灯链接的 bounding rect（axe 忽略 `overflow:hidden` 裁剪）就把按钮压到只剩 6px 安全区。现给「更多」加 `relative z-10`（Group 4：positioned + z-index），按钮升到顶层，安全区恢复完整 70×32

## [Unreleased]

### 性能：评论区与图片灯箱懒加载（首屏 JS -~200KB）

- **comment-next.iife.js（120KB，45% 未用）随 HTML 立即执行**：`<halo:comment>` 由 Halo 服务端注入脚本，而评论区在文章/瞬间/单页/友链/图床页的首屏之下。现把注入产物包进 `<template id="comment-lazy-template">`（内容惰性：脚本不下载、web component 不升级），由 `app.ts` 的 IntersectionObserver 在评论区接近视口（提前 400px）时把内容搬到占位节点激活；无 IO 老内核退化为立即加载，Swup 换页后按新 DOM 重新绑定
- **PhotoSwipe 全家桶（~80KB）每次 page:view 都 eager 初始化**：首屏几乎从不点击图片。现改为武装一个 capture 阶段的轻量委托监听，click 真正命中图库图片（`.custom-md img` / `#post-cover img` / `.moment-media img` / `#photo-detail-image`）时才动态拉起 PhotoSwipe 并重放本次 click 开图；拦截时 `preventDefault` 避免图片被链接包裹时的意外跳转。相册页（photos-gallery）保持原 eager 逻辑不变

### 修复：音乐播放器封面降采样对 Meting 代理地址不生效

- **播放列表封面白耗约 1 MiB 传输**：`MusicPlayer` 的 `picWithParam` 此前只识别网易云直链的 `?param=WxH` 参数，而歌单接口返回的是自建 Meting 代理地址（形如 `.../api?server=netease&type=pic&id=xxx&auth=xxx`，**不含 `param`**），正则不命中，代理便无条件 302 到 `?param=300y300`——18 首歌的列表封面实测共 1072 KiB，而屏幕上只显示 32px。现补充代理形态识别：URL 命中 `type=pic` 时通过 `URL.searchParams` 追加 `&size=N`（`auth` 原样保留；服务端自 2026-09-03 起已放行 `size` 参数，鉴权串由 `server+type+id` 计算、不含 size，故既有链接照常有效）。实测封面体积降 **92%**（`300y300` → `100y100`），首页约省 986 KiB。网易云直链、站内相对路径、图床地址的处理均维持原样

### 修复：CI 类型检查失败（astro check 4 errors）

CI 的 `pnpm check` 步骤此前报 4 个错误，均为历史遗留、与近期改动无关：

- **X5 兼容改动误留指令值**：提交 `22edba2`（X5 老内核下语言/亮暗/搜索按钮可见可交互）把
  `Navbar.astro` 的 Search / LanguageSwitch / LightDarkSwitch 由上游的 `client:only="svelte"`
  改为 `client:load` 以参与 SSR（否则 hydration 失败时按钮直接消失），但**误将 `="svelte"` 留在
  了 `client:load` 后面**。`client:load` 是布尔指令、不接受值，导致 `ts(2769)` 类型错误。
  现去掉该值：SSR 行为不变、X5 兼容效果保留，类型检查通过

- **`scripts/rasterize-pattern.mjs` 缺 `@resvg/resvg-js`**：一次性构建工具（把 SVG 纹理预渲染为
  PNG，产物 `pattern-*.png` 已提交），不参与 CI 与 astro build。该依赖是原生二进制，仅重新生成
  纹理时才需要；为它常驻 `devDependencies` 会无谓拖慢 CI 安装，故关闭本文件的类型检查并加注释说明

### 魔改：移动端菜单触控优化

- **触控区域放大到 44px 标准**：移动端菜单（手风琴样式）此前展开箭头按钮仅约 37 × 37 px、菜单行高约 40px，均低于移动端 44px 最小触控标准，容易点空或误触跳转。现将箭头按钮改为固定 `h-11 w-11`（44 × 44）、菜单行与子菜单项内边距由 `py-2` 提升至 `py-3`（行高约 48px），面板宽度由 `w-40`（160px）加宽到 `w-48`（192px）

- **新增「移动端菜单整行展开」开关**（主题设置 → 魔改开关）：开启后，有子菜单的项点击整行任意位置即展开/收起子菜单，符合手风琴直觉、大幅降低误触；关闭则维持原版行为（仅右侧箭头可展开，点击文字跳转）。**注意开启后父项自身链接将无法直接访问**，如有需要请在子菜单里补一条对应条目。默认关闭

### 移植上游 v1.2.2-rc-3 / rc-4（Helio-RC db31f51 / c31267c）

历史已与上游连通，以下改动为**直接 cherry-pick**，与上游逐字节一致（`Search.svelte`、`photo.astro` 已零差异）：

- **照片详情页首尾照片提示 (#62)**：图库详情页处于第一张/最后一张照片时，上一张/下一张按钮原本空白无提示，现补充提示文案，与文章页提示体验保持一致

- **照片详情页无 EXIF 提示 (#63)**：照片无 EXIF 信息时补充「此照片无 EXIF」提示，避免信息区空白

- **移动端搜索结果标题错位 (#64)**：修复窄窗口下搜索结果标题因 `inline-flex` 默认不换行而溢出、箭头图标错位的问题

- **搜索结果摘要显示 HTML 标签文本 (#64)**：修复搜索摘要中正文的 HTML 标签（如 `<strong>`）被当作字面文本显示的问题，现将其替换为空格，仅保留搜索高亮标记

### 移植上游 v1.2.2-rc2（Helio-RC e2ea7f5 / 145a0ce）

- **公告栏支持写入 HTML (#55)**：公告内容新增「内容呈现为HTML」开关与「内容最大高度(px)」设置（默认 640，范围 40–1024）。开启后内容按 HTML 渲染（`th:utext`）且高度由内容自身决定，仅以上限约束、超出部分内部滚动，防撑破侧栏；关闭时按纯文本转义（`th:text`），维持原有行为。**此项取代本地此前无条件改用 `th:utext` 的改动**（提交 a71efcd），冲突处一律采用上游原版实现

- **移动端搜索框聚焦后未占满宽度 (#58)**：移动端搜索面板输入框误用桌面端 `focus:w-60` 定宽，聚焦后反而缩窄并出现空白，已移除

- **回退三栏布局右侧栏空态自动收列 (#33)**：删除 `rightSidebarHasContentExpr` 空态判定与 `th:with` 作用域提升包裹层，布局类改回直接读 `theme.config.layout.pageLayout.layoutMode`；三栏模式下右侧栏为空时不再自动切换两栏，保持布局一致性，目录组件可正常使用

### 修复

- **分类导航栏滑块高亮溢出 (#52)**：`.category-scroll` 增加 `position: relative`，修正 `scrollPillIntoView` 的 `offsetLeft` 基准（此前相对整个 track，窄屏下过度滚动）；`moveLiquid` 与滚动区可见窗口求交集：半露只铺可见段、完全滚出时隐藏，防止液态滑块（滚动区兄弟节点、不受 `overflow`/`mask` 约束）底色溢出到相邻 pill / 分隔线

## [v1.2.0] - 2026-08-23

> 呀呼！欢迎使用 **Ethereal 主题 v1.2.0** 版本
>
> 本次更新带来前台多语言切换、时间轴与技能页面、追番插件页面适配等重大功能更新，后台设置合并「扩展页面」分组，并带来三栏布局空态收列、移动端目录弹窗等体验优化
>
> 如在主题使用中遇到问题或者建议，欢迎在 [Issue](https://github.com/AloneNanNan/halo-theme-ethereal/issues) 中提交。也可前往 [主题交流群](https://qm.qq.com/q/onMpJjYvgQ) 进行讨论

### Tips

- 更新后建议前往「主题设置 → 详细」进行 重载主题配置 & 清除模版缓存 两项操作，确保新设置项正常生效

### 新增

- **前台语言切换面板**：导航栏新增语言切换按钮，访客可实时切换 简体中文 / 繁體中文 / English 三语界面（会同步后台界面语言），并补齐全站 i18n 词条覆盖；可在「主题设置 → 布局设置 → 菜单栏设置 → 语言切换」控制按钮显示，并在「主题设置 → 样式设置 → 主题语言」配置访客未手动切换时的默认语言

- **时间轴与技能页面**：新增时间轴与技能两个页面模板，支持条目分组筛选与自定义内容展示（教育经历 / 工作经历 / 项目经历等类型）；可前往「主题设置 → 扩展页面」关联自定义页面并配置 by @Leave-Time in #27

- **追番插件页面适配**：新增适配 [追番插件](https://www.halo.run/store/apps/app-OTFPN) 页面，支持类型与状态双维筛选、分页，B 站式竖版封面卡片（渐变覆盖信息、评分角标、追番/播放/弹幕/硬币四项统计），可安装后体验 #28

- **移动端目录悬浮按钮与目录弹窗**：当页面无可见目录时，右下角显示目录悬浮按钮，点击呼出 TOC 弹窗，按钮图标随弹窗状态切换；可在「主题设置 → 布局设置 → 浮动导航按钮」开启 #29

- **菜单栏自定义图标与 Logo**：菜单项支持在 Halo「菜单管理」中为每个一级菜单配置 Iconify 图标；菜单栏设置新增 Logo 上传项，留空回退主题默认图标

- **分类导航栏组件**：新增水平滚动 pill 导航栏（首页 / 归档 / 分类 / 全部分类），液态滑块跟随高亮；可在「主题设置 → 布局设置 → 页面布局 → 分类导航栏」开启

### 优化

- **三栏布局右侧栏空态收列**：三栏布局下右侧栏无组件时，整页自动按两栏模式渲染（收起第三列），避免空栏占位；空态文章页目录改走两栏浮动目录 by @Helio-RC in #33

- **分组页筛选交互统一**：抽取分组页页头与筛选标签公共组件，统一友链 / 装备 / 瞬间 / 相册 / 作品集 / 技能 / 时间轴七个分组页的筛选标签尺寸与视觉，「已筛选」徽章全站统一

- **后台设置迁移**：「朋友圈」相关设置迁移至「扩展页面」Tab，设置层级更清晰

- **天气 Key 配置说明**：腾讯位置服务 Key 的配置提示补充配额分配说明 #30

### 其它

- 版本号提升至 v1.2.0

- README 优化 by @Helio-RC in #43 #44

- 依赖升级：astro 7.2.1 → 7.2.3 by @dependabot[bot] in #34；npm 依赖组批量更新 by @dependabot[bot] in #41

### 新贡献者

- @Leave-Time 在 #27 中完成了他们的首次贡献

**变更完整日志**: https://github.com/AloneNanNan/Halo-Theme-Ethereal/compare/v1.1.2...v1.2.0

## [v1.1.2] - 2026-08-17

### Tips

- ⚠️⚠️⚠️ **更新必读**：本次为破坏性更新，已保存的大部分主题设置会丢失，升级后需重新配置。受影响的设置项：Banner 布局、Banner 样式、标题与副标题、动画速度、欢迎弹窗、菜单、页面布局、文章卡片布局、菜单栏设置（含菜单样式/固定菜单栏/配色切换/访客样式切换）、浮动导航按钮、配色切换开关
- 更新后建议前往「主题设置 → 详细」进行「重载主题配置」与「清除模版缓存」两项操作，确保新设置项正常生效

### 新增

- **Halo 2.26 页面布局契约模板适配**：新增 `layout.astro` 契约模板，供插件自有前台页面复用主题外壳，含样式顺序对齐、PAGE_WIDTH 常量与动画配置优化
- **后台设置重组**：新增「布局设置」设置页，将分散在多个页面的布局类设置集中管理；「基础设置」页删除，Banner 样式/标题与副标题/动画速度迁入「样式设置」页；详细迁移清单见下方 **设置项迁移**

### 设置项迁移

⚠️⚠️⚠️ 本次为破坏性更新，以下设置项因组键变更，升级后配置将回落默认值，需用户重新配置。

| 设置项       | 原位置   | 新位置                       |
| :----------- | :------- | :--------------------------- |
| Banner 布局  | 基础设置 | 布局设置                     |
| Banner 样式  | 基础设置 | 样式设置                     |
| 标题与副标题 | 基础设置 | 样式设置                     |
| 动画速度     | 基础设置 | 样式设置                     |
| 欢迎弹窗     | 基础设置 | 布局设置                     |
| 菜单         | 基础设置 | 布局设置                     |
| 页面布局     | 侧边栏   | 布局设置                     |
| 文章卡片布局 | 文章     | 布局设置                     |
| 菜单栏设置   | 样式设置 | 布局设置                     |
| 浮动导航按钮 | 样式设置 | 布局设置                     |
| 配色切换开关 | 样式设置 | 布局设置                     |
| 固定导航栏   | 样式设置 | 布局设置                     |
| 基础设置全页 | —        | **已删除**，原有设置全部迁出 |

升级后请前往「主题设置」对照上表逐项检查并重新配置。

### 优化

- **后台设置项重组**：基础设置 / 样式设置 / 侧边栏 / 文章四个设置页精简重构，设置层级更清晰；「样式」tab 更名「样式设置」
  - 布局设置包含：页面布局、Banner 布局、文章卡片布局、菜单栏设置（菜单 / 移动端菜单样式 / 固定菜单栏 / 配色切换 / 访客样式切换）、浮动导航按钮、欢迎弹窗
  - 样式设置包含：Banner 样式、标题与副标题、主题颜色、配色方案、样式开关、动画速度、外部字体
  - 侧边栏保留：小组件设置、个人简介小组件、公告小组件
  - 文章保留：版权声明、内容显示、目录、文章摘要、文章操作栏
- **配色（深浅色）切换**：「允许访客切换配色」移入菜单栏设置并改名「配色（深浅色）切换」，控制导航栏明暗切换按钮的显示
- **菜单栏设置**：「固定导航栏」更名「固定菜单栏」
- **菜单下拉框**：菜单选择由 radio 改为下拉框（menuSelect）
- **跨页切换性能**：拆分/重写跨页切换逻辑，改用浏览器原生平滑滚动，减少主线程阻塞 by @Helio-RC in #26
- **悬浮目录**：优化二栏样式下的悬浮目录，当页面宽度不足时自动隐藏，避免目录显示异常

### 修复

- 修复 v1.1.1 修改导致的两栏模式下目录不可见问题 by @Helio-RC in #26

### 其它

- 版本号提升至 v1.1.2
- **README 全面重写**：更新项目介绍、功能列表、安装说明，改版徽章

## [v1.1.1] - 2026-08-16

### 新增

- **访客前台样式切换面板**：导航栏「主题色」切换面板升级为「显示设置」面板（外观 / 壁纸双分区），访客可实时切换主题色相、文章列表/网格布局、卡片样式（悬浮 / 磨砂 / 瀑布流）、壁纸模式，以及横幅波浪、首页壁纸标题等壁纸设置；开关位于「主题设置 → 样式 → 菜单栏设置 → 访客样式切换」，可逐项配置
- **Banner 全屏与全屏透明模式**：新增 displayMode 显示模式开关（关闭/纯色、横幅、全屏、全屏透明），重构 Banner 高度体系与滚动落点；全屏透明模式下无横幅、整屏壁纸作为页面背景，配合「高级材质」使内容与组件卡片呈现磨砂透明效果，并可分别调节壁纸透明度、背景模糊度与卡片透明度
- **文章页隐藏封面图开关**：新增文章页正文上方封面图显示开关，列表/卡片封面不受影响 [#20]
- **网格封面高度自适应开关**：开启后封面自动拉伸填满卡片剩余高度，等高网格下同排封面等高、摘要下方不留白

### 优化

- **目录高亮重构**：高亮指示器改用主题色并同步动画速度档位，转场更平滑；二栏悬浮目录不再显示「此文章无目录」占位文案
- Banner 相关设置项拆分为「Banner 布局」和「Banner 样式」两项设置组；原「固定色调」开关移入「访客样式切换」并更名为「主题色相切换」
- 部分卡片样式、固定导航栏与网格细节显示优化

### 修复

- 文章卡片主题色装饰竖线与网格箭头未对齐标题 [#17] [#19]
- 文章分享海报点击保存无反应 [#22]
- 公告小组件 PC 端无法关闭 [#21]
- 固定导航栏与文章卡片相关布局问题
- 波浪与 Banner 浏览器兼容问题（Safari 首帧错位 / Edge 过渡缝隙），向下按钮独立于标题开关

### 其它

- 版本号提升至 v1.1.1，更新 release 与 README
- 新增 AGENTS.md 开发约定文档，README 补充说明
- 依赖升级：astro 7.2.0 → 7.2.1（补丁级更新） [#23]

## [v1.1.0] - 2026-08-11

### 新增

- **网格布局**：新增网格文章布局，优化多种文章布局卡片显示效果
- **移动端菜单抽屉样式**：菜单面板新增抽屉样式，支持手风琴/抽屉两种模式切换
- **固定导航栏开关**：新增固定导航栏开关，菜单栏设置移入样式设置页并默认关闭欢迎弹窗
- **入场欢迎卡片**
- **Banner 视频/动图播放与多图轮播**：移动端独立图片来源，外部链接去重及相关修复 [#15]
- **个人简介在线状态**功能
- **动画速度三档设置**（舒缓/均衡/疾速/自定义），动画时长全面变量化 [#12]
- **适配心愿便签插件**：新增心愿墙便签视框与发布交互
- **适配日程日历插件**：新增配套最近日程小组件
- GitHub Issue 模板（Bug / Feature / Enhance / Security / Help）

### 修复

- 音乐播放器 401、公告移动端不显示、页脚间距、移动端卡片悬浮效果及部分设置项优化 [#11] [#13]
- 视频 Banner 宽度较窄时暂停按钮无法触发（Lighthouse 审计） [#16]
- Banner 视频媒体控制与入场动画，消除移动端来源判定双实现
- 移动端封面图不铺满卡片（显式锁定 calc 保留两侧边距），README 同步目录结构说明
- 所有小组件装饰线未对齐标题
- CodeQL 扫描告警（strip-html-comments 结束标签宽松匹配与未闭合注释处理、external-link-redirect 头像 URL 协议白名单）
- lockfile 与 package.json 不同步；重新解析 lockfile 使 serialize-javascript overrides 生效（4.0.0 → 7.0.7，告警清零）

### 其它

- 版本号提升至 v1.1.0，更新 release 与 README
- 系统 Git 升级至 2.50.1，lint-staged 恢复 17（PR 原版）

## [v1.0.8] - 2026-08-07

### 新增

- **主题切换动画与交互**：基于 View Transitions API，4 种样式可配置；keyframes 数值化、跨平台适配与 wipe 优化，统一各平台行为并补充兼容性提示
- **底部波浪效果三选开关**（关闭/开启/移动端关闭），移动端跳过动画省主线程

### 修复

- **可访问性**：键盘操作、ARIA、对比度提升；Label in Name、ARIA 菜单结构；搜索框补 id/name；首页 h1 兜底（banner 标题缺失时用隐藏站点名，消除 Swup 无障碍警告）
- **安全面审计**：协议白名单、服务端排序、去重试、冷却 + honeypot、危险 scheme 黑名单（放行 ftp/blob 等无害协议）等
- **性能/加载审计**：懒加载 + srcset、脚本门控、TOC IntersectionObserver、动画暂停等
- 全局清理 Swup v3 死事件 `swup:contentReplaced`（18 处，v4 从未分发），消除换页脚本重执行导致的监听器累积与死事件残留
- 右侧边栏换页重播入场动画（swup-visited 会话标记门控）、刷新闪烁、入场动画类改静态
- 静态资源引用统一加版本指纹，避免 CDN 缓存失效；补全菜单面板 ARIA 语义
- 回退正文图片 srcset，修复灯箱打开过小
- 摘要打字机去除重复代码

### 优化

- 移除内联 onclick 改用事件委托，upvote 失败回滚、文章正文 noscript 降级
- 版本号统一从 theme.yaml 读取，修复 ASSET_VERSION 构建期注入

### 其它

- 版本号提升至 v1.0.8，同步 README 截图与 QQ 交流群、CD 工作流权限
- 统一 pnpm 版本

## [v1.0.7] - 2026-08-04

### 新增

- 为缺少 meta description 的页面自动添加 description

### 修复

- 统一页面 title/OG 输出并修复头部结构问题
- ASSET_VERSION 构建期注入，版本号统一从 theme.yaml 读取
- 站点统计字数口径减少误差，热门文章改为全量拉取

### 优化

- 站点统计 / 资源加载 / 首屏 CLS
- 站点统计图标统一为圆角风格，优化字数统计与小组件折叠逻辑

## [v1.0.6] - 2026-08-03

版本号提升至 1.0.6（git 历史中无功能变更记录）。

## [v1.0.5.1] - 2026-08-03

### 新增

- **文章打赏功能**与操作栏设置项，优化按钮图标动效
- **友情链接自助提交功能**，优化部分按钮样式与圆角

### 修复

- 旧版插件下 /links 页面崩溃
- 消除外链模态框 XSS 注入

### 优化

- 分享海报与外链模态框显示，友链验证码与海报高度
- 统一图片 CDN 后缀生成，合并右侧边栏重复代码

### 其它

- 版本号提升至 1.0.5.1
- CD 工作流增加手动触发，支持按 tag 手动同步应用市场
- 新增 Halo 应用市场同步工作流（仅同步，不构建）
- README 更新小组件列表、项目结构及功能描述

## [v1.0.4] - 2026-07-31

### 新增

- **公告小组件** & 一言 API 可配置 & 个人简介设置迁移 & 统一小组件边距
- **主题署名开关**，优化移动端导航交互，修复安全风险
- **文章分享海报**、按钮动效优化、卡片悬浮增强
- **朋友圈页面重构**：新增朋友圈黑名单设置、友情链接页面随机跳转功能优化、兼容性改造
- **卡片悬浮效果**：卡片悬停时轻微上移并显示主题色阴影
- **自定义字体功能**，单页评论区跟随 Halo 设置
- **适配项目集插件**
- **主题登录认证界面重构**，引入动画角色交互面板
- template + JS 的 **CDN 正文图片方案**，优化图片处理默认值

### 修复

- 统一标题 UI 提交导致分类/标签页布局异常
- 图片自定义格式失效、正文图片双重加载与空跑问题
- 分享海报摘要读取 Halo 后台数据，不再依赖摘要框开关
- 个人简介跳转 /login 瞬间样式散架、友链随机访问自定义分组失效（改回 DOM 方案），新增随机访问与随机钓鱼跳转动效
- meta description 标签缺失 `th:` 前缀

### 优化

- 移除卡片 3D 倾斜功能，优化作品集/装备库页面
- 图片处理扩展、外部字体非阻塞加载、JS 打包优化
- 统一各页面标题 UI 与间距样式

### 其它

- 版本号提升至 1.0.4
- README 更新预览表格、组件列表、页面支持及项目结构

## [v1.0.1] - 2026-07-23

### 新增

- 🎉 初始提交：Ethereal Halo 主题首发（基于 Fuwari 二次开发的 Halo 增强型主题），包含首页、文章、分类、标签、归档、友链、朋友圈等页面及基础设置项

### 修复

- 朋友圈部分文章溢出卡片
- Halo 徽章分支名 master → main

### 其它

- 版本号提升至 1.0.1，更新 README

---

[Unreleased]: https://github.com/AloneNanNan/halo-theme-ethereal/compare/v1.2.0...HEAD
[v1.1.2]: https://github.com/AloneNanNan/halo-theme-ethereal/compare/v1.1.1...v1.1.2
[v1.1.1]: https://github.com/AloneNanNan/halo-theme-ethereal/compare/v1.1.0...v1.1.1
[v1.1.0]: https://github.com/AloneNanNan/halo-theme-ethereal/compare/ae09a21...35707ae
[v1.0.8]: https://github.com/AloneNanNan/halo-theme-ethereal/compare/9231bb5...ae09a21
[v1.0.7]: https://github.com/AloneNanNan/halo-theme-ethereal/compare/0b61402...9231bb5
[v1.0.6]: https://github.com/AloneNanNan/halo-theme-ethereal/compare/80ff959...0b61402
[v1.0.5.1]: https://github.com/AloneNanNan/halo-theme-ethereal/compare/3c815fc...80ff959
[v1.0.4]: https://github.com/AloneNanNan/halo-theme-ethereal/compare/4db643c...3c815fc
[v1.0.1]: https://github.com/AloneNanNan/halo-theme-ethereal/compare/71f837e...4db643c

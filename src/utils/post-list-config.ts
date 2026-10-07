/**
 * 文章卡片布局的 Thymeleaf 表达式生成。
 *
 * 与 settings.yaml 的 layout.postList 配置组对应，读取：
 *   defaultMode / list.coverPosition / list.coverRatio / descriptionLines /
 *   grid.masonry / grid.coverFullWidth / grid.coverAutoHeight
 *
 * 渲染结果输出到 PostList.astro 的容器上：
 *   th:classappend -> 追加布局类（post-grid-mode / post-list-mode / cover-left /
 *                     cover-fixed / grid-cover-inset|full / grid-cover-fill）
 *   th:attr        -> data-masonry（供瀑布流 JS 读取）
 *   th:style       -> --post-card-min-width（写死 320px）/ --post-desc-lines
 *
 * 安全约定：
 *   Thymeleaf 表达式（${} 内 / SpringEL）中不能出现 Tailwind 的括号类
 *   （rounded-(--radius-large)、w-[calc(...)] 等），否则解析器会误判括号
 *   导致 "Could not parse as expression"。因此所有含特殊字符的 Tailwind 类
 *   一律放静态 class 属性，Thymeleaf 只产出简单类名。
 *   类名拼接采用 '文本' + ${expr} 交替模式（与 friends.astro 已验证写法一致）。
 */

export function postListContainerThWith(): string {
  return (
    "postList=${theme.config?.layout?.postList}, " +
    "defaultMode=${postList?.defaultMode ?: 'list'}, " +
    "coverPosition=${postList?.list?.coverPosition ?: 'right'}, " +
    "coverRatio=${postList?.list?.coverRatio ?: 'fill'}, " +
    "descLines=${postList?.descriptionLines ?: 2}, " +
    "masonry=${postList?.grid?.masonry == true}, " +
    "coverFullWidth=${postList?.grid?.coverFullWidth == true}, " +
    "coverAutoHeight=${postList?.grid?.coverAutoHeight != false}, " +
    "gridClass=${defaultMode == 'grid' ? ' post-grid-mode' : ' post-list-mode'}, " +
    "coverExtra=${defaultMode != 'grid' and coverPosition == 'left' ? ' cover-left' : ''}, " +
    "coverRatioExtra=${coverRatio == 'fixed16x9' ? ' cover-fixed' : ''}, " +
    "gridExtra=${defaultMode == 'grid' and coverFullWidth ? ' grid-cover-full' : ' grid-cover-inset'}, " +
    "gridFill=${defaultMode == 'grid' and !masonry and coverAutoHeight ? ' grid-cover-fill' : ''}, " +
    // 系列角标用的「全部系列」快照（本地 1.5.57 迁入）。
    //
    // 🔴🔴 为什么放在**容器**上、而不是每张卡片自己去调 Finder：
    //     插件 `SeriesFinderImpl.get(name)` 内部就是 `loadSeries()` = `client.listAll(Post.class)`
    //     全表扫 + 分组排序，**没有缓存**。一页 9~10 张卡逐卡调 = 9~10 次全表扫。
    //     改成容器上取一次 `listAll()`（同样一次全表扫，但**整页只一次**），卡片再从结果里
    //     按名挑自己的系列 —— 开销从 O(卡片数 × 全表) 降到 O(1 × 全表 + 卡片数 × 系列数)。
    //
    // 🔴 版本门控必须**内联短路**（`pluginFinder != null and pluginFinder.available(...)`）：
    //     `listAll` 只有 ethereal-companion 1.1.0+ 才有，插件没装/没升级时直接调
    //     ⇒ SpEL 找不到方法 ⇒ **整页 500 / 正文截断**。
    //
    // ⚠️ 变量必须声明在本属性里（容器上），卡片组件用**祖先作用域**读取 ——
    //    同 `SeriesStrip` 的 `seriesList` 由 `th:with` 声明、`<section>` 在子层读，是同一套语义。
    "seriesAll=${pluginFinder != null and pluginFinder.available('ethereal-companion', '>=1.1.0') ? recentCommentsSeriesFinder.listAll() : null}"
  );
}

/** 追加的布局类：'文本' + ${变量} 交替拼接，避免 ${} 内复杂嵌套 */
export function postListContainerClass(): string {
  return (
    "' '" +
    " + ${gridClass}" +
    " + ${coverExtra}" +
    " + ${coverRatioExtra}" +
    " + ${gridExtra}" +
    " + ${gridFill}"
  );
}

/** 供瀑布流 JS 读取的数据属性（与 public/assets/post-list-layout.js 约定一致） */
export function postListDataAttrs(): string {
  return "data-masonry=${masonry ? 'true' : 'false'}";
}

/** 容器内联变量：网格最小列宽写死 320px，简介截断行数由配置控制。
 *  使用 Thymeleaf 字面量替换语法 |...| 拼接，避免手工 + 连接 */
export function postListContainerStyle(): string {
  return "|--post-card-min-width: 320px; --post-desc-lines: ${descLines};|";
}

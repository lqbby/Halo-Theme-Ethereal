<script lang="ts">
  import { onMount } from "svelte";
  import type { Hit, SearchResult } from "../types/searchResult";
  import { t } from "../utils/i18n";

  // ⑥ 状态统一：桌面/移动端共用一份 keyword、一份 result/loading、一份防抖与
  // AbortController 管线（原先桌面/移动各一份关键词与双 timer 的结构已合并）。
  // 两个输入框都 bind:value 到同一 keyword，天然双向同步。
  let keyword = $state("");
  let result = $state<Hit[]>([]);
  let isSearching = $state(false);
  let initialized = $state(false);
  // 最近一次「请求成功完成」对应的关键词：用于区分「还没搜完」与「搜完且 0 条」
  // （⑤ 空结果状态只在 completedKeyword 与当前关键词一致且 result 为空时展示，
  // 避免编辑关键词后拿旧关键词的空态冒充当前结果）。
  let completedKeyword = $state<string | null>(null);
  let searchTimer: number | undefined;
  let searchId = 0;
  let abortController: AbortController | null = null;

  let desktopInput = $state<HTMLInputElement | null>(null);
  let mobileInput = $state<HTMLInputElement | null>(null);

  const trimmedKeyword = $derived(keyword.trim());
  const showEmptyState = $derived(
    !isSearching &&
      completedKeyword !== null &&
      completedKeyword === trimmedKeyword &&
      result.length === 0,
  );
  const showIdleState = $derived(
    !isSearching && trimmedKeyword === "" && result.length === 0,
  );

  // {0} 占位替换（与 utils/external-link-redirect.ts 的 fmt 同式，i18n 参数格式一致）
  const fmt = (msg: string, ...args: (string | number)[]) =>
    String(msg).replace(/\{(\d+)\}/g, (m, i) =>
      args[+i] != null ? String(args[+i]) : m,
    );

  const escapeHtml = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  // 仅还原搜索高亮的 <mark>，其余 HTML 标签（如 <strong>）剥除为空格，
  // 避免摘要原样显示标签文本
  const renderHighlighted = (value?: string) => {
    const protectedValue = (value || "")
      .replace(/<mark>/gi, "\u0001")
      .replace(/<\/mark>/gi, "\u0002")
      .replace(/<[^>]*>/g, " ");
    return escapeHtml(protectedValue)
      .replaceAll("\u0001", "<mark>")
      .replaceAll("\u0002", "</mark>");
  };

  const excerptOf = (hit: Hit) => renderHighlighted(hit.description || hit.content || "");

  const setPanelVisibility = (show: boolean): void => {
    const panel = document.getElementById("search-panel");
    if (!panel) return;
    panel.classList.toggle("float-panel-closed", !show);
  };

  const togglePanel = () => {
    const panel = document.getElementById("search-panel");
    if (!panel) return;
    const willOpen = panel.classList.contains("float-panel-closed");
    panel.classList.toggle("float-panel-closed");
    if (willOpen) {
      void loadPopularPosts();
      mobileInput?.focus();
    }
  };

  // ── ⑤ 最近搜索：localStorage 存最近 8 条「请求成功完成」过的关键词 ──
  const RECENT_KEY = "ethereal_recent_searches";
  const RECENT_MAX = 8;
  let recentSearches = $state<string[]>([]);

  const loadRecentSearches = (): string[] => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is string => typeof item === "string" && !!item.trim())
        .slice(0, RECENT_MAX);
    } catch {
      return [];
    }
  };

  const rememberKeyword = (value: string) => {
    const next = [value, ...recentSearches.filter((item) => item !== value)].slice(
      0,
      RECENT_MAX,
    );
    recentSearches = next;
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // 存储不可用（无痕/被拦）时仅保留内存态，不中断搜索
    }
  };

  const clearRecentSearches = () => {
    recentSearches = [];
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch {
      // 同上，静默降级
    }
  };

  const useRecentKeyword = (value: string) => {
    // 写回同一份 keyword 后由统一 $effect 防抖管线自动开搜；顺手把焦点还给
    // 当前可见的输入框（桌面 lg 断点显示桌面框，否则用面板内移动框）
    keyword = value;
    focusVisibleInput();
  };

  // ── ⑤ 热门文章兜底：与 widget/PopularPosts.astro 完全同口径 ──
  // 数据来源（PopularPosts.astro 客户端脚本实测）：先读 sessionStorage 缓存
  // popular_posts_v1（{ts, posts} 结构、30s TTL），未命中再请求 Halo 内容接口
  // GET /apis/api.content.halo.run/v1alpha1/posts?page=0&size=5&sort=stats.visit,desc，
  // 过滤 spec.publish && spec.visible === "PUBLIC" 后取 Top 5。
  // 这里同键同结构先读缓存（组件已加载过时零额外请求、数据完全一致），
  // 未命中才调同一接口，并按同结构回写缓存与小组件共享。
  interface PopularPostRaw {
    metadata?: { name?: string };
    spec?: { title?: string; slug?: string; publish?: boolean; visible?: string };
    status?: { permalink?: string };
    stats?: { visit?: number };
  }

  interface PopularPost {
    title: string;
    href: string;
    visits: number;
  }

  const POPULAR_CACHE_KEY = "popular_posts_v1";
  const POPULAR_CACHE_TTL = 30 * 1000;
  const POPULAR_MAX = 5;
  let popularPosts = $state<PopularPost[]>([]);
  let popularSettled = false;
  let popularLoading = false;

  // 与 PopularPosts.astro 同规则：base 只接受字符串（分组对象会拼出
  // [object Object] 链接），取自 #theme-config JSON
  const getBasePath = (): string => {
    try {
      const el = document.getElementById("theme-config");
      if (!el) return "";
      const cfg = JSON.parse(el.textContent || "{}") as { base?: unknown };
      return typeof cfg.base === "string" ? cfg.base : "";
    } catch {
      return "";
    }
  };

  const toPopularPost = (post: PopularPostRaw, basePath: string): PopularPost | null => {
    const title = post.spec?.title || "";
    const permalink = post.status?.permalink || "";
    const href =
      permalink || basePath + "/archives/" + (post.spec?.slug || post.metadata?.name || "");
    // 与 PopularPosts 同面：非 http(s) 且非站内路径的链接不展示
    if (!title || !(/^https?:\/\//i.test(href) || href.startsWith("/"))) return null;
    return { title, href, visits: post.stats?.visit || 0 };
  };

  const mapPopularPosts = (posts: PopularPostRaw[]): PopularPost[] => {
    const basePath = getBasePath();
    return posts
      .map((post) => toPopularPost(post, basePath))
      .filter((post): post is PopularPost => post !== null);
  };

  const readPopularCache = (): PopularPost[] | null => {
    try {
      const raw = sessionStorage.getItem(POPULAR_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { ts?: number; posts?: PopularPostRaw[] };
      // 与 PopularPosts.getCached 同校验：结构不符或超 TTL 视为失效
      if (!parsed || !parsed.ts || !Array.isArray(parsed.posts)) return null;
      if (Date.now() - parsed.ts >= POPULAR_CACHE_TTL) return null;
      return mapPopularPosts(parsed.posts);
    } catch {
      return null;
    }
  };

  const loadPopularPosts = async (): Promise<void> => {
    if (popularSettled || popularLoading) return;
    popularLoading = true;
    try {
      const cached = readPopularCache();
      if (cached) {
        popularPosts = cached;
        popularSettled = true;
        return;
      }
      const response = await fetch(
        `/apis/api.content.halo.run/v1alpha1/posts?page=0&size=${POPULAR_MAX}&sort=stats.visit,desc`,
      );
      if (!response.ok) return;
      const data = (await response.json()) as { items?: PopularPostRaw[] };
      const published = (data.items || []).filter(
        (post) => post.spec?.publish && post.spec.visible === "PUBLIC",
      );
      const top = published.slice(0, POPULAR_MAX);
      try {
        sessionStorage.setItem(
          POPULAR_CACHE_KEY,
          JSON.stringify({ ts: Date.now(), posts: top }),
        );
      } catch {
        // 存储不可用时不缓存，数据本身仍可用
      }
      popularPosts = mapPopularPosts(top);
      popularSettled = true;
    } catch {
      // 拿不到热门数据时静默不展示该区（不编造标题）；下次打开面板可重试
    } finally {
      popularLoading = false;
    }
  };

  // 与 PopularPosts.formatCount 同规则：>=10000 走 locale 单位（万/k），
  // >=1000 用 x.xk，其余原样
  const formatVisits = (num: number): string => {
    if (num >= 10000) {
      const unit = t("widget.popularPosts.tenThousand", "万");
      const divisor = unit === "k" ? 1000 : 10000;
      return (num / divisor).toFixed(1).replace(/\.0$/, "") + unit;
    }
    if (num >= 1000) return (num / 1000).toFixed(1) + "k";
    return String(num);
  };

  // ── 统一搜索管线（⑥）：一份防抖 timer + 一份 AbortController ──
  const search = async (rawKeyword: string): Promise<void> => {
    const normalizedKeyword = rawKeyword.trim();
    const currentSearchId = ++searchId;

    // 取消上一次未完成的请求
    if (abortController) {
      abortController.abort();
    }
    abortController = new AbortController();

    if (!normalizedKeyword) {
      result = [];
      completedKeyword = null;
      // 复位加载态：空关键词分支提前 return，不经过下方 try/finally；
      // 而被 abort() 的前一请求在 finally 里因 searchId 已自增也不复位，
      // 否则「输入字符→立即清空」会让「搜索中」永久卡住。
      // 面板显隐此处不动：输入为空时面板若处于打开/聚焦态，展示最近搜索+热门兜底；
      // 关闭走既有通道（app.ts 点击外部关闭 / 移动端开关按钮）。
      isSearching = false;
      return;
    }

    isSearching = true;

    try {
      const response = await fetch("/apis/api.halo.run/v1alpha1/indices/-/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          keyword: normalizedKeyword,
          highlightPreTag: "<mark>",
          highlightPostTag: "</mark>",
          limit: 20,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Search request failed: ${response.status}`);
      }

      const data = (await response.json()) as SearchResult;
      if (currentSearchId !== searchId) return;
      result = data.hits || [];
      completedKeyword = normalizedKeyword;
      // ⑤ 记录「成功提交」关键词（有无命中都算提交成功，请求失败不记）
      rememberKeyword(normalizedKeyword);
      // ⑤ 结果为空时也要打开面板展示空态（原逻辑为空直接隐藏面板）
      setPanelVisibility(true);
      if (result.length === 0) {
        void loadPopularPosts();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        // 请求被主动取消，无需处理
        return;
      }
      console.error("Search error:", error);
      if (currentSearchId !== searchId) return;
      result = [];
      completedKeyword = null;
      setPanelVisibility(false);
    } finally {
      if (currentSearchId === searchId) {
        isSearching = false;
      }
    }
  };

  const scheduleSearch = (value: string) => {
    if (searchTimer) {
      window.clearTimeout(searchTimer);
    }
    searchTimer = window.setTimeout(() => {
      void search(value);
    }, 250);
  };

  const onInputFocus = () => {
    setPanelVisibility(true);
    void loadPopularPosts();
    // 与原桌面端 onfocus 行为一致：关键词非空但尚无对应完成结果时立即补搜一次
    if (trimmedKeyword && completedKeyword !== trimmedKeyword && !isSearching) {
      void search(keyword);
    }
  };

  // ── ④ Ctrl/⌘+K 唤起 ──
  const isEditableElement = (el: Element | null): boolean => {
    if (!el) return false;
    if ((el as HTMLElement).isContentEditable) return true;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  };

  const focusVisibleInput = () => {
    // 桌面搜索条在 <lg 时 display:none（offsetParent 为 null），据此选可见的那个
    const target =
      desktopInput && desktopInput.offsetParent !== null ? desktopInput : mobileInput;
    target?.focus();
    target?.select();
  };

  const onGlobalKeydown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.key.toLowerCase() !== "k") return;
    const active = document.activeElement;
    const inSearchInput = active === desktopInput || active === mobileInput;
    // 焦点已在其它输入控件（文章编辑、评论框、其它表单）时不抢快捷键；
    // 焦点在本组件的搜索框内时仍允许（用于面板被外部关闭后重新唤起）
    if (!inSearchInput && isEditableElement(active)) return;
    event.preventDefault();
    setPanelVisibility(true);
    void loadPopularPosts();
    focusVisibleInput();
  };

  onMount(() => {
    initialized = true;
    recentSearches = loadRecentSearches();
    // 本组件挂在 Navbar（#top-row，位于 #swup-container 之外），Swup 换页不卸载、
    // 监听全站只绑一次；仍按 onMount 返回清理的规范成对解绑，并先 remove 一次
    // 防御热重载/异常重挂载导致的重复绑定。
    document.removeEventListener("keydown", onGlobalKeydown);
    document.addEventListener("keydown", onGlobalKeydown);
    return () => {
      document.removeEventListener("keydown", onGlobalKeydown);
      if (searchTimer) window.clearTimeout(searchTimer);
      if (abortController) abortController.abort();
    };
  });

  $effect(() => {
    if (initialized) {
      scheduleSearch(keyword);
    }
  });
</script>

<!-- search bar for desktop view -->
<div
  id="search-bar"
  class="mr-2 hidden h-11 items-center rounded-lg bg-black/[0.04] transition-all hover:bg-black/[0.06] focus-within:bg-black/[0.06] dark:bg-white/5 dark:hover:bg-white/10 dark:focus-within:bg-white/10 lg:flex"
>
  <!-- 搜索图标：text-black/30 对比度不足，升为 /50 提升可见性（与 PostCard 元信息处理一致） -->
  <span class="icon-[material-symbols--search] pointer-events-none absolute ml-3 text-[1.25rem] text-black/50 transition dark:text-white/50"></span>
  <!-- placeholder 不能作为可靠的可访问名称（输入后消失），补 aria-label；
       id/name：表单字段可访问性（浏览器自动填充） -->
  <input
    id="search-input-desktop"
    name="search"
    placeholder={t("search.placeholder", "搜索")}
    aria-label={t("search.placeholder", "搜索")}
    bind:value={keyword}
    bind:this={desktopInput}
    onfocus={onInputFocus}
    class="h-full w-40 bg-transparent pl-10 text-sm text-black/50 outline-0 transition-all active:w-60 focus:w-60 dark:text-white/50"
  />
  <!-- ④ 快捷键提示徽标（⌘K）：纯提示不拦截点击，窄桌面隐藏避免挤压输入框 -->
  <kbd
    aria-hidden="true"
    title={t("search.shortcutHint", "按 Ctrl/⌘ + K 唤起搜索")}
    class="pointer-events-none mr-3 hidden shrink-0 rounded-md bg-black/[0.06] px-1.5 py-0.5 text-[0.65rem] font-medium leading-none text-black/40 dark:bg-white/10 dark:text-white/40 xl:block">⌘K</kbd
  >
</div>

<!-- toggle btn for phone/tablet view -->
<button
  onclick={togglePanel}
  aria-label={t("search.panel", "Search Panel")}
  id="search-switch"
  class="btn-plain scale-animation h-11 w-11 rounded-lg active:scale-90 lg:!hidden"
  type="button"
>
  <span class="icon-[material-symbols--search] text-[1.25rem]"></span>
</button>

<!-- search panel -->
<div
  id="search-panel"
  class="float-panel search-panel float-panel-closed absolute left-4 right-4 top-20 rounded-2xl p-2 shadow-2xl md:left-[unset] md:w-[30rem]"
>
  <!-- search bar inside panel for phone/tablet -->
  <div
    id="search-bar-inside"
    class="relative flex h-11 items-center rounded-xl bg-black/[0.04] transition-all hover:bg-black/[0.06] focus-within:bg-black/[0.06] dark:bg-white/5 dark:hover:bg-white/10 dark:focus-within:bg-white/10 lg:hidden"
  >
    <!-- 搜索图标：同桌面端，升为 /50 提升可见性 -->
    <span class="icon-[material-symbols--search] pointer-events-none absolute ml-3 text-[1.25rem] text-black/50 transition dark:text-white/50"></span>
    <!-- placeholder 不能作为可靠的可访问名称（输入后消失），补 aria-label；
         id/name：表单字段可访问性（浏览器自动填充） -->
    <!-- mobile 输入框：absolute inset-0 铺满搜索条；聚焦只需边框环提示，
         不能套用桌面端 focus:w-60 定宽（会破坏占满宽度，即 #58） -->
    <input
      id="search-input-mobile"
      name="search"
      placeholder={t("search.placeholder", "搜索")}
      aria-label={t("search.placeholder", "搜索")}
      bind:value={keyword}
      bind:this={mobileInput}
      onfocus={onInputFocus}
      class="absolute inset-0 bg-transparent pl-10 text-sm text-black/50 outline-0 dark:text-white/50"
    />
  </div>

  <div class="overflow-y-auto" style="max-height: calc(100dvh - 132px)">
    {#snippet popularSection()}
      {#if popularPosts.length > 0}
        <div class="px-3 pb-1 pt-3 text-xs font-bold text-50">
          {t("search.popular", "热门文章")}
        </div>
        {#each popularPosts as post}
          <a
            href={post.href}
            class="group flex items-center justify-between gap-3 rounded-xl px-3 py-2 transition hover:bg-(--btn-plain-bg-hover) active:bg-(--btn-plain-bg-active)"
          >
            <span
              class="min-w-0 truncate text-sm text-75 transition group-hover:text-(--primary)"
              >{post.title}</span
            >
            <span class="shrink-0 text-xs text-50">
              <span
                class="icon-[material-symbols--visibility-outline] mr-0.5 align-[-2px] text-sm"></span
              >{formatVisits(post.visits)}
            </span>
          </a>
        {/each}
      {/if}
    {/snippet}

    {#snippet recentSection()}
      {#if recentSearches.length > 0}
        <div class="flex items-center justify-between px-3 pt-3">
          <span class="text-xs font-bold text-50">{t("search.recent", "最近搜索")}</span>
          <button
            type="button"
            onclick={clearRecentSearches}
            class="text-xs text-50 transition hover:text-(--primary)"
            >{t("search.clearRecent", "清空")}</button
          >
        </div>
        <div class="flex flex-wrap gap-1.5 px-3 pb-1 pt-2">
          {#each recentSearches as item}
            <button
              type="button"
              onclick={() => useRecentKeyword(item)}
              class="rounded-lg bg-black/[0.04] px-2.5 py-1 text-sm text-75 transition hover:bg-black/[0.08] dark:bg-white/5 dark:hover:bg-white/10"
              >{item}</button
            >
          {/each}
        </div>
      {/if}
    {/snippet}

    {#if isSearching}
      <!-- 状态消息是真实内容而非装饰，用更高对比度的 text-50 -->
      <div class="px-3 py-3 text-sm text-50">{t("search.loading", "搜索中...")}</div>
    {:else if showEmptyState}
      <!-- ⑤ 空结果状态：明确文案（带关键词）+ 热门文章兜底 -->
      <div class="px-3 py-3 text-sm text-50">
        {fmt(
          t("search.noResultsFor", "没有找到与『{0}』相关的文章"),
          completedKeyword ?? trimmedKeyword,
        )}
      </div>
      {@render popularSection()}
    {:else if showIdleState}
      <!-- ⑤ 输入为空/聚焦时：最近搜索 + 热门文章 -->
      {@render recentSection()}
      {@render popularSection()}
    {/if}

    <!-- search results -->
    {#each result as item}
      <a
        href={item.permalink}
        class="group block rounded-xl px-3 py-2 text-lg transition first-of-type:mt-2 hover:bg-(--btn-plain-bg-hover) active:bg-(--btn-plain-bg-active) lg:first-of-type:mt-0"
      >
        <!-- 标题用 flex + 内部换行：inline-flex 默认 nowrap，窄屏（移动端）长标题
             无法换行导致溢出、箭头图标错位（#64）；min-w-0/break-words 允许词内断行 -->
        <div
          class="flex items-center gap-x-1 font-bold text-90 transition group-hover:text-(--primary)"
        >
          <span class="min-w-0 break-words">{@html renderHighlighted(item.title)}</span>
          <span
            class="icon-[fa6-solid--chevron-right] shrink-0 text-[0.75rem] text-(--primary) transition"></span
          >
        </div>
        <div class="text-sm text-50 transition">
          {@html excerptOf(item)}
        </div>
      </a>
    {/each}
  </div>
</div>

<style>
  /* 键盘聚焦（focus-visible）时提供可见焦点环，替代原来无条件 outline:0 导致的
     焦点不可见问题；鼠标点击不显示，避免视觉干扰 */
  input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
    border-radius: 0.5rem;
  }


</style>

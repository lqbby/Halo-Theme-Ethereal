import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.thymeleaf.context.Context;
import org.thymeleaf.spring6.SpringTemplateEngine;
import org.thymeleaf.templateresolver.StringTemplateResolver;

/**
 * ThRenderProbe —— 从 built 产物里**抠出真实片段**，用真 Thymeleaf + mock 数据渲染，
 * 验证「运行时求值」而不只是「语法可解析」。
 *
 * 为什么需要它：validate-th.mjs 只把 `Could not parse as expression` 当错，其余异常一律
 * 归为「环境性跳过」（本地没有 Halo 上下文）。于是**变量名写错**这类 bug 完全隐形 ——
 * 表达式能解析，只是求值为 null，卡片静默不渲染。本探针喂 mock 数据，让 null 无所遁形。
 *
 * 做法（关键：保证被测的是**真模板**，不是抄一份）：
 *   ① 从模板文件里抠出顶层 th:with 链（cfg=${theme.config?.extendPages?.about} …）
 *   ② 按标记注释 + 标签配平抠出目标 <section> 整块
 *   ③ 拼成 `<div th:with="<真链>">…<真 section>…</div>` 渲染
 *
 * 用法： java -cp <jars> ThRenderProbe.java <built.html> [count|none] [changelog条数]
 *   count = "none" ⇒ 不写 highlights.count（测模板默认值）
 *   changelog条数 = "0" ⇒ 更新日志为空（测手填兜底分支）
 *
 * 退出码：0 = 渲染成功；1 = 运行时异常（cause 链全打印）；2 = 片段定位失败。
 */
public class ThRenderProbe {

    static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
        return m;
    }

    /**
     * ⚠️ badge 一律写成 key（值可为 null），**不能省略 key**：
     *    本地裸 SpringTemplateEngine 对「缺失键 + 点号」会抛 EL1008E，而**真 Halo 不会** ——
     *    证据：线上 extendPages.blogChangelog.days 只有 ['items']（没有 pageSize），
     *    1.5.1 模板却读 `cfg?.days?.pageSize`，线上页面仍 200 且渲染 12 条。
     *    ⇒ 生产语义 = 缺失键取到 null。mock 用显式 null 对齐它，否则探针会假报错。
     */
    static Map<String, Object> rec(String date, String version, String title, String summary, String badge) {
        return map("date", date, "version", version, "title", title, "summary", summary, "badge", badge);
    }

    /**
     * 语义电池 —— 用同一套引擎把「点号 vs 方括号」「缺失键」「越界切片」等逐个跑一遍。
     * 结论直接影响模板写法：到底哪些访问会抛异常、哪些安静返回 null。
     */
    static void semantics(SpringTemplateEngine engine) {
        // 挂主题 i18n：不挂的话下面每一条 #{…} 都只会渲染成 ??key_zh_CN??，等于白验。
        engine.setMessageResolver(new I18n("../../i18n/zh_CN.properties"));
        Map<String, Object> m = map("present", "yes");
        List<Object> arr = new ArrayList<>();
        arr.add(map("a", 1));
        List<Object> two = new ArrayList<>();
        two.add("x");
        two.add("y");

        Context ctx = new Context();
        ctx.setVariable("m", m);
        ctx.setVariable("arr", arr);
        ctx.setVariable("two", two);

        String[] exprs = {
            "${m.present}",
            "${m?.present}",
            "${m.missing}",
            "${m?.missing}",
            "${m['missing']}",
            "${arr[0].a}",
            "${arr[0].zzz}",
            "${arr[0]?.zzz}",
            "${arr.get(0)['zzz']}",
            "${two.subList(0, 2)}",
            "${two.subList(0, 5)}",
        };
        System.out.println("—— SpEL / Thymeleaf 语义电池 ——");
        System.out.println("  ⚠️ 注意：这里用的是**裸 SpringTemplateEngine**。它对「缺失键 + 点号」抛 EL1008E，");
        System.out.println("     但**真 Halo 返回 null** —— 证据：线上 days 配置只有 ['items']（无 pageSize），");
        System.out.println("     1.5.1 模板却读 cfg?.days?.pageSize，线上仍 200 且渲染 12 条。");
        System.out.println("     ⇒ 结论：方括号索引在两边都安全；点号只在 Halo 侧安全（本地 mock 要补全 key）。");
        for (String e : exprs) {
            String t = "<div xmlns:th=\"http://www.thymeleaf.org\" th:text=\""
                    + e.replace("\"", "&quot;") + "\"></div>";
            try {
                String out = engine.process(t, ctx).replaceAll("\\s+", " ").trim();
                System.out.printf("  OK   %-24s → %s%n", e, out);
            } catch (Throwable ex) {
                Throwable d = ex;
                while (d.getCause() != null && d.getCause() != d) d = d.getCause();
                System.out.printf("  THROW %-23s → %s%n", e,
                        d.getClass().getSimpleName() + ": " + clip(String.valueOf(d.getMessage()), 80));
            }
        }
        // —— 2026-09-16 追加：th:with 内变量能否互相引用 + null 条件语义 ——
        // 动机：本仓两处注释**互相矛盾** —— `MoeCounter.astro` 写「同一 th:with 里变量不能互相引用」，
        //      而 `pages/steam.astro` 却依赖 `profile=${sp ? …}`、`dataOk=${profile != null and …}`。
        //      靠猜会写错模板，这里用真引擎定论（并把结论固化下来，避免以后继续猜）。
        System.out.println("—— th:with 引用语义 + null 条件电池 ——");
        Map<String, Object> m2 = map("present", "yes", "nilBool", null);
        ctx.setVariable("m2", m2);
        ctx.setVariable("nilBool", null);
        ctx.setVariable("nilStr", null);
        String[][] battery = {
            {"后引用前（声明顺序）", "<div th:with=\"sp=${m2.present != null}, p=${sp ? 'P' : 'N'}\" th:text=\"${p}\"></div>"},
            {"前引用后（逆序）", "<div th:with=\"p=${sp ? 'P' : 'N'}, sp=${m2.present != null}\" th:text=\"${p}\"></div>"},
            {"同属性内布尔派生 + th:if", "<div th:with=\"a=${1}, b=${a == 1}\" th:if=\"${b}\">IN</div>"},
            {"三元条件为 null（顶层变量）", "<div th:text=\"${nilBool ? 'Y' : 'N'}\"></div>"},
            {"th:classappend 内 null 三元", "<div th:classappend=\"${(nilBool ? ' has-x' : '') + ' base'}\">z</div>"},
            {"th:if 条件为 null", "<div th:if=\"${nilBool}\">HIDDEN</div>"},
            {"null + 字符串拼接", "<div th:text=\"${nilStr + 'badges/'}\"></div>"},
            {"null 对象取属性（点号）", "<div th:text=\"${nilStr.length}\"></div>"},
            {"自定义属性 th:aria-label", "<div th:aria-label=\"${m2.present}\"></div>"},
            {"自定义属性 th:data-*", "<div th:data-server-url=\"${m2.present}\"></div>"},
            {"th:attr rel 为 null 时删属性", "<a href=\"https://x\" th:attr=\"rel=${nilStr}\">a</a>"},
            {"th:attr rel 有值时设属性", "<a href=\"https://x\" th:attr=\"rel=${m2.present}\">a</a>"},
            {"th:rel 是否被识别", "<a href=\"https://x\" th:rel=\"${m2.present}\">a</a>"},
        };
        for (String[] c : battery) {
            try {
                String out = engine.process(c[1], ctx).replaceAll("\\s+", " ").trim();
                System.out.printf("  OK    %-24s → %s%n", c[0], out);
            } catch (Throwable ex) {
                Throwable d = ex;
                while (d.getCause() != null && d.getCause() != d) d = d.getCause();
                System.out.printf("  THROW %-24s → %s%n", c[0],
                        d.getClass().getSimpleName() + ": " + clip(String.valueOf(d.getMessage()), 70));
            }
        }
        // —— 2026-09-18 追加：featured-cards / series-strip 审查相关 ——
        // 动机：FeaturedCards 的封面 <img> 写成 `th:src="${cond ? null : url}"`。
        //      MEMORY 里记着「3.1.5 对求值为 null 的 th:src/th:href 不是删属性而是写空值
        //      （href="" 点一下打当前页）」，但那条当初是**间接推断**的。这里用真引擎当场定论，
        //      并顺带验证「等价修法」th:attr="src=${…}" 在 null 时到底删不删属性。
        System.out.println("—— 属性求值 / 消息参数 / 裸 < 电池 ——");
        Map<String, Object> m3 = map("v", "VAL");
        ctx.setVariable("m3", m3);
        List<Object> posts3 = new ArrayList<>();
        posts3.add(map("title", "t1"));
        posts3.add(map("title", "t2"));
        ctx.setVariable("posts3", posts3);
        String[][] battery3 = {
            {"th:src 求值 null", "<img th:src=\"${nilStr}\" alt=\"\">"},
            {"th:src 有值", "<img th:src=\"${m3.v}\" alt=\"\">"},
            {"th:href 求值 null", "<a th:href=\"${nilStr}\">x</a>"},
            {"th:attr src 求值 null", "<img th:attr=\"src=${nilStr}\" alt=\"\">"},
            {"th:attr src 有值", "<img th:attr=\"src=${m3.v}\" alt=\"\">"},
            {"th:attr 逗号分隔两参数", "<img th:attr=\"src=${m3.v},fetchpriority=${m3.v}\" alt=\"\">"},
            {"th:attr 逗号分隔且都为 null", "<img th:attr=\"src=${nilStr},fetchpriority=${nilStr}\" alt=\"\">"},
            {"消息参数内嵌 $", "<p th:text=\"#{seriesStrip.issue(${m3.v})}\">x</p>"},
            {"消息 key 命中（字面量参）", "<p th:text=\"#{seriesStrip.issue(3)}\">x</p>"},
            {"消息 key 命中（无参）", "<p th:text=\"#{featured.badge.recent}\">x</p>"},
            {"消息 key 缺失", "<p th:text=\"#{no.such.key.zzz}\">x</p>"},
            {"Elvis + 安全导航", "<p th:text=\"${nilStr ?: 'fallback'}\">x</p>"},
            {"th:style 纯字面量管道", "<div th:style=\"|animation-delay: var(--x)|\">s</div>"},
            {"嵌套 each 外层 st 可见", "<div th:each=\"a,st:${posts3}\"><span th:each=\"b,ps:${posts3}\" th:text=\"${st.index + '-' + ps.index}\"></span></div>"},
            {"th:each 状态 st.count", "<div th:each=\"a,st:${posts3}\" th:text=\"${st.count}\"></div>"},
            {"th:if 里裸小于号", "<div th:if=\"${1 < 4}\">LT</div>"},
            {"classappend 三层嵌套三元", "<div th:classappend=\"${1 == 0 ? ' a' : (1 == 1 ? ' b' : ' c')}\">z</div>"},
            {"th:if 里 &lt; 实体", "<div th:if=\"${1 &lt; 4}\">LT</div>"},
        };
        for (String[] c : battery3) {
            try {
                String out = engine.process(c[1], ctx).replaceAll("\\s+", " ").trim();
                System.out.printf("  OK    %-26s → %s%n", c[0], clip(out, 110));
            } catch (Throwable ex) {
                Throwable d = ex;
                while (d.getCause() != null && d.getCause() != d) d = d.getCause();
                System.out.printf("  THROW %-26s → %s%n", c[0],
                        d.getClass().getSimpleName() + ": " + clip(String.valueOf(d.getMessage()), 70));
            }
        }
        // —— 2026-09-21 追加：文章卡片重构相关（阅读时长整数除法 / 系列注解 map 索引 / 期号定位）——
        // 动机：卡片要新加「阅读时长」与「系列名 + 期号」，两处都踩没验过的 SpEL 语义：
        //   ① 时长口径必须与文章页一致 = ceil(字数/400)，但不能用 T(java.lang.Math)（不保证被 Halo 放行）
        //      ⇒ 改试「整数除法 (n+399) div 400」；
        //   ② 系列名从 post.metadata.annotations['series'] 取（绕开 #annotations 方言，只依赖 metadata POJO）；
        //   ③ 期号要在当前系列的 posts 里按 name 定位；LQ 全部文章都没填 order ⇒ 走「总数 - 下标」倒推，
        //      所以必须验证「嵌套 each + 内层 th:if」这条定位路（选择语法 ?[...] 也要验，看它未命中时炸不炸）。
        System.out.println("—— 卡片重构电池：整数除法 / map 索引 / 期号定位 ——");
        Map<String, Object> ann = map("series", "网站推荐", "other", "x");
        Map<String, Object> metaObj = map("annotations", ann, "name", "p-mid");
        Map<String, Object> postObj = map("metadata", metaObj, "spec", map("pinned", true));
        ctx.setVariable("post", postObj);
        ctx.setVariable("nilMap", null);
        List<Object> seriesPosts = new ArrayList<>();
        seriesPosts.add(map("name", "p-new", "order", null));
        seriesPosts.add(map("name", "p-mid", "order", null));
        seriesPosts.add(map("name", "p-old", "order", 7));
        ctx.setVariable("seriesView", map("posts", seriesPosts));
        ctx.setVariable("wc", 1234);
        // —— 2026-09-21 追加②：卡片角标改成「一次 listAll + 逐卡按名定位」后的语义 ——
        // 动机：初版角标在**每张卡**上调 recentCommentsSeriesFinder.get(seriesName)，
        //   而插件 SeriesFinderImpl.get() 每次都 loadSeries() = client.listAll(Post.class) 全表扫。
        //   首页 9 张卡 = 9 次全表扫。改成在列表容器上 `th:with` 调**一次** listAll()，
        //   卡片再按名从结果里挑（外层 each + th:if，O(系列数) 字符串比较）。
        //   但这条依赖两个没验过的语义：① th:each 遍历 null 会不会抛；② 外层 each + 同层 th:if 能否按名过滤。
        ctx.setVariable("seriesName", "网站推荐");
        List<Object> seriesAll = new ArrayList<>();
        seriesAll.add(map("name", "网站推荐", "posts", seriesPosts));
        seriesAll.add(map("name", "另一个系列", "posts", new ArrayList<>()));
        ctx.setVariable("seriesAll", seriesAll);
        ctx.setVariable("seriesAllNull", null);
        String[][] battery4 = {
            {"整数除法 7→1", "<div th:text=\"${(7 + 399) div 400}\"></div>"},
            {"整数除法 400→1", "<div th:text=\"${(400 + 399) div 400}\"></div>"},
            {"整数除法 401→2", "<div th:text=\"${(401 + 399) div 400}\"></div>"},
            {"整数除法 0→0", "<div th:text=\"${(0 + 399) div 400}\"></div>"},
            {"th:with 算出分钟再进 i18n", "<div th:with=\"m=${(wc + 399) div 400}\" th:text=\"#{seriesStrip.issue(${m})}\"></div>"},
            {"annotations 两层方括号", "<div th:text=\"${post.metadata.annotations['series']}\"></div>"},
            {"annotations 缺键", "<div th:text=\"${post.metadata.annotations['nope']}\"></div>"},
            {"annotations 父为 null 带守卫", "<div th:text=\"${nilMap != null ? nilMap['series'] : null}\"></div>"},
            {"annotations 父为 null 裸索引", "<div th:text=\"${nilMap['series']}\"></div>"},
            {"isEmpty(null)", "<div th:text=\"${#strings.isEmpty(nilMap)}\"></div>"},
            {"嵌套 each 定位（未填 order 倒推）", "<div th:remove=\"tag\"><span th:each=\"sp, ss : ${seriesView.posts}\"><span th:if=\"${sp.name == 'p-mid'}\" th:text=\"${#lists.size(seriesView.posts) - ss.index}\"></span></span></div>"},
            {"嵌套 each 定位（填了 order 优先）", "<div th:remove=\"tag\"><span th:each=\"sp, ss : ${seriesView.posts}\"><span th:if=\"${sp.name == 'p-old'}\" th:text=\"${sp.order != null ? sp.order : #lists.size(seriesView.posts) - ss.index}\"></span></span></div>"},
            {"未填 order 时 order 为 null 判定", "<div th:remove=\"tag\"><span th:each=\"sp, ss : ${seriesView.posts}\"><span th:if=\"${sp.name == 'p-new'}\" th:text=\"${sp.order != null ? 'HAS' : 'NIL'}\"></span></span></div>"},
            {"选择语法 ?, 命中", "<div th:text=\"${seriesView.posts.?[name == 'p-old']}\"></div>"},
            {"选择后取下标", "<div th:text=\"${seriesView.posts.?[name == 'p-old'][0].order}\"></div>"},
            {"选择未命中后取下标", "<div th:text=\"${seriesView.posts.?[name == 'zzz'][0].order}\"></div>"},
            {"#lists.size", "<div th:text=\"${#lists.size(seriesView.posts)}\"></div>"},
            {"th:each 遍历 null 列表", "<div th:each=\"a : ${seriesAllNull}\">X</div>"},
            {"th:each 遍历 null（带同层 th:if 守卫）", "<div th:each=\"a : ${seriesAllNull}\" th:if=\"${seriesAllNull != null}\">X</div>"},
            {"外层 each + 同层 th:if 按名过滤", "<div th:remove=\"tag\"><span th:each=\"sv : ${seriesAll}\" th:if=\"${sv.name == seriesName}\" th:text=\"${sv.name}\"></span></div>"},
            {"按名过滤 + 内层 each 取期号", "<div th:remove=\"tag\"><span th:each=\"sv : ${seriesAll}\"><span th:remove=\"tag\" th:if=\"${sv.name == seriesName}\"><span th:each=\"sp, ss : ${sv.posts}\"><span th:if=\"${sp.name == 'p-mid'}\" th:text=\"#{seriesStrip.issue(${sp.order != null ? sp.order : #lists.size(sv.posts) - ss.index})}\"></span></span></span></span></div>"},
            {"按名过滤（未命中：不输出）", "<div th:remove=\"tag\"><span th:each=\"sv : ${seriesAll}\" th:if=\"${sv.name == '不存在'}\" th:text=\"X\"></span></div>"},
            {"seriesAll 为 null 时的完整角标", "<div th:remove=\"tag\"><span th:each=\"sv : ${seriesAllNull}\" th:if=\"${seriesAllNull != null and sv.name == seriesName}\" th:text=\"X\"></span></div>"},
            {"th:remove=tag + each + if 同层", "<div th:remove=\"tag\" th:each=\"sv : ${seriesAll}\" th:if=\"${seriesAll != null and sv.name == seriesName}\"><span th:text=\"${sv.name}\"></span></div>"},
            {"完整角标（真标记，命中）", "<span th:remove=\"tag\" th:each=\"sv : ${seriesAll}\" th:if=\"${seriesAll != null and sv.name == seriesName}\"><span class=\"post-card-series post-card-series--cover\" th:if=\"${not #lists.isEmpty(sv.posts)}\"><span class=\"post-card-series__name\" th:text=\"${seriesName}\"></span><div th:remove=\"tag\" th:each=\"sp, ss : ${sv.posts}\"><span class=\"post-card-series__issue\" th:if=\"${sp.name == post.metadata.name}\" th:text=\"#{seriesStrip.issue(${sp.order != null ? sp.order : #lists.size(sv.posts) - ss.index})}\"></span></div></span></span>"},
            {"完整角标（系列没对上→整块不输出）", "<span th:remove=\"tag\" th:each=\"sv : ${seriesAll}\" th:if=\"${seriesAll != null and sv.name == '不存在'}\"><span class=\"post-card-series\" th:if=\"${not #lists.isEmpty(sv.posts)}\"><span th:text=\"${seriesName}\"></span></span></span>"},
            {"完整角标（seriesAll 为 null）", "<span th:remove=\"tag\" th:each=\"sv : ${seriesAllNull}\" th:if=\"${seriesAllNull != null and sv.name == seriesName}\"><span class=\"post-card-series\"><span th:text=\"${seriesName}\"></span></span></span>"},
        };
        for (String[] c : battery4) {
            try {
                String out = engine.process(c[1], ctx).replaceAll("\\s+", " ").trim();
                System.out.printf("  OK    %-26s → %s%n", c[0], clip(out, 110));
            } catch (Throwable ex) {
                Throwable d = ex;
                while (d.getCause() != null && d.getCause() != d) d = d.getCause();
                System.out.printf("  THROW %-26s → %s%n", c[0],
                        d.getClass().getSimpleName() + ": " + clip(String.valueOf(d.getMessage()), 70));
            }
        }
        System.out.println("—— 电池结束 ——");
    }

    static String clip(String s, int n) {
        String t = s.replaceAll("\\s+", " ").trim();
        return t.length() > n ? t.substring(0, n) + " …" : t;
    }

    // ==================== 文章卡片真渲染（--card） ====================
    //
    // 动机（2026-09-21，1.5.57 卡片重构）：卡片是「全站三态共用」的组件，光看产物里有没有
    // 某个 class 只能证明标记存在，证明不了**求值结果对不对** —— 系列角标要靠祖先作用域的
    // `seriesAll` 过滤、阅读时长靠整数除法、底栏靠 `#lists.isEmpty(post.tags)` 切 no-tags。
    // 这里把产物里的**真卡片片段**抠出来、喂 mock 数据用真引擎渲染，一次把所有分支铺开。
    //
    // 产物给了什么、本方法补了什么：
    //   · 产物里已有：<article class="card-base post-card …" th:with="coverEmpty=…"> 整块
    //   · 本方法补的上下文：post / postStat / theme / pluginFinder / extraApiStatsFinder /
    //     seriesAll。其中 `seriesAll` 在真页面里由**列表容器**的 th:with 声明
    //     （postListContainerThWith()），本探针直接当上下文变量喂进来 —— 等价，且更省事。
    //   · 🔴 `pluginFinder` / `extraApiStatsFinder` 必须是**真对象**（不是 Map）：
    //     模板里是 `pluginFinder.available('extra-api','3.*')` 这种**方法调用**，Map 没有
    //     这些方法 ⇒ EL1008E。所以下面写了两个极简桩类。
    //   · ⚠️ 裸 SpringTemplateEngine 对「缺失键 + 点号」抛 EL1008E（真 Halo 返回 null）
    //     ⇒ mock 里所有会被点号读到的键都要**显式给值**，这也是 Stub#available 恒 true 的原因
    //     （不能省掉 imageProcessing.card_cover_width 之类）。

    /** 桩：pluginFinder.available(plugin, range) —— 恒 true，让门控分支全开 */
    public static class StubPluginFinder {
        public boolean available(String plugin, String range) {
            return true;
        }
    }

    /** 桩：extraApiStatsFinder.getPostWordCount({name:…}) —— 按 metadata.name 查字数表 */
    public static class StubStatsFinder {
        private final Map<String, Integer> words;

        StubStatsFinder(Map<String, Integer> words) {
            this.words = words;
        }

        public int getPostWordCount(Map<String, Object> ref) {
            Object n = ref == null ? null : ref.get("name");
            Integer w = n == null ? null : words.get(String.valueOf(n));
            return w == null ? 0 : w;
        }
    }

    /** mock 文章：键一律显式给（见上「缺失键」注意事项） */
    static Map<String, Object> mockPost(String name, String title, String cover, boolean pinned,
                                        String series, java.util.Date publish, String excerpt,
                                        List<Object> tags, List<Object> cats, boolean withStats,
                                        int visit, int comment, int upvote) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("metadata", map("name", name, "annotations", series == null ? null : map("series", series)));
        m.put("spec", map("title", title, "cover", cover, "pinned", pinned,
                "publishTime", publish, "slug", name));
        m.put("status", map("permalink", "/archives/" + name, "excerpt", excerpt,
                "lastModifyTime", publish));
        m.put("stats", withStats ? map("visit", visit, "comment", comment, "upvote", upvote) : null);
        m.put("tags", tags);
        m.put("categories", cats);
        return m;
    }

    static List<Object> mockTerms(String[] names) {
        List<Object> out = new ArrayList<>();
        for (String n : names) {
            out.add(map("spec", map("displayName", n), "status", map("permalink", "/tags/" + n)));
        }
        return out;
    }

    static Map<String, Object> mockSeriesPost(String name, Integer order) {
        return map("name", name, "title", name, "permalink", "/archives/" + name,
                "order", order, "publishTime", null, "cover", null);
    }

    /** 从产物里抠出「文章卡片 + 后面那条移动端分隔线」 */
    static String extractCard(String text) {
        int a = text.indexOf("card-base post-card");
        if (a < 0) {
            System.out.println("✖ 产物里找不到 card-base post-card");
            System.exit(2);
        }
        int aStart = text.lastIndexOf("<article", a);
        int aEnd = text.indexOf("</article>", a);
        if (aStart < 0 || aEnd < 0) {
            System.out.println("✖ <article> 定位失败");
            System.exit(2);
        }
        aEnd += "</article>".length();
        int d = text.indexOf("<div class=\"post-card-divider", aEnd);
        int dEnd = aEnd;
        if (d >= 0) {
            dEnd = text.indexOf("</div>", d);
            dEnd = dEnd < 0 ? aEnd : dEnd + "</div>".length();
        }
        return text.substring(aStart, dEnd);
    }

    static void card(SpringTemplateEngine engine, String builtHtml, String outFile) throws Exception {
        engine.setMessageResolver(new I18n("../../i18n/zh_CN.properties"));
        String text = new String(Files.readAllBytes(Paths.get(builtHtml)), StandardCharsets.UTF_8);
        String card = extractCard(text);
        System.out.println("抠出卡片片段：" + card.length() + " 字符");
        // 🔴 必须把 `@{}` 链接表达式降级成普通 `${}`：
        //    裸 SpringTemplateEngine + 普通 Context **不是 IWebContext**，而 `@{${x}}` 里
        //    x 求出来是 `/archives/xxx` 这种**上下文相对路径** ⇒ 解析期直接抛
        //    `ParseException: Link base "/…" cannot be context relative (/...) unless the
        //    context … implements IWebContext`（2026-09-21 实测）。预览里 href 只是装饰，
        //    换成普通表达式即可；这也解释了为什么 about 页那路探针一直没踩到 —— 那段没有 @{}。
        card = card.replaceAll("@\\{(\\$\\{[^{}]*\\})\\}", "$1")
                   .replaceAll("@\\{(/[^}]*)\\}", "$1");
        if (card.contains("@{")) {
            System.out.println("⚠️ 片段里仍有 @{} 未降级（多层嵌套？）—— 可能再次抛 IWebContext 异常");
        }
        if (card.contains("th:each=\"post")) {
            System.out.println("⚠️ 片段里含列表级 th:each（应只含单卡）——请人工确认");
        }

        // ⚠️ 数据一律取**线上真值**（2026-09-21 从 www.lqbby.com 首页抓的真实统计/标签），
        //    否则量出来的宽度没有说服力 —— 底栏放不放得下，全看数字位数与标签字数。
        Map<String, Integer> words = new LinkedHashMap<>();
        words.put("p-cover-pinned", 3015);
        words.put("p-cover-series", 2717);
        words.put("p-cover-plain", 1874);
        words.put("p-cover-long", 2323);
        words.put("p-nocover-series", 2281);
        words.put("p-nocover-notags", 1588);
        words.put("p-cover-longtag", 2263);
        words.put("p-cover-manytags", 4120);
        java.util.Calendar c = java.util.Calendar.getInstance();
        c.set(2026, java.util.Calendar.SEPTEMBER, 12, 10, 30, 0);
        java.util.Date d1 = c.getTime();
        c.set(2026, java.util.Calendar.AUGUST, 3, 9, 0, 0);
        java.util.Date d2 = c.getTime();

        // 系列快照：真页面里由容器 th:with 的 listAll() 提供
        List<Object> seriesAll = new ArrayList<>();
        seriesAll.add(map("name", "网站推荐",
                "posts", new ArrayList<>(List.of(
                        mockSeriesPost("p-cover-series", null),
                        mockSeriesPost("p-nocover-series", null),
                        mockSeriesPost("p-cover-pinned", null))),
                "latest", mockSeriesPost("p-cover-series", null)));
        seriesAll.add(map("name", "折腾记录",
                "posts", new ArrayList<>(List.of(mockSeriesPost("p-other-1", 1))),
                "latest", mockSeriesPost("p-other-1", 1)));

        String coverUrl = "https://tc.lqbby.com/uploads/2026/09/cover-sample.webp";
        String longTitle = "把 NAS 上的签到中心从单项目脚本重构成多项目面板";
        String longExcerpt =
                "面板原来只服务美团一个项目，加第二个项目时才发现路由、鉴权、存储三处都写死了项目名。";

        // 场景：名称 → [卡片片段, eager 下标]
        List<Object[]> scenes = new ArrayList<>();
        scenes.add(new Object[]{"① 有封面 · 置顶 · 系列 · 3 标签（#免费工具/#办公工具/#Windows，首卡 eager）",
                mockPost("p-cover-pinned", longTitle, coverUrl, true, "网站推荐", d1,
                        "把自己常用的一批 Windows 小工具整理成一张清单，附下载地址与许可证说明。",
                        mockTerms(new String[]{"免费工具", "办公工具", "Windows"}), mockTerms(new String[]{"网站推荐"}),
                        true, 57, 0, 1), 0});
        scenes.add(new Object[]{"② 有封面 · 系列 · 3 标签（#macOS/#工具箱/#应用分身）",
                mockPost("p-cover-series", "macOS 上让同一个应用开两份的几个办法",
                        coverUrl, false, "网站推荐", d2,
                        "不用第三方分身工具，靠系统自带的能力就能做到多开。",
                        mockTerms(new String[]{"macOS", "工具箱", "应用分身"}), mockTerms(new String[]{"折腾"}),
                        true, 26, 0, 1), 1});
        scenes.add(new Object[]{"③ 有封面 · 无系列 · 2 标签（#Ethereal/#魔改）· 3 位浏览数",
                mockPost("p-cover-plain", "给自己的 Halo 主题做了一次排版重构",
                        coverUrl, false, null, d2,
                        "卡片的信息层级重新排了一遍，元信息提到标题之前。",
                        mockTerms(new String[]{"Ethereal", "魔改"}), mockTerms(new String[]{"折腾"}),
                        true, 242, 1, 1), 2});
        scenes.add(new Object[]{"④ 无封面 · 系列 · 3 标签（走 inline 系列 chip 分支）",
                mockPost("p-nocover-series", "群晖上跑泰拉瑞亚灾厄服：版本对不上的坑",
                        null, false, "网站推荐", d1,
                        "tModLoader 版本必须与客户端精确匹配，否则 Mod 直接加载失败。",
                        mockTerms(new String[]{"怀旧游戏", "在线游戏", "模拟器"}), mockTerms(new String[]{"折腾"}),
                        true, 17, 0, 0), 3});
        scenes.add(new Object[]{"⑤ 无封面 · 无标签 · 无统计（no-tags + 两源全空守卫分支）",
                mockPost("p-nocover-notags", "换了 MosDNS 之后国内域名解析更干净了",
                        null, false, null, d2,
                        "fake-ip 与 geosite 数据源撕裂会导致国内域名被丢给代理，这次两侧对齐了。",
                        new ArrayList<>(), new ArrayList<>(), false, 0, 0, 0), 4});
        scenes.add(new Object[]{"⑥ 有封面 · 置顶 · 最长标签对（#Chrome 扩展/#DeepSeek）· 底栏压力最大",
                mockPost("p-cover-longtag", "从 Chrome 书签迁移到自建书签站的两个坑",
                        coverUrl, true, null, d1,
                        "书签树的结构与浏览器 API 返回的结构不一致，得先拍平再重建。",
                        mockTerms(new String[]{"Chrome 扩展", "DeepSeek", "书签管理"}) , mockTerms(new String[]{"折腾"}),
                        true, 182, 0, 0), 5});
        scenes.add(new Object[]{"⑦ 有封面 · 长标题 + 长摘要（看摘要截断与卡片等高）",
                mockPost("p-cover-long", "用 Astro 把 Halo 主题拆成可维护的组件之后，我踩到的七个静默失败",
                        coverUrl, false, null, d2, longExcerpt,
                        mockTerms(new String[]{"AI 工具", "AI Agent", "浏览器自动化"}), mockTerms(new String[]{"折腾"}),
                        true, 142, 0, 3), 6});
        // ⚠️ 1.5.58 新增：**5 个标签**——只有 ≥4 个才能看到 `+N`，而 `+N` 的**计数**
        //    正是这次分档改动最容易错的地方（窄档按 2 算显示 `+3`、宽档按 3 算显示 `+2`）。
        scenes.add(new Object[]{"⑧ 有封面 · 5 标签（唯一能看到 +N 的场景：窄档应显示 +3、宽档应显示 +2）",
                mockPost("p-cover-manytags", "一年下来我删掉的七个 Halo 插件与替代方案",
                        coverUrl, false, null, d1,
                        "插件少而稳比多而全更重要，这七个被换成了更轻的实现。",
                        mockTerms(new String[]{"免费工具", "Windows", "博客", "效率", "折腾"}),
                        mockTerms(new String[]{"折腾"}),
                        true, 988, 4, 0), 7});

        StringBuilder out = new StringBuilder();
        out.append("<!-- 本文件由 ThRenderProbe.java --card 生成，勿手改 -->\n");
        for (Object[] sc : scenes) {
            String label = (String) sc[0];
            @SuppressWarnings("unchecked")
            Map<String, Object> post = (Map<String, Object>) sc[1];
            int idx = (Integer) sc[2];

            Context ctx = new Context();
            ctx.setVariable("post", post);
            ctx.setVariable("postStat", map("index", idx, "count", idx + 1));
            ctx.setVariable("seriesAll", seriesAll);
            ctx.setVariable("seriesAllNull", null);
            ctx.setVariable("pluginFinder", new StubPluginFinder());
            ctx.setVariable("extraApiStatsFinder", new StubStatsFinder(words));
            ctx.setVariable("theme", map("config", map(
                    "layout", map("postList", map("descriptionLines", 2)),
                    "post", map("actionBar", map("like", true)),
                    // ⚠️ imageProcessing 的键必须齐（见 Stub 注释）
                    "performance", map("imageProcessing", map(
                            "provider", "none", "card_cover_width", 400, "custom_format", "")))));

            String tpl = "<div xmlns:th=\"http://www.thymeleaf.org\">" + card + "</div>";
            out.append("<!--SCENE ").append(label).append(" -->\n");
            try {
                String rendered = engine.process(tpl, ctx);
                // 去掉最外层包装 div
                int open = rendered.indexOf('>', rendered.indexOf("<div")) + 1;
                int close = rendered.lastIndexOf("</div>");
                out.append(rendered, open, close).append('\n');
                System.out.println("  OK    " + label);
            } catch (Throwable e) {
                System.out.println("  THROW " + label);
                for (Throwable t = e; t != null; t = t.getCause()) {
                    System.out.println("        CAUSE: " + t.getClass().getSimpleName() + ": " + t.getMessage());
                }
                out.append("<!--FAILED ").append(label).append(" -->\n");
            }
        }
        Files.write(Paths.get(outFile), out.toString().getBytes(StandardCharsets.UTF_8));
        System.out.println("已写出：" + outFile);
    }

    /**
     * 极简 i18n resolver —— 直接读主题的 i18n/zh_CN.properties，支持 {0} 占位替换。
     *
     * 为什么必须有：**裸 SpringTemplateEngine 不认主题 i18n**（认的是 Halo 自己那套
     * MessageResolver）。不挂这个的话，模板里每一处 `#{key}` 都会渲染成 `??key_zh_CN??`，
     * 于是「消息表达式」这条线（`#{key(${var})}` 参数内嵌、缺 key 的降级形态）根本验不了。
     * 挂上之后，`#{seriesStrip.issue(3)}` 才真的能验出「3 期」。
     */
    static class I18n implements org.thymeleaf.messageresolver.IMessageResolver {
        private final java.util.Properties p = new java.util.Properties();

        I18n(String file) {
            try (java.io.Reader r = new java.io.InputStreamReader(
                    new java.io.FileInputStream(file), StandardCharsets.UTF_8)) {
                p.load(r);
            } catch (Exception e) {
                System.out.println("  ⚠️ i18n 未加载（" + file + "）：" + e.getMessage());
            }
        }

        public String getName() {
            return "I18n";
        }

        public Integer getOrder() {
            return 0;
        }

        public String resolveMessage(org.thymeleaf.context.ITemplateContext ctx, Class<?> origin,
                                     String key, Object[] params) {
            String v = p.getProperty(key);
            if (v == null) return null;
            if (params != null) {
                for (int i = 0; i < params.length; i++) {
                    v = v.replace("{" + i + "}", String.valueOf(params[i]));
                }
            }
            return v;
        }

        /** 返回 null ⇒ 交给 Thymeleaf 用默认的 `??key_locale??` 表示（正好用来验证缺 key 的形态） */
        public String createAbsentMessageRepresentation(org.thymeleaf.context.ITemplateContext ctx,
                                                        Class<?> origin, String key, Object[] params) {
            return null;
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.out.println("✖ 用法：ThRenderProbe.java <built.html> [count|none] [changelog条数] [锚点文本]");
            System.out.println("        ThRenderProbe.java --semantics");
            System.out.println("        ThRenderProbe.java --card <built index.html> <out.html>");
            System.exit(2);
        }

        SpringTemplateEngine engine = new SpringTemplateEngine();
        StringTemplateResolver r = new StringTemplateResolver();
        r.setTemplateMode("HTML");
        r.setCacheable(false);
        engine.setTemplateResolver(r);

        if ("--semantics".equals(args[0])) {
            semantics(engine);
            return;
        }
        if ("--card".equals(args[0])) {
            card(engine, args[1], args[2]);
            return;
        }

        String file = args[0];
        String countArg = args.length > 1 ? args[1] : "3";
        String clArg = args.length > 2 ? args[2] : "4";
        // ⚠️ 锚点必须是**产物里存在**的文本：构建会用 strip-comments 剥掉所有 HTML 注释，
        //    拿 `<!-- 更新摘要 -->` 当锚点必然定位失败（踩过）。
        String anchor = args.length > 3 ? args[3] : "LATEST CHANGES";

        String text = new String(Files.readAllBytes(Paths.get(file)), StandardCharsets.UTF_8);

        Matcher mw = Pattern.compile(
                "th:with=\"(cfg=\\$\\{theme\\.config\\?\\.extendPages\\?\\.about\\}.*?)\"",
                Pattern.DOTALL).matcher(text);
        if (!mw.find()) {
            System.out.println("✖ 找不到顶层 th:with 链（cfg=${theme.config?.extendPages?.about}…）");
            System.exit(2);
        }
        String chain = mw.group(1);

        int mark = text.indexOf(anchor);
        if (mark < 0) {
            System.out.println("✖ 找不到锚点文本：" + anchor);
            System.exit(2);
        }
        int secStart = text.lastIndexOf("<section", mark);
        if (secStart < 0) {
            System.out.println("✖ 锚点之前没有 <section");
            System.exit(2);
        }
        int depth = 0, end = -1;
        Matcher mt = Pattern.compile("<(/?)section\\b", Pattern.CASE_INSENSITIVE).matcher(text);
        mt.region(secStart, text.length());
        while (mt.find()) {
            if (mt.group(1).isEmpty()) depth++;
            else depth--;
            if (depth == 0) {
                int gt = text.indexOf('>', mt.end());
                end = gt < 0 ? text.length() : gt + 1;
                break;
            }
        }
        if (end <= 0) {
            System.out.println("✖ <section> 标签不配平");
            System.exit(2);
        }
        String section = text.substring(secStart, end);

        List<Object> items = new ArrayList<>();
        if (!"0".equals(clArg)) {
            items.add(rec("2026.09.13", "v1.5.1", "修复更新日志页「整页截断」与分组行",
                    "两个隐蔽的 Thymeleaf 表达式缺陷一并修掉。", "累积中"));
            items.add(rec("2026.09.13", "v1.5.0", "更新日志页改版 · 关于我设置补全",
                    "服务端分页 + 年月分组 + 折叠卡片。", null));
            items.add(rec("2026.09.13", "v1.4.90", "主题设置补默认值",
                    "顺带修掉状态胶囊恒不渲染。", null));
            items.add(rec("2026.09.12", "v1.4.80", "图标类名不进产物",
                    "Tailwind 内容扫描 + @source inline 白名单。", null));
        }
        Map<String, Object> hi = map(
                "enable", true,
                "moreLabel", "按日查看 →",
                "moreUrl", "/blog-changelog",
                // ⚠️ 可选键一律显式给 null（不能省 key）—— 同上「本地引擎 vs 真 Halo」的语义差。
                //    count=null ⇒ 走模板默认值 3；这正是线上现状（配置里没有 count）。
                "count", "none".equals(countArg) ? null : Integer.valueOf(countArg),
                "items", List.of(map(
                        "title", "手填兜底条目",
                        "icon", null,
                        "tone", null,
                        "description", "只在更新日志为空时出现",
                        "version", "v0.0.1",
                        "tags", "a\nb",
                        "link", null)));

        // ⚠️ 顶层 th:with 链还会读 activity / skills / sidebar.profile —— 它们的键**必须存在**，
        //    否则 SpEL 点号访问缺失键会抛 EL1008E（不是返回 null），探针会误判成模板坏了。
        Map<String, Object> aboutCfg = map(
                "highlights", hi,
                "activity", map("enable", true, "count", 5, "subtitle", "写下来的，才会留下"));

        Map<String, Object> theme = map("config", map(
                "extendPages", map(
                        "about", aboutCfg,
                        "skills", map("entries", map("items", new ArrayList<>())),
                        "blogChangelog", map("days", map("items", items))),
                "sidebar", map("profile", map("social_media", new ArrayList<>()))));

        String tpl = "<div xmlns:th=\"http://www.thymeleaf.org\" th:with=\"" + chain + "\">"
                + section + "</div>";

        Context ctx = new Context();
        ctx.setVariable("theme", theme);
        ctx.setVariable("site", map("title", "LQBBY"));

        try {
            String out = engine.process(tpl, ctx);
            System.out.println(out);
            System.out.println("=== PROBE OK ===");
        } catch (Throwable e) {
            for (Throwable t = e; t != null; t = t.getCause()) {
                System.out.println("CAUSE: " + t.getClass().getSimpleName() + ": " + t.getMessage());
            }
            System.out.println("=== PROBE FAILED ===");
            System.exit(1);
        }
    }
}

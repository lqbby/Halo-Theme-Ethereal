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
        System.out.println("—— 电池结束 ——");
    }

    static String clip(String s, int n) {
        String t = s.replaceAll("\\s+", " ").trim();
        return t.length() > n ? t.substring(0, n) + " …" : t;
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.out.println("✖ 用法：ThRenderProbe.java <built.html> [count|none] [changelog条数] [锚点文本]");
            System.out.println("        ThRenderProbe.java --semantics");
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

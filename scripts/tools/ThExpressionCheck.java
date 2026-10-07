import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.thymeleaf.context.Context;
import org.thymeleaf.spring6.SpringTemplateEngine;
import org.thymeleaf.templateresolver.StringTemplateResolver;

/**
 * ThExpressionCheck —— 用真 Thymeleaf 解析每个 th:* 属性，抓「表达式语法错误」。
 *
 * 为什么需要它：`${a}${b}` 这种 Thymeleaf 层解析失败会让页面 **200 但整页截断**，
 * 而 grep / node --check 都查不出来（1.5.0 线上事故）。
 *
 * 判定口径（关键）：
 *   只把 "Could not parse as expression" 当作**错误**。
 *   其余异常（变量不存在、Finder 缺失、消息键缺失…）都是**环境问题**，因为本地没有 Halo 上下文，
 *   一律忽略 —— 这样才不会被噪音淹没，oracle 只对一个东西报警：表达式能不能被 Thymeleaf 解析。
 *
 * 用法： java -cp <thymeleaf+spring jars> ThExpressionCheck.java <file...>
 */
public class ThExpressionCheck {

    private static final Pattern ATTR =
            Pattern.compile("\\bth:([\\w-]+)\\s*=\\s*\"([^\"]*)\"", Pattern.DOTALL);

    private static boolean VERBOSE = false;

    public static void main(String[] args) throws Exception {
        List<String> files2 = new ArrayList<>();
        for (String a : args) {
            if (a.equals("-v")) VERBOSE = true;
            else files2.add(a);
        }
        args = files2.toArray(new String[0]);
        SpringTemplateEngine engine = new SpringTemplateEngine();
        StringTemplateResolver resolver = new StringTemplateResolver();
        resolver.setTemplateMode("HTML");
        resolver.setCacheable(false);
        engine.setTemplateResolver(resolver);

        int files = 0, attrs = 0, parseErrors = 0, envSkipped = 0;
        List<String> report = new ArrayList<>();

        for (String a : args) {
            Path p = Paths.get(a);
            if (!Files.isRegularFile(p)) continue;
            files++;
            String text = new String(Files.readAllBytes(p), StandardCharsets.UTF_8);
            Matcher m = ATTR.matcher(text);
            while (m.find()) {
                String attr = m.group(1);
                String val = m.group(2);
                if (!val.contains("{")) continue;
                // .astro 源码里 JS 模板字符串会把 ${ 写成 \${（Astro 转义）⇒ 先还原，
                // 否则源码扫描会误报（产物里本来就是 ${）。
                val = val.replace("\\$", "$").replace("\\#", "#");
                attrs++;
                String tpl = "<div xmlns:th=\"http://www.thymeleaf.org\" th:" + attr + "=\""
                        + val.replace("\"", "&quot;") + "\"></div>";
                try {
                    engine.process(tpl, new Context());
                    if (VERBOSE) System.out.println("OK     th:" + attr + "  " + oneLine(val));
                } catch (Exception e) {
                    // 顶层消息只是「An error happened during template parsing」，
                    // 真正的解析错误在 cause 链里 ⇒ 必须逐层找。
                    if (isParseError(e)) {
                        parseErrors++;
                        int line = lineOf(text, m.start());
                        report.add("PARSE  " + p.getFileName() + ":" + line + "  th:" + attr
                                + "\n       " + oneLine(val));
                    } else {
                        envSkipped++;
                        if (VERBOSE) System.out.println("ENV    th:" + attr + "  "
                                + oneLine(deepestMessage(e)) + "   << " + oneLine(val));
                    }
                }
            }
        }

        for (String r : report) System.out.println(r);
        System.out.println();
        System.out.printf("Thymeleaf 真解析：文件 %d / 表达式属性 %d / 语法错误 %d / 环境性跳过 %d%n",
                files, attrs, parseErrors, envSkipped);
        if (parseErrors > 0) System.exit(1);
    }

    private static boolean isParseError(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            String m = String.valueOf(t.getMessage());
            if (m.contains("Could not parse as expression")) return true;
        }
        return false;
    }

    private static String deepestMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null && t.getCause() != t) t = t.getCause();
        return String.valueOf(t.getMessage());
    }

    private static int lineOf(String text, int idx) {
        int line = 1;
        for (int i = 0; i < idx && i < text.length(); i++) if (text.charAt(i) == '\n') line++;
        return line;
    }

    private static String oneLine(String s) {
        String t = s.replaceAll("\\s+", " ").trim();
        return t.length() > 110 ? t.substring(0, 110) + " …" : t;
    }
}

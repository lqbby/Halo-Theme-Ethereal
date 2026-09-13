#!/usr/bin/env node
/**
 * validate-th.mjs —— 用**真 Thymeleaf** 校验主题里每个 th:* 表达式能否被解析。
 *
 * 为什么需要它（1.5.0 线上事故复盘）：
 *   `th:classappend="${a}${b}"`（两个 ${} 紧邻、中间无任何分隔符）会让 Thymeleaf 抛
 *   `TemplateProcessingException: Could not parse as expression` ⇒ 页面返回 **HTTP 200
 *   但响应在异常处被截断**（客户端只拿到半个 DOM，表现成"某块内容没渲染"）。
 *   这类问题 `node --check`、grep 产物、`astro check` 全部查不出来 —— 只有真跑 Thymeleaf 才看得见。
 *
 * 判定口径：只把 `Could not parse as expression` 当错误；
 *   变量/Finder/消息键缺失等一律忽略（本地没有 Halo 上下文，那些必然失败）。
 *   实测：表达式里引用未定义变量不会报错（解析为 null）⇒ 噪音几乎为零，oracle 很干净。
 *
 * 覆盖范围：`templates/` 下的 .html（产物，真正运行的）+ `src/` 下的 .astro（源码，提前发现）。
 *
 * 依赖：JDK（`JAVA_HOME` 或 ~/.workbuddy/binaries/jdk/*）+ Thymeleaf/Spring jar
 *      （从 gradle 缓存自动找；也可用 TH_JARS_DIR 指定目录）。
 *      依赖缺失时**只提示、不失败**（exit 0），避免卡住正常构建。
 *
 * 用法： node scripts/validate-th.mjs [-v]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const VERBOSE = process.argv.includes("-v");

/** 需要的 jar：groupId/artifactId/version 三级目录里随便找一个非 sources 的 jar */
const NEEDED = [
  "org.thymeleaf/thymeleaf/3.1.5.RELEASE",
  "org.thymeleaf/thymeleaf-spring6/3.1.5.RELEASE",
  "org.springframework/spring-expression",
  "org.springframework/spring-core",
  "org.springframework/spring-beans",
  "org.springframework/spring-context",
  "org.springframework/spring-aop",
  "org.attoparser/attoparser",
  "org.unbescape/unbescape",
  "org.slf4j/slf4j-api",
];

function findJava() {
  if (process.env.JAVA_HOME) {
    const exe = join(
      process.env.JAVA_HOME,
      "bin",
      process.platform === "win32" ? "java.exe" : "java",
    );
    if (existsSync(exe)) return exe;
  }
  const base = join(homedir(), ".workbuddy", "binaries", "jdk");
  if (existsSync(base)) {
    for (const d of readdirSync(base)) {
      const exe = join(
        base,
        d,
        "bin",
        process.platform === "win32" ? "java.exe" : "java",
      );
      if (existsSync(exe)) return exe;
    }
  }
  return "java";
}

function jarFor(spec) {
  const bases = [];
  if (process.env.TH_JARS_DIR) bases.push(process.env.TH_JARS_DIR);
  bases.push(join(homedir(), ".gradle", "caches", "modules-2", "files-2.1"));
  bases.push(join(homedir(), ".m2", "repository"));
  for (const base of bases) {
    const dir = join(base, spec);
    if (!existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop();
      for (const name of readdirSync(cur)) {
        const full = join(cur, name);
        if (statSync(full).isDirectory()) stack.push(full);
        else if (
          name.endsWith(".jar") &&
          !name.includes("sources") &&
          !name.includes("javadoc")
        )
          return full;
      }
    }
  }
  return null;
}

function walk(dir, re, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, re, out);
    else if (re.test(name)) out.push(full);
  }
  return out;
}

const javaExe = findJava();
const jars = NEEDED.map(jarFor);
const missing = NEEDED.filter((_, i) => !jars[i]);
if (missing.length) {
  console.log("⏭️  跳过 Thymeleaf 校验：缺 jar → " + missing.join(", "));
  console.log("   （设 TH_JARS_DIR 指向存放这些 jar 的目录即可启用）");
  process.exit(0);
}

const targets = [
  ...walk(join(ROOT, "templates"), /\.html$/),
  ...walk(join(ROOT, "src"), /\.astro$/),
];
if (!targets.length) {
  console.log(
    "⏭️  跳过：没找到 templates/*.html 或 src/**/*.astro（先在主题根目录跑）",
  );
  process.exit(0);
}

const harness = join(ROOT, "scripts", "tools", "ThExpressionCheck.java");
if (!existsSync(harness)) {
  console.log("⏭️  跳过：缺 scripts/tools/ThExpressionCheck.java");
  process.exit(0);
}

try {
  const out = execFileSync(
    javaExe,
    [
      "-Dfile.encoding=UTF-8",
      "-Dstdout.encoding=UTF-8",
      "-cp",
      jars.join(";"),
      harness,
      ...(VERBOSE ? ["-v"] : []),
      ...targets,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  console.log(out.trim());
  console.log(`\n✔ Thymeleaf 校验通过（${targets.length} 个模板）`);
} catch (e) {
  if (e.stdout) console.log(String(e.stdout).trim());
  console.error(
    "\n✘ 存在 Thymeleaf 表达式解析错误 —— 上线会 200 但整页截断，必须修。",
  );
  process.exit(1);
}

#!/usr/bin/env node
/**
 * probe-card.mjs —— 「关于我」卡片探针：真 Thymeleaf + mock 数据**渲染**产物片段，验运行时求值。
 *
 *   node scripts/probe-card.mjs
 *
 * 为什么不是 validate-th：那个只判「表达式能否解析」，变量缺失一律算环境噪音 ⇒
 * **变量名写错**（渲染成 null、卡片静默消失）它抓不到。本探针喂 mock 数据，
 * 用真实产物（templates/about.html）里的**原样片段**渲染，逐场景断言 DOM 结果。
 *
 * 覆盖的场景见 SCENARIOS（默认值 / 切片 / 超量 / 空数据兜底）。
 * 依赖与 validate-th.mjs 相同（JDK + Thymeleaf/Spring jar，从 gradle 缓存找）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = join(ROOT, "templates", "about.html");
const PROBE = join(ROOT, "scripts", "tools", "ThRenderProbe.java");

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

if (!existsSync(TARGET)) {
  console.log("⏭️  跳过：没有 templates/about.html（先 astro build）");
  process.exit(0);
}
if (!existsSync(PROBE)) {
  console.log("⏭️  跳过：缺 scripts/tools/ThRenderProbe.java");
  process.exit(0);
}
const jars = NEEDED.map(jarFor);
const missing = NEEDED.filter((_, i) => !jars[i]);
if (missing.length) {
  console.log("⏭️  跳过：缺 jar → " + missing.join(", "));
  process.exit(0);
}

/** 语义电池：只跑一次，打印「点号/方括号/缺失键/越界」各自的真实行为 */
if (process.argv.includes("--semantics")) {
  console.log(
    execFileSync(
      findJava(),
      [
        "-Dfile.encoding=UTF-8",
        "-Dstdout.encoding=UTF-8",
        "-cp",
        jars.join(";"),
        PROBE,
        "--semantics",
      ],
      { encoding: "utf8" },
    ),
  );
  process.exit(0);
}

/** 每个场景：参数 + 对渲染结果的断言 */
const SCENARIOS = [
  {
    name: "默认（不写 count）→ 取 3 条",
    args: ["none", "4"],
    tiles: 3,
    live: 1,
    meta: "自动同步自「博客更新日志」· 最新 3 条",
    fallback: false,
  },
  {
    name: "count=2（切片 subList 路径）→ 取 2 条",
    args: ["2", "4"],
    tiles: 2,
    live: 1,
    meta: "自动同步自「博客更新日志」· 最新 2 条",
    fallback: false,
  },
  {
    name: "count=10 > 记录数（不切片）→ 全给 4 条",
    args: ["10", "4"],
    tiles: 4,
    live: 1,
    meta: "自动同步自「博客更新日志」· 最新 4 条",
    fallback: false,
  },
  {
    name: "更新日志为空 → 回退手填兜底",
    args: ["3", "0"],
    tiles: 1,
    live: 0,
    meta: null,
    fallback: true,
  },
];

const javaExe = findJava();
let bad = 0;

for (const sc of SCENARIOS) {
  let out = "";
  let failed = null;
  try {
    out = execFileSync(
      javaExe,
      [
        "-Dfile.encoding=UTF-8",
        "-Dstdout.encoding=UTF-8",
        "-cp",
        jars.join(";"),
        PROBE,
        TARGET,
        ...sc.args,
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    failed = (e.stdout || "") + "\n" + (e.stderr || "");
  }

  const checks = [];
  const tiles = (out.match(/class="about-tile"/g) || []).length;
  const live = (out.match(/about-chip is-live/g) || []).length;
  const dates = (out.match(/class="about-chip is-date"/g) || []).length;
  const vers = (out.match(/class="about-chip">v/g) || []).length;
  const hasFallback = out.includes("手填兜底条目");
  const hasMeta =
    sc.meta == null ? !out.includes("自动同步自") : out.includes(sc.meta);
  const liveText = out.includes("累积中");

  // 兜底条目没有日期 chip（手填项没有 date 字段）；同步条目每个都该有
  const expDates = sc.fallback ? 0 : sc.tiles;
  const expVers = sc.tiles;

  checks.push([`tile 数 = ${tiles}（期望 ${sc.tiles}）`, tiles === sc.tiles]);
  checks.push([`累积中角标 = ${live}（期望 ${sc.live}）`, live === sc.live]);
  checks.push([
    `角标文案渲染 ${liveText ? "有" : "无"}（期望 ${sc.live > 0 ? "有" : "无"}）`,
    liveText === sc.live > 0,
  ]);
  checks.push([`日期 chip = ${dates}（期望 ${expDates}）`, dates === expDates]);
  checks.push([`版本 chip = ${vers}（期望 ${expVers}）`, vers === expVers]);
  checks.push([`meta 文案`, hasMeta]);
  checks.push([
    `兜底分支 ${hasFallback ? "出现" : "未出现"}（期望 ${sc.fallback ? "出现" : "未出现"}）`,
    hasFallback === sc.fallback,
  ]);
  const rendered = out.includes("=== PROBE OK ===");
  checks.push([`渲染无异常`, rendered && !failed]);

  const allOk = checks.every(([, ok]) => ok);
  if (!allOk) bad++;
  console.log(`${allOk ? "✅" : "❌"} ${sc.name}`);
  for (const [label, ok] of checks) {
    if (!ok || process.env.VERBOSE)
      console.log(`     ${ok ? "·" : "✗"} ${label}`);
  }
  if (failed) {
    console.log(
      failed
        .split("\n")
        .filter((l) => l.trim())
        .slice(-8)
        .map((l) => "     | " + l)
        .join("\n"),
    );
  }
}

console.log();
console.log(
  bad === 0
    ? `✔ 卡片探针通过（${SCENARIOS.length} 个场景）`
    : `✖ 卡片探针失败：${bad} / ${SCENARIOS.length} 个场景不达标`,
);
process.exit(bad === 0 ? 0 : 1);

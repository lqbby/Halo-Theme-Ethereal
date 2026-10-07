#!/usr/bin/env node
/**
 * 拉齐 ThRenderProbe / ThExpressionCheck 需要的 jar 到 `scripts/tools/lib/`。
 *
 * 为什么要这个脚本：这两个探针是**真 Thymeleaf 引擎**跑模板表达式的唯一手段 ——
 * `validate-th.mjs` 只把 `Could not parse as expression` 当错，变量名写错、求值为 null
 * 这类问题它一律看不见；而真机探针能把「`th:src` 求值 null 到底删属性还是写空值」
 * 这种语义问题当场定论（1.5.38 就是靠它坐实了 FeaturedCards 的空 src 缺陷）。
 *
 * 为什么不把 jar 提交进仓库：9 个包 ≈ 5MB 二进制，进 git 只会让 clone 变慢、diff 变脏。
 * 用脚本保证「谁都能重建同一套 classpath」更划算。
 *
 * 用法：
 *   node scripts/tools/fetch-lib.mjs           # 缺什么补什么
 *   node scripts/tools/fetch-lib.mjs --force   # 全量重下
 *
 * 拉完这样跑（JDK 11+，单文件源码模式，注意 java 要用绝对路径）：
 *   cd scripts/tools
 *   <jdk>/bin/java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp "lib/*" ThRenderProbe.java --semantics
 *
 * ⚠️ 版本要对齐线上 Halo 的运行时：Thymeleaf 3.1.5 + Spring 6.1.x。
 *    换 Spring 大版本会让 SpEL 行为漂移，探针结论就不再代表线上。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 阿里云公共仓（已验证可用；清华 maven-central 路径是 404，别再用） */
const MIRRORS = [
  "https://maven.aliyun.com/repository/public",
  "https://repo1.maven.org/maven2",
];

const JARS = [
  "org/thymeleaf/thymeleaf/3.1.5.RELEASE/thymeleaf-3.1.5.RELEASE.jar",
  "org/thymeleaf/thymeleaf-spring6/3.1.5.RELEASE/thymeleaf-spring6-3.1.5.RELEASE.jar",
  "org/attoparser/attoparser/2.0.7.RELEASE/attoparser-2.0.7.RELEASE.jar",
  "org/unbescape/unbescape/1.1.6.RELEASE/unbescape-1.1.6.RELEASE.jar",
  "org/springframework/spring-core/6.1.14/spring-core-6.1.14.jar",
  "org/springframework/spring-beans/6.1.14/spring-beans-6.1.14.jar",
  "org/springframework/spring-context/6.1.14/spring-context-6.1.14.jar",
  "org/springframework/spring-expression/6.1.14/spring-expression-6.1.14.jar",
  "org/springframework/spring-aop/6.1.14/spring-aop-6.1.14.jar",
  "org/springframework/spring-jcl/6.1.14/spring-jcl-6.1.14.jar",
  "org/slf4j/slf4j-api/2.0.16/slf4j-api-2.0.16.jar",
];

const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.join(here, "lib");
const force = process.argv.includes("--force");

/** jar 的魔数：PK。下回来的是 HTML 错误页时靠这个当场识破（踩过：镜像 404 返回 153B 的 HTML） */
const looksLikeZip = (buf) =>
  buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b;

async function download(rel) {
  const file = path.join(libDir, path.basename(rel));
  if (!force && fs.existsSync(file) && looksLikeZip(fs.readFileSync(file))) {
    return { file: path.basename(rel), status: "已存在" };
  }
  let lastErr = "";
  for (const base of MIRRORS) {
    try {
      const res = await fetch(base + "/" + rel);
      if (!res.ok) {
        lastErr = `HTTP ${res.status} @ ${base}`;
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!looksLikeZip(buf)) {
        lastErr = `不是 jar（${buf.length}B，多半是 404 页面）@ ${base}`;
        continue;
      }
      fs.writeFileSync(file, buf);
      return {
        file: path.basename(rel),
        status: `${(buf.length / 1024).toFixed(0)}KB`,
      };
    } catch (e) {
      lastErr = `${e.message} @ ${base}`;
    }
  }
  return { file: path.basename(rel), status: "✗ 失败", error: lastErr };
}

fs.mkdirSync(libDir, { recursive: true });
const results = [];
for (const rel of JARS) results.push(await download(rel));

let failed = 0;
for (const r of results) {
  const ok = !r.error;
  if (!ok) failed++;
  console.log(
    `  ${ok ? "✓" : "✗"} ${r.file.padEnd(42)} ${r.status}${r.error ? "  → " + r.error : ""}`,
  );
}
console.log(
  failed
    ? `\n✗ ${failed}/${JARS.length} 个 jar 没拿到 —— 探针跑不起来`
    : `\n✓ ${JARS.length} 个 jar 就绪：${libDir}`,
);
process.exit(failed ? 1 : 0);

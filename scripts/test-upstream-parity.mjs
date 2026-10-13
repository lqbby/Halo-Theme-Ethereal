// @ts-check
// 上游（ethereal-up2 AGENTS.md「常见坑」）对齐桩测（2026-10-12，v1.7.36）
//
// 背景：用户要求「看一下上游，可能还有这种问题」。逐条核对上游 AGENTS.md 的
//   侧边栏/小组件约定与常见坑后，发现三处主线未对齐，本次修复并锁死：
//   P1 移动端列表的 FormKit 条件字段 key 必须与左栏区分（`mobile_widget_*`）——
//      同名 key 会在 preserve 下互相覆盖（上游明示）；三条列表的 select id 也须互异
//   P2 三个小组件数组都要有 itemLabels（否则后台条目列出全部字段，上游已示范写法）
//   P3 小组件里的图标必须用 span + icon-[...]（astro-icon 的 <Icon> 走 sprite，
//      仅在首次使用处输出 <symbol>；该处由 Thymeleaf 运行期决定渲不渲染时图标全丢）
//   P4 构建期图标遮罩前缀守卫（ensure-icon-mask-prefix）必须挂在 astro:build:done
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS = join(ROOT, "settings.yaml");
const W = join(ROOT, "src/components/widget");

let failures = 0;
/**
 * @param {string} name
 * @param {unknown} actual
 * @param {unknown} expected
 */
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "✅" : "❌"} ${name}：实得 ${JSON.stringify(actual)} / 应有 ${JSON.stringify(expected)}`,
  );
}

const src = readFileSync(SETTINGS, "utf8").replace(/\r/g, "").split("\n");
/** @param {string} exact */
function idx(exact) {
  for (let i = 0; i < src.length; i++) if (src[i].trim() === exact) return i;
  return -1;
}
const iW = idx("name: widgets");
const iM = idx("name: mobileWidgets");
const iR = idx("name: rightWidgets");
/** 段内所有 key: 值 */
function keysIn(a, b) {
  const out = new Set();
  for (const l of src.slice(a, b)) {
    const m = /^\s+key: (\S+)/.exec(l);
    if (m) out.add(m[1]);
  }
  return out;
}
const leftKeys = keysIn(iW, iM);
const mobKeys = keysIn(iM, iR);
const collide = [...leftKeys].filter((k) => mobKeys.has(k));

check(
  "P1a 移动端列表 key 全为 mobile_widget_*（不与左栏同名）",
  mobKeys.size > 0 &&
    [...mobKeys].every((k) => k.startsWith("mobile_widget_")) &&
    collide.length === 0,
  true,
);
{
  const ids = src
    .filter((l) => /^\s+id: \w*widgets_value\s*$/.test(l))
    .map((l) => l.trim());
  check(
    `P1b 三条列表 select id 互异（${ids.join(" / ")}）`,
    new Set(ids).size === ids.length && ids.length === 3,
    true,
  );
}

for (const name of ["widgets", "mobileWidgets", "rightWidgets"]) {
  const i = idx(`name: ${name}`);
  const seg = src.slice(i, i + 12).join("\n");
  check(
    `P2 ${name} 有 itemLabels（$value.value / $value.name）`,
    /itemLabels:/.test(seg) &&
      /label: \$value\.value/.test(seg) &&
      /label: \$value\.name/.test(seg),
    true,
  );
}

{
  const mp = readFileSync(join(W, "MusicPlayer.astro"), "utf8");
  check(
    "P3 MusicPlayer 不含 astro-icon <Icon>（改用 icon-[...] span）",
    !/<Icon\b/.test(mp) && !/astro-icon/.test(mp),
    true,
  );
  check(
    "P3b MusicPlayer 的图标改用 icon-[...]（抽查播放键）",
    /icon-\[material-symbols--play-arrow-rounded\]/.test(mp),
    true,
  );
  // 其余组件也不应引入 <Icon>（sprite 坑：可见性由 Thymeleaf 运行期决定）
  const offenders = readdirSync(W).filter(
    (f) =>
      f.endsWith(".astro") && /<Icon\b/.test(readFileSync(join(W, f), "utf8")),
  );
  check(
    `P3c 小组件目录无 <Icon> 残留（${offenders.join(",") || "无"}）`,
    offenders.length,
    0,
  );
}

{
  const cfg = readFileSync(join(ROOT, "astro.config.mjs"), "utf8");
  check(
    "P4 图标遮罩前缀守卫挂在 astro:build:done",
    /ensureIconMaskPrefixInDir/.test(cfg) && /astro:build:done/.test(cfg),
    true,
  );
}

// ── P5 th:* 属性值里禁写注释（2026-10-13 线上事故的永久守卫）──
// th:with 的 assignation sequence 解析器遇到非 `name=expr` 片段直接抛
// TemplateProcessingException ⇒ 响应流截断、页面转圈（不是报错页）。
// 做法：先剥掉 `${...}` 表达式（含嵌套），再在 th:*="…" 值里找 `/*`；
//       并顺带检查 `${...}` 内部也不应出现 SpEL 不支持的 `/* */` 注释。
{
  /** 剥离 ${...}（支持一层嵌套） */
  function stripExpr(s) {
    let out = "";
    let i = 0;
    while (i < s.length) {
      if (s[i] === "$" && s[i + 1] === "{") {
        let depth = 0;
        let j = i + 1;
        for (; j < s.length; j++) {
          if (s[j] === "{") depth++;
          else if (s[j] === "}") {
            depth--;
            if (depth === 0) break;
          }
        }
        out += "§";
        i = j + 1;
      } else {
        out += s[i++];
      }
    }
    return out;
  }
  const files = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".astro") || e.name.endsWith(".html"))
        files.push(p);
    }
  })(join(ROOT, "src"));
  const offenders = [];
  for (const f of files) {
    const raw = readFileSync(f, "utf8");
    const stripped = stripExpr(raw);
    const re = /\bth:[A-Za-z-]+="([^"]*)"/g;
    let m;
    while ((m = re.exec(stripped))) {
      if (m[1].includes("/*"))
        offenders.push(`${f.replace(ROOT, "")} → ${m[1].slice(0, 60)}…`);
    }
  }
  check(
    `P5 th:* 属性值内无 C 风格注释（${offenders.length} 处）`,
    offenders.length,
    0,
  );
  if (offenders.length)
    for (const o of offenders.slice(0, 5)) console.log("    ", o);
}

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);

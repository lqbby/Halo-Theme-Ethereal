#!/usr/bin/env node
/**
 * 归并「博客更新日志」：逐版本原始记录 → 发布用的批次记录
 *
 *   node scripts/merge-changelog.mjs              # 生成 changelog.json（默认每 10 个版本一条）
 *   node scripts/merge-changelog.mjs --size 5     # 换批次大小
 *   node scripts/merge-changelog.mjs --check      # 只比对，不写盘
 *   node scripts/merge-changelog.mjs --groups     # 只打印分组，方便核对边界
 *
 * 输入：changelog.raw.json      逐版本原始记录（append-only，summary/detail 都在这）
 *      changelog.batches.json   批次文案（key = 该批最高的版本号；缺省则自动兜底）
 * 输出：changelog.json          发布版 = 主题设置 extendPages.blogChangelog 的真相源
 *                              → 再用 node scripts/push-changelog.mjs --apply 推到 Halo
 *
 * 批次规则（方案 A）：**从最老开始每 N 条一组**，边界只受「更老的记录」影响，
 * 所以往后追加新版本时，已有批次的边界**永不变动**；最新一批是「正在累积」的那批。
 *
 * 每条合并记录：
 *   version  = 该批最高的主题版本号（如 v1.5.1）
 *   date     = 该批最新那天的日期
 *   entries  = 逐个版本的「版本号 · 标题」要点列表（保留明细）
 *   tags     = 该批 tags 的并集（去重，保持首次出现顺序）
 *   title / summary / detail = 取 changelog.batches.json，缺省则自动兜底
 *
 * ⚠️ 顺序即渲染顺序：days.items 必须「日期倒序 + 同日版本倒序」（模板按原序渲染，不做排序）。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "changelog.raw.json");
const BATCHES = join(ROOT, "changelog.batches.json");
const OUT = join(ROOT, "changelog.json");

const argv = process.argv.slice(2);
const CHECK = argv.includes("--check");
const GROUPS_ONLY = argv.includes("--groups");
const sizeArg = argv.indexOf("--size");
const SIZE = sizeArg >= 0 ? Number(argv[sizeArg + 1]) : 10;
if (!Number.isInteger(SIZE) || SIZE < 1) {
  console.error(`✖ --size 需要一个正整数，收到：${argv[sizeArg + 1]}`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(RAW, "utf8"));
const batches = existsSync(BATCHES)
  ? JSON.parse(readFileSync(BATCHES, "utf8"))
  : {};
const rawItems = raw?.days?.items ?? [];
if (!rawItems.length) {
  console.error(`✖ ${RAW} 里没有 days.items`);
  process.exit(1);
}

/* ---------- 排序键 ---------- */
// 主题版本 = vX.Y.Z；插件等其它记录没有这个形态，排在同一天的末尾。
function semver(x) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(String(x.version ?? ""));
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function cmpAsc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const A = semver(a);
  const B = semver(b);
  if (A && B) {
    for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] - B[i];
    return 0;
  }
  if (A) return -1; // 主题版本在同一天里排在插件记录之前
  if (B) return 1;
  return String(a.version).localeCompare(String(b.version));
}

/* ---------- 归并 ---------- */
function mergeTags(items) {
  const seen = [];
  for (const it of items) {
    for (const t of String(it.tags ?? "").split("\n")) {
      const v = t.trim();
      if (v && !seen.includes(v)) seen.push(v);
    }
  }
  return seen.join("\n");
}

function mergeEntries(items) {
  return items
    .map((it) => {
      const t = String(it.title ?? "").trim();
      return t ? `${it.version} · ${t}` : String(it.version);
    })
    .join("\n");
}

/** 批次标签：优先取该批里最高的主题版本；整批都不是主题版本时退回末条 */
function labelOf(items) {
  const themed = items.filter((it) => semver(it));
  return (themed.length ? themed[themed.length - 1] : items[items.length - 1])
    .version;
}

function build() {
  const asc = [...rawItems].sort(cmpAsc);
  const groups = [];
  for (let i = 0; i < asc.length; i += SIZE)
    groups.push(asc.slice(i, i + SIZE));

  const merged = groups.map((g) => {
    const label = labelOf(g);
    const last = g[g.length - 1];
    const copy = batches[label] ?? {};
    const firsts = g.map((x) => String(x.title ?? "").trim()).filter(Boolean);
    return {
      date: last.date,
      version: label,
      title:
        copy.title ??
        `${g.length} 个版本：${firsts[0] ?? label} … ${firsts[firsts.length - 1] ?? label}`,
      summary:
        copy.summary ??
        `本批次共归并 ${g.length} 个版本（${g[0].version} → ${label}），主要变更见下方要点。`,
      ...(copy.detail ? { detail: copy.detail } : {}),
      // 批次可自定义标签（并集往往十几个，卡片上会糊）；没写就退回并集
      tags: copy.tags ?? mergeTags(g),
      entries: mergeEntries(g),
    };
  });

  // 渲染顺序：日期倒序 + 同日版本倒序。批次之间日期通常不同，同日时按标签版本倒序。
  merged.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const A = semver(a);
    const B = semver(b);
    if (A && B) {
      for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return B[i] - A[i];
      return 0;
    }
    return String(b.version).localeCompare(String(a.version));
  });

  return { groups, merged };
}

const { groups, merged } = build();

if (GROUPS_ONLY) {
  console.log(
    `批次大小 = ${SIZE}；原始 ${rawItems.length} 条 → 归并后 ${merged.length} 条\n`,
  );
  groups.forEach((g, i) => {
    const label = labelOf(g);
    console.log(
      `  ${String(i + 1).padStart(2)}. [${String(g.length).padStart(2)}条] ${g[0].version} ~ ${g[g.length - 1].version}   →   ${label}  (${g[g.length - 1].date})`,
    );
  });
  const missing = merged
    .filter((m) => !batches[m.version])
    .map((m) => m.version);
  console.log(
    missing.length
      ? `\n⚠️ changelog.batches.json 缺少文案：${missing.join(", ")}`
      : "\n✅ 每个批次都有手写文案",
  );
  process.exit(0);
}

const { _comment, days, ...rest } = raw;
void _comment;
void days;

const out = {
  _comment:
    "「博客更新日志」页的真相源（1:1 对应主题设置 extendPages.blogChangelog）。" +
    `本文件由 scripts/merge-changelog.mjs 从 changelog.raw.json 按「每 ${SIZE} 个版本一条」生成，**不要手改** ——` +
    "改原文案请编 changelog.batches.json，加新版本请编 changelog.raw.json，然后重跑 merge。" +
    "days.items 必须按日期倒序（最新的在最上面），date 必须是 YYYY.MM.DD（模板用全长正则守卫，格式不符整行不渲染）。",
  ...rest,
  days: { ...(days ?? {}), items: merged },
};

const next = JSON.stringify(out, null, 2) + "\n";
const prev = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";

if (CHECK) {
  const norm = (s) => JSON.stringify(JSON.parse(s));
  const same = prev && norm(prev) === norm(next);
  console.log(
    same
      ? "✅ changelog.json 已是最新"
      : "⚠️ changelog.json 与生成结果不一致（跑一次不带 --check 即可更新）",
  );
  process.exit(same ? 0 : 1);
}

writeFileSync(OUT, next, "utf8");
console.log(
  `✅ 原始 ${rawItems.length} 条 → 归并 ${merged.length} 条（每批 ${SIZE}）`,
);
console.log(`   ${OUT}`);
console.log(`   下一步：node scripts/push-changelog.mjs           # dry-run`);
console.log(`           node scripts/push-changelog.mjs --apply   # 推到 Halo`);

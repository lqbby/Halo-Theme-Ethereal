#!/usr/bin/env node
/**
 * 归并「博客更新日志」：逐版本原始记录 → 发布用的批次记录
 *
 *   node scripts/merge-changelog.mjs            # 生成 changelog.json（默认按「整十版本号」收口）
 *   node scripts/merge-changelog.mjs --check    # 只比对，不写盘
 *   node scripts/merge-changelog.mjs --groups   # 只打印分组，方便核对边界
 *   node scripts/merge-changelog.mjs --size 5   # 改用「每 N 条一组」（旧模式，备用）
 *
 * 输入：changelog.raw.json      逐版本原始记录（append-only，summary/detail 都在这）
 *      changelog.batches.json   批次文案（key = 批次版本号；缺省则自动兜底）
 * 输出：changelog.json          发布版 = 主题设置 extendPages.blogChangelog 的真相源
 *                              → 再用 node scripts/push-changelog.mjs --apply 推到 Halo
 *
 * 批次规则（默认）：**按版本号的「整十」收口** —— 收口点 = 补丁位是 10 的倍数（.0 也算），
 * 每条版本归入「它之后最近的那个整十」，于是标签长这样：v1.4.10 / v1.4.20 / v1.4.30 …
 * ⚠️ 收口点是**版本空间里的位置**，不要求该版本真实发布过（如 1.4.20 从未发布，
 *    1.4.11~1.4.18 仍然归入 v1.4.20 这一批）。补丁位 91~99 会滚到下一个 minor 的 .0
 *    （所以 1.4.91~1.5.0 归入 v1.5.0）。
 * ⭐ 最后一批（还没凑到一个整十 = 正在累积的那批）用**该批最高真实版本号**命名。
 *
 * 每条合并记录：
 *   version  = 批次版本号（整十收口；累积批用真实最高版本号）
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
const MODE = sizeArg >= 0 ? "count" : "decade"; // 默认按整十版本号收口
const SIZE = sizeArg >= 0 ? Number(argv[sizeArg + 1]) : 10;
if (MODE === "count" && (!Number.isInteger(SIZE) || SIZE < 1)) {
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

/**
 * 版本空间的「收口点」：把补丁位向上取整到 10 的倍数。
 *   1.3.85 → v1.3.90   1.4.0 → v1.4.0   1.4.4 → v1.4.10   1.4.18 → v1.4.20
 *   1.4.91 → 补丁位 91 向上取整得 100 ⇒ 滚到下一个 minor ⇒ v1.5.0
 * ⚠️ 返回的是**版本空间里的位置**，不保证该版本真实发布过（1.4.20 / 1.4.50 就没发过）。
 */
function boundaryLabel(x) {
  const sv = semver(x);
  if (!sv) return null; // 插件等非主题记录：跟随当前批次
  let [maj, min, pat] = sv;
  pat = Math.ceil(pat / 10) * 10;
  while (pat >= 100) {
    min += 1;
    pat -= 100;
  }
  return `v${maj}.${min}.${pat}`;
}

/** 按「整十版本号」切桶；返回 [{ label, items, closed }]（closed = 该批已收到收口点） */
function chunkByDecade(items) {
  const out = [];
  let cur = [];
  let curLabel = null;
  for (const it of items) {
    const b = boundaryLabel(it);
    if (b === null) {
      cur.push(it); // 插件记录：不参与边界判断，跟着当前批次
      continue;
    }
    if (curLabel === null) {
      curLabel = b;
    } else if (b !== curLabel) {
      out.push({ label: curLabel, items: cur, closed: true });
      cur = [];
      curLabel = b;
    }
    cur.push(it);
  }
  if (cur.length) {
    // 最后一批：若已收到收口点就沿用整十标签，否则它是「正在累积」的那批 ⇒ 用真实最高版本号
    const closed = cur.some((x) => x.version === curLabel);
    out.push({ label: closed ? curLabel : labelOf(cur), items: cur, closed });
  }
  return out;
}

function chunkByCount(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const g = items.slice(i, i + size);
    out.push({ label: labelOf(g), items: g, closed: i + size < items.length });
  }
  return out;
}

function build() {
  const asc = [...rawItems].sort(cmpAsc);
  const groups =
    MODE === "count" ? chunkByCount(asc, SIZE) : chunkByDecade(asc);

  const merged = groups.map(({ label, items: g }) => {
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
  const how =
    MODE === "count"
      ? `每 ${SIZE} 条一组`
      : "按整十版本号收口（v1.4.10 / v1.4.20 / …）";
  console.log(
    `切法 = ${how}；原始 ${rawItems.length} 条 → 归并后 ${merged.length} 条\n`,
  );
  groups.forEach(({ label, items: g, closed }, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}. [${String(g.length).padStart(2)}条] ${g[0].version} ~ ${g[g.length - 1].version}   →   ${label}  (${g[g.length - 1].date})${closed ? "" : "   ← 正在累积"}`,
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
  `✅ 原始 ${rawItems.length} 条 → 归并 ${merged.length} 条（${MODE === "count" ? `每 ${SIZE} 条一组` : "按整十版本号收口"}）`,
);
console.log(`   ${OUT}`);
console.log(`   下一步：node scripts/push-changelog.mjs           # dry-run`);
console.log(`           node scripts/push-changelog.mjs --apply   # 推到 Halo`);

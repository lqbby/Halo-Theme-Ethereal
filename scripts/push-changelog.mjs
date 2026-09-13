#!/usr/bin/env node
/**
 * A′ 落地：把仓库里的 changelog.json 推到 Halo（主题设置 extendPages.blogChangelog）
 *
 * 用法：
 *   node scripts/push-changelog.mjs                      # dry-run：只读库 + 打印差异，不写
 *   node scripts/push-changelog.mjs --apply              # 写库（默认先 docker stop halo，写完再 start）
 *   node scripts/push-changelog.mjs --apply --no-stop    # 不重启（想验证 Halo 会不会自动热加载时用）
 *
 * 为什么必须走改库：
 *   官方 MCP `halo_update_theme_setting_group` 经 MCP 调用不可用（MCP 包装层输出 schema 不匹配，
 *   成功/失败路径都撞同一个错），且主题设置缓存在内存、改库不会触发失效
 *   ⇒ 唯一可控通道 = 「停 halo → 改 extensions 表 → 起 halo」。
 *
 * 安全：
 *   - 只改 data.extendPages 里的 blogChangelog 一个键，其余字段原样回写（Python/JS 读→改→dump，不手拼）
 *   - 写之前整份 ConfigMap 落盘到 <halo root>/_cm_backup_Ethereal-configMap.<ts>.json（唯一回滚手段）
 *   - 写完回读，逐组比对「只有 extendPages 变了」
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, ".."); // ethereal/
const HALO_ROOT = resolve(ROOT, ".."); // halo/
const CHANGELOG = join(ROOT, "changelog.json");

const argv = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");
const NO_STOP = argv.has("--no-stop");

const SSH_HOST = process.env.HALO_SSH_HOST || "群晖";
const PG_CONTAINER = "halo-postgres";
const HALO_CONTAINER = "halo";
const CM_NAME = "/registry/configmaps/Ethereal-configMap";
const DOCKER = "/usr/local/bin/docker";
const PSQL = `${DOCKER} exec -i ${PG_CONTAINER} psql -U halo -d halo -A -t`;

const NOISE =
  /post-quantum|store now, decrypt later|may need to be upgraded|^\*\*|^Warning: Permanently/;

function ssh(cmd, input) {
  const r = spawnSync("ssh", [SSH_HOST, cmd], {
    input,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  const clean = (s) =>
    (s || "")
      .split("\n")
      .filter((l) => !NOISE.test(l))
      .join("\n");
  if (r.status !== 0)
    throw new Error(
      `ssh 失败(${r.status}): ${cmd}\n${clean(r.stdout)}\n${clean(r.stderr)}`,
    );
  return clean(r.stdout);
}

function readConfigMap() {
  const b64 = ssh(
    PSQL,
    `SELECT translate(encode(data,'base64'), E'\\n', '') FROM extensions WHERE name='${CM_NAME}';\n`,
  ).trim();
  if (!b64) throw new Error(`ConfigMap 不存在：${CM_NAME}`);
  const root = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  return { root };
}

function writeConfigMap(root) {
  const b64 = Buffer.from(JSON.stringify(root), "utf8").toString("base64");
  ssh(
    PSQL,
    `UPDATE extensions SET data = decode('${b64}','base64') WHERE name='${CM_NAME}';\n`,
  );
}

function docker(action, container) {
  return ssh(`${DOCKER} ${action} ${container}`);
}

function backup(root) {
  const dir = join(HALO_ROOT);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const p = join(dir, `_cm_backup_Ethereal-configMap.${ts}.json`);
  writeFileSync(p, JSON.stringify(root, null, 2), "utf8");
  return p;
}

function summarize(label, obj) {
  const d = obj?.days?.items ?? [];
  const ms = obj?.milestones?.items ?? [];
  console.log(
    `  ${label}: days ${d.length} 条 [${d.map((x) => x.version).join(", ")}] · milestones ${ms.length} 条 [${ms.map((x) => x.version).join(", ")}]`,
  );
}

// ---------- main ----------
/**
 * 键顺序无关的深比较。
 * ⚠️ 不能直接用 JSON.stringify 比 —— Halo 侧会把 ConfigMap 的组字符串重新序列化，
 * 对象键顺序会变，直接比字符串会得出「不一致」的假阳性。
 * 但 days.items / milestones.items 是**数组**，顺序有意义（就是渲染顺序）⇒ 只对
 * object 的键排序，数组保持原序。
 */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canon(v[k])]),
    );
  }
  return v;
}
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const raw = JSON.parse(readFileSync(CHANGELOG, "utf8"));
const payload = {};
for (const [k, v] of Object.entries(raw))
  if (!k.startsWith("_")) payload[k] = v;

console.log(`📄 本地真相源：${CHANGELOG}`);
summarize("仓库", payload);
console.log(`🔌 读取线上 ConfigMap …`);
const { root } = readConfigMap();

if (!root || typeof root.data !== "object")
  throw new Error("ConfigMap 结构异常：缺少 data");
if (typeof root.data.extendPages !== "string")
  throw new Error("ConfigMap 结构异常：data.extendPages 不是字符串");

const ext = JSON.parse(root.data.extendPages);
const before = ext.blogChangelog;
summarize("线上", before);

const same = eq(before, payload);
if (same) {
  if (JSON.stringify(before) !== JSON.stringify(payload)) {
    console.log(
      "  ℹ️ 仅对象键顺序不同（Halo 重新序列化所致），内容等价 ⇒ 视为一致。",
    );
  }
  console.log("\n✅ 线上与本仓库一致，无需推送。");
  process.exit(0);
}

console.log("\n❌ 不一致 —— 待写入的变更：");
const bv = new Set(
  (before?.days?.items ?? []).map((x) => x.version + "@" + x.date),
);
const av = new Set(
  (payload.days?.items ?? []).map((x) => x.version + "@" + x.date),
);
for (const v of av) if (!bv.has(v)) console.log(`  + day   ${v}`);
for (const v of bv) if (!av.has(v)) console.log(`  − day   ${v}`);
const bm = (before?.milestones?.items ?? []).map((x) => x.version);
const am = (payload.milestones?.items ?? []).map((x) => x.version);
if (JSON.stringify(bm) !== JSON.stringify(am))
  console.log(`  ~ milestones ${JSON.stringify(bm)} → ${JSON.stringify(am)}`);
for (const k of Object.keys(payload)) {
  if (["days", "milestones"].includes(k)) continue;
  if (!eq(before?.[k], payload[k])) console.log(`  ~ ${k}`);
}

if (!APPLY) {
  console.log("\n(dry-run，未写库；加 --apply 才写)");
  process.exit(0);
}

// 构造新 ConfigMap
const newRoot = JSON.parse(JSON.stringify(root));
const newExt = JSON.parse(newRoot.data.extendPages);
newExt.blogChangelog = payload;
newRoot.data.extendPages = JSON.stringify(newExt);

// 不变式校验：只有 extendPages 变了
const changed = [];
for (const k of Object.keys(newRoot.data)) {
  if (newRoot.data[k] !== root.data[k]) changed.push(k);
}
for (const k of ["apiVersion", "kind"]) {
  if (JSON.stringify(newRoot[k]) !== JSON.stringify(root[k]))
    changed.push(`<root>.${k}`);
}
if (JSON.stringify(newRoot.metadata) !== JSON.stringify(root.metadata))
  changed.push("<root>.metadata");
if (!changed.length) {
  console.log("⚠️  未检测到任何变更，放弃写入。");
  process.exit(1);
}
if (changed.length !== 1 || changed[0] !== "extendPages") {
  console.log(
    `⚠️  作用域检查未通过，改动的组：${changed.join(", ")} —— 中止。`,
  );
  process.exit(1);
}
console.log(
  `\n作用域检查通过：仅 data.extendPages 变化（共 ${Object.keys(newRoot.data).length} 组）`,
);

const bak = backup(root);
console.log(`💾 已备份整份 ConfigMap → ${bak}`);

if (!NO_STOP) {
  console.log("⏹  停止 halo …");
  console.log("   " + docker("stop", HALO_CONTAINER).trim());
}
try {
  console.log("✍️  写入 extensions 表 …");
  writeConfigMap(newRoot);
  console.log("🔎 回读校验 …");
  const { root: back } = readConfigMap();
  const backExt = JSON.parse(back.data.extendPages);
  const ok = eq(backExt.blogChangelog, payload);
  const scopeOk = Object.keys(back.data).filter(
    (k) => back.data[k] !== root.data[k],
  );
  console.log(`   内容一致：${ok ? "✅" : "❌"}`);
  console.log(`   变动组：${scopeOk.length ? scopeOk.join(", ") : "(无)"}`);
  if (!ok) throw new Error("回读内容与目标不一致");
} finally {
  if (!NO_STOP) {
    console.log("▶️  启动 halo …");
    console.log("   " + docker("start", HALO_CONTAINER).trim());
  }
}

console.log(
  "\n✅ 推送完成。下一步：等 halo healthy（15~30s 内全站 500 属正常），",
);
console.log("   然后刷边缘缓存并抓公网验证：");
console.log(
  "   ssh " +
    SSH_HOST +
    ` "${DOCKER} inspect ${HALO_CONTAINER} --format '{{.State.Health.Status}}'"`,
);
console.log(
  "   curl -s -o /dev/null -w '%{size_download}\\n' https://www.lqbby.com/blog-changelog",
);

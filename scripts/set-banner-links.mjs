#!/usr/bin/env node
/**
 * 配置首页 Banner 链接（主题设置 style.bannerText.links.items）
 *
 * 用法：
 *   node scripts/set-banner-links.mjs             # dry-run：只读库 + 打印当前值/计划值，不写
 *   node scripts/set-banner-links.mjs --apply     # 写库（默认先 stop halo，写完 start）
 *
 * 内容（用户 2026-10-11 选定）：关于(/about) + 归档(/archives) + RSS(/rss.xml)，
 * 图标为 material-symbols 圆角系（与站内其它图标风格一致），iconify format:svg 存储格式。
 *
 * 通道：主题设置缓存在 Halo 内存、官方 MCP 保存通道不可用（输出 schema 不匹配）
 *   ⇒ 唯一可控通道 = 「停 halo → 改 extensions 表 ConfigMap → 起 halo」
 *   （同 scripts/push-changelog.mjs 的安全范式；本脚本适配当前拓扑 VM101/1Panel）。
 *
 * 拓扑：VM101 lq@192.168.5.11:10088（键 ~/.ssh/nas_root_ed25519）
 *   容器：1Panel-halo-4xQa / 1Panel-postgresql-VIXG
 */
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, ".."); // ethereal/
const HALO_ROOT = resolve(ROOT, ".."); // halo/

const argv = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");

const SSH_ARGS = [
  "-i",
  `${process.env.HOME}/.ssh/nas_root_ed25519`,
  "-p",
  "10088",
  "lq@192.168.5.11",
];
const PG_CONTAINER = "1Panel-postgresql-VIXG";
const HALO_CONTAINER = "1Panel-halo-4xQa";
const CM_NAME = "/registry/configmaps/Ethereal-configMap";
const PSQL = `sudo docker exec -i ${PG_CONTAINER} psql -U halo -d halo -A -t`;

const NOISE =
  /post-quantum|store now, decrypt later|may need to be upgraded|^\*\*|^Warning: Permanently/;

function ssh(cmd, input) {
  const r = spawnSync("ssh", [...SSH_ARGS, cmd], {
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
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
}

function writeConfigMap(root) {
  const b64 = Buffer.from(JSON.stringify(root), "utf8").toString("base64");
  ssh(
    PSQL,
    `UPDATE extensions SET data = decode('${b64}','base64') WHERE name='${CM_NAME}';\n`,
  );
}

function backup(root) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const p = join(HALO_ROOT, `_cm_backup_Ethereal-configMap.${ts}.json`);
  writeFileSync(p, JSON.stringify(root, null, 2), "utf8");
  const olds = readdirSync(HALO_ROOT)
    .filter(
      (f) =>
        f.startsWith("_cm_backup_Ethereal-configMap") && f.endsWith(".json"),
    )
    .sort()
    .reverse();
  for (const f of olds.slice(5)) {
    try {
      rmSync(join(HALO_ROOT, f));
    } catch {
      /* ignore */
    }
  }
  return p;
}

// ── 目标内容 ──────────────────────────────────────────────
const ICONS = {
  person:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M9.175 10.825Q8 9.65 8 8t1.175-2.825T12 4t2.825 1.175T16 8t-1.175 2.825T12 12t-2.825-1.175M4 18v-.8q0-.85.438-1.562T5.6 14.55q1.55-.775 3.15-1.162T12 13t3.25.388t3.15 1.162q.725.375 1.163 1.088T20 17.2v.8q0 .825-.587 1.413T18 20H6q-.825 0-1.412-.587T4 18m2 0h12v-.8q0-.275-.137-.5t-.363-.35q-1.35-.675-2.725-1.012T12 15t-2.775.338T6.5 16.35q-.225.125-.363.35T6 17.2zm6-8q.825 0 1.413-.587T14 8t-.587-1.412T12 6t-1.412.588T10 8t.588 1.413T12 10m0-.625"/></svg>',
  archive:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M11.288 10.288Q11 10.575 11 11v3.2l-.9-.9q-.275-.275-.7-.275t-.7.275t-.275.7t.275.7l2.6 2.6q.3.3.7.3t.7-.3l2.6-2.6q.275-.275.275-.7t-.275-.7t-.7-.275t-.7.275l-.9.9V11q0-.425-.288-.712T12 10t-.712.288M5 8v11h14V8zm0 13q-.825 0-1.412-.587T3 19V6.525q0-.35.113-.675t.337-.6L4.7 3.725q.275-.35.687-.537T6.25 3h11.5q.45 0 .863.188t.687.537l1.25 1.6q.225.275.338.6t.112.675V19q0 .825-.587 1.413T19 21zm.4-15h13.2l-.85-1H6.25zM5 8h14V6H5zm0 11V8z"/></svg>',
  rss: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M3.588 20.413Q3 19.825 3 19t.588-1.412T5 17t1.413.588T7 19t-.587 1.413T5 21t-1.412-.587M18.5 21q-.65 0-1.088-.475T16.9 19.4q-.275-2.425-1.312-4.537T12.9 11.1T9.138 8.413T4.6 7.1q-.65-.075-1.125-.512T3 5.5t.45-1.062t1.075-.363q3.075.275 5.763 1.563t4.737 3.337t3.338 4.738t1.562 5.762q.05.65-.375 1.088T18.5 21M4.6 12.45q-.625-.075-1.1-.5t-.475-1.075t.438-1.075t1.087-.425q1.725.125 3.225.8t2.625 1.75t1.75 2.625t.8 3.225q.025.65-.425 1.088t-1.075.437t-1.075-.475t-.5-1.1q-.075-1.075-.55-2.037t-1.237-1.688t-1.688-1.237T4.6 12.45"/></svg>',
};

const ICON_META = { width: "24", color: "" };
const makeIcon = (name, value) => ({ name, ...ICON_META, value });

const ITEMS = [
  {
    icon: makeIcon("material-symbols:person-outline-rounded", ICONS.person),
    name: "关于",
    url: "/about",
  },
  {
    icon: makeIcon("material-symbols:archive-outline-rounded", ICONS.archive),
    name: "归档",
    url: "/archives",
  },
  {
    icon: makeIcon("material-symbols:rss-feed-rounded", ICONS.rss),
    name: "RSS",
    url: "/rss.xml",
  },
];

// ── 主流程 ────────────────────────────────────────────────
// ⚠️ bannerText 隶属于 style 组（base 组里有一份遗留副本，主题读数走 style）
const root = readConfigMap();
const style = JSON.parse(root.data.style);
const before = JSON.stringify(style.bannerText?.links ?? null);
console.log("当前 links ：", before);
console.log(
  "计划 links ：",
  JSON.stringify(
    ITEMS.map((i) => ({ name: i.name, url: i.url, icon: i.icon.name })),
  ),
);
style.bannerText = style.bannerText || {};
style.bannerText.links = { items: ITEMS };
root.data.style = JSON.stringify(style);

if (!APPLY) {
  console.log("\n[DRY-RUN] 未写入。加 --apply 执行。");
  process.exit(0);
}

const bak = backup(root);
console.log("备份 →", bak);

console.log(`停 ${HALO_CONTAINER} ...`);
ssh(`sudo docker stop ${HALO_CONTAINER}`);
try {
  console.log("写库 ...");
  writeConfigMap(root);
} finally {
  console.log(`起 ${HALO_CONTAINER} ...`);
  ssh(`sudo docker start ${HALO_CONTAINER}`);
}

// 就绪等待（最长 ~120s）
const t0 = Date.now();
for (;;) {
  const st = ssh(
    `sudo docker inspect ${HALO_CONTAINER} --format '{{.State.Status}} {{.State.Health.Status}}'`,
  ).trim();
  process.stdout.write(`\r状态: ${st}   `);
  if (st.includes("healthy")) break;
  if (Date.now() - t0 > 120000)
    throw new Error("Halo 未在 120s 内恢复 healthy");
  spawnSync(process.execPath, ["-e", "setTimeout(()=>{},3000)"]);
}
console.log("\nHalo healthy ✓");

// 回读校验：只有 style 变化
const root2 = readConfigMap();
const groups = Object.keys(root.data);
const changed = groups.filter((g) => root.data[g] !== root2.data[g]);
console.log("回读变化组：", changed.join(",") || "(无)");
if (changed.length !== 1 || changed[0] !== "style")
  throw new Error("校验失败：变化的组不止 style！请用备份回滚。");
const style2 = JSON.parse(root2.data.style);
console.log(
  "回读 items：",
  JSON.stringify(style2.bannerText.links.items.map((i) => [i.name, i.url])),
);
console.log(
  "\n✅ 完成。源站验证：curl http://nas.lqbby.com:8090/ | grep banner-links",
);

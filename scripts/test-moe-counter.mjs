#!/usr/bin/env node
/**
 * 访客计数小组件（MoeCounter）行为回归测试。
 *
 * 目的：证明「counter_source = site」这条新链路真的成立 ——
 *   1. counter_source = moe（默认）：img.src = {api}/get/@{id}?theme={theme}    （不含 num，保持原行为）
 *   2. counter_source = site     ：img.src = …&num={N}                          （数字外部注入）
 *   3. data-num 为 0 / 空        ：**不带** num 参数
 *      —— Moe-Counter 的 num 默认值是 0 且 `if (num > 0)` 才走「只渲染不写库」分支，
 *         传 num=0 等价于「无 num」⇒ 会回落成自增，必须挡住。
 *   4. data-api 带旧后缀（…/get/@id?theme=…）：先裁掉再拼，避免出现
 *      `…/get/@lqbby?theme=X/get/@lqbby?theme=X`（主题参数变垃圾 ⇒ 切主题静默失效）
 *   5. counter_theme = native + site：直接用 data-num 画数字方块，**不发任何请求**
 *
 * 被测对象是**构建产物**里的内联脚本（templates/index.html），不是 .astro 源
 * —— 这样连「Astro 有没有把它原样吐出来」一起验了。
 *
 * 不给 templates/index.html 时自动挑选（templates/ 下任意含 moe-counter-root 的 html）。
 *
 * 用法：node scripts/test-moe-counter.mjs [path/to/index.html]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TEMPLATES = path.join(ROOT, "templates");

// ---------- 取被测脚本 ----------
function pickTemplate(explicit) {
  if (explicit) return explicit;
  for (const name of ["index.html", "page.html", "post.html"]) {
    const p = path.join(TEMPLATES, name);
    if (fs.existsSync(p)) {
      const s = fs.readFileSync(p, "utf8");
      if (s.includes("moe-counter-root")) return p;
    }
  }
  if (fs.existsSync(TEMPLATES)) {
    for (const f of fs.readdirSync(TEMPLATES)) {
      if (!f.endsWith(".html")) continue;
      const p = path.join(TEMPLATES, f);
      const s = fs.readFileSync(p, "utf8");
      if (s.includes("moe-counter-root")) return p;
    }
  }
  throw new Error("找不到含 moe-counter-root 的构建产物，请先 build");
}

function extractScript(html) {
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1].includes("moe-counter-root") && m[1].includes("MoeCounter"))
      return m[1];
  }
  throw new Error("构建产物里找不到访客计数的内联脚本");
}

// ---------- 极简 DOM 桩（只实现被测脚本用到的那部分） ----------
function makeEl(tag) {
  return {
    tagName: tag,
    hidden: false,
    _attrs: Object.create(null),
    _children: [],
    _style: {},
    _listeners: Object.create(null),
    get style() {
      return this._style;
    },
    getAttribute(k) {
      return k in this._attrs ? this._attrs[k] : null;
    },
    setAttribute(k, v) {
      this._attrs[k] = String(v);
    },
    addEventListener(t, fn) {
      (this._listeners[t] = this._listeners[t] || []).push(fn);
    },
    appendChild(c) {
      // 真实 DOM 会把文档片段的子节点「展平」插入父节点，桩件必须照做，
      // 否则 renderDigits 里 appendChild(frag) 之后拿不到 span（会误报为产品 bug）
      if (c && c.tagName === "#fragment") {
        for (const child of c._children) this._children.push(child);
      } else {
        this._children.push(c);
      }
      return c;
    },
    set innerHTML(v) {
      this._html = String(v);
      this._children = [];
    },
    get innerHTML() {
      return this._html || "";
    },
    set className(v) {
      this._cls = String(v);
    },
    get className() {
      return this._cls || "";
    },
    set textContent(v) {
      this._text = String(v);
    },
    get textContent() {
      return this._text || "";
    },
  };
}

function runner({ api, name, theme, num }) {
  const root = makeEl("div");
  root.id = "moe-counter-root";
  if (api != null) root._attrs["data-api"] = api;
  if (name != null) root._attrs["data-name"] = name;
  if (theme != null) root._attrs["data-theme"] = theme;
  if (num != null) root._attrs["data-num"] = num;

  const img = makeEl("img");
  const digits = makeEl("div");
  digits.hidden = true;
  const err = makeEl("div");
  const byId = {
    "moe-counter-root": root,
    "moe-counter-img": img,
    "moe-counter-digits": digits,
    "moe-counter-error": err,
  };

  let fetchCalls = [];
  const store = () => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  };

  const document = {
    getElementById: (id) => byId[id] ?? null,
    createElement: makeEl,
    createDocumentFragment: () => makeEl("#fragment"),
  };
  const win = {
    sessionStorage: store(),
    localStorage: store(),
    // 懒加载在测试里立即触发（等价于元素已在视口）
    __themeLazyInit: (_anchor, cb) => cb(),
  };

  return {
    root,
    img,
    digits,
    err,
    get fetchCalls() {
      return fetchCalls;
    },
    run(code) {
      const fetchStub = (url) => {
        fetchCalls.push(String(url));
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ name, num: 999 }),
        });
      };
      // eslint-disable-next-line no-new-func
      new Function(
        "window",
        "document",
        "console",
        "setTimeout",
        "clearTimeout",
        "fetch",
        code,
      )(
        win,
        document,
        { warn() {}, log() {}, error() {} },
        setTimeout,
        clearTimeout,
        fetchStub,
      );
    },
  };
}

// ---------- 断言 ----------
let pass = 0;
const fails = [];
function check(label, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fails.push(label);
    console.log(`  ✗ ${label}${extra ? "  → " + extra : ""}`);
  }
}

const script = extractScript(
  fs.readFileSync(pickTemplate(process.argv[2]), "utf8"),
);
console.log(
  `被测脚本：${pickTemplate(process.argv[2])}（${script.length} 字符）\n`,
);

const API = "https://moe.lqbby.com:1443";

// 1) 默认来源 = moe：不带 num
console.log("[1] counter_source=moe（无 data-num）");
{
  const r = runner({ api: API, name: "lqbby", theme: "moebooru", num: "" });
  r.run(script);
  check(
    "img.src 保持原行为且不含 num",
    r.img.src === `${API}/get/@lqbby?theme=moebooru`,
    r.img.src,
  );
}

// 2) source=site：num 注入
console.log("[2] counter_source=site（data-num=3743）");
{
  const r = runner({ api: API, name: "lqbby", theme: "moebooru", num: "3743" });
  r.run(script);
  check(
    "img.src 追加 &num=3743",
    r.img.src === `${API}/get/@lqbby?theme=moebooru&num=3743`,
    r.img.src,
  );
}

// 3) num 为 0 / 非法 → 必须丢掉（否则服务端会当成自增）
console.log("[3] data-num 为 0 / 非数字");
for (const [label, val] of [
  ["0", "0"],
  ["空串", ""],
  ["abc", "abc"],
  ["负号", "-1"],
]) {
  const r = runner({ api: API, name: "lqbby", theme: "moebooru", num: val });
  r.run(script);
  check(`num=${label} 不带 num 参数`, !r.img.src.includes("num="), r.img.src);
}

// 4) 旧配置 api 带后缀 → 先裁
console.log("[4] data-api 带 /get/@id?theme=… 旧后缀");
{
  const r = runner({
    api: `${API}/get/@lqbby?theme=moebooru`,
    name: "lqbby",
    theme: "asoul",
    num: "3743",
  });
  r.run(script);
  check(
    "裁掉旧后缀后按当前主题重建（主题设置能生效）",
    r.img.src === `${API}/get/@lqbby?theme=asoul&num=3743`,
    r.img.src,
  );
  check(
    "URL 里没有出现两次 /get/@",
    r.img.src.split("/get/@").length === 2,
    r.img.src,
  );
}

// 5) native 自绘 + site：直接画 digit，零请求
console.log("[5] counter_theme=native + counter_source=site");
{
  const r = runner({ api: API, name: "lqbby", theme: "native", num: "3743" });
  r.run(script);
  const text = r.digits._children.map((c) => c.textContent).join("");
  check("数字方块逐位渲染 3743", text === "3743", `"${text}"`);
  check(
    "未发任何请求（不碰 Moe-Counter）",
    r.fetchCalls.length === 0,
    r.fetchCalls.join(","),
  );
  check("图片未显示", r.img.hidden === true);
}

// 6) native 自绘 + moe 来源：仍走原 fetch 逻辑
console.log("[6] counter_theme=native + counter_source=moe");
{
  const r = runner({ api: API, name: "lqbby", theme: "native", num: "" });
  r.run(script);
  check(
    "回落到 /record/@id 拉取",
    r.fetchCalls.length === 1 && r.fetchCalls[0] === `${API}/record/@lqbby`,
    r.fetchCalls.join(","),
  );
}

console.log(
  `\n通过 ${pass} 项${fails.length ? `，失败 ${fails.length} 项：\n - ${fails.join("\n - ")}` : "，全部通过"}`,
);
process.exit(fails.length ? 1 : 0);

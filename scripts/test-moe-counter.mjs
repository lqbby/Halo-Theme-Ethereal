#!/usr/bin/env node
/**
 * 访客计数小组件（MoeCounter）行为回归测试。
 *
 * 目的：证明「counter_source = site」这条链路真的成立 ——
 *   1. counter_source = moe（默认）：img.src = {api}/get/@{id}?theme={theme}  （不含 num，保持原行为）
 *   2. counter_source = site     ：走**贴片精灵模式** —— 只 fetch 一次 {api}/get/@demo?theme={theme}，
 *      从返回 SVG 的 <image> 读字形尺寸后本地拼数字；img.src 不再加载
 *   3. data-num 为 0 / 空 / 非法：**不进**贴片模式、也**不带** num 参数
 *      —— Moe-Counter 的 num 默认值是 0 且 `if (num > 0)` 才走「只渲染不写库」分支，
 *         传 num=0 等价于「无 num」⇒ 会回落成自增，必须挡住。
 *   4. data-api 带旧后缀（…/get/@id?theme=…）：先裁掉再拼，避免出现
 *      `…/get/@lqbby?theme=X/get/@lqbby?theme=X`（主题参数变垃圾 ⇒ 切主题静默失效）
 *   5. counter_theme = native + site：直接用 data-num 画数字方块，**不发任何请求**
 *   6. ⭐ 贴片精灵的**核心不变量**：@demo 的 URL 恒定、不含 num ⇒ 才能被浏览器缓存一年，
 *      之后的访问才是「0 外部请求」；且单字宽度必须由服务端给的 cell 尺寸算出来
 *      （换主题不用改代码，也绝不能被写死成 moebooru 的 45×100）
 *   7. ⭐ 任一环节失败（fetch 失败 / SVG 里没有 <image>）都必须**落回**旧的服务端主题图，
 *      即 img.src = …&num=N —— 这是「新版不倒退」的保底
 *   8. ⭐ 补零：服务端 Moe-Counter 默认 padding = 7（themify: padStart(padding,'0')）⇒
 *      3743 会渲染成 0003743；@demo 精灵图只给字形、不参与补零 ⇒ 补零必须在本地做，
 *      否则精灵模式比原版主题图少几位前导 0。data-pad 缺省 = 7，"0" = 不补零。
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
    _listeners: Object.create(null),
    // CSS 自定义属性走 setProperty —— 贴片精灵全靠 --moe-* 这几个变量传递尺寸
    _style: {
      _vars: Object.create(null),
      setProperty(k, v) {
        this._vars[k] = String(v);
      },
      getPropertyValue(k) {
        return this._vars[k] || "";
      },
      removeProperty(k) {
        delete this._vars[k];
      },
    },
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
      // 否则 renderDigits / renderSprite 里 appendChild(frag) 之后拿不到 span
      //（会误报为产品 bug）
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

const API = "https://moe.lqbby.com:1443";

// 真实 @demo 响应里 <defs> 的形态：10 个字形并排，每个 <image> 自带 cell 宽高
const svgFor = (cw, ch) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 ${cw * 10} ${ch}" width="${cw * 10}" height="${ch}">
  <defs><image id="0" width="${cw}" height="${ch}" xlink:href="data:image/gif;base64,R0lGODlhLQBkALMAACocJKGkunN8ntXa6BE1dwxKpTdvw0mq6v7j0vDWzOGFgLZtauGjov7+/gAAAP///yH5BAEAAA8ALAAAAAAtAGQAAAT/8MlJq7046827" /></defs>
  <g><use x="0" xlink:href="#0" /></g>
</svg>`;

function runner({ api, name, theme, num, pad, svg, failFetch }) {
  const root = makeEl("div");
  root.id = "moe-counter-root";
  root.clientWidth = 315; // 侧栏内容宽度
  if (api != null) root._attrs["data-api"] = api;
  if (name != null) root._attrs["data-name"] = name;
  if (theme != null) root._attrs["data-theme"] = theme;
  if (num != null) root._attrs["data-num"] = num;
  if (pad != null) root._attrs["data-pad"] = pad;

  const img = makeEl("img");
  const digits = makeEl("div");
  digits.hidden = true;
  const sprite = makeEl("div");
  sprite.hidden = true;
  const err = makeEl("div");
  const byId = {
    "moe-counter-root": root,
    "moe-counter-img": img,
    "moe-counter-digits": digits,
    "moe-counter-sprite": sprite,
    "moe-counter-error": err,
  };

  const fetchCalls = [];
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
    // 贴片精灵要按 padding 算出可用宽度；桩件给一个真实侧栏的量级
    getComputedStyle: () => ({ paddingLeft: "12px", paddingRight: "12px" }),
  };

  return {
    root,
    img,
    digits,
    sprite,
    err,
    get fetchCalls() {
      return fetchCalls;
    },
    run(code) {
      const fetchStub = (url, init) => {
        fetchCalls.push(String(url));
        if (String(url).includes("/get/@demo")) {
          if (failFetch) return Promise.reject(new Error("network down"));
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(svg ?? svgFor(45, 100)),
          });
        }
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
        { warn() {}, log() {}, error() {}, info() {} },
        setTimeout,
        clearTimeout,
        fetchStub,
      );
    },
  };
}

// 贴片精灵走 Promise 链 ⇒ 断言前要让微任务/定时器跑完
const flush = () => new Promise((r) => setTimeout(r, 0));

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

const target = pickTemplate(process.argv[2]);
const script = extractScript(fs.readFileSync(target, "utf8"));
console.log(`被测脚本：${target}（${script.length} 字符）\n`);

// 1) 默认来源 = moe：不带 num，不碰 @demo
console.log("[1] counter_source=moe（无 data-num）");
{
  const r = runner({ api: API, name: "lqbby", theme: "moebooru", num: "" });
  r.run(script);
  await flush();
  check(
    "img.src 保持原行为且不含 num",
    r.img.src === `${API}/get/@lqbby?theme=moebooru`,
    r.img.src,
  );
  check("未请求 @demo", r.fetchCalls.length === 0, r.fetchCalls.join(","));
  check("贴片精灵未启用", r.sprite.hidden === true);
}

// 2) source=site：走贴片精灵，只请求一次 @demo，并按服务端默认补零到 7 位
console.log("[2] counter_source=site（data-num=3743 ⇒ 0003743）");
{
  const r = runner({ api: API, name: "lqbby", theme: "moebooru", num: "3743" });
  r.run(script);
  await flush();
  const demo = `${API}/get/@demo?theme=moebooru`;
  check(
    "只发一次请求，且指向 @demo",
    r.fetchCalls.length === 1 && r.fetchCalls[0] === demo,
    r.fetchCalls.join(","),
  );
  check("切到 sprite 状态", r.root.getAttribute("data-state") === "sprite");
  check("贴片精灵已显示", r.sprite.hidden === false);
  check("原版 img 未显示", r.img.hidden === true && !r.img.src);
  const glyphs = r.sprite._children;
  check(
    "补零到 7 位 ⇒ 7 个字形（对齐服务端 padding 默认值）",
    glyphs.length === 7,
    String(glyphs.length),
  );
  check(
    "格位索引 = 0,0,0,3,7,4,3（前导 0 就是精灵图的 0 号字形）",
    glyphs.map((g) => g.style.getPropertyValue("--moe-glyph-d")).join(",") ===
      "0,0,0,3,7,4,3",
    glyphs.map((g) => g.style.getPropertyValue("--moe-glyph-d")).join(","),
  );
  check(
    "精灵图 URL 进 CSS 变量",
    r.sprite.style.getPropertyValue("--moe-sprite") === `url("${demo}")`,
    r.sprite.style.getPropertyValue("--moe-sprite"),
  );
  check(
    "原子尺寸取自 <image> 的 45×100 ⇒ 7 位时单字 41.57 × 92.38（总宽正好 291）",
    Math.abs(
      parseFloat(r.sprite.style.getPropertyValue("--moe-glyph-w")) - 41.5714,
    ) < 0.05 &&
      Math.abs(
        parseFloat(r.sprite.style.getPropertyValue("--moe-glyph-h")) - 92.381,
      ) < 0.05,
    `${r.sprite.style.getPropertyValue("--moe-glyph-w")} × ${r.sprite.style.getPropertyValue("--moe-glyph-h")}`,
  );
  check(
    "读屏拿到真实数字（前导 0 只是补位，不进 aria-label）",
    r.sprite.getAttribute("aria-label") === "3743",
    r.sprite.getAttribute("aria-label"),
  );
  check(
    "★ 核心不变量：URL 恒定、不含 num（否则一年缓存失效，回到每次重拉）",
    !r.fetchCalls[0].includes("num=") && !r.fetchCalls[0].includes("3743"),
    r.fetchCalls[0],
  );
}

// 3) 换主题（miku 的 cell 是 165×250）：单字宽度必须跟着服务端变，不能写死
console.log("[3] 换主题 ⇒ 单字尺寸跟服务端 cell 走（不写死 moebooru 比例）");
{
  const r = runner({
    api: API,
    name: "lqbby",
    theme: "miku",
    num: "3743",
    svg: svgFor(165, 250),
  });
  r.run(script);
  await flush();
  check(
    "请求的是当前主题的 @demo",
    r.fetchCalls[0] === `${API}/get/@demo?theme=miku`,
    r.fetchCalls[0],
  );
  const h = parseFloat(r.sprite.style.getPropertyValue("--moe-glyph-h"));
  const w = parseFloat(r.sprite.style.getPropertyValue("--moe-glyph-w"));
  check(
    "按 165/250 比例算出尺寸（7 位时约 41.6 × 63.0）",
    Math.abs(w - 41.5714) < 0.05 && Math.abs(h - 62.987) < 0.05,
    `${w} × ${h}`,
  );
  const total = w * 7;
  check(
    "总宽不超出可用宽度（291px）",
    total <= 291.5,
    `总宽 ${total.toFixed(1)}px`,
  );
}

// 4) 位数变多时自动收窄，总宽仍不溢出
console.log("[4] 8 位数（总宽自适应，不顶破侧栏）");
{
  const r = runner({
    api: API,
    name: "lqbby",
    theme: "moebooru",
    num: "12345678",
  });
  r.run(script);
  await flush();
  const w = parseFloat(r.sprite.style.getPropertyValue("--moe-glyph-w"));
  const h = parseFloat(r.sprite.style.getPropertyValue("--moe-glyph-h"));
  check("渲染 8 个字形", r.sprite._children.length === 8);
  check(
    "总宽正好铺满可用宽度（291px）而未超",
    Math.abs(w * 8 - 291) < 0.5 && h < 120,
    `总宽 ${(w * 8).toFixed(1)}px，高 ${h.toFixed(1)}px`,
  );
}

// 5) num 为 0 / 非法 → 必须丢掉（否则服务端会当成自增），且不进贴片模式
console.log("[5] data-num 为 0 / 非数字");
for (const [label, val] of [
  ["0", "0"],
  ["空串", ""],
  ["abc", "abc"],
  ["负号", "-1"],
]) {
  const r = runner({ api: API, name: "lqbby", theme: "moebooru", num: val });
  r.run(script);
  await flush();
  check(
    `num=${label} 不带 num 参数且不请求 @demo`,
    !r.img.src.includes("num=") && r.fetchCalls.length === 0,
    `${r.img.src} | ${r.fetchCalls.join(",")}`,
  );
}

// 6) 旧配置 api 带后缀 → 先裁（贴片与回落两条路都要验）
console.log("[6] data-api 带 /get/@id?theme=… 旧后缀");
{
  const r = runner({
    api: `${API}/get/@lqbby?theme=moebooru`,
    name: "lqbby",
    theme: "asoul",
    num: "3743",
  });
  r.run(script);
  await flush();
  check(
    "裁掉旧后缀后按当前主题重建 @demo",
    r.fetchCalls[0] === `${API}/get/@demo?theme=asoul`,
    r.fetchCalls[0],
  );
  check(
    "URL 里没有出现两次 /get/@",
    r.fetchCalls[0].split("/get/@").length === 2,
    r.fetchCalls[0],
  );
}

// 7) @demo 拿不到（网络失败）⇒ 回落服务端主题图，行为与旧版一致
console.log("[7] @demo 请求失败 → 回落主题图");
{
  const r = runner({
    api: API,
    name: "lqbby",
    theme: "moebooru",
    num: "3743",
    failFetch: true,
  });
  r.run(script);
  await flush();
  check(
    "回落 img.src = …&num=3743（1.5.23 的老行为）",
    r.img.src === `${API}/get/@lqbby?theme=moebooru&num=3743`,
    r.img.src,
  );
  check(
    "贴片精灵隐藏且已清空",
    r.sprite.hidden === true && r.sprite.innerHTML === "",
  );
  check("状态回到 theme", r.root.getAttribute("data-state") === "theme");
}

// 8) @demo 回来了但不是预期结构（没有 <image>）⇒ 同样回落，不白屏
console.log("[8] @demo 响应结构异常 → 回落主题图");
{
  const r = runner({
    api: API,
    name: "lqbby",
    theme: "moebooru",
    num: "3743",
    svg: '<svg viewBox="0 0 450 100"></svg>',
  });
  r.run(script);
  await flush();
  check(
    "回落 img.src = …&num=3743",
    r.img.src === `${API}/get/@lqbby?theme=moebooru&num=3743`,
    r.img.src,
  );
  check("未误显示空白贴片", r.sprite.hidden === true);
}

// 9) native 自绘 + site：直接画 digit，零请求
console.log("[9] counter_theme=native + counter_source=site");
{
  const r = runner({ api: API, name: "lqbby", theme: "native", num: "3743" });
  r.run(script);
  await flush();
  const text = r.digits._children.map((c) => c.textContent).join("");
  check("补零到 7 位：0003743", text === "0003743", `"${text}"`);
  check(
    "前 3 位标为补位（is-empty），有效数字不标",
    r.digits._children
      .map((c) => (String(c.className).includes("is-empty") ? "E" : "S"))
      .join("") === "EEESSSS",
    r.digits._children.map((c) => c.className).join(" | "),
  );
  check(
    "未发任何请求（不碰 Moe-Counter）",
    r.fetchCalls.length === 0,
    r.fetchCalls.join(","),
  );
  check("图片未显示", r.img.hidden === true);
}

// 10) native 自绘 + moe 来源：仍走原 fetch 逻辑
console.log("[10] counter_theme=native + counter_source=moe");
{
  const r = runner({ api: API, name: "lqbby", theme: "native", num: "" });
  r.run(script);
  await flush();
  check(
    "回落到 /record/@id 拉取",
    r.fetchCalls.length === 1 && r.fetchCalls[0] === `${API}/record/@lqbby`,
    r.fetchCalls.join(","),
  );
}

// 11) counter_padding = 0 ⇒ 不补零（想回到「只显有效数字」时的开关）
console.log("[11] counter_padding=0（不补零）");
{
  const r = runner({
    api: API,
    name: "lqbby",
    theme: "moebooru",
    num: "3743",
    pad: "0",
  });
  r.run(script);
  await flush();
  const glyphs = r.sprite._children;
  check("4 个字形、无前导 0", glyphs.length === 4, String(glyphs.length));
  check(
    "格位索引 = 3,7,4,3",
    glyphs.map((g) => g.style.getPropertyValue("--moe-glyph-d")).join(",") ===
      "3,7,4,3",
    glyphs.map((g) => g.style.getPropertyValue("--moe-glyph-d")).join(","),
  );
  check("读屏数字不变", r.sprite.getAttribute("aria-label") === "3743");
}

// 12) data-pad 缺省 / 非法 / 超范围 ⇒ 回落默认 7，并夹到 16（与服务端取值域一致）
console.log("[12] data-pad 缺省与边界值");
for (const [label, val, expect] of [
  ["缺省（旧配置没存过该项）", null, 7],
  ["空串", "", 7],
  ["非数字", "abc", 7],
  ["负数", "-3", 7],
  ["超范围 99", "99", 16],
]) {
  const r = runner({
    api: API,
    name: "lqbby",
    theme: "moebooru",
    num: "1",
    pad: val,
  });
  r.run(script);
  await flush();
  check(
    `pad=${label} ⇒ ${expect} 位`,
    r.sprite._children.length === expect,
    String(r.sprite._children.length),
  );
}

// 13) 宽度变化后必须重算：原版 <img> 是 width:100% 自适应的，精灵模式不能退化成「一次性测量」
//     （侧栏折叠 / 窗口缩放 / 移动端旋转后，写死 px 的 background 切片会与元素实际宽度脱钩）
console.log("[13] 宽度变化 ⇒ 精灵重算");
{
  const seen = [];
  globalThis.ResizeObserver = class {
    constructor(cb) {
      this.cb = cb;
      seen.push(this);
    }
    observe() {}
    disconnect() {}
  };
  const r = runner({ api: API, name: "lqbby", theme: "moebooru", num: "3743" });
  r.run(script);
  await flush();
  const before = r.sprite.style.getPropertyValue("--moe-glyph-w");
  check(
    "渲染后注册了 ResizeObserver（持续监听可用宽度）",
    seen.length === 1,
    String(seen.length),
  );
  // 模拟侧栏变窄：可用宽度 315 → 200（再减去 12+12 的内边距）
  r.root.clientWidth = 200;
  seen.forEach((o) => o.cb());
  await flush();
  const after = r.sprite.style.getPropertyValue("--moe-glyph-w");
  check(
    "变窄后单字宽度按新可用宽度重算",
    parseFloat(after) > 0 && parseFloat(after) < parseFloat(before),
    `${before} → ${after}`,
  );
  check(
    "重算后位数与格位索引不变（只改尺寸，不改数字）",
    r.sprite._children.length === 7 &&
      r.sprite._children
        .map((g) => g.style.getPropertyValue("--moe-glyph-d"))
        .join(",") === "0,0,0,3,7,4,3" &&
      r.sprite.getAttribute("aria-label") === "3743",
    String(r.sprite._children.length),
  );
  delete globalThis.ResizeObserver;
}

console.log(
  `\n通过 ${pass} 项${fails.length ? `，失败 ${fails.length} 项：\n - ${fails.join("\n - ")}` : "，全部通过"}`,
);
process.exit(fails.length ? 1 : 0);

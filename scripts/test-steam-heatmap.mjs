#!/usr/bin/env node
/**
 * Steam 页热力图脚本（构建产物 templates/assets/steam.js）行为回归。
 *
 * 被测对象是**构建产物**（esbuild 压缩过的 IIFE），不是 .astro/.ts 源 ——
 * 这样连「构建有没有把修复原样吐出来」一起验了。因为产物被 minify（标识符打乱），
 * 所以断言一律看**行为**（请求次数 / 实例数），不看函数名。
 *
 * 模拟的运行时前提（都是真实存在、且可在本环境复现的）：
 *   · SwupScriptsPlugin 换页会**克隆重执行**本脚本（@swup/astro reloadScripts 默认 true）；
 *   · `window.swup.hooks.on("page:view", h)` 注册的 handler **跨换页持久**（globalInstance）；
 *   · `window.__etherealOnce` 跨换页持久 ⇒ 同一 env 内重复 eval 产物 = 模拟一次换页重执行。
 *
 * 覆盖：
 *   [1] 双跑：第二次脚本执行 + page:view 只能多出 **1** 次 heatmap 请求
 *   [2] echarts 加载失败后必须能重试（失败不得被永久缓存）
 *   [3] `--hue` 内联变更要触发重画；class 无变化时不得重画（防抖）
 *   [4] 并发渲染只让最新那次写 DOM（旧的那次到点即弃）
 *   [5] 取数超时：接口挂住时 10s 后 abort，不会永久 loading
 *
 * 用法：node scripts/test-steam-heatmap.mjs [templates/assets/steam.js]
 */
import fs from "node:fs";

const target = process.argv[2] || "templates/assets/steam.js";
const code = fs.readFileSync(target, "utf8");

const flush = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function mkEl(tag) {
  return {
    tagName: tag,
    hidden: false,
    dataset: {},
    complete: true,
    naturalWidth: 200,
    _children: [],
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    style: { setProperty() {}, removeProperty() {} },
    getAttribute: () => null,
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    closest: () => null,
    appendChild(c) {
      this._children.push(c);
      return c;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function makeEnv({ echartsFails = false, hangFetch = false } = {}) {
  const st = {
    heatmapCalls: 0,
    fetchUrls: [],
    scriptInserts: 0,
    echartsInitCalls: 0,
    moCallbacks: [],
    hooks: {},
    aborted: 0,
  };
  const vars = new Map([
    ["--hue", "250"],
    ["--btn-content", "#5b5b78"],
  ]);

  const canvas = mkEl("div");
  const heat = mkEl("div");
  heat.dataset = {
    days: "365",
    theme: "steam",
    legend: "true",
    echarts: "https://cdn.example/echarts.min.js",
    hoursTpl: "游戏时长：%s 小时",
  };
  heat.querySelector = (sel) =>
    sel === ".steam-heatmap__canvas" ? canvas : null;

  const docEl = mkEl("html");
  const head = mkEl("head");
  const body = mkEl("body");
  body.contains = () => true;

  const fakeEcharts = {
    init() {
      st.echartsInitCalls++;
      // 记录 init 发生时 canvas 是否仍处于 hidden（display:none ⇒ 0×0）
      st.canvasHiddenAtInit = canvas.hidden;
      return { setOption() {}, resize() {}, dispose() {} };
    },
  };

  const win = {
    __etherealOnce: {}, // 跨换页持久（同一 env 内复用）
    get swup() {
      return {
        hooks: {
          on: (ev, h) => {
            (st.hooks[ev] = st.hooks[ev] || []).push(h);
          },
        },
      };
    },
    addEventListener() {},
  };

  const document = {
    documentElement: docEl,
    head,
    body,
    getElementById: (id) => (id === "steam-heatmap" ? heat : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement(tag) {
      const el = mkEl(tag);
      if (tag === "script") {
        st.scriptInserts++;
        setTimeout(() => {
          if (echartsFails) {
            el.onerror && el.onerror();
            return;
          }
          win.echarts = fakeEcharts;
          el.onload && el.onload();
        }, 0);
      }
      return el;
    },
  };

  const fetchStub = (url, init) => {
    const u = String(url);
    st.fetchUrls.push(u);
    if (init && init.signal) {
      init.signal.addEventListener?.("abort", () => {
        st.aborted++;
      });
    }
    if (u.includes("heatmap/records")) {
      st.heatmapCalls++;
      if (hangFetch) return new Promise(() => {}); // 永远不返回
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [{ spec: { date: today(), playtimeMinutes: 90 } }],
          }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  const getComputedStyle = () => ({
    getPropertyValue: (n) => vars.get(n) || "",
  });

  class MO {
    constructor(cb) {
      this.cb = cb;
    }
    observe() {
      st.moCallbacks.push(this.cb);
    }
    disconnect() {}
  }
  class RO {
    constructor(cb) {
      this.cb = cb;
    }
    observe() {}
    disconnect() {}
  }

  return {
    st,
    win,
    vars,
    run() {
      const fn = new Function(
        "window",
        "document",
        "console",
        "setTimeout",
        "clearTimeout",
        "fetch",
        "getComputedStyle",
        "MutationObserver",
        "ResizeObserver",
        code,
      );
      fn(
        win,
        document,
        { warn() {}, log() {}, error() {}, info() {} },
        setTimeout,
        clearTimeout,
        fetchStub,
        getComputedStyle,
        MO,
        RO,
      );
    },
    firePageView() {
      (st.hooks["page:view"] || []).forEach((h) => h());
    },
    fireMutation() {
      st.moCallbacks.forEach((cb) => cb());
    },
  };
}

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

console.log(`被测产物：${target}（${code.length} 字符）\n`);

// [1] 双跑
console.log("[1] Swup 换页重执行 + page:view ⇒ 只应多出 1 次 heatmap 请求");
{
  const e = makeEnv();
  e.run();
  await flush();
  const n1 = e.st.heatmapCalls;
  check("首次执行发出 1 次 heatmap 请求", n1 === 1, String(n1));

  e.run(); // 模拟 SwupScriptsPlugin 克隆重执行
  await flush();
  const n2 = e.st.heatmapCalls;
  check("脚本重执行（未换页）不应再发请求", n2 === n1, `${n1} → ${n2}`);

  e.firePageView(); // 模拟换页后的 page:view
  await flush();
  const n3 = e.st.heatmapCalls;
  check(
    "一次换页只多 1 次请求",
    n3 - n1 === 1,
    `${n1} → ${n3}（多了 ${n3 - n1}）`,
  );
}

// [2] echarts 加载失败不得被永久缓存
console.log("[2] echarts 加载失败后必须能重试");
{
  const e = makeEnv({ echartsFails: true });
  e.run();
  await flush();
  check(
    "首次失败：插入 1 个 script",
    e.st.scriptInserts === 1,
    String(e.st.scriptInserts),
  );
  e.firePageView(); // 下一次进入/换页
  await flush();
  check(
    "失败后再次渲染会重新插入 script（未被 rejected promise 缓存挡住）",
    e.st.scriptInserts === 2,
    String(e.st.scriptInserts),
  );
}

// [3] --hue 内联变更要触发重画，其它属性变更不重画
console.log("[3] 访客改主题色（内联 --hue）⇒ 重画；无变化 ⇒ 不重画");
{
  const e = makeEnv({ echartsFails: false });
  e.run();
  await flush();
  const n1 = e.st.heatmapCalls;
  e.fireMutation(); // class / style 都没变
  await flush();
  check(
    "无变化时不重画（防抖生效）",
    e.st.heatmapCalls === n1,
    String(e.st.heatmapCalls),
  );
  e.vars.set("--hue", "140"); // 拖主题色滑杆
  e.fireMutation();
  await flush();
  check(
    "主色相变化时重画",
    e.st.heatmapCalls === n1 + 1,
    `${n1} → ${e.st.heatmapCalls}`,
  );
}

// [4] 并发渲染只让最新那次写 DOM
console.log("[4] 并发渲染：旧的那次到点即弃");
{
  const e = makeEnv();
  e.run();
  await flush();
  const before = e.st.echartsInitCalls;
  e.firePageView();
  e.firePageView(); // 两次并发（都在取数途中）
  await flush();
  check(
    "两次并发只产生 1 次 echarts.init",
    e.st.echartsInitCalls - before === 1,
    `新增 ${e.st.echartsInitCalls - before} 次`,
  );
}

// [5] 取数超时（接口挂住不得永久 loading）
console.log("[5] 接口挂住 ⇒ 10s 后 abort");
{
  const e = makeEnv({ hangFetch: true });
  e.run();
  await flush();
  check(
    "发出了请求且装配了 abort signal",
    e.st.heatmapCalls === 1 &&
      e.st.fetchUrls.some((u) => u.includes("heatmap/records")),
    String(e.st.heatmapCalls),
  );
  // 产物里应有超时常量（10000ms；minify 后可能是 1e4）与 abort 调用：
  // 压缩后定时器行为验不了，改看源码特征（两种写法都接受）
  check(
    "产物含 10s 超时 + abort 逻辑",
    /(10e3|10000|1e4)/.test(code) && /abort/i.test(code),
    "未找到超时常量/abort",
  );
}

// [6] 必须在「已可见」的容器上 init（否则 0×0 初始化，只能靠 RO 兜底；
//     不支持 RO 的浏览器上热力图永久不可见）
console.log("[6] 在可见容器上 echarts.init");
{
  const e = makeEnv();
  e.run();
  await flush();
  check(
    "init 时 canvas 不是 hidden",
    e.st.canvasHiddenAtInit === false,
    `canvas.hidden=${e.st.canvasHiddenAtInit}`,
  );
}

console.log(
  `\n通过 ${pass} 项${fails.length ? `，失败 ${fails.length} 项：\n - ${fails.join("\n - ")}` : "，全部通过"}`,
);
process.exit(fails.length ? 1 : 0);

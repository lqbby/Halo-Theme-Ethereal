// @ts-nocheck 浏览器运行时脚本（经典脚本形态：SwupScriptsPlugin 换页重执行 + window 守卫）
//
// Steam 页 /steam 的客户端行为。两块职责：
//   ① 封面兜底 —— 插件返回的 headerImageUrl 可能为 null（新游戏封面尚未补全），
//      或图片 CDN 临时不可达。失败时给 .steam-cover 打 is-broken，
//      由 CSS 换成主题色底 + Iconify 占位图标（见 styles/steam.css）。
//      为什么不在 <img> 上写内联 onerror：主题其它地方都不用内联事件属性，
//      且内联串里塞 Thymeleaf 表达式容易踩「裸属性不求值」的坑。
//   ② 游戏时长热力图 —— 插件用 ECharts 的 calendar+heatmap 画「贡献墙」。
//
// 热力图的两个关键约束（决定了本文件的写法）：
//   A. **配色必须自算**：ECharts 画在 canvas 上，canvas 吃不到 CSS 变量，
//      所以色阶只能在 JS 里拼 oklch() 字符串。但色相仍从主题取
//      （--hue），亮度阶梯照抄主题的明暗两套观感 ⇒ 与全站同源，
//      同时保留插件原有的 4 个配色主题作为「色相家族」。
//      唯一走 var(--x) 的是 tooltip：ECharts 的 tooltip 默认 renderMode:'html'，
//      是真实 DOM 节点，var() 能解析。
//   B. **必须逐次重放**：Swup 只换 #swup-container，本脚本所在 IIFE 跨换页持久
//      ⇒ 整个 IIFE 不能罩在 guardOnce 里（否则回访 /steam 直接 return，
//      热力图与封面兜底全失效）。按主题既定写法：bindGlobal() 放守卫内、
//      init() 放守卫外、再挂 onPageView 兜底（见 utils/once.ts 注释）。
//   C. **ECharts 实例必须手动 dispose**：echarts.init() 会把实例登记进模块级
//      `instances` 表（供 getInstanceByDom 用），DOM 被 Swup 换掉后它不会自动出表
//      ⇒ 换页/换主题重画若只丢掉局部变量，实例会一直挂在表里。
//      又因为 IIFE 重执行会重置局部变量，实例引用只能存在 **window** 上，
//      新的那一份 IIFE 才能把上一份的实例释放掉。
import { guardOnce, onPageView, onceBound } from "../../utils/once";

const HEATMAP_KEY = "steam-heatmap";

/** 取数超时（ms）。接口被代理/反代挂住时 await 永不返回 ⇒ 页面永久停在 loading。
 *  与 list-filter.ts 的 FETCH_TIMEOUT 保持同一量级。 */
const FETCH_TIMEOUT = 10000;

/** 跨 IIFE 副本共享的状态（IIFE 重执行会重置局部变量，只有 window 能留住）。 */
type SteamShared = {
  __steamChart?: { dispose: () => void; resize: () => void };
  __steamRO?: ResizeObserver;
  /** 渲染序号：并发/重入时只让「最新那次」写 DOM，旧的到点即弃（见 initHeatmap）。 */
  __steamReqId?: number;
};
const shared = window as unknown as SteamShared;

/* ─────────────────────────── ① 封面兜底 ─────────────────────────── */

/** 把已加载失败的封面标记出来。幂等，可反复调用。 */
function markBrokenCovers(root: ParentNode = document) {
  root.querySelectorAll(".steam-cover img").forEach((img) => {
    const box = img.closest(".steam-cover");
    if (!box) return;

    // 插件对缺失封面给的是 null ⇒ 服务端 th:src 求值为 null 时属性被摘掉，
    // 这里直接判「没有 src」为失败
    const src = img.getAttribute("src");
    if (!src || src === "about:blank") {
      box.classList.add("is-broken");
      return;
    }
    // complete && naturalWidth===0 ⇒ 已确定失败（尚未加载完时 complete 为 false，跳过）
    if (img.complete && img.naturalWidth === 0) {
      box.classList.add("is-broken");
    }
  });
}

/** 给尚未绑定的封面图挂 error/load 监听（load 成功时清掉可能的误判）。 */
function bindCoverFallbacks(root: ParentNode = document) {
  root.querySelectorAll(".steam-cover img").forEach((img) => {
    if (img.dataset.steamBound === "1") return;
    img.dataset.steamBound = "1";

    const box = img.closest(".steam-cover");
    if (!box) return;

    img.addEventListener("error", () => box.classList.add("is-broken"));
    img.addEventListener("load", () => {
      if (img.naturalWidth > 0) box.classList.remove("is-broken");
    });
  });
}

/* ────────────────────────── ② 热力图 ────────────────────────── */

/** 读主题 token 的实际计算值，取不到时回落。 */
function readVar(name, fallback) {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

/** 当前是否为暗色（Ethereal 把 .dark 挂在 <html> 上，与插件 darkModeSelector 默认值一致）。 */
function isDark() {
  return document.documentElement.classList.contains("dark");
}

/** canvas 是否支持 oklch()。用「赋值后是否被保留」探测，避免老旧内核静默画成黑块。 */
const oklchSupported = (() => {
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return false;
    ctx.fillStyle = "#123456";
    ctx.fillStyle = "oklch(0.7 0.14 250)";
    return ctx.fillStyle !== "#123456";
  } catch {
    return false;
  }
})();

/**
 * 每个配色主题的色相来源。
 * steam 用「跟随主题」—— 主题设置里改 --hue，热力图跟着走，
 * 这是把插件默认色板接入 Ethereal 的关键一步；其余三个保留原色相家族。
 */
const THEME_HUE = {
  steam: null, // null = 取主题 --hue
  github: 145,
  fire: 45,
  purple: 300,
};

/** 亮/暗两套「空单元格」底色（对齐 card-bg 的对比，不抢眼但可辨）。 */
function emptyColor(hue) {
  return isDark() ? `oklch(0.30 0.02 ${hue})` : `oklch(0.955 0.012 ${hue})`;
}

/**
 * 5 级色阶。
 * 亮色模式：浅底 → 深主色（越暗 = 时长越长），与卡片白底同调；
 * 暗色模式：深底 → 亮主色（越亮 = 越长），与暗色卡片同调。
 * 饱和度随亮度递增，避免低亮度段发灰。
 */
function rampColors(hue) {
  if (isDark()) {
    return [
      `oklch(0.34 0.05 ${hue})`,
      `oklch(0.44 0.08 ${hue})`,
      `oklch(0.54 0.11 ${hue})`,
      `oklch(0.64 0.135 ${hue})`,
      `oklch(0.74 0.15 ${hue})`,
    ];
  }
  return [
    `oklch(0.90 0.045 ${hue})`,
    `oklch(0.83 0.075 ${hue})`,
    `oklch(0.75 0.105 ${hue})`,
    `oklch(0.66 0.135 ${hue})`,
    `oklch(0.56 0.16 ${hue})`,
  ];
}

/** 色彩空间不支持时的兜底：按色相给一组近似 RGB 阶梯（粗粒度分段即可）。 */
function fallbackRamp(hue) {
  const base = ((hue % 360) + 360) % 360;
  if (base < 30) return ["#7a3f00", "#9c5608", "#c2740f", "#e0961c", "#f5b73d"];
  if (base < 90) return ["#5c4a00", "#7d6608", "#a38710", "#c9ab1c", "#edcf3d"];
  if (base < 180)
    return ["#0d4a33", "#116b48", "#1a8f5f", "#27b378", "#4ed69b"];
  if (base < 240)
    return ["#123a5c", "#17558a", "#2074b8", "#3396dd", "#66b8f0"];
  if (base < 300)
    return ["#2b2160", "#3f3288", "#5745b0", "#7259d6", "#9b86f0"];
  return ["#4a1050", "#6d1a76", "#93249e", "#b53cc0", "#d76ce0"];
}

/** 从 DOM 取本次渲染所需配置（Swup 换页后 DOM 会变，必须每次重读）。 */
function readConfig(el) {
  return {
    days: Number(el.dataset.days || "365") || 365,
    themeKey: (el.dataset.theme || "steam").trim(),
    showLegend: el.dataset.legend === "true",
    echartsUrl: (el.dataset.echarts || "").trim(),
    // i18n 文案由模板经 data-* 透传（别把中文写进 JS，否则多语言站会串）。
    // 模板串里用 %s 占位，避免把「小时 / hours / 小時」这类量词也写死在这。
    hoursTpl: (el.dataset.hoursTpl || "游戏时长：%s 小时").trim(),
  };
}

/* ECharts 动态加载：同一地址只加载一次（改设置换了地址则重新加载） */
let echartsPromise = null;
let echartsSrc = "";

function loadECharts(src) {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (!src) return Promise.reject(new Error("echarts url empty"));
  if (echartsPromise && echartsSrc === src) return echartsPromise;

  echartsSrc = src;
  echartsPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => {
      if (window.echarts) resolve(window.echarts);
      else reject(new Error("echarts global missing"));
    };
    s.onerror = () => reject(new Error("echarts load failed"));
    document.head.appendChild(s);
  }).catch((err) => {
    // ⚠️ 失败**不得**留在缓存里：否则本会话后续每次调用都直接复用这个 rejected promise
    //    ⇒ 一次网络抖动 = 热力图整会话失效（只有整页刷新能救）。
    //    清缓存让下一次 initHeatmap 真正重试；已加载成功的分支走 `window.echarts`，不受影响。
    echartsPromise = null;
    throw err;
  });
  return echartsPromise;
}

/** 拉取每日时长记录（插件公开 API，已聚合给匿名角色）。 */
async function fetchHeatmap(days) {
  const fmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const url =
    `/apis/api.steam.timxs.com/v1alpha1/heatmap/records` +
    `?startDate=${fmt(start)}&endDate=${fmt(end)}&page=1&size=${days}`;

  const ctrl =
    typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => {
    if (ctrl) ctrl.abort();
  }, FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok) throw new Error(`heatmap http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 把接口数据摊成 [日期, 分钟数, 小时文案] 的连续序列（缺口补 0）。 */
function buildSeries(data, days) {
  const byDate = new Map();
  for (const it of data.items || []) {
    const date = it.spec && it.spec.date;
    if (!date) continue;
    byDate.set(
      date,
      (byDate.get(date) || 0) + ((it.spec && it.spec.playtimeMinutes) || 0),
    );
  }

  const cells = [];
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    // 用**本地日期**拼 key，与接口 spec.date 的口径一致
    // （⚠️ 别用 toISOString，UTC 偏移会让日期整体错一天）
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
    const minutes = byDate.get(key) || 0;
    cells.push([key, minutes, (minutes / 60).toFixed(1)]);
  }
  return cells;
}

/** 释放上一份 IIFE / 上一次渲染留下的 ECharts 实例与 ResizeObserver。 */
function disposeChart() {
  if (shared.__steamRO) {
    try {
      shared.__steamRO.disconnect();
    } catch {
      /* 元素已移除，忽略 */
    }
    shared.__steamRO = undefined;
  }
  if (shared.__steamChart) {
    try {
      shared.__steamChart.dispose();
    } catch {
      /* 已销毁，忽略 */
    }
    shared.__steamChart = undefined;
  }
}

function showState(el, state) {
  const q = (sel) => el.querySelector(sel);
  const canvas = q(".steam-heatmap__canvas");
  const loading = q("[data-state-loading]");
  const empty = q("[data-state-empty]");
  const error = q("[data-state-error]");

  if (canvas) canvas.hidden = state !== "chart";
  if (loading) loading.hidden = state !== "loading";
  if (empty) empty.hidden = state !== "empty";
  if (error) error.hidden = state !== "error";
}

async function initHeatmap() {
  // ⚠️ 先领号：本函数可能被并发/重入地调用（脚本被 Swup 克隆重执行 + page:view 回调、
  //    切明暗踩在取数途中）——只让「最新那次」把结果写进 DOM。否则两路都 init 会
  //    ① 打两个 heatmap 请求 ② echarts.init 在同一 canvas 上二次调用
  //    ③ 旧的 ResizeObserver 永远不被 disconnect（引用被覆盖）。
  const myId = (shared.__steamReqId = (shared.__steamReqId || 0) + 1);

  // ⚠️ 先释放：DOM 可能已被 Swup 换掉，这里拿不到旧元素，但实例引用在 window 上
  disposeChart();

  const el = document.getElementById("steam-heatmap");
  if (!el) return; // 不在 /steam，或本次渲染没开热力图

  const canvas = el.querySelector(".steam-heatmap__canvas");
  if (!canvas) return;

  const cfg = readConfig(el);
  showState(el, "loading");

  let series;
  let echartsLib;
  try {
    const res = await Promise.all([
      loadECharts(cfg.echartsUrl),
      fetchHeatmap(cfg.days),
    ]);
    echartsLib = res[0];
    series = buildSeries(res[1], cfg.days);
  } catch (err) {
    console.warn("[steam] 热力图加载失败：", err);
    showState(el, "error");
    return;
  }

  // 期间可能已换页（DOM 不再是这一份），或已有更新的渲染在跑（领号已不是自己）⇒ 放弃这次渲染
  if (shared.__steamReqId !== myId) return;
  if (!document.body.contains(el)) return;

  const total = series.reduce((sum, c) => sum + c[1], 0);
  if (total <= 0) {
    // 插件原本只是画一张全灰的图；这里换成明确引导（追踪未启用 / 尚未产出数据）
    showState(el, "empty");
    return;
  }

  const hueFromTheme = Number(readVar("--hue", "250")) || 250;
  const hue =
    THEME_HUE[cfg.themeKey] === null
      ? hueFromTheme
      : THEME_HUE[cfg.themeKey] || hueFromTheme;
  const colors = oklchSupported ? rampColors(hue) : fallbackRamp(hue);
  const empty = oklchSupported
    ? emptyColor(hue)
    : isDark()
      ? "#2b2b2b"
      : "#ececec";

  const maxMinutes = Math.max(...series.map((c) => c[1]), 1);
  const step = maxMinutes / 5;
  const pieces = [
    { min: 0, max: 0, color: empty },
    { gt: 0, lte: step, color: colors[0] },
    { gt: step, lte: step * 2, color: colors[1] },
    { gt: step * 2, lte: step * 3, color: colors[2] },
    { gt: step * 3, lte: step * 4, color: colors[3] },
    { gt: step * 4, color: colors[4] },
  ];

  // 画在 canvas 上的文字必须给具体色值（吃不到 CSS 变量）
  const axisText = readVar("--btn-content", isDark() ? "#c9c9d4" : "#5b5b78");

  // ⚠️ init 之前必须先把 canvas 露出来：它此前被 showState(el,"loading") 置为 hidden
  //    ⇒ display:none 的容器尺寸是 0×0，ECharts 会按 0 尺寸建图（控制台告警、
  //      首帧不可见），只能等 ResizeObserver 首次回调 resize() 才救回来；
  //      而 `typeof ResizeObserver === "undefined"` 的浏览器**根本不会**救回来，
  //      热力图就永久是一片空白。
  showState(el, "chart");
  try {
    const chart = echartsLib.init(canvas);
    shared.__steamChart = chart;
    chart.setOption({
      // tooltip 是真实 DOM 节点，可以直接吃主题变量
      tooltip: {
        position: "top",
        formatter: (p) =>
          `${p.data[0]}<br/>${cfg.hoursTpl.replace("%s", p.data[2])}`,
        backgroundColor: "var(--float-panel-bg)",
        borderColor: "var(--line-color)",
        borderWidth: 1,
        textStyle: { color: "var(--deep-text)", fontSize: 12 },
        extraCssText:
          "border-radius: var(--radius-large); box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);",
      },
      visualMap: {
        show: !!cfg.showLegend,
        type: "piecewise",
        pieces,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        text: ["高", "低"],
        textStyle: { color: axisText },
        itemWidth: 10,
        itemHeight: 10,
      },
      calendar: {
        top: 20,
        left: 34,
        right: 12,
        bottom: cfg.showLegend ? 42 : 22,
        range: [series[0][0], series[series.length - 1][0]],
        cellSize: ["auto", 13],
        splitLine: { show: false },
        itemStyle: { borderColor: "transparent", borderWidth: 0 },
        yearLabel: { show: true, color: axisText },
        monthLabel: { show: true, color: axisText, nameMap: "ZH" },
        dayLabel: { show: true, color: axisText, nameMap: "ZH", firstDay: 1 },
      },
      series: [
        {
          type: "heatmap",
          coordinateSystem: "calendar",
          data: series,
          itemStyle: {
            // 格子间隙用卡片底色，形成「墙」的分离感（与插件同款做法）
            borderColor: readVar("--card-bg", isDark() ? "#2a2a33" : "#ffffff"),
            borderWidth: 2,
            borderRadius: 2,
          },
        },
      ],
    });
  } catch (err) {
    console.warn("[steam] 热力图渲染失败：", err);
    showState(el, "error");
    return;
  }

  // 容器宽度变化（侧栏收起 / 窗口缩放）时重算
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (shared.__steamChart) {
        try {
          shared.__steamChart.resize();
        } catch {
          /* 已销毁，忽略 */
        }
      }
    });
    ro.observe(canvas);
    shared.__steamRO = ro;
  }
}

/* ────────────────────────── ③ 调度 ────────────────────────── */

/** 每次进入 /steam（或本页被 Swup 重放）都要跑：重读 DOM、重放状态。 */
function init() {
  bindCoverFallbacks(document);
  markBrokenCovers(document);
  void initHeatmap();
}

function bindGlobal() {
  // 主题明暗切换后 canvas 上的色阶不会自己变（CSS 变量变了，但图表里是死色值），
  // 需要重画。观察 `<html>` 的 class **与 style**：
  //   · class → 明暗翻转（.dark）
  //   · style → 访客样式面板拖「主题色」写的是内联 `--hue`
  //     （见 utils/settings/scheme.ts 的 setHue）；只盯 class 会漏掉它，
  //     表现是「整站换了色、热力图色阶还留在旧色相」，直到切明暗或刷新。
  // 两者都没变就直接 return，避免 LightDarkSwitch 的其它 class 变动引起无谓重绘。
  let lastDark = isDark();
  let lastHue = readVar("--hue", "");
  const mo = new MutationObserver(() => {
    const now = isDark();
    const hue = readVar("--hue", "");
    if (now === lastDark && hue === lastHue) return;
    lastDark = now;
    lastHue = hue;
    void initHeatmap();
  });
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
}

// ⚠️ 顺序不能反：守卫只包 bindGlobal；init 必须留在守卫外，
// 否则回访本页时整个 IIFE 直接 return，封面兜底与热力图全部失效
// （1.5.x 系列踩过的坑，见 utils/once.ts 注释）。
if (!guardOnce(HEATMAP_KEY)) bindGlobal();
onPageView(HEATMAP_KEY, init);
// ⚠️ 顶层首跑要 onceBound 包住：SwupScriptsPlugin 换页会**克隆重执行本脚本**，
//    裸调 init() 会与上面那个跨换页持久的 page:view handler **各跑一次**
//    ⇒ 每次进 /steam 两个 heatmap 请求 + ResizeObserver 泄漏。
//    onceBound 只挡「顶层首跑」、不挡 page:view 回调 ⇒ 回访渲染不受影响
//    （同 comment-locate.ts 的写法：其注释明确写了「顶层 bind 若裸调会与 page:view
//      handler 各执行一次」这个坑）。
onceBound(HEATMAP_KEY + ":boot", init);

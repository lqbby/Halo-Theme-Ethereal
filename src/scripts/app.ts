// src/scripts/app.ts — 应用入口：协调所有初始化逻辑

// ── 全局样式 ──
import "../styles/global.css";
import "../styles/utilities.css";
import "../styles/variables.css";
import "../styles/content-widgets.css";
import "../styles/comment-widget.css";
import "../styles/base.css";
import "../styles/theme-transition.css";
import "../styles/components.css";
import "../styles/statistics.css";
import "../styles/markdown.css";
import "../styles/portfolio-card.css";
import "../styles/transition.css";
import "../styles/speed.css";
import "../styles/scrollbar.css";
import "../styles/external-link-modal.css";
import "../styles/link-apply-modal.css";
import "../styles/profile-status.css";

// ── 第三方 ──
import "overlayscrollbars/styles/overlayscrollbars.css";

// ── 工具模块 ──
import { SWUP_VISIT_END_DELAY } from "../constants/constants";
import {
  setTheme,
  getStoredTheme,
  getHue,
  setHue,
} from "../utils/setting-utils";
import {
  scrollDownToContent,
  scrollFunction,
  lockstepScrollToTop,
  smartScrollTo,
} from "../utils/scroll-manager";
import { syncHomeClass, isHomePath } from "../utils/banner-sync";
import { initLegacyAdmonitions } from "../utils/legacy-admonitions";
import { initContentEnhance } from "../utils/content-enhance";
import { initExternalLinkRedirect } from "../utils/external-link-redirect";
import { initProfileStatus } from "../utils/profile-status";
import {
  armLazyLightbox,
  initPhotosGallery,
  refreshPhotosGallery,
  destroyAll,
} from "../utils/content-media";

// 最近一次用户滚动时间戳：供「重排类任务不得在滚动期间执行」的守卫使用（见 initCustomScrollbar）
let lastUserScrollAt = 0;
window.addEventListener(
  "scroll",
  () => {
    lastUserScrollAt = Date.now();
  },
  { passive: true },
);

// 换页滚动的「复位纪元」：换页开始（visit:start）与跨页回顶复位执行时递增。
// initCustomScrollbar 挂载后「恢复滚动位置」的 rAF 据此放弃过期恢复——否则会出现
// 「导航已回顶（scrollTo 0），随后到达的挂载 rAF 发现位置对不上、又把旧位置写回」
// 的竞态：新页面里旧位置超出可滚动上限即被钳制，移动端表现为「首页底部点文章 →
// 直接落在文章页最底」（2026-10-10 CDP 实测：复位后 ~60ms 被写回 top=原位置）。
let navResetStamp = 0;

// ── 落点兜底（1.7.15；1.7.16 即时化）──
// iOS Safari 上，点击换页在复位之后仍可能被「外部写者」把滚动位置拽走
// ——真机实测：点列表最后几张卡片 → 位置原地拉扯几轮后才归位（v1.7.15
// 兜底生效但「拉回」延迟大，用户仍可感知拉扯）。
// ⚠️ 归因修正：Safari 27（2026-09）前不支持 scroll anchoring，此现象与
//    「重锚」无关；外部写者的具体来源尚未在真机定位（本地 WebKit 复刻
//    不出），故按「任何非用户输入的位置偏离都即时纠正」处理。
// 对「点击换页」做落点复核：复位后按固定延迟各查一次，只要没有用户输入
// 且位置明显偏离顶部（>2px）就再瞬时回顶；用户任何滚动/按键/指针按下
// 立即令本次 guard 失效（不与用户抢滚动，pointerdown 覆盖桌面拖滚动条
// 这类不派发 wheel 的操作）；新一轮换页（visit:start）同样使旧 guard
// 失效（token 递增）。正常路径下复位已使 scrollY=0 ⇒ 所有复核都是空
// 操作，零感知。
// ⚠️ 只在 non-popstate / non-hash 的点击换页路径挂（见 content:scroll 处）；
// #comment 等锚点路径有自己的落位接管（comment-locate），不能被拉回顶部。
// 两种档位表（按「复位是否瞬时完成」分流；v1.7.18 起判据随锁步改造变更）：
//   · 瞬时路径：复位瞬时到位（仅 prefers-reduced-motion，或非横幅模式下
//     smartScrollTo 的距离门控 >1.5 屏），位置应即稳于 0 —— 额外挂
//     scroll 事件即时纠正（外部写者一写就于下一帧收回，把「拉扯」压到
//     不可见），配密集档位兜底（防 scroll 事件在个别场景缺失）。
//   · 动画路径：复位走 700ms 动画（--dur-banner）——横幅模式锁步自
//     v1.7.18 起任意距离都动画（用户场景「页底点卡片」走这条），首档须
//     晚于动画窗口，避免把「动画没播完」误判成「被拽走」而打断动画。
const LANDING_GUARD_DELAYS_INSTANT = [120, 300, 600, 1200, 2000, 3200, 4500];
const LANDING_GUARD_DELAYS_ANIMATED = [900, 1800, 3000, 4500];
const LANDING_GUARD_CLEANUP_MS = 4700;
let landingGuardToken = 0;
function armLandingGuard(preResetY: number): void {
  const token = ++landingGuardToken;
  let userTookOver = false;
  const release = () => {
    userTookOver = true;
  };
  const enforce = (src: "event" | "timer"): void => {
    if (token !== landingGuardToken || userTookOver) return;
    if (window.scrollY > 2) {
      spNoteDrag(src, window.scrollY);
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  };
  window.addEventListener("wheel", release, { passive: true });
  window.addEventListener("touchstart", release, { passive: true });
  window.addEventListener("touchmove", release, { passive: true });
  window.addEventListener("pointerdown", release, { passive: true });
  window.addEventListener("keydown", release);
  // 本次复位是否会瞬时完成：横幅模式锁步回顶自 v1.7.18 起任意距离都走
  // 动画（仅 prefers-reduced-motion 瞬时）；非横幅模式走 smartScrollTo
  // 距离门控（>1.5 屏瞬时）。瞬时完成的路径位置应即稳于 0，任何 scroll
  // 事件（外部写者所致）即时纠正；动画路径只能靠晚于动画窗口的档位复核。
  const spReduce =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const instantPath =
    spReduce ||
    (!document.body.classList.contains("enable-banner") &&
      preResetY > (window.innerHeight || 800) * 1.5);
  spGuardArmed(instantPath ? "instant" : "animated", preResetY);
  const onScroll = () => {
    enforce("event");
  };
  if (instantPath) {
    window.addEventListener("scroll", onScroll, { passive: true });
  }
  for (const delay of instantPath
    ? LANDING_GUARD_DELAYS_INSTANT
    : LANDING_GUARD_DELAYS_ANIMATED) {
    setTimeout(() => enforce("timer"), delay);
  }
  setTimeout(() => {
    window.removeEventListener("wheel", release);
    window.removeEventListener("touchstart", release);
    window.removeEventListener("touchmove", release);
    window.removeEventListener("pointerdown", release);
    window.removeEventListener("keydown", release);
    window.removeEventListener("scroll", onScroll);
    spGuardEnded();
  }, LANDING_GUARD_CLEANUP_MS);
}

// ── 自动诊断探针（1.7.17）──
// 背景：真机「换页复位后被外部写者拽走」的写者始终未抓到——本地 Playwright
// WebKit 是 Linux 构建、没有 iOS 的 UIKit/WKWebView 层，此问题无法本地复刻；
// 静态审计已排除全部可查 JS（详见日志 2026-10-10）。本探针驻留「诊断设备」
// （站点管理员设备，用户零操作）抓现场，证据回传自建 umami（数据落自有库）：
//   ① 包装全部滚动写入 API（window/Element scrollTo、window scrollBy、
//      scrollIntoView、页面级 scrollTop setter），记录调用栈；
//   ② y 轨迹（scroll 变化采样）+ 生命周期 marks（换页/复位/撑高/scrollend/
//      地址栏 visualViewport），每条自动附类状态快照（c=is-changing a=is-animating
//      h=is-home t=toc-not-ready）——「非 JS 写者」判据：拽走发生但写入缓冲无记录；
//   ③ 落点兜底检出「拽走」（enforce 检出非用户输入的位置偏离 >2px）即抓现场快照
//      （前 8 条写入 + 前 1.5s 轨迹 + marks）回传事件 sp_drag（30s 节流）；
//      每次换页 guard 结束回传落点统计 sp_ok（drag 计数/来源/最大深度/时刻分布）。
// 激活（三选一）：① URL ?sp=1（持久化 localStorage）；② 管理员登录自动探测
// （roles 含 super-role，仅自有域名 + 未被 ?sp=0 显式关闭）；③ ?sp=0 关闭。
// 普通访客永不激活、零开销（未激活时全部函数首行 return）。
const SP_ENDPOINT = "https://umami.lqbby.com:1443/api/send";
const SP_WEBSITE = "07575ebc-0b8e-46b6-8ab6-7c1acd5109c2";
let spActive = false;
let spInstalled = false;
let spSessionSent = 0;
let spLastDragSentAt = 0;
interface SpWrite {
  t: number;
  fn: string;
  args: string;
  y: number;
  stack: string;
}
interface SpMark {
  t: number;
  name: string;
  info: string;
  cls: string;
}
const spWrites: SpWrite[] = [];
const spMarks: SpMark[] = [];
const spYtrace: Array<[number, number]> = [];
const spStats = {
  armed: false,
  path: "",
  preResetY: 0,
  startT: 0,
  dragCount: 0,
  dragEvent: 0,
  dragTimer: 0,
  maxDragY: 0,
  firstDragT: -1,
  lastDragT: -1,
};
function spNow(): number {
  return Math.round(performance.now());
}
function spPush<T>(arr: T[], item: T, cap: number, trim: number): void {
  arr.push(item);
  if (arr.length > cap) arr.splice(0, trim);
}
function spStack(): string {
  try {
    return (new Error().stack || "")
      .split("\n")
      .slice(3, 8)
      .map((s) =>
        s
          .trim()
          .replace(/^at\s+/, "")
          .split("?")[0]
          .replace(/https?:\/\/[^/]+/, ""),
      )
      .join(" < ");
  } catch (_) {
    return "";
  }
}
function spSend(name: string, data: Record<string, string | number>): void {
  if (!spActive || spSessionSent >= 80) return;
  spSessionSent += 1;
  try {
    fetch(SP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        type: "event",
        payload: {
          website: SP_WEBSITE,
          hostname: location.hostname,
          url: location.pathname + location.hash,
          title: (document.title || "").slice(0, 60),
          name,
          data,
        },
      }),
    }).catch(() => {});
  } catch (_) {}
}
function spCls(): string {
  const de = document.documentElement;
  return (
    (de.classList.contains("is-changing") ? "c" : "") +
      (de.classList.contains("is-animating") ? "a" : "") +
      (document.body.classList.contains("is-home") ? "h" : "") +
      (de.classList.contains("toc-not-ready") ? "t" : "") || "-"
  );
}
function spMark(name: string, info: string = ""): void {
  if (!spActive) return;
  spPush(spMarks, { t: spNow(), name, info, cls: spCls() }, 200, 100);
}
/** 落点兜底检出「拽走」时调用（抓现场快照回传，30s 节流） */
function spNoteDrag(src: "event" | "timer", y: number): void {
  if (!spActive) return;
  const t = spNow();
  spStats.dragCount += 1;
  if (src === "event") spStats.dragEvent += 1;
  else spStats.dragTimer += 1;
  if (y > spStats.maxDragY) spStats.maxDragY = y;
  if (spStats.firstDragT < 0) spStats.firstDragT = t;
  spStats.lastDragT = t;
  // 快照回传（30s 节流；⚠️ spLastDragSentAt 初始 0，须以 ">0" 区分「从未发送」
  // 与「30s 内已发送」——否则页面加载后 30s 内的首次拽走会被误节流吞掉）
  if (spLastDragSentAt > 0 && t - spLastDragSentAt < 30000) return;
  spLastDragSentAt = t;
  const data: Record<string, string | number> = {
    path: spStats.path,
    pre: Math.round(spStats.preResetY),
    y: Math.round(y),
    dt: spStats.startT ? t - spStats.startT : -1,
    src,
    drags: spStats.dragCount,
  };
  const ws = spWrites.slice(-8);
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    data["w" + i] =
      `${w.t}ms ${w.fn} ${w.args.slice(0, 40)} y=${w.y} | ${w.stack.slice(0, 180)}`;
  }
  const tr = spYtrace.filter(([tt]) => tt > t - 1500).slice(-10);
  for (let i = 0; i < tr.length; i++)
    data["y" + i] = `${tr[i][0]}ms ${tr[i][1]}`;
  const ms = spMarks.slice(-3);
  for (let i = 0; i < ms.length; i++)
    data["m" + i] = `${ms[i].t}ms ${ms[i].name} ${ms[i].info} [${ms[i].cls}]`;
  spSend("sp_drag", data);
}
/** guard 挂载：初始化本轮落点统计 */
function spGuardArmed(path: "instant" | "animated", preResetY: number): void {
  if (!spActive) return;
  spStats.armed = true;
  spStats.path = path;
  spStats.preResetY = preResetY;
  spStats.startT = spNow();
  spStats.dragCount = 0;
  spStats.dragEvent = 0;
  spStats.dragTimer = 0;
  spStats.maxDragY = 0;
  spStats.firstDragT = -1;
  spStats.lastDragT = -1;
}
/** guard 结束（4.7s 清理时）：回传本轮落点统计 */
function spGuardEnded(): void {
  if (!spActive || !spStats.armed) return;
  spStats.armed = false;
  const t = spNow();
  const data: Record<string, string | number> = {
    path: spStats.path,
    pre: Math.round(spStats.preResetY),
    drags: spStats.dragCount,
    ev: spStats.dragEvent,
    tm: spStats.dragTimer,
    maxy: Math.round(spStats.maxDragY),
    first: spStats.firstDragT >= 0 ? spStats.firstDragT - spStats.startT : -1,
    last: spStats.lastDragT >= 0 ? spStats.lastDragT - spStats.startT : -1,
    endy: Math.round(window.scrollY),
    dur: t - spStats.startT,
  };
  const ws = spWrites.slice(-15);
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    data["w" + i] =
      `${w.t}ms ${w.fn} ${w.args.slice(0, 40)} y=${w.y} | ${w.stack.slice(0, 160)}`;
  }
  const ms = spMarks.slice(-6);
  for (let i = 0; i < ms.length; i++)
    data["m" + i] = `${ms[i].t}ms ${ms[i].name} ${ms[i].info} [${ms[i].cls}]`;
  spSend("sp_ok", data);
}
/** 安装采集器（幂等；仅激活时安装，普通访客零开销） */
function spInstall(): void {
  if (spInstalled || !spActive) return;
  spInstalled = true;
  const rec = (fn: string, args: unknown[], stack: string): void => {
    try {
      spPush(
        spWrites,
        {
          t: spNow(),
          fn,
          args: JSON.stringify(args).slice(0, 120),
          y: Math.round(window.scrollY),
          stack,
        },
        300,
        150,
      );
    } catch (_) {}
  };
  const oTo = window.scrollTo.bind(window);
  window.scrollTo = function (...a: unknown[]) {
    rec("W.scrollTo", a, spStack());
    return (oTo as (...x: unknown[]) => void)(...a);
  };
  const oBy = window.scrollBy.bind(window);
  window.scrollBy = function (...a: unknown[]) {
    rec("W.scrollBy", a, spStack());
    return (oBy as (...x: unknown[]) => void)(...a);
  };
  const oETo = Element.prototype.scrollTo;
  Element.prototype.scrollTo = function (...a: unknown[]) {
    rec(
      "E.scrollTo[" +
        ((this as Element).id ||
          (this as Element).className ||
          (this as Element).tagName) +
        "]",
      a,
      spStack(),
    );
    return (oETo as (...x: unknown[]) => void).apply(this, a);
  };
  const oSiv = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (...a: unknown[]) {
    rec(
      "SIV[" +
        ((this as Element).id ||
          (this as Element).className ||
          (this as Element).tagName) +
        "]",
      a,
      spStack(),
    );
    return (oSiv as (...x: unknown[]) => void).apply(this, a);
  };
  const dEl = document.documentElement;
  const proto = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
  if (proto && proto.set) {
    const nativeSet = proto.set;
    Object.defineProperty(Element.prototype, "scrollTop", {
      get: proto.get,
      set(v: number) {
        if (
          this === dEl ||
          this === document.body ||
          this === document.scrollingElement
        )
          rec("setST", [v], spStack());
        return nativeSet.call(this, v);
      },
      configurable: true,
    });
  }
  window.addEventListener(
    "scroll",
    () => {
      const y = Math.round(window.scrollY);
      const last = spYtrace[spYtrace.length - 1];
      if (!last || last[1] !== y) spPush(spYtrace, [spNow(), y], 800, 400);
    },
    { passive: true },
  );
  try {
    window.visualViewport?.addEventListener("resize", () => {
      spMark("vv", `h=${Math.round(window.visualViewport?.height || 0)}`);
    });
  } catch (_) {}
  spMark("install", `vh=${window.innerHeight}`);
}
/** 激活决策：?sp=1 / ?sp=0 / localStorage 留存 / 管理员登录自动探测 */
function initScrollProbe(): void {
  try {
    const qs = new URLSearchParams(location.search);
    const sp = qs.get("sp");
    if (sp === "1") {
      try {
        localStorage.setItem("__et_sp", "1");
      } catch (_) {}
      spActive = true;
    } else if (sp === "0") {
      try {
        localStorage.setItem("__et_sp", "0");
      } catch (_) {}
      spActive = false;
    } else if (localStorage.getItem("__et_sp") === "1") {
      spActive = true;
    }
  } catch (_) {}
  if (spActive) {
    spInstall();
    return;
  }
  // 管理员自动探测：仅在自有域名 + 未被 ?sp=0 显式关闭时（普通访客 401 即止）
  let manuallyOff = false;
  try {
    manuallyOff = localStorage.getItem("__et_sp") === "0";
  } catch (_) {}
  if (manuallyOff || !/(^|\.)lqbby\.com$/.test(location.hostname)) return;
  fetch("/apis/api.console.halo.run/v1alpha1/users/-", {
    credentials: "same-origin",
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((u) => {
      if (!u) return;
      const raw: Array<{ metadata?: { name?: string } } | string> =
        Array.isArray(u.roles) ? u.roles : [];
      const roles: string[] = raw.map((x) =>
        typeof x === "string" ? x : x?.metadata?.name || "",
      );
      if (!roles.includes("super-role")) return;
      spActive = true;
      try {
        localStorage.setItem("__et_sp", "1");
      } catch (_) {}
      spInstall();
    })
    .catch(() => {});
}

// ── 自定义滚动条（懒加载，等入场动画结束后初始化） ──
let scrollbarInitialized = false;
function initCustomScrollbar() {
  if (scrollbarInitialized) return;
  scrollbarInitialized = true;
  const bodyElement = document.querySelector("body");
  if (!bodyElement) return;
  import("overlayscrollbars").then(({ OverlayScrollbars }) => {
    let mounted = false;
    // 换页进行中：is-changing / is-animating 由 Swup 在 visit 生命周期挂/摘，
    // 与 theme 其它守卫（如 RecentComments 点击拦截）同一判据
    const navBusy = () =>
      document.documentElement.classList.contains("is-changing") ||
      document.documentElement.classList.contains("is-animating");
    const mount = (fromInteraction: boolean) => {
      if (mounted) return; // 防重入：Promise.all 与 setTimeout 兜底可能双调
      mounted = true;
      // 挂载会同步 appendChild 重组 body 子元素（一次全量重排长任务），扰动滚动
      // 几何，导致「刷新后浏览器已把滚动位置恢复到底部」时挂载瞬间页面跳动。
      // 仅自动兜底（用户未交互，如 3.5s 定时器）触发时保护滚动位置：挂载前记录
      // scrollY，挂载完成后下一帧（等 OS 完成初始布局）若有偏差则恢复；用户主动
      // 滚动（wheel/touchmove/keydown）触发时不恢复——wheel 的默认滚动发生在事件
      // 处理返回后，此刻恢复会把用户刚滚到的位置拉回滚动前。
      // 🔴 换页进行中（navBusy）同样不恢复：此刻的「位置变化」是本主题自己的
      // 跨页回顶复位（scrollTo 0），恢复写回旧位置 = 把用户拽到新页深处甚至最底。
      const scrollYBefore =
        fromInteraction || navBusy() ? null : window.scrollY;
      const stampAtCapture = navResetStamp;
      OverlayScrollbars(
        { target: bodyElement, cancel: { nativeScrollbarsOverlaid: true } },
        {
          scrollbars: {
            theme: "scrollbar-base scrollbar-auto py-1",
            autoHide: "scroll",
            autoHideDelay: 500,
            autoHideSuspend: false,
          },
          // 降低滚动/事件驱动的同步测量频率（默认 event: [33, 99]：滚动中 33ms
          // 内即触发 update，OS 内部对 target 读尺寸 → 每帧强制重排）。放大首
          // 延迟与间隔后，滚动时测量节流到 100ms/250ms 档，显著减少 layout
          // thrash；其余字段保持库默认值
          update: {
            debounce: {
              mutation: [0, 33],
              resize: null,
              event: [100, 250],
              env: [222, 666, true],
            },
          },
        },
      );
      if (scrollYBefore !== null) {
        requestAnimationFrame(() => {
          // 捕获 → 恢复之间发生过换页/回顶复位（纪元变化）⇒ 旧位置已无意义，
          // 放弃恢复（否则竞态会把用户拽到新页面深处/最底）
          if (navResetStamp !== stampAtCapture) return;
          if (Math.abs(window.scrollY - scrollYBefore) > 1) {
            window.scrollTo({ top: scrollYBefore });
          }
        });
      }
    };
    // OverlayScrollbars 初始化会把 body 内容包裹进滚动容器（appendChild 移动全部
    // 元素），Chrome 对被移动且动画未结束的元素会重建 CSS 动画对象，导致入场动画
    // "播放完成后再重放一次"（复现时间点即 overlayscrollbars 下载完成瞬间）。
    // 等 fade-in-up 全部结束再初始化——此时动画已被下方的一次性保护清理，
    // 移动不再触发重放；2s 兜底防动画异常卡住。等待期间原生滚动条正常工作。
    // 挂载本身会触发一次全量重排（移动全部 body 子元素 + 尺寸测量，数百 ms），
    // 是主线程一次 ~127ms 的归因长任务。自定义滚动条纯属装饰，无需抢首屏：
    // 挂载时机改为「滚动 / 触摸滚动 / 键位」触发（不含点击/指针，见下方注释），兜底用固定 3.5s
    // 延迟——不用 requestIdleCallback：它无 timeout 时仍会在主线程首个空闲点触发
    // （实测 1.65s/2.68s 都落在 FCP→TTI 的 TBT 窗口内，长任务依旧）。3.5s 远在
    // TTI(~1.7s) 之后，且 Lighthouse 不模拟交互，故该长任务在报告中彻底消失。
    // 等待期间原生滚动条正常工作，切换不可感知。
    // ⚠️ 触发时机之上再叠「滚动中不执行」守卫（见 runWhenIdle）：wheel/touchmove
    // 命中瞬间正是滚动中，3.5s 兜底也可能落在持续滚动里，守卫保证挪到滚动停稳之后。
    const runWhenIdle = (task: (fromInteraction: boolean) => void): void => {
      let ran = false;
      // 🔴 不得在滚动期间执行：mount 会移动全部 body 子元素 + 尺寸测量（数百 ms 全量
      // 重排）。下面的 wheel/touchmove 触发器命中的正是「刚开始滚动」的时刻，若立刻
      // 执行，长任务直接落在滚动过程中（up2 线 CDP 实测 112ms 长帧、掉帧 6 帧）；
      // 3.5s 兜底同样可能在持续滚动中到点。⇒ 统一加守卫：距最近一次用户滚动 ≥300ms
      // 才执行；仍在滚则 250ms 重试，最多 20 次（≈5s）后强执行（防永不初始化）。
      let scrollGuardTries = 0;
      const run = (fromInteraction: boolean) => {
        if (ran) return;
        // 换页进行中也一并推迟（同一计数上限）：mount 的全量重排落在换页窗口里
        // 既制造卡顿，又会与回顶复位抢滚动位置（位置恢复另有纪元守卫兜底）。
        const scrollRecent =
          lastUserScrollAt > 0 && Date.now() - lastUserScrollAt < 300;
        if ((scrollRecent || navBusy()) && scrollGuardTries < 20) {
          scrollGuardTries += 1;
          setTimeout(() => run(fromInteraction), 250);
          return;
        }
        ran = true;
        task(fromInteraction);
      };
      const opts = { once: true, passive: true } as const;
      // ⚠️ 勿用 pointerdown / touchstart 触发：它们会在「点击 / 触摸」时触发 mount，
      // mount 同步 appendChild 移动全部 body 子元素，干扰同一次点击的 click 处理，
      // 导致刷新后「首次点击菜单/分类失效」（需等 3.5s 兜底 mount 完成才恢复，
      // 即用户观察到的「约 4 秒后首次点击才成功」）。wheel（桌面滚轮）/ touchmove
      // （移动端触摸滚动）/ keydown（键盘）都不直接对应「点击」，触发 mount 不会
      // 干扰正在进行的点击。
      window.addEventListener("wheel", () => run(true), opts);
      window.addEventListener("touchmove", () => run(true), opts);
      window.addEventListener("keydown", () => run(true), opts);
      setTimeout(() => run(false), 3500);
    };
    const running = document
      .getAnimations()
      .filter(
        (a) =>
          a instanceof CSSAnimation &&
          (a.animationName === "fade-in-up" ||
            a.animationName === "slide-in-up"),
      );
    if (running.length > 0) {
      void Promise.all(
        running.map((a) => a.finished.catch(() => undefined)),
      ).then(() => runWhenIdle(mount));
      setTimeout(() => runWhenIdle(mount), 2000);
    } else {
      runWhenIdle(mount);
    }
  });
}

// ── 入场动画一次性保护 ──
// 浏览器会因元素移动（滚动容器包裹等）/样式重算重建 CSS 动画对象，使入场动画
// 从头重放。用 document 级事件委托在动画结束/取消后清理：
//  - .onload-animation 类元素：移除类（回到静态可见状态，重放无动画可播）
//  - banner 标题/副标题（动画由 CSS 选择器定义，无类可移除）：内联固化终态
//    （opacity: 1 + animation: none）
function removeOnloadAnimation(e: AnimationEvent) {
  const el = e.target as Element | null;
  if (!el) return;
  if (el.classList.contains("onload-animation")) {
    el.classList.remove("onload-animation");
  }
  if (el.id === "banner-title" || el.id === "banner-subtitle-wrapper") {
    const style = (el as HTMLElement).style;
    style.opacity = "1";
    style.animation = "none";
  }
}
document.addEventListener("animationend", removeOnloadAnimation);
document.addEventListener("animationcancel", removeOnloadAnimation);

// ── 首刷壁纸主题对齐 ──
// 对齐逻辑（暗色 source 存废 + src/位置归位）统一放在 MainGridLayout 紧随
// #banner-wrapper 的内联脚本里，经 window.__etherealAlignBannerTheme 暴露：
// 那里在**解析期**就按 html.dark（<head> 内联脚本已同步定档）落定壁纸，比本模块早得多
// （本模块 import 十余个样式表）。本处 init 阶段再调一次（幂等）：
// · 暗色下先把 src 切到 data-theme-src，showBanner 再按「图片就绪才 reveal」等待暗色图，
//   首显即为正确主题图（亮色主题下 src===next 零副作用）；
// · 亮色下若系统是暗色，内联脚本已移除暗色 <source>，避免「揭示出暗图再被换掉」的闪图。
// 内联脚本缺失（异常构建）时不额外兜底：banner-theme-switch 到 DOMContentLoaded 仍会对齐。
function alignBannerTheme() {
  const align = window.__etherealAlignBannerTheme;
  if (typeof align === "function") align();
}

// ── Banner 显示 ──
// 揭示逻辑（媒体就绪判定 + 首帧门槛 + 摘 opacity-0/scale-105）统一放在
// MainGridLayout 的内联脚本里，经 window.__etherealRevealBanners 暴露：首屏由它
// 在解析期直接调用（不等本模块，避免主 bundle 拖慢 LCP），Swup 换页后重建的 banner
// 由这里再调一次。保持单一实现——双容器/多媒体的就绪判定不再各写一份。
// 渐显仍必须绑定「媒体就绪」时刻：图片就绪才解除遮蔽 + 触发 transition，
// 保证「图片出现即渐显」的观感；若脱离加载时序（如 CSS 无条件动画），
// 慢加载图片会先空白后硬闪现。
function showBanner() {
  const revealBanners = window.__etherealRevealBanners;
  if (typeof revealBanners === "function") {
    revealBanners();
    return;
  }
  // 内联脚本缺失（异常构建）时的兜底：直接显示，宁可丢动画也不能让 banner 永久隐藏
  document.querySelectorAll(".banner-reveal").forEach((banner) => {
    banner.classList.remove("opacity-0", "scale-105");
  });
}

// ── Banner overlay 显隐同步 ──
// SSR 在非首页给 #banner-overlay 设置 display:none 内联样式，
// 该元素在 Swup 容器外，跨页切换时不被替换，需手动同步。
// 首次加载由 banner-responsive.ts initOverlay() 处理，
// 此处仅覆盖 Swup 导航场景（banner-responsive.ts 不会重新执行）
function syncBannerOverlay() {
  const overlay = document.getElementById("banner-overlay");
  if (!overlay) return;
  if (overlay.style.display === "none") {
    overlay.style.display = "";
  }
  const wasHidden = overlay.classList.contains("banner-text-hidden");
  overlay.classList.toggle("banner-text-hidden", !isHomePath());
  if (isHomePath() && wasHidden) {
    document.dispatchEvent(new CustomEvent("banner:visible"));
  }
}

// ── 点击外部关闭面板 ──
function setClickOutsideToClose(panel: string, ignores: string[]) {
  document.addEventListener("click", (event) => {
    const panelDom = document.getElementById(panel);
    const target = event.target;
    if (!panelDom || !(target instanceof Node)) return;
    for (const ignored of ignores) {
      const ignoredEl = document.getElementById(ignored);
      if (ignoredEl === target || ignoredEl?.contains(target)) return;
    }
    panelDom.classList.add("float-panel-closed");
  });
}

// ── 恢复 history 原始方法 ──
function restoreOriginalHistoryStateHandlers() {
  const originalHistory = (window as any).__etherealOriginalHistory;
  if (!originalHistory) return;
  if (originalHistory.pushState)
    window.history.pushState = originalHistory.pushState;
  if (originalHistory.replaceState)
    window.history.replaceState = originalHistory.replaceState;
}

// ── widget-layout 自定义元素（小组件折叠"更多"按钮）──
// 必须在全局无条件注册，不能依赖任何具体小组件的渲染位置，
// 否则公告等组件被 th:if 隐藏时，分类/标签等按钮会全部失效。
class WidgetLayoutElement extends HTMLElement {
  connectedCallback() {
    if (this.dataset.isCollapsed !== "true") return;
    const id = this.dataset.id;
    const btn = this.querySelector(".expand-btn");
    const wrapper = this.querySelector(`#${id}`);
    btn?.addEventListener("click", () => {
      wrapper?.classList.remove("collapsed");
      btn.classList.add("hidden");
    });
  }
}

if (!customElements.get("widget-layout")) {
  customElements.define("widget-layout", WidgetLayoutElement);
}

// ── table-of-contents 自定义元素（目录组件，上游 7e6c87c 迁入）──
// 与 widget-layout 同理：必须在全局无条件注册，不能依赖任何具体实例的渲染位置。
// TOC 在页面里有多个实例（左右侧栏目录槽位、两栏悬浮目录、移动端目录弹窗），
// 而侧栏实例会被 th:if 按 post.toc.position 配置移除；Astro 对组件脚本全页只输出
// 一次且落在第一个实例处，注册脚本随该实例被移除时，另一栏的 <table-of-contents>
// 永远不会 upgrade —— 表现为目录卡片整体空白（条目、占位都没有）。
// 本地特有（保留）：headingText 剔除 heading-anchor、阅读线 +2px 容差、三栏窄边距、
// toc-not-ready 跳过高亮、单次 insertBefore、单一坐标系跟随。
/**
 * 标题纯文本：剔除装饰性锚点 <a class="heading-anchor">#</a>。
 * content-enhance 会给每个 h2/h3 注入这个锚点，直接读 textContent 会把它的
 * "#" 一起吞进目录标题（显示成「它是什么#」）。
 */
function headingText(heading: HTMLElement): string {
  const clone = heading.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".heading-anchor").forEach((el) => el.remove());
  return clone.textContent?.trim() || "";
}

class TableOfContents extends HTMLElement {
  tocEl: HTMLElement | null = null;
  visibleClass = "visible";
  mutationObserver?: MutationObserver;
  scrollHandler?: () => void;
  resizeHandler?: () => void;
  anchorNavTarget: HTMLElement | null = null;
  headings: HTMLElement[] = [];
  tocEntries: HTMLAnchorElement[] = [];
  active: boolean[] = [];
  activeIndicator: HTMLElement | null = null;
  /** 阅读线（px）：标题顶边越过它就算「已读到」。
   *  必须与标题的 scroll-margin-top 对齐（markdown.css 里 6rem = 96px，也就是
   *  锚点跳转的落点），并留 2px 容差 —— 锚点跳转后标题恰好落在 96.xx px，
   *  严格 `<= 96` 会把目标自己判掉，症状是「点了目录、页面滚到位了，
   *  高亮却停在上一条」。init() 里按实际计算值算一次，避免每帧读样式。 */
  readLine = 98;

  connectedCallback() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", this.refresh);
    } else {
      this.refresh();
    }

    // 换页后刷新由 app.ts 中 swup.hooks.on("content:replace") 的真实钩子
    // 承担；原 swup:contentReplaced 监听删除（v3 事件名从未触发）。
  }

  disconnectedCallback() {
    this.mutationObserver?.disconnect();
    this.removeWindowListeners();
    this.tocEl?.removeEventListener("click", this.handleAnchorClick, {
      capture: true,
    });
    document.removeEventListener("DOMContentLoaded", this.refresh);
  }

  refresh = () => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!this.isConnected) return;
        if (!this.init()) {
          window.setTimeout(() => this.isConnected && this.init(), 80);
        }
      }),
    );
  };

  reset() {
    this.mutationObserver?.disconnect();
    this.removeWindowListeners();
    this.tocEl?.removeEventListener("click", this.handleAnchorClick, {
      capture: true,
    });
    this.querySelectorAll("[data-toc-entry]").forEach((entry) =>
      entry.remove(),
    );
    this.headings = [];
    this.tocEntries = [];
    this.active = [];
    this.anchorNavTarget = null;
    this.readLine = 98;
    this.activeIndicator = this.querySelector("[data-toc-indicator]");
    this.activeIndicator?.setAttribute("style", "opacity: 0");
    this.querySelector("[data-toc-empty]")?.classList.add("hidden");
  }

  removeWindowListeners() {
    if (this.scrollHandler) {
      window.removeEventListener("scroll", this.scrollHandler);
      this.scrollHandler = undefined;
    }
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = undefined;
    }
  }

  init() {
    this.reset();
    const content = document.querySelector<HTMLElement>("#content, .custom-md");
    const scrollParent = this.closest("[data-toc-scroll]");
    this.tocEl =
      scrollParent instanceof HTMLElement
        ? scrollParent
        : document.getElementById("toc-inner-wrapper");
    if (!content || !this.tocEl) {
      return false;
    }

    this.mutationObserver = new MutationObserver(() => {
      if (!this.headings.length) this.refresh();
    });
    this.mutationObserver.observe(content, {
      childList: true,
      subtree: true,
    });

    const allHeadings = Array.from(
      content.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
    ).filter((heading) => headingText(heading));
    const maxDepth = Math.max(1, Number(this.dataset.maxDepth || "4"));
    const minDepth = allHeadings.length
      ? Math.min(
          ...allHeadings.map((heading) => Number(heading.tagName.substring(1))),
        )
      : 1;
    this.headings = allHeadings.filter(
      (heading) => Number(heading.tagName.substring(1)) < minDepth + maxDepth,
    );
    this.active = this.headings.map(() => false);
    // 阅读线 = 标题的 scroll-margin-top（锚点落点）+ 2px 容差。这里算一次存起来，
    // 别放进 currentHeadingIndex（它每帧都被调用，读计算样式会拖慢滚动）。
    if (this.headings.length) {
      const smt = Number.parseFloat(
        getComputedStyle(this.headings[0]).scrollMarginTop,
      );
      this.readLine = (Number.isFinite(smt) && smt > 0 ? smt : 96) + 2;
    }

    if (!this.headings.length) {
      const emptyEl = this.querySelector<HTMLElement>("#toc-empty");
      if (emptyEl) {
        emptyEl.textContent = this.dataset.emptyText || "此文章无目录";
        emptyEl.classList.remove("hidden");
      }
      return true;
    }
    this.querySelector("[data-toc-empty]")?.classList.add("hidden");

    this.tocEl.addEventListener("click", this.handleAnchorClick, {
      capture: true,
    });
    // 条目先追加到 DocumentFragment，最后一次性 insertBefore：避免逐条
    // 插入（每次 childList 变化都会使布局失效，长文换页后 TOC 初始化时
    // 反复触发整页重排——实测 visit:end 后 300ms 级卡顿来源）
    const fragment = document.createDocumentFragment();
    // 一级小节的序号：只数「一级小节」自己，不是标题的扁平下标。
    // ⚠️ 曾经写成 String(index + 1)（全部标题的下标），下面挂子小节时序号会跳号
    // —— 三个一级小节显示成 1 / 4 / 7 而不是 1 / 2 / 3。
    let sectionNo = 0;
    this.headings.forEach((heading, index) => {
      if (!heading.id) {
        heading.id = `heading-${index}`;
      }

      const depth = Number(heading.tagName.substring(1));
      const isTop = depth === minDepth;
      if (isTop) {
        sectionNo += 1;
      }
      const title = headingText(heading);
      const link = document.createElement("a");
      link.dataset.tocEntry = "true";
      link.href = `#${heading.id}`;
      link.className =
        "px-2 flex gap-2 relative transition-all duration-(--toc-transition-duration) w-full min-h-10 rounded-xl hover:bg-(--toc-btn-hover) hover:pl-3 active:bg-(--toc-btn-active) py-2";
      // 三栏布局：调整条目边距以适配更窄的 TOC 宽度
      if (this.closest(".layout-three-column")) {
        link.style.marginLeft = "0.75rem";
        link.style.marginRight = "0.75rem";
        link.style.width = "calc(100% - 1.5rem)";
      }
      // 标记挡位：一级 = 右对齐的等宽数字，子级 = 小圆点。
      // ⚠️ 别改回「实心方块徽章」（原 w-5 h-5 rounded-lg bg-(--toc-badge-bg)）：
      //    十几个方块会连成一条比标题还重的竖轴抢焦点，两位数（10/11/12）
      //    塞进 20px 方块里还会挤成一团。数字沿用 text-50（与标题同色，靠更小
      //    字号 + 无底色退到背景），既安静又不牺牲对比度。
      //    标记盒固定 w-5 h-5 且不垂直居中整行：换行标题时标记要与**首行**对齐。
      const indent =
        depth === minDepth + 1 ? " ml-3" : depth >= minDepth + 2 ? " ml-6" : "";
      const marker = isTop
        ? `<span class="toc-marker toc-num transition w-5 h-5 shrink-0 flex items-center justify-end text-xs font-medium leading-5 tabular-nums text-50${indent}">${sectionNo}</span>`
        : `<span class="toc-marker transition w-5 h-5 shrink-0 flex items-center justify-center${indent}"><span class="toc-dot transition rounded-full bg-black/20 dark:bg-white/25 ${
            depth === minDepth + 1 ? "h-1.5 w-1.5" : "h-1 w-1"
          }"></span></span>`;
      link.innerHTML = `
          ${marker}
          <div class="toc-title transition duration-(--toc-transition-duration) text-sm ${depth >= minDepth + 2 ? "text-30" : "text-50"}"></div>
        `;
      const titleEl = link.querySelector(".toc-title");
      if (titleEl) {
        titleEl.textContent = title;
      }
      fragment.appendChild(link);
      this.tocEntries.push(link);
    });
    this.insertBefore(fragment, this.activeIndicator);

    // 高亮更新由 scroll/resize 的 rAF 节流驱动（currentHeadingIndex 仅读
    // getBoundingClientRect，无样式写交错时读取不强制重排——layout thrash
    // 根源是「写 class → 读 rect」交替，已由 toggleActiveHeading 先读后写
    // 消除）。不引入 IntersectionObserver 快照：isIntersecting 是「与视口
    // 相交」而非「顶边越过 96px 线」，集合取 max 会指向视口底部标题而非
    // 阅读区顶部标题，与原 currentHeadingIndex 语义不等价（I23 曾引入，
    // 已回退）
    let scrollTicking = false;
    this.scrollHandler = () => {
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(() => {
        scrollTicking = false;
        // 换页期间（html.toc-not-ready）目录被 CSS 隐藏，跳过高亮计算：
        // 平滑回顶滚动时每帧读 rect + 写 class 纯属浪费（不可见），
        // 显示后（类移除）自动恢复
        if (document.documentElement.classList.contains("toc-not-ready")) {
          return;
        }
        this.updateActiveByScroll();
      });
    };
    this.resizeHandler = () => {
      if (document.documentElement.classList.contains("toc-not-ready")) {
        return;
      }
      this.updateActiveByScroll();
    };
    window.addEventListener("scroll", this.scrollHandler, { passive: true });
    window.addEventListener("resize", this.resizeHandler);
    this.updateActiveByScroll();
    return true;
  }

  update() {
    requestAnimationFrame(() => {
      this.toggleActiveHeading();
      this.scrollToActiveHeading();
    });
  }

  toggleActiveHeading() {
    let min = this.active.length;
    let max = -1;
    // 先只遍历 active 数组计算 min/max（不碰 DOM），再统一读一次布局、
    // 最后写入 class/style：避免「写 class → 读 rect → 写 style」的
    // 写-读交错强制重排（单帧内仅一次布局计算）
    for (let i = 0; i < this.active.length; i++) {
      if (this.active[i]) {
        min = Math.min(min, i);
        max = Math.max(max, i);
      }
    }

    if (min > max || !this.tocEl || !this.activeIndicator) {
      this.activeIndicator?.setAttribute("style", "opacity: 0");
      for (let i = 0; i < this.active.length; i++) {
        this.tocEntries[i]?.classList.remove(this.visibleClass);
      }
      return;
    }

    const parentOffset = this.getBoundingClientRect().top;
    const top = this.tocEntries[min].getBoundingClientRect().top - parentOffset;
    const bottom =
      this.tocEntries[max].getBoundingClientRect().bottom - parentOffset;
    this.activeIndicator.setAttribute(
      "style",
      `top: ${top}px; height: ${bottom - top}px`,
    );
    for (let i = 0; i < this.active.length; i++) {
      this.tocEntries[i]?.classList.toggle(this.visibleClass, this.active[i]);
    }
  }

  scrollToActiveHeading() {
    if (this.anchorNavTarget || !this.tocEl) return;
    const activeHeading = this.querySelectorAll<HTMLElement>(
      `.${this.visibleClass}`,
    );
    if (!activeHeading.length) return;

    const topmost = activeHeading[0];
    const bottommost = activeHeading[activeHeading.length - 1];
    const tocHeight = this.tocEl.clientHeight;
    const scrollTop = this.tocEl.scrollTop;
    // 统一坐标系：以滚动容器 tocEl 为基准（rect 差值），不再混用 offsetTop
    // （相对最近 positioned 祖先，即 table-of-contents）与 scrollTop（相对
    // tocEl）——两者隔着 h-8 spacer 等元素，混用依赖巧合的 32px 才成立
    const tocTop = this.tocEl.getBoundingClientRect().top;
    const topOffset = topmost.getBoundingClientRect().top - tocTop + scrollTop;
    const bottomOffset =
      bottommost.getBoundingClientRect().bottom - tocTop + scrollTop;
    // 高亮变化即跟随滚动（update 仅在 active 变化时调用，dirty 检查已在
    // updateActiveByScroll 承担）：恢复 v1.1.1 的平滑跟随行为。目录小容器的
    // smooth 滚动不触发 window 级 scrollHandler，无放大重排问题
    const top =
      bottomOffset - topOffset < 0.9 * tocHeight
        ? topOffset - 32
        : bottomOffset - tocHeight * 0.8;
    this.tocEl.scrollTo({
      top,
      left: 0,
      behavior: "smooth",
    });
  }

  handleAnchorClick = (event: Event) => {
    const anchor = event
      .composedPath()
      .find((element) => element instanceof HTMLAnchorElement);
    if (!(anchor instanceof HTMLAnchorElement)) return;

    const id = decodeURIComponent(anchor.hash?.substring(1));
    this.anchorNavTarget =
      this.headings.find((heading) => heading.id === id) || null;
    const activeIndex = this.headings.findIndex((heading) => heading.id === id);
    if (activeIndex >= 0) {
      this.active = this.tocEntries.map((_, index) => index === activeIndex);
      this.update();
    }

    // 🔴 本页锚点滚动由本方法接管（astro.config.mjs 已关 Swup 的 samePageWithHash）：
    //    插件走的是主线程逐帧 JS 插值（scrl），长文点目录同样有拉扯感；
    //    改为距离门控 —— 长距离瞬时、短距离平滑。锚点落点沿用统一口径：
    //    标题的 scroll-margin-top（markdown.css 6rem）以「导航栏底边」为基准，
    //    故用 navbar 高度 + 12px 余量补偿。
    const target = this.anchorNavTarget;
    if (target && anchor.hash && anchor.hash.length > 1) {
      event.preventDefault();
      const navEl = document.getElementById("navbar-wrapper");
      const navH = navEl ? navEl.getBoundingClientRect().height : 72;
      smartScrollTo(
        Math.max(
          0,
          window.scrollY + target.getBoundingClientRect().top - navH - 12,
        ),
      );
      try {
        history.replaceState(null, "", anchor.hash);
      } catch (e) {}
    }
  };

  currentHeadingIndex() {
    if (!this.headings.length) return -1;

    const offset = this.readLine;
    let activeIndex = 0;
    for (let index = 0; index < this.headings.length; index++) {
      if (this.headings[index].getBoundingClientRect().top <= offset) {
        activeIndex = index;
      } else {
        break;
      }
    }

    return activeIndex;
  }

  updateActiveByScroll = () => {
    const activeIndex = this.currentHeadingIndex();
    if (activeIndex < 0) return;

    const active = this.tocEntries.map((_, index) => index === activeIndex);
    // 点击目录后的跳转保护：目标到达阅读线即解除。
    // ⚠️ 必须与 currentHeadingIndex 用**同一条阅读线**（原先这里写死 100、
    // 判定用 96，保护会先于「目标被认定为当前项」解除 → 点击高亮被立刻覆盖，
    // 表现为「点了目录、滚到位了，高亮却停在上一条」）。
    // ⚠️ 还要兜住「目标永远到不了阅读线」的情形（典型：点最后一条，页面已到底、
    // 没有更多内容把它顶上来）：否则 anchorNavTarget 永久残留，
    // scrollToActiveHeading() 会一直早退，目录从此不再自动跟随阅读位置。
    if (this.anchorNavTarget) {
      const atBottom =
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 2;
      if (
        this.anchorNavTarget.getBoundingClientRect().top <= this.readLine ||
        atBottom
      ) {
        this.anchorNavTarget = null;
      }
    }
    // dirty 检查：高亮未变化时跳过 indicator 定位/滚动，消除每 tick 布局读取
    if (active.every((value, index) => value === this.active[index])) {
      return;
    }
    this.active = active;
    this.update();
  };
}

if (!customElements.get("table-of-contents")) {
  customElements.define("table-of-contents", TableOfContents);
}

// ── 非主题页判定（上游 #82）──
// 主题页都由 MainGridLayout 外壳渲染，必然带 astro.config.mjs 声明的全部 Swup 容器
// （清单由调用方从 swup.options.containers 取，改配置无需同步）；插件自带前台页
// （独立模板，或经契约外壳 templates/layout.html 渲染的页面）都没有 —— 缺任一项即交还浏览器。
// 选择器非常规或取不到清单时返回 false（不交还）：宁可漏判、退化为原行为，不误判主题页。
function shouldHandoffToBrowser(html: string, containers: unknown): boolean {
  if (!Array.isArray(containers) || containers.length === 0) return false;
  const ids = containers.map((selector) =>
    typeof selector === "string" && /^#[A-Za-z][\w-]*$/.test(selector)
      ? selector.slice(1)
      : "",
  );
  if (ids.some((id) => !id)) return false;
  return ids.some((id) => !html.includes(id));
}

// ── Swup hooks ──
function setupSwup() {
  if ((window as any).__etherealSwupHandlersBound) return;
  (window as any).__etherealSwupHandlersBound = true;

  // ── 非主题页不接管（上游 #82）──
  // 目标页没有主题容器时，SwupHeadPlugin 会摘掉整套主题 CSS（换页期间可见的导航栏/
  // 侧栏/页脚当场无样式），随后 replaceContent 容器不匹配报错并整页刷新。挂 page:load
  // （响应 HTML 到手时）：abort() 置 done 后 renderPage / animatePageIn 都在入口
  // `if (e.done) return` 直接返回，head 合并与内容替换绝不发生，等价于「这次点击不走
  // Swup」，代价只有一次已发出的 HTML 请求。
  // 下场动画不等 fetch，此时必然已开始/播完，而 abort 跳过了 visit:end 的收尾 ——
  // 故下方撤回换页态，避免页面定格在"主内容已淡出"。
  // 注：astro.config.mjs 里的 swup.ignore （login/logout/console…）是快速通道，保留；
  // 本守卫负责「不在 ignore 清单里的插件前台页」这类未知路径。
  window.swup.hooks.on(
    "page:load",
    (
      visit: {
        abort?: () => void;
        to?: { url?: string; hash?: string };
        history?: { popstate?: boolean };
      },
      args: { page?: { html?: string } },
    ) => {
      // @swup/astro 的类型声明不含运行时字段；本钩子只用到下面这几个
      const swup = window.swup as unknown as {
        options?: { containers?: unknown; skipPopStateHandling?: unknown };
        navigating?: boolean;
        onVisitEnd?: unknown;
      };
      const options = swup.options;
      const html = args?.page?.html;
      if (
        typeof html !== "string" ||
        !shouldHandoffToBrowser(html, options?.containers)
      ) {
        return;
      }
      const target = `${visit.to?.url ?? ""}${visit.to?.hash ?? ""}`;
      if (!target) return;
      visit.abort?.();
      // abort 跳过了 swup 成功流程末尾的复位，这里补齐：navigating 不复位会让本文档
      // 后续 popstate 访问挂到永不触发的 onVisitEnd 队列上静默失效（地址变了内容不变），
      // 复位前的同一 URL 点击也会被 preventDefault 吞掉
      swup.navigating = false;
      swup.onVisitEnd = undefined;
      // abort 跳过 visit:end / animation:in:end，补上它们的收尾清理
      document.documentElement.classList.remove(
        "is-changing",
        "is-animating",
        "is-leaving",
        "is-rendering",
        "home-switch",
        "toc-not-ready",
      );
      hidePageHeightExtend();
      // popstate（前进/后退）场景：浏览器已经走完这次遍历，直接真实加载目标即可
      if (visit.history?.popstate) {
        window.location.replace(target);
        return;
      }
      // 点击场景：swup 已为本轮 visit pushState 了一条属于本文档的目标占位条目，直接
      // 真实跳转会串错条目链 —— 回退只回退地址、不恢复文档（Chrome 实测）。必须先
      // history.back() 撤掉它再跳；这步的 popstate 要临时屏蔽 swup 接管，免得它白拉一次。
      const originalSkip = options?.skipPopStateHandling;
      const restoreSkip = () => {
        if (options) options.skipPopStateHandling = originalSkip;
      };
      if (options) options.skipPopStateHandling = () => true;
      // 兜底：极端情况下没有可回退的条目（不应发生）时也别把点击吞掉
      const fallback = window.setTimeout(() => {
        restoreSkip();
        window.location.assign(target);
      }, 200);
      window.addEventListener(
        "popstate",
        () => {
          window.clearTimeout(fallback);
          restoreSkip();
          window.location.assign(target);
        },
        { once: true },
      );
      window.history.back();
    },
  );

  // ── 换页后的焦点归位 ──
  // @swup/a11y-plugin 顺手做了播报区，但**默认把焦点丢到 <body>**（其内部
  // rootSelector = "body"）：焦点等于回到页面最起点，键盘用户每翻一页都得重新 Tab
  // 过整个导航栏才能摸到正文（「键盘税」），读屏用户也拿不到"页面已切换"的落点。
  // 这里覆盖 visit.a11y.focus 的选择器，让焦点落到当前页的主标题上（插件会负责
  // tabindex=-1、focus({preventScroll})、以及旧浏览器兼容）。
  // ⚠️ 必须用 on（handler 阶段）而不是 before：插件的 prepareVisit 注册在 before
  // 阶段，且会把 visit.a11y 整体替换；swup 的 hooks.call 顺序是 before → handler →
  // after，所以 on 阶段写入必然晚于插件、一定覆盖成功。用 before 反而会被反过来覆盖。
  // ⚠️ 选择器**不能**写成 "main h1, h1" 之类的宽列表：querySelector 取的是文档顺序首个
  // 匹配，而站点横幅标题 #banner-title 本身就是个 <h1>、且位于 main 之前（非首页时它
  // 是 display:none，聚焦不渲染的元素会被浏览器直接忽略，修复静默失效）。同理也不能
  // 把容器本身写进选择器列表 —— 容器在它的后代之前，会永远抢先命中。
  // 契约：Swup 容器内的页面需要提供主标题 <h1>（缺失时插件静默跳过、焦点不移动，不报错）。
  window.swup.hooks.on("visit:start", (visit: any) => {
    if (!visit?.a11y) return;
    visit.a11y.focus = {
      selector: "#swup-container h1",
      wait: true,
    };
  });

  // ── 首页 banner 标题模式下的焦点兜底 ──
  // 首页的 h1 有两种互斥形态（见 index.astro 与 MainGridLayout）：
  //   ① banner 标题关闭 → 容器内渲染 sr-only 站点名 h1 → "#swup-container h1" 可命中；
  //   ② banner 标题开启 → 页面唯一 h1 是 #banner-title，但它在 <main> 之外、#swup-container
  //      之前（absolute 定位的横幅），"#swup-container h1" 选不到 → 焦点退回 <body>，
  //      键盘税（每页重新 Tab 过导航栏）白付一遍。实测：1.4.52 从文章返回首页即命中此坑。
  // 选择器必须在 content:replace 才解析：此时新内容已进 DOM，visit:start 时还在文档碎片里。
  // ⚠️ 兜底目标只能是**非交互元素**：插件会给焦点目标无条件写 tabindex="-1"，且仅在原本
  //    非 null 时还原 → 指向 <a>/<button> 会把它永久移出 Tab 序。
  // ⚠️ 不能用 "A, B" 列表式选择器：querySelector 取文档顺序首个匹配，而 #banner-title 在
  //    #swup-container 之前 → 非首页（banner 为 display:none）会抢先命中隐藏元素、聚焦被忽略。
  // 落点质量：#banner-title 在文档顺序上晚于导航栏，故聚焦它之后按 Tab 直接前进到内容区。
  window.swup.hooks.on("content:replace", (visit: any) => {
    if (!visit?.a11y?.focus) return;
    const container = document.querySelector("#swup-container");
    if (!container?.querySelector("h1")) {
      const bannerTitle = document.getElementById("banner-title");
      visit.a11y.focus.selector =
        bannerTitle && bannerTitle.getClientRects().length > 0
          ? "#banner-title"
          : "#swup-container";
    }
  });

  // 注：曾在此把 --content-delay 改为 0ms（让换页后内容立即浮现），但该变量被全部
  // 入场动画的 animation-delay: calc(var(--content-delay) + Xms) 消费，点击时修改
  // 会重算已完成动画的 delay（方向依赖的重启风险，且单向永不恢复）——已移除，
  // 保持 150ms 默认错落延迟。
  window.swup.hooks.on("content:replace", initCustomScrollbar);
  window.swup.hooks.on("content:replace", destroyAll, { before: true });
  // 首页↔其他页换页（is-home 变化时）挂 home-switch：仅全屏模式启用——
  // 让新内容淡入与横幅/网格 700ms 位移同速，换入即最终布局，消除"内容先显示、
  // 再位移"的闪烁（全屏下位移大 100vh↔35vh，且波浪下移出视口、缝隙不可见）。
  // 横幅模式回归 1.1.0 行为：不在 content:replace 提前切 is-home，换入后内容
  // 与波浪/横幅同速滑动（page:view 同步），避免"波浪滑过内容顶边露 1px 背景缝"
  // （Edge 75% 缩放可复现）。URL 在 animation:out:start 前已由 Swup pushState
  // 更新，可预判新页。
  // 当前是否全屏模式：运行时读取 <html data-banner-display>（访客可在面板切换
  // 壁纸模式，默认非全屏时手动切到全屏也应生效），不能按初始化时的值缓存
  function isFullscreenMode(): boolean {
    return document.documentElement.dataset.bannerDisplay === "fullscreen";
  }
  // is-home 是否会因本次换页而变化（URL 在 animation:out:start 前已由 Swup
  // pushState 更新，用「路径 vs 当前 body 类」比对可预判；全屏模式已在
  // content:replace 提前切换，此后调用恒为 false）。随上游 v2.0.0 b7e94d7 移植。
  function isHomeSwitching(): boolean {
    return isHomePath() !== document.body.classList.contains("is-home");
  }
  // ── 换页撑高（#page-height-extend）──
  // 300vh 撑高恒渲染且在 Swup 容器外（跨页不替换）：显示/隐藏统一走这两个入口。
  // 随上游 v2.0.0 b7e94d7 移植（此前主线沿用旧「跳过显示」逻辑，缺了这条修复）：
  // 深层换页（如首页底部点文章）换入的文档比旧滚动位置短时，滚动位置会被浏览器
  // 钳制到新文档底（移动端实测偶尔定格在「文章页最底」），撑高让旧位置在新文档里
  // 依然有效，回顶后再收起。
  function showPageHeightExtend(): void {
    spMark("phe", "show");
    document.getElementById("page-height-extend")?.classList.remove("hidden");
  }
  function hidePageHeightExtend(): void {
    spMark("phe", "hide");
    document.getElementById("page-height-extend")?.classList.add("hidden");
  }
  window.swup.hooks.on(
    "animation:out:start",
    (visit: { to?: { hash?: string }; history?: { popstate?: boolean } }) => {
      const bannerMoves = document.body.classList.contains("enable-banner");
      const switching = isHomeSwitching();
      if (!bannerMoves || !isFullscreenMode()) {
        document.documentElement.classList.remove("home-switch");
      } else {
        document.documentElement.classList.toggle("home-switch", switching);
      }
      // 点击换页（非 popstate / 非 hash）且 is-home 会变、从非顶部出发时显示
      // 300vh 撑高：位移期间文档高度持续变化，深层换页的滚动位置可能超出新
      // 文档可滚动上限被浏览器钳制（内容先下坠再上升的抖动来源之一）。收起见
      // hidePageHeightExtendWhenAtTop（等回顶再收，避免骤降反被钳制）；
      // 从顶部换页无需撑高，popstate / hash 场景沿用 visit:start 的设置
      if (!visit?.history?.popstate && !visit?.to?.hash && bannerMoves) {
        if (switching && window.scrollY > 0) showPageHeightExtend();
        else hidePageHeightExtend();
      }
    },
  );
  // 旧内容已淡出、新内容未换入的空档切换 is-home（仅全屏模式：横幅/网格/波浪
  // 的 700ms 位移发生在不可见阶段，跳过动画的换页维持原 page:view 同步）。
  // 横幅模式不提前切换——新内容以旧 is-home 定位换入，page:view 后再整体滑动，
  // 内容与波浪/横幅同速联动，不产生波浪越过内容顶边时的 1px 缝隙
  window.swup.hooks.on(
    "content:replace",
    () => {
      if (
        document.documentElement.classList.contains("is-changing") &&
        isFullscreenMode()
      ) {
        syncHomeClass();
      }
    },
    { before: true },
  );
  // 换入动画结束（含被 home-switch 拉长的 700ms 淡入）后移除，两侧组件淡回
  window.swup.hooks.on("animation:in:end", () => {
    document.documentElement.classList.remove("home-switch");
  });
  window.swup.hooks.on("content:replace", () => {
    const rightToc = document.querySelector(
      "#sidebar-toc table-of-contents, #right-sidebar-toc table-of-contents",
    ) as (HTMLElement & { refresh?: () => void }) | null;
    rightToc?.refresh?.();
    // 换页兜底：弹窗是 swup 容器已整容器替换（自动关闭），但目录按钮在 Swup
    // 容器外不刷新，需复位「目录」图标与 aria 状态，避免残留 X 态。
    // （下方 updateTocBtnVisibility 的 close 只在按钮隐藏时收弹窗，两者分工不同）
    window.__etherealTocPopup?.close?.();
    updateTocBtnVisibility();
  });
  window.swup.hooks.on("page:view", () => {
    // L2 内容增强 + L3 短代码转译：Swup 换页后新 .custom-md 需重新执行
    // （initContentEnhance 幂等，已打 data-content-enhanced 标记的会跳过）。
    // 首刷走 DOMContentLoaded，换页走这里——缺了它 callout 短代码（7 种）
    // 在换页后不转译、显示成原始 GitHub Alert 样式。
    initContentEnhance();
    // is-home 将切换且已推迟：不在此翻转（等 content:scroll 与锁步同帧翻转，
    // 消除「位移先动 37ms」的反向段前窗）；不切换（文章→文章等）照常同步
    // （幂等）。安全兜底：content:scroll 异常不触发时 1200ms 后仍翻转。
    if (deferHomeClassForFollow && isHomeSwitching()) {
      setTimeout(() => {
        if (deferHomeClassForFollow && isHomeSwitching()) {
          deferHomeClassForFollow = false;
          syncHomeClass();
        }
      }, 1200);
    } else {
      deferHomeClassForFollow = false;
      syncHomeClass();
    }
    syncBannerOverlay();
    armLazyLightbox();
    void initPhotosGallery();
    showBanner();
    scrollFunction();
    initLegacyAdmonitions();
    initExternalLinkRedirect();
    initCommentLazyLoad();
  });
  // 跨页回顶滚动统一走 scroll-manager：有 is-home 位移的（横幅/全屏）走锁步插值
  // （v1.7.18 起任意距离都动画；见 content:scroll 钩子），无位移的模式走
  // smartScrollTo 距离门控（长距离瞬时、短距离平滑）。
  // 同页锚点（目录点击）由 TableOfContents.handleAnchorClick 接管 + 距离门控
  // （astro.config.mjs 已关 Swup 的 samePageWithHash）。
  // TOC 恢复显示绑定「滚动真正结束」：长文从底部回顶的原生平滑可持续数百
  // ms，晚于 visit:end + 200ms——若按 visit:end 移除 toc-not-ready，后半段
  // 滚动中目录就已显示。滚动结束信号双通道：原生平滑派发 scrollend 事件、
  // scrl 引擎派发 swup scroll:end（两者都监听，幂等 release）。
  // needsScrollWait 仅对「从非顶部换页回顶」的场景置真；从顶部换页（零距离
  // 短路无滚动结束信号）与 popstate 由 visit:end 直接移除
  let needsScrollWait = false;
  // is-home 翻转推迟到锁步启动（v1.7.19）：横幅模式「从非顶部换页且 is-home
  // 将切换」时 page:view 不立即 syncHomeClass——位移 transition 先启动而锁步
  // 回顶晚 ~37ms 启动，会形成「位移先走、滚动后追」的反向段（上下抖动）；
  // 推迟后由 content:scroll 在锁步启动同帧翻转，滚动跟随 translate 实时进度
  // （lockstepScrollToTop 的 follow 模式），合成运动严格单调。
  let deferHomeClassForFollow = false;
  const releaseTocNotReady = () => {
    document.documentElement.classList.remove("toc-not-ready");
  };
  // 撑高（#page-height-extend）的收起：必须等滚动回顶后再隐藏——横幅模式
  // visit:end（约 200ms）远早于锁步回顶结束（--dur-banner），提前收起会让
  // 文档高度骤降、滚动位置被浏览器钳制（移动端「落在文章页最底」的来源）。
  // 回顶信号：锁步结束 / 原生平滑结束都会派发 scrollend（幂等；不支持的
  // 浏览器走 visit:end 的 2s 兜底）。随上游 v2.0.0 b7e94d7 移植。
  const hidePageHeightExtendWhenAtTop = () => {
    if (window.scrollY > 0) return;
    hidePageHeightExtend();
  };
  window.swup.hooks.on("scroll:end", () => {
    if (needsScrollWait) releaseTocNotReady();
  });
  window.addEventListener("scrollend", () => {
    spMark("scrollend", `y=${Math.round(window.scrollY)}`);
    if (needsScrollWait) releaseTocNotReady();
    hidePageHeightExtendWhenAtTop();
  });

  window.swup.hooks.on(
    "visit:start",
    (visit: {
      scroll?: { animate?: boolean };
      to?: { hash?: string };
      history?: { popstate?: boolean };
    }) => {
      restoreOriginalHistoryStateHandlers();
      spMark("visit:start", visit?.to?.hash ? "hash" : "plain");
      // 换页开始：递增复位纪元（OverlayScrollbars 挂载后的位置恢复据此放弃过期恢复）
      navResetStamp += 1;
      // 上一轮换页的落点兜底同样即刻失效（新换页有自己的复位与兜底）
      landingGuardToken += 1;
      // 标记会话内已发生换页（<html> 不被 Swup 替换，标记永久有效）：
      // #right-sidebar 是 swup 容器，换页会换入带静态 onload-animation 类的新
      // aside，transition.css 据此标记永久抑制其入场动画（首刷动画不受影响）。
      document.documentElement.classList.add("swup-visited");
      // 换页进行中：目录隐藏（CSS 门控 html.toc-not-ready，覆盖两栏/三栏）。
      // 挂在 <html> 上而非容器类：Swup 换页会替换 #toc-container /
      // #right-sidebar 容器，旧节点上的类随销毁，新节点无类会导致目录提前显示
      document.documentElement.classList.add("toc-not-ready");
      needsScrollWait =
        !visit?.history?.popstate && !visit?.to?.hash && window.scrollY > 0;
      // 是否推迟 is-home 翻转（见 deferHomeClassForFollow 声明注释）：
      // 横幅模式（全屏在 content:replace 已提前切，无推迟语义）+ 非 reduce
      // （reduce 锁步瞬时，无跟随循环，保持 page:view 原行为）
      deferHomeClassForFollow =
        needsScrollWait &&
        document.body.classList.contains("enable-banner") &&
        !isFullscreenMode() &&
        !(
          window.matchMedia &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        );
      // SwupScrollPlugin 在 before("visit:start")（priority -1）设置
      // visit.scroll.animate，此处（默认 priority 0）在接管回顶滚动时覆盖为
      // false，早于其 content:scroll 的 doScrollingBetweenPages 消费点。
      // popstate / 带 hash 场景仍交由插件默认处理，不覆盖
      if (!visit?.history?.popstate && !visit?.to?.hash && visit?.scroll) {
        visit.scroll.animate = false;
        // 默认隐藏撑高；确需显示的条件（is-home 会变 + 从非顶部出发）在
        // animation:out:start 判定，那里才知道是否会切换（随上游 b7e94d7）
        hidePageHeightExtend();
      } else {
        showPageHeightExtend();
      }
    },
  );
  // 跨页回顶滚动接管 content:scroll，统一改用浏览器原生平滑滚动（behavior:
  // "smooth"，合成器驱动不占主线程，无 scrl 引擎的每帧 JS 测量卡顿）：
  // content:replace 换入新内容后布局仍 dirty，立即滚动会派发 scroll 事件
  // → OverlayScrollbars 同步测量 → 强制整页重排（实测单帧 900ms）。延迟
  // 双 rAF 让浏览器先完成新内容首次布局，滚动时测量命中缓存不触发重排。
  // popstate / 带 hash 场景走插件默认逻辑（默认锚点滚动）。后注册的
  // replace 生效（Swup 按注册顺序取最后者）
  window.swup.hooks.replace(
    "content:scroll",
    (
      visit: {
        scroll?: { animate?: boolean };
        to?: { hash?: string };
        history?: { popstate?: boolean };
      },
      _args: unknown,
      defaultHandler?: (visit: unknown, args: unknown) => void,
    ) => {
      // 评论区锚点（#comment / #comment-next-*）：滚动由 comment-locate.ts 在
      // 评论区懒加载渲染后接管（原生 smooth）。SwupScrollPlugin 的锚点滚动走
      // scrl 引擎，在单条评论元素尚未渲染时找不到锚点、且每帧强制 scrollTop
      // 会覆盖原生 scrollIntoView → 跳转失败/互相打架。这里直接跳过，让它
      // 完全退出评论区场景的滚动（同页目录锚点走 linkToAnchor 路径，不受影响）。
      const hash = visit?.to?.hash || "";
      // ⚠️ Swup 的 to.hash 带 "#" 前缀（如 "#comment-next-comment-<name>"）：直接
      //    indexOf("comment") 命中位置是 1（# 占 0 位）→ 判断恒为 false、return 永不
      //    生效 → SwupScrollPlugin 找不到 shadow DOM 里的评论锚点后 fall through 回顶
      //    （scrl 引擎每帧 scrollTo(0)），覆盖插件自己的 scrollIntoView。先去掉 # 再判。
      if (hash.replace(/^#/, "").indexOf("comment") === 0) {
        return;
      }
      if (!visit?.history?.popstate && !visit?.to?.hash) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            // 回顶复位执行：递增复位纪元——此刻任何「挂载后恢复滚动位置」的 rAF
            // 都必须放弃（其捕获的旧位置属于上一页面，写回会把用户拽到深处）
            navResetStamp += 1;
            // 复位前位置：供落点兜底判「复位是否瞬时完成」（见 armLandingGuard）。
            // 读在复位调用之前——lockstepScrollToTop / smartScrollTo 内部也
            // 同步读 window.scrollY 做各自判据，两者口径一致
            const preResetY = window.scrollY;
            spMark("reset", "pre=" + Math.round(preResetY));
            // 有 is-home 位移的模式（横幅 / 全屏）：改「锁步回顶」——原生平滑滚动的
            // 时长/曲线不可控，与内容位移异步叠加会形成「先下后上」往复；锁步用 rAF
            // 逐帧插值、与位移同曲线（0.4,0,0.2,1）同时长（--dur-banner），合成位移
            // 恢复单调（随上游 v2.0.0 commit b7e94d7 移植；v1.7.18 起任意距离都
            // 走锁步动画，取消 >1.5 屏瞬时截断——窄屏页底点卡片不再一帧裸跳）。
            // 纯色 / 全屏透明无 enable-banner、无位移 ⇒ 保持原生平滑（合成器驱动）
            if (document.body.classList.contains("enable-banner")) {
              if (deferHomeClassForFollow && isHomeSwitching()) {
                // is-home 切换：锁步启动同帧翻转（消除位移先动的前窗），滚动
                // 跟随 #main-grid 的 translate 实时进度（同相 ⇒ 合成单调）
                deferHomeClassForFollow = false;
                syncHomeClass();
                lockstepScrollToTop(document.getElementById("main-grid"));
              } else {
                // 文章→文章等无位移场景：ease 自走即单调
                deferHomeClassForFollow = false;
                lockstepScrollToTop();
              }
            } else {
              // 非锁步分支同样走距离门控：原先直接 smooth 会让「从文章深处进入下一页」
              // 变成长距离拉扯（原生 smooth 时长随距离缩放）
              smartScrollTo(0);
            }
            // 落点兜底（1.7.15；1.7.16 即时化）：复位之后位置仍可能被外部
            // 写者再次拽走——真机：点列表最后几张卡片换页 → 拉扯几轮后
            // 才归位。挂落点复核（见 armLandingGuard），瞬时路径附
            // scroll 事件即时纠正。仅「从非顶部出发」（needsScrollWait）的
            // 换页需要：从顶部出发本就在顶部
            if (needsScrollWait) armLandingGuard(preResetY);
          }),
        );
        return;
      }
      defaultHandler?.(visit, _args);
    },
  );
  window.swup.hooks.on("visit:end", () => {
    setTimeout(() => {
      // needsScrollWait（从非顶部点击换页）时回顶可能远晚于 visit:end（横幅
      // 模式尤其），交给 hidePageHeightExtendWhenAtTop 等回顶收起（原因见其
      // 注释）；其余场景（从顶部换页 / popstate / hash）立即收起
      if (needsScrollWait) {
        hidePageHeightExtendWhenAtTop();
      } else {
        hidePageHeightExtend();
        releaseTocNotReady();
      }
    }, SWUP_VISIT_END_DELAY);
    // 兜底：滚动结束信号异常缺失（极端场景）时 2s 后强制恢复目录并收起撑高，
    // 避免目录永久隐藏 / 页面残留 300vh 空白（幂等，正常路径已先行处理）
    if (needsScrollWait) {
      setTimeout(() => {
        releaseTocNotReady();
        hidePageHeightExtend();
      }, 2000);
    }
  });
}

// 目录悬浮按钮显隐（I29）：只要页面没有可见目录（两栏悬浮目录 #toc-wrapper /
// 三栏右侧栏目录 #sidebar-toc / #right-sidebar-toc table-of-contents），就显示目录悬浮按钮——
// 面向移动端/平板端无目录场景；空目录文章仍显示按钮，点开弹窗展示"此文章无目录"
// 占位（与目录小组件一致）。.floating-controls 位于 Swup 容器外、换页不刷新，
// 故换页（content:replace）与窗口 resize 都要重算：offsetParent 对 display:none
// 祖先返回 null，可准确反映两栏/三栏 TOC 在各断点下的实际可见性。
function updateTocBtnVisibility() {
  const btn = document.getElementById("back-to-toc-btn");
  if (!btn) return;
  const hasTocWidget = !!document.querySelector("#toc-popup table-of-contents");
  const floatingToc = document.getElementById("toc-wrapper");
  const rightToc = document.querySelector(
    "#sidebar-toc table-of-contents, #right-sidebar-toc table-of-contents",
  ) as HTMLElement | null;
  const hasVisibleToc = !!(
    (floatingToc && floatingToc.offsetParent) ||
    (rightToc && rightToc.offsetParent)
  );
  const show = hasTocWidget && !hasVisibleToc;
  btn.classList.toggle("hide", !show);
  if (!show) {
    // 按钮隐藏（换页到无目录页 / 拉宽到有目录的断点）时同步收起弹窗
    window.__etherealTocPopup?.close?.();
  }
  // 目录按钮参与自定义按钮的位置计数，显隐变化后重新计算
  window.__etherealFloatingControlsReposition?.();
}

// ── 评论区懒加载（P3，1.3.3）──
// <halo:comment> 由 Halo 服务端注入，comment-next.iife.js（~120KB，45% 未用）随
// HTML 解析立即执行，而评论区在文章页首屏之下。页面模板把产物包进
// <template id="comment-lazy-template">（内容惰性：脚本不下载、web component 不
// 升级），这里在评论区接近视口（提前 400px）时把内容搬到占位节点激活。
// Swup 换页后新 DOM 的占位为空，page:view 重新绑定即可覆盖 SPA 场景。
// 评论区「内容已渲染」的判定常量（供 comment-locate.ts 对齐落位高亮时机）：
//   MIN_READY_HEIGHT —— 低于此高度说明还只是「评论」标题壳子（约 80px）
//   STABLE_FRAMES    —— ResizeObserver 连续几次回调高度不变才算稳定
//   READY_TIMEOUT    —— 硬超时，接口失败时也要把落位动画放出来
const COMMENT_MIN_READY_HEIGHT = 160;
const COMMENT_STABLE_FRAMES = 2;
const COMMENT_READY_TIMEOUT = 4000;
/**
 * 标记评论区内容已渲染：高度超过空壳阈值且连续 N 帧不变后，打上
 * data-comment-ready 并派发 comment:ready，供 comment-locate.ts 把落位高亮
 * 延后到内容出现之后再播（否则 0.9s 脉冲在空壳上播完，用户看不到任何提示）。
 */
function trackCommentReady(box: HTMLElement) {
  if (box.dataset.commentReady) return;
  let settled = false;
  let ro: ResizeObserver | null = null;
  const finish = () => {
    if (settled) return;
    settled = true;
    if (ro) ro.disconnect();
    box.dataset.commentReady = "1";
    document.dispatchEvent(new CustomEvent("comment:ready"));
  };
  let lastH = -1;
  let stable = 0;
  if ("ResizeObserver" in window) {
    ro = new ResizeObserver(() => {
      const h = box.offsetHeight;
      if (h === lastH) stable += 1;
      else {
        stable = 0;
        lastH = h;
      }
      // 高度够高（不是空壳）且连续两帧不变 → 认为首屏评论已渲染
      if (stable >= COMMENT_STABLE_FRAMES && h >= COMMENT_MIN_READY_HEIGHT)
        finish();
    });
    ro.observe(box);
  } else {
    setTimeout(finish, 1200);
  }
  // 硬超时兜底：评论接口失败/长耗时时也要让落位动画播出来，不能一直悬着
  setTimeout(finish, COMMENT_READY_TIMEOUT);
}

// 评论懒加载 IO 跨页共享引用：未滚到评论区就离开时，旧页 IO 仍观察着已被
// Swup 替换掉的旧 #comment 节点，每篇滞留一个 IO + 旧 DOM 引用。故提升到
// 模块级，每次 initCommentLazyLoad 开头先断开上一次的 IO 再创建新的。
let commentLazyIo: IntersectionObserver | null = null;

function initCommentLazyLoad() {
  // 换页清理：断开上一次（上一页）的 IO，避免滞留旧 DOM。须放在早退判断之前，
  // 保证新页无 #comment（如首页/归档）时也能清掉上一篇遗留的 IO。
  if (commentLazyIo) {
    commentLazyIo.disconnect();
    commentLazyIo = null;
  }
  const box = document.getElementById("comment");
  const tpl = document.getElementById(
    "comment-lazy-template",
  ) as HTMLTemplateElement | null;
  const slot = document.getElementById("comment-lazy-placeholder");
  if (!box || !tpl || !slot) return;
  if (slot.childNodes.length > 0) return; // 本次导航已激活（幂等）
  const adopt = () => {
    if (slot.childNodes.length > 0) return;
    while (tpl.content.firstChild) {
      slot.appendChild(tpl.content.firstChild);
    }
    trackCommentReady(box);
  };
  // 带 #comment 锚点进入（侧栏「最近评论」跳转 / 通知邮件链接）时立即激活：
  // 用户意图明确就是看评论，不必等 IO 判定接近视口（省掉 400px 预滚动 + 一次
  // IO 回调的延迟），让 ~120KB 的 comment-next 尽早开始下载。
  const wantsComment = (location.hash || "").indexOf("#comment") === 0;
  if (wantsComment || !("IntersectionObserver" in window)) {
    adopt();
    return;
  }
  commentLazyIo = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        commentLazyIo?.disconnect();
        commentLazyIo = null;
        adopt();
      }
    },
    { rootMargin: "400px" },
  );
  commentLazyIo.observe(box);
}

// 同页锚点激活：侧栏「最近评论」指向当前文章时（RecentComments 的同页分支），
// hash 变为 #comment* 不触发 page:view，这里补挂 hashchange，让评论懒加载立即
// 激活（等同带锚点进入页面的 wantsComment 路径），滚动与高亮由 comment-locate.ts
// 接管。initCommentLazyLoad 幂等（已激活/无 #comment 时直接返回）。模块级注册
// 一次即可（本模块在 Swup 容器外，整页生命周期只执行一次）。
window.addEventListener("hashchange", () => {
  if ((location.hash || "").indexOf("#comment") === 0) initCommentLazyLoad();
});

// ── 初始化 ──
function init() {
  syncHomeClass();
  // 首次同步完成：恢复 wave 平滑过渡（加载早期被 html:not(.page-ready) 抑制，
  // 避免 syncHomeClass 首次设置 transform 时产生 700ms 条带位移）。必须双 rAF
  // 延迟：同帧加 page-ready 会让渲染时过渡仍生效（transform 与 class 同帧提交）。
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.add("page-ready");
    });
  });
  setTheme(getStoredTheme());
  setHue(getHue());
  initCustomScrollbar();
  alignBannerTheme();
  showBanner();
  // init() 跑在模块执行期（deferred），早于 post.astro 内联 processAndInsert 注册的
  // DOMContentLoaded；直接同步调用时 .custom-md 还没从模板克隆到占位符，blockquote
  // 全找不到。挂到 DOMContentLoaded 让 processAndInsert 先插入正文，转换器再扫。
  // Swup 换页路径的 page:view 钩子不受影响（新内容已在 DOM 后才触发）。
  document.addEventListener("DOMContentLoaded", initLegacyAdmonitions);
  document.addEventListener("DOMContentLoaded", initContentEnhance);
  updateTocBtnVisibility();
  initCommentLazyLoad();
}

setClickOutsideToClose("display-setting", [
  "display-setting",
  "display-settings-switch",
]);
// 注：nav-menu-panel 已改为右侧抽屉（body.nav-menu-open 驱动），关闭逻辑由
// navbar.js 统一处理（遮罩点击/关闭按钮/链接点击/ESC），不再作为 float-panel 处理
setClickOutsideToClose("search-panel", [
  "search-panel",
  "search-bar",
  "search-switch",
]);

// 向下箭头滚动目标：暴露给 MainGridLayout 内联事件委托脚本调用（按钮与委托
// 位于 Swup 容器外，模块本体仅执行一次，无需额外防重绑定守卫）
if (!(window as any).__etherealScrollDown) {
  (window as any).__etherealScrollDown = scrollDownToContent;
}

// 诊断探针：尽早决策激活（?sp=1 / 管理员登录自动探测）并包装滚动写入 API，
// 保证「换页窗口内的写入」全部在案（普通访客未激活时零开销）
initScrollProbe();
init();
armLazyLightbox();
void initPhotosGallery();

// 相册页「就地筛选」（templates/assets/list-filter.js）会替换 #photos-gallery 所在的列表区，
// 而灯箱绑的是被换掉的旧元素 ⇒ 该脚本替换后需要重建灯箱。它是独立的经典脚本产物，
// 拿不到本模块作用域，故把重建函数挂到 window 供其调用（元素不存在时函数内即空转）。
(window as any).__etherealRefreshPhotosGallery = refreshPhotosGallery;

if (window?.swup?.hooks) {
  setupSwup();
} else {
  document.addEventListener("swup:enable", setupSwup);
}

scrollFunction();
initExternalLinkRedirect();
initProfileStatus();
// 窗口尺寸变化（横竖屏切换/拉宽拉窄）后重算目录按钮显隐与弹窗锚定
window.addEventListener("resize", updateTocBtnVisibility);

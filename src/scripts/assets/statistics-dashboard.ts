// @ts-nocheck —— 数据看板（statistics.html）客户端逻辑：取数 + 手写 SVG 绘图。
// 配置从 #statistics-dashboard 的 data-* 读取（模板由 theme.config 注入），
// 本脚本不读 #theme-config JSON、不含任何硬编码凭证 / 站点 ID。
//
// 数据路径：
//  1) Umami 公开分享流：设置里的分享链接 / shareId → GET {base}/api/share/{id}
//     换 { token, websiteId } → 带 x-umami-share-token 头调
//     /api/websites/{id}/stats | pageviews | metrics。分享未配置时模板已渲染
//     未配置占位，本脚本直接跳过 Umami 部分；换 token 失败则给各面板补一条
//     安静的失败提示，不抛错、不白屏。
//  2) 推送节奏：GitHub 公开 API /repos/{owner/repo}/commits（无令牌，
//     sessionStorage 缓存 10 分钟压速率限制）。
//  3) 最近评论：与侧边栏同源的聚合端点
//     /apis/api.recent-comments.halo.run/v1alpha1/comments/latest?size=8，
//     失败时退回「拉最近文章 → 逐篇查评论」的旧瀑布（同侧边栏口径）。
//
// 图表全部手写 SVG（折线/面积/环形），色值由 statistics.css 的 hue 派生
// token 给出，脚本只写几何。Swup 换页后脚本重执行：以根元素 data-rendered
// 守卫防同页重复初始化（新 DOM 无此标记，自然重跑）。
(function () {
  var root = document.getElementById("statistics-dashboard");
  if (!root || root.getAttribute("data-stats-init")) return;
  root.setAttribute("data-stats-init", "1");

  var DAY_MS = 24 * 60 * 60 * 1000;
  var TZ =
    (window.Intl && Intl.DateTimeFormat().resolvedOptions().timeZone) ||
    "Asia/Shanghai";
  var WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

  /* ---------------- 基础工具 ---------------- */

  function fetchJSON(url, opts, timeout) {
    var ms = timeout || 10000;
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, ms);
    var merged = {};
    opts = opts || {};
    for (var k in opts) {
      if (Object.prototype.hasOwnProperty.call(opts, k)) merged[k] = opts[k];
    }
    merged.signal = controller.signal;
    return fetch(url, merged).then(
      function (res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      },
      function (err) {
        clearTimeout(timer);
        throw err;
      },
    );
  }

  // 统计页数字一律全数显示（千分位），不走 Layout 的 __etherealBigNum
  // 全局助手——那个助手会把大数压成 k 格式，是给侧边栏小部件的紧凑口径，
  // 统计页照搬会丢精度（用户 2026-11-16 拍板：统计页全数、侧边栏不动）
  function fmtNum(n) {
    n = Number(n) || 0;
    return n.toLocaleString("zh-CN");
  }

  function fmtRelative(dateStr) {
    if (!dateStr) return "";
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    var diff = Date.now() - d.getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return "刚刚";
    if (mins < 60) return mins + " 分钟前";
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + " 小时前";
    var days = Math.floor(hours / 24);
    if (days < 30) return days + " 天前";
    if (days < 365) return Math.floor(days / 30) + " 个月前";
    return Math.floor(days / 365) + " 年前";
  }

  function dayKey(ts) {
    var d = new Date(ts);
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function panelEl(name) {
    return root.querySelector('[data-panel="' + name + '"]');
  }

  // Umami 换 token / 取数失败时，给指定面板补一条安静提示（只补一次）
  function noteFailure(panelName, text) {
    var p = panelEl(panelName);
    if (!p || p.querySelector(".stats-unconfigured")) return;
    var d = document.createElement("div");
    d.className = "stats-unconfigured";
    d.textContent = text;
    p.appendChild(d);
  }

  /* ---------------- Umami 分享流 ---------------- */

  var umamiBase = (root.getAttribute("data-umami-base") || "").replace(
    /\/+$/,
    "",
  );
  var shareRaw = root.getAttribute("data-umami-share") || "";
  var githubRepo = (root.getAttribute("data-github-repo") || "").trim();

  function parseShareId(raw) {
    if (!raw) return "";
    var s = String(raw).trim();
    var m = s.match(/share\/([^/?#]+)/);
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch (e) {
        return m[1];
      }
    }
    return s.split(/[/?#]/)[0];
  }

  var shareId = parseShareId(shareRaw);
  var umami = null; // { token, websiteId }

  function umamiInit() {
    if (!shareId || !umamiBase) return Promise.resolve(false);
    var url = umamiBase + "/api/share/" + encodeURIComponent(shareId);
    var urlAlt = umamiBase + "/api/share/id/" + encodeURIComponent(shareId);
    return fetchJSON(url, {}, 10000)
      .catch(function () {
        return fetchJSON(urlAlt, {}, 10000);
      })
      .then(function (data) {
        var d = (data && data.data) || data || {};
        if (!d.token || !d.websiteId) return false;
        umami = { token: d.token, websiteId: d.websiteId };
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  function umamiGet(path) {
    // Umami 未就绪（未配置 / 分享链接失效）时降级为 rejected Promise，
    // 让各调用方的 .catch 走安静的失败提示；直接解引用 umami 会同步
    // 抛 TypeError，发生在返回 Promise 之前、.catch 接不住，还会中断绑定。
    if (!umami) return Promise.reject(new Error("Umami 尚未就绪"));
    return fetchJSON(
      umamiBase +
        "/api/websites/" +
        encodeURIComponent(umami.websiteId) +
        "/" +
        path,
      {
        headers: {
          "x-umami-share-token": umami.token,
          // Umami v3 数据接口除 token 外还要求带分享上下文（shareId 明文），
          // 缺了它 stats / pageviews / metrics 全部 401；v2 只需 token。
          "x-umami-share-context": shareId,
        },
      },
      12000,
    );
  }

  function statVal(stats, key) {
    var v = stats && stats[key];
    if (v == null) return 0;
    return typeof v === "object" ? Number(v.value) || 0 : Number(v) || 0;
  }

  function rangeQuery(days) {
    var endAt = Date.now();
    var startAt = endAt - days * DAY_MS;
    return "startAt=" + startAt + "&endAt=" + endAt;
  }

  /* ---------------- Hero 状态 ---------------- */

  function setHeroStatus(state, text, stamp) {
    var box = root.querySelector("[data-hero-status]");
    if (box) {
      box.setAttribute("data-state", state);
      var t = box.querySelector("[data-hero-status-text]");
      if (t && text) t.textContent = text;
    }
    if (stamp) {
      var s = root.querySelector("[data-last-update]");
      if (s) s.textContent = stamp;
    }
  }

  /* ---------------- 1. 顶部统计卡 ---------------- */

  // 今日 stats 只取一次：summary 卡与活跃时间面板的「今日访客」共用
  var todayStatsPromise = null;
  function getTodayStats() {
    if (!todayStatsPromise) {
      var now = Date.now();
      var dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      todayStatsPromise = umamiGet(
        "stats?startAt=" + dayStart.getTime() + "&endAt=" + now,
      )
        .then(function (stats) {
          return {
            visitors: statVal(stats, "visitors"),
            pageviews: statVal(stats, "pageviews"),
          };
        })
        .catch(function (err) {
          // 失败不缓存：置空让下一次调用方（summary / activity）能重试，
          // 否则一次瞬时失败会把 rejected promise 喂给本页所有后续调用方
          todayStatsPromise = null;
          throw err;
        });
    }
    return todayStatsPromise;
  }

  function loadSummary() {
    if (!panelEl("summary")) return;
    var now = Date.now();
    var all = "startAt=0&endAt=" + now;
    Promise.all([getTodayStats(), umamiGet("stats?" + all)])
      .then(function (rs) {
        setStat("todayVisitors", rs[0].visitors);
        setStat("todayPageviews", rs[0].pageviews);
        setStat("totalVisitors", statVal(rs[1], "visitors"));
        setStat("totalPageviews", statVal(rs[1], "pageviews"));
      })
      .catch(function () {
        noteFailure("summary", "Umami 数据暂时读不到，请稍后再看。");
      });
  }

  function setStat(name, value) {
    var el = root.querySelector('[data-stat="' + name + '"]');
    if (el) el.textContent = fmtNum(value);
  }

  /* ---------------- 2. 访问脉冲（手写 SVG 折线/面积） ---------------- */

  var CH = { x0: 42, x1: 944, yTop: 38, yBase: 230 };
  var pulseCache = {};
  var pulseState = null; // { dates:[], views:[], visitors:[] }

  function loadPulse(days) {
    var panel = panelEl("pulse");
    if (!panel) return;
    if (pulseCache[days]) {
      drawPulse(pulseCache[days]);
      return;
    }
    umamiGet(
      "pageviews?" +
        rangeQuery(days) +
        "&unit=day&timezone=" +
        encodeURIComponent(TZ),
    )
      .then(function (data) {
        var series = normalizeDaily(data, days);
        pulseCache[days] = series;
        drawPulse(series);
      })
      .catch(function () {
        noteFailure("pulse", "Umami 数据暂时读不到，请稍后再看。");
      });
  }

  // 把 pageviews 响应按本地日期对齐成定长数组（缺日补 0）
  function normalizeDaily(data, days) {
    var byDay = {};
    function fill(list, field) {
      (list || []).forEach(function (p) {
        var k = dayKey(p.x);
        byDay[k] = byDay[k] || { views: 0, visitors: 0 };
        byDay[k][field] += Number(p.y) || 0;
      });
    }
    fill(data && data.pageviews, "views");
    fill(data && data.sessions, "visitors");
    var out = { dates: [], views: [], visitors: [] };
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(today.getTime() - i * DAY_MS);
      var k = dayKey(d.getTime());
      var row = byDay[k] || { views: 0, visitors: 0 };
      out.dates.push(d);
      out.views.push(row.views);
      out.visitors.push(row.visitors);
    }
    return out;
  }

  function smoothPath(pts) {
    if (!pts.length) return "";
    var d = "M " + pts[0].x + " " + pts[0].y;
    for (var i = 1; i < pts.length; i++) {
      var prev = pts[i - 1];
      var cur = pts[i];
      var mx = (prev.x + cur.x) / 2;
      var my = (prev.y + cur.y) / 2;
      d += " Q " + prev.x + " " + prev.y + " " + mx + " " + my;
    }
    var last = pts[pts.length - 1];
    d += " L " + last.x + " " + last.y;
    return d;
  }

  function drawPulse(series) {
    var panel = panelEl("pulse");
    if (!panel) return;
    pulseState = series;
    var svg = panel.querySelector("[data-pulse-chart]");
    var emptyEl = panel.querySelector("[data-chart-empty]");
    var total = series.views.reduce(function (a, b) {
      return a + b;
    }, 0);
    if (emptyEl) emptyEl.hidden = total > 0;
    if (svg) svg.style.display = total > 0 ? "" : "none";
    var wrap = panel.querySelector(".stats-chart-wrap");
    if (wrap) wrap.classList.toggle("is-empty", !total);
    fillPeriodStats(series);
    if (!total) return;

    var n = series.dates.length;
    var max = 0;
    series.views.forEach(function (v) {
      if (v > max) max = v;
    });
    series.visitors.forEach(function (v) {
      if (v > max) max = v;
    });
    if (max <= 0) max = 1;

    function px(i) {
      return n === 1
        ? (CH.x0 + CH.x1) / 2
        : CH.x0 + (i * (CH.x1 - CH.x0)) / (n - 1);
    }
    function py(v) {
      return CH.yBase - (v / max) * (CH.yBase - CH.yTop);
    }
    function ptsOf(arr) {
      return arr.map(function (v, i) {
        return {
          x: Math.round(px(i) * 10) / 10,
          y: Math.round(py(v) * 10) / 10,
        };
      });
    }

    var viewsPts = ptsOf(series.views);
    var visitorsPts = ptsOf(series.visitors);
    var lineViews = smoothPath(viewsPts);
    var area =
      lineViews +
      " L " +
      viewsPts[viewsPts.length - 1].x +
      " " +
      CH.yBase +
      " L " +
      viewsPts[0].x +
      " " +
      CH.yBase +
      " Z";
    panel.querySelector("[data-chart-area]").setAttribute("d", area);
    panel
      .querySelector('[data-chart-line="views"]')
      .setAttribute("d", lineViews);
    panel
      .querySelector('[data-chart-line="visitors"]')
      .setAttribute("d", smoothPath(visitorsPts));

    pulseState.maxV = max;
    var NS = "http://www.w3.org/2000/svg";
    var g = panel.querySelector("[data-chart-points]");
    while (g.firstChild) g.removeChild(g.firstChild);
    function addPoints(pts, cls) {
      pts.forEach(function (p, idx) {
        var c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", p.x);
        c.setAttribute("cy", p.y);
        c.setAttribute("r", "3");
        c.setAttribute(
          "class",
          "stats-chart-point " +
            cls +
            (idx === pts.length - 1 ? " stats-chart-point--endpoint" : ""),
        );
        g.appendChild(c);
      });
    }
    addPoints(viewsPts, "stats-chart-point--views");
    addPoints(visitorsPts, "stats-chart-point--visitors");
    animatePulseLines(panel);

    var yMax = panel.querySelector('[data-y="max"]');
    var yMid = panel.querySelector('[data-y="mid"]');
    if (yMax) yMax.textContent = fmtNum(max);
    if (yMid) yMid.textContent = fmtNum(Math.round(max / 2));
    var xStart = panel.querySelector('[data-x="start"]');
    var xMid = panel.querySelector('[data-x="mid"]');
    if (xStart)
      xStart.textContent =
        series.dates[0].getMonth() + 1 + "/" + series.dates[0].getDate();
    if (xMid) {
      var md = series.dates[Math.floor(n / 2)];
      xMid.textContent = md.getMonth() + 1 + "/" + md.getDate();
    }
    svg.setAttribute(
      "aria-label",
      "最近 " + n + " 天的浏览量与访客趋势，单日最高浏览 " + fmtNum(max),
    );
  }

  // 本周期 snapshot 子块：与折线同一份 series 派生（不额外取数）
  function fillPeriodStats(series) {
    var panel = panelEl("pulse");
    if (!panel) return;
    var views = 0;
    var visitors = 0;
    var active = 0;
    var peak = 0;
    var peakDate = null;
    series.views.forEach(function (v, i) {
      views += v;
      visitors += series.visitors[i] || 0;
      if (v > 0) active++;
      if (v > peak) {
        peak = v;
        peakDate = series.dates[i];
      }
    });
    function set(sel, text) {
      var el = panel.querySelector(sel);
      if (el) el.textContent = text;
    }
    set("[data-period-views]", fmtNum(views));
    set("[data-period-visitors]", fmtNum(visitors));
    set("[data-period-active]", fmtNum(active) + " 天");
    set("[data-period-peak]", fmtNum(peak));
    set(
      "[data-period-peak-date]",
      peakDate
        ? peakDate.getMonth() + 1 + "月" + peakDate.getDate() + "日"
        : "—",
    );
    set(
      "[data-period-range-label]",
      "近 " + series.dates.length + " 天 · 本地时间",
    );
  }

  // 折线描画动画（刷新/切换范围时重播；减动效时跳过）
  function animatePulseLines(panel) {
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    ["views", "visitors"].forEach(function (key) {
      var path = panel.querySelector('[data-chart-line="' + key + '"]');
      if (!path || !path.getTotalLength) return;
      try {
        var len = path.getTotalLength();
        path.style.transition = "none";
        path.style.strokeDasharray = String(len);
        path.style.strokeDashoffset = String(len);
        // 强制回流后启动过渡（d 一并过渡，切换范围时线形平滑变形）
        void path.getBoundingClientRect();
        path.style.transition =
          "stroke-dashoffset 0.9s ease, d 0.42s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
        path.style.strokeDashoffset = "0";
        if (key === "visitors") {
          // 会话线终态是虚线：动画结束后撤掉内联 dash，交回 CSS 的 5 6 虚线
          setTimeout(function () {
            path.style.strokeDasharray = "";
            path.style.strokeDashoffset = "";
          }, 950);
        }
      } catch (e) {}
    });
  }

  /* 热门排行子块：Umami metrics 的路径排行（近 30 天，与对方同口径）。
     Umami v3 起 metrics 的 type 由 url 改名为 path（url 返回 400）。 */
  function loadRanking() {
    var panel = panelEl("pulse");
    if (!panel) return;
    var list = panel.querySelector("[data-ranking-list]");
    if (!list) return;
    metricsList("path", 50)
      .then(function (rows) {
        var clean = rows.filter(function (r) {
          return (
            r.value > 0 &&
            r.label.charAt(0) === "/" &&
            !/\.(css|js|png|jpe?g|svg|ico|webp|woff2?|xml|txt|json)(\?|$)/i.test(
              r.label,
            )
          );
        });
        renderRanking(list, clean.slice(0, 8));
      })
      .catch(function () {
        renderRanking(list, []);
      });
  }

  function renderRanking(list, rows) {
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!rows.length) {
      var empty = document.createElement("li");
      empty.className = "stats-ranking__empty";
      empty.textContent = "暂时没有可展示的排行";
      list.appendChild(empty);
      return;
    }
    var max = rows[0].value || 1;
    rows.forEach(function (r, i) {
      var item = document.createElement(
        r.label.charAt(0) === "/" ? "a" : "span",
      );
      item.className = "stats-ranking__item";
      if (item.tagName === "A") item.setAttribute("href", r.label);
      item.style.setProperty(
        "--stats-share",
        Math.max(4, Math.round((r.value / max) * 100)) + "%",
      );
      var idx = document.createElement("span");
      idx.className = "stats-ranking__index";
      idx.textContent = String(i + 1).padStart(2, "0");
      var copy = document.createElement("span");
      copy.className = "stats-ranking__copy";
      var title = document.createElement("strong");
      var decoded = r.label;
      try {
        decoded = decodeURIComponent(r.label);
      } catch (e) {}
      var seg = decoded.replace(/\/+$/, "").split("/").pop();
      title.textContent = decoded === "/" ? "首页" : seg || decoded;
      title.title = decoded;
      copy.appendChild(title);
      if (decoded !== title.textContent) {
        var sub = document.createElement("small");
        sub.textContent = decoded;
        copy.appendChild(sub);
      }
      var val = document.createElement("strong");
      val.textContent = fmtNum(r.value);
      item.appendChild(idx);
      item.appendChild(copy);
      item.appendChild(val);
      list.appendChild(item);
    });
  }

  // 脉冲图 hover：竖直引导线 + 浮签（事件委托在 svg 上，按横坐标找最近点）
  function bindPulseHover() {
    var panel = panelEl("pulse");
    if (!panel) return;
    var svg = panel.querySelector("[data-pulse-chart]");
    var tip = panel.querySelector("[data-chart-tooltip]");
    var guide = panel.querySelector("[data-chart-guide]");
    if (!svg || !tip || !guide) return;
    var wrap = panel.querySelector(".stats-chart-wrap");

    function move(evt) {
      if (!pulseState || !pulseState.dates.length) return;
      var rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      var vx = ((evt.clientX - rect.left) / rect.width) * 960;
      var n = pulseState.dates.length;
      var i = Math.round(((vx - CH.x0) / (CH.x1 - CH.x0)) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      var x =
        n === 1 ? (CH.x0 + CH.x1) / 2 : CH.x0 + (i * (CH.x1 - CH.x0)) / (n - 1);
      guide.setAttribute("x1", x);
      guide.setAttribute("x2", x);
      guide.style.display = "";
      var d = pulseState.dates[i];
      tip.querySelector("[data-tip-date]").textContent =
        d.getFullYear() +
        "-" +
        String(d.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(d.getDate()).padStart(2, "0") +
        " · " +
        WEEKDAYS[(d.getDay() + 6) % 7];
      tip.querySelector("[data-tip-views]").textContent = fmtNum(
        pulseState.views[i],
      );
      tip.querySelector("[data-tip-visitors]").textContent = fmtNum(
        pulseState.visitors[i],
      );
      tip.hidden = false;
      var wrapRect = wrap.getBoundingClientRect();
      var leftPx = rect.left - wrapRect.left + (x / 960) * rect.width;
      tip.style.left = leftPx + "px";
      tip.style.top = "0px";
    }
    svg.addEventListener("mousemove", move);
    svg.addEventListener("mouseleave", function () {
      tip.hidden = true;
      guide.style.display = "none";
    });
  }

  var pulseRange = 30;

  function bindPulseRange() {
    var panel = panelEl("pulse");
    if (!panel) return;
    var btns = panel.querySelectorAll("[data-range]");
    btns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        btns.forEach(function (b) {
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        pulseRange = Number(btn.getAttribute("data-range")) || 30;
        loadPulse(pulseRange);
      });
    });
    var refresh = panel.querySelector("[data-pulse-refresh]");
    if (refresh) {
      refresh.addEventListener("click", function () {
        refresh.classList.add("is-spinning");
        setTimeout(function () {
          refresh.classList.remove("is-spinning");
        }, 900);
        delete pulseCache[pulseRange];
        loadPulse(pulseRange);
      });
    }
  }

  /* ---------------- 3. 推送节奏（GitHub 公开 API） ---------------- */

  var GH_CACHE_KEY = "ethereal-stats-github";
  var GH_CACHE_TTL = 10 * 60 * 1000;

  function loadPush() {
    var panel = panelEl("push");
    if (!panel) return;
    // 优先读站内生成的提交统计：VM 101 每小时用 git log 生成、同域提供，
    // 绕开浏览器直调 api.github.com 的未认证限额（共享代理出口 IP 的
    // 60 次/小时额度常被同 IP 陌生人占满，浏览器侧永远 403 判空）。
    // 站内数据不可用时才回退 GitHub API 直连（sessionStorage 缓存只作用于它）。
    fetchLocalPushData()
      .catch(function () {
        if (!githubRepo || githubRepo.indexOf("/") < 0) {
          throw new Error("no repo");
        }
        return readGhCache().then(function (cached) {
          if (cached) return cached;
          return fetchGhCommits().then(function (data) {
            try {
              sessionStorage.setItem(
                GH_CACHE_KEY,
                JSON.stringify({
                  ts: Date.now(),
                  repo: githubRepo,
                  data: data,
                }),
              );
            } catch (e) {}
            return data;
          });
        });
      })
      .then(renderPush)
      .catch(function () {
        showPushEmpty();
      });
  }

  // 站内推送统计（/opt/push-data/gen_push_data.py 每小时生成，
  // 形状与 fetchGhCommits 返回一致：{ byDay, startISO, lastPushAt, prevPushAt }；
  // source 标记实际来源，状态文案按它写，不再一律硬编码 GitHub）
  function fetchLocalPushData() {
    return fetchJSON(
      "/upload/stats/push-data.json",
      { cache: "no-cache" },
      8000,
    ).then(function (data) {
      if (
        !data ||
        typeof data.byDay !== "object" ||
        data.byDay === null ||
        Array.isArray(data.byDay)
      ) {
        throw new Error("bad local push data");
      }
      data.source = "local";
      return data;
    });
  }

  function readGhCache() {
    try {
      var raw = sessionStorage.getItem(GH_CACHE_KEY);
      if (!raw) return Promise.resolve(null);
      var parsed = JSON.parse(raw);
      if (
        parsed &&
        parsed.repo === githubRepo &&
        Date.now() - parsed.ts < GH_CACHE_TTL &&
        parsed.data
      ) {
        return Promise.resolve(parsed.data);
      }
    } catch (e) {}
    return Promise.resolve(null);
  }

  // 近 12 个月窗口：从 12 个月前那天所在周的周一开始逐页拉 commits。
  // 全年提交可能上千：至多 10 页 × 100，且整页都早于窗口起点时提前停。
  function fetchGhCommits() {
    var start = ghWindowStart();
    var sinceISO = start.toISOString();
    var byDay = {};
    var allTs = [];
    function pull(page) {
      var url =
        "https://api.github.com/repos/" +
        githubRepo +
        "/commits?per_page=100&page=" +
        page +
        "&since=" +
        encodeURIComponent(sinceISO);
      return fetchJSON(
        url,
        { headers: { Accept: "application/vnd.github+json" } },
        12000,
      ).then(function (list) {
        if (!Array.isArray(list)) throw new Error("bad response");
        var oldest = Infinity;
        list.forEach(function (c) {
          var date = c && c.commit && (c.commit.committer || c.commit.author);
          var t = date && (date.date || null);
          if (!t) return;
          var ts = new Date(t).getTime();
          if (ts < oldest) oldest = ts;
          allTs.push(ts);
          var k = dayKey(ts);
          byDay[k] = (byDay[k] || 0) + 1;
        });
        if (list.length === 100 && page < 10 && oldest >= start.getTime())
          return pull(page + 1);
        return byDay;
      });
    }
    return pull(1).then(function (map) {
      allTs.sort(function (a, b) {
        return b - a;
      });
      // GitHub 回退路径只有提交级时间戳：一次 push 含多个提交时最新
      // 两条只差几秒，「最近间隔」会被 fmtDuration 兜底成误导的「1 分钟」。
      // 按活跃日去重、取最近两天各自的最新提交——间隔回到按天口径；
      // lastPushAt 恒取最新提交（allTs[0]），「最近一次」保持分钟精度；
      // 只有 prevPushAt 加天数门控：不足两个活跃日时不填，最近间隔
      // 落到「—」分支（:950-951），不再出现「1 分钟」误报。
      var distinctDayTs = [];
      var seenDays = {};
      allTs.forEach(function (ts) {
        var k = dayKey(ts);
        if (!seenDays[k]) {
          seenDays[k] = true;
          distinctDayTs.push(ts);
        }
      });
      return {
        byDay: map,
        startISO: dayKey(start.getTime()),
        lastPushAt: allTs.length
          ? new Date(allTs[0]).toISOString()
          : null,
        prevPushAt:
          distinctDayTs.length > 1
            ? new Date(distinctDayTs[1]).toISOString()
            : null,
        source: "github",
      };
    });
  }

  function mondayOf(d) {
    var x = new Date(d.getTime());
    x.setHours(0, 0, 0, 0);
    return new Date(x.getTime() - ((x.getDay() + 6) % 7) * DAY_MS);
  }

  // 窗口起点：12 个月前那天所在周的周一（与 gen_push_data.py 同口径）
  function ghWindowStart() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    if (d.getMonth() === 1 && d.getDate() === 29) d.setDate(28);
    d.setFullYear(d.getFullYear() - 1);
    return mondayOf(d);
  }

  var pushState = null; // { byDay, mode, start, weeks }
  // 周数由数据起点（startISO）到本周实际算出，不写死，避免把未来周算进去
  function pushWeeks() {
    return pushState && pushState.weeks ? pushState.weeks : 53;
  }

  function renderPush(data) {
    var panel = panelEl("push");
    if (!panel || !data) return;
    var start = data.startISO
      ? new Date(data.startISO + "T00:00:00")
      : ghWindowStart();
    if (isNaN(start.getTime())) start = ghWindowStart();
    var weeks = Math.max(
      1,
      Math.round(
        (mondayOf(new Date()).getTime() - start.getTime()) / (7 * DAY_MS),
      ) + 1,
    );
    pushState = {
      byDay: data.byDay || {},
      mode: "daily",
      density: 1,
      start: start,
      weeks: weeks,
    };
    fillPushMetrics(panel, pushState.byDay, data);
    var totalEl = panel.querySelector("[data-push-total]");
    if (totalEl) {
      var total = 0;
      Object.keys(pushState.byDay).forEach(function (k) {
        total += pushState.byDay[k] || 0;
      });
      totalEl.textContent = "共 " + fmtNum(total) + " 次推送";
    }
    renderPushGrid();
    bindPushControls(panel);
    initSnake(panel);
    // 来源文案按实际数据路径写：站内管线（本地 bare 克隆 git log）与
    // GitHub API 兜底是两回事，不再一律写「数据来自 GitHub」（清单 A13）
    var isLocal = data.source === "local";
    var status = panel.querySelector("[data-push-status]");
    if (status)
      status.textContent = isLocal
        ? "站内统计 · 每小时更新"
        : "数据来自 GitHub";
    var sourceEl = panel.querySelector("[data-push-source-text]");
    if (sourceEl)
      sourceEl.textContent = isLocal
        ? "数据口径：本地仓库 main 分支提交 · 每小时更新"
        : "数据来自 GitHub 公开接口";
  }

  // 时长人话化：给「最近间隔」用（精确到分钟级）
  function fmtDuration(ms) {
    var mins = Math.max(1, Math.round(ms / 60000));
    if (mins < 60) return mins + " 分钟";
    var hours = Math.floor(mins / 60);
    var restMins = mins % 60;
    if (hours < 24)
      return restMins ? hours + " 小时 " + restMins + " 分" : hours + " 小时";
    var days = Math.floor(hours / 24);
    var restHours = hours % 24;
    return restHours ? days + " 天 " + restHours + " 小时" : days + " 天";
  }

  // 精确时间：YYYY-MM-DD HH:MM（本地时区，统计卡副文案用）
  function fmtDateTime(ts) {
    var d = new Date(ts);
    function p2(n) {
      return String(n).padStart(2, "0");
    }
    return (
      d.getFullYear() +
      "-" +
      p2(d.getMonth() + 1) +
      "-" +
      p2(d.getDate()) +
      " " +
      p2(d.getHours()) +
      ":" +
      p2(d.getMinutes())
    );
  }

  // 4 个 metric 块由 byDay 派生；数据带 lastPushAt / prevPushAt（提交级
  // 时间戳）时，最近一次与最近间隔精确到分钟，缺时间戳时退回按天口径
  function fillPushMetrics(panel, byDay, data) {
    var activeTs = [];
    Object.keys(byDay).forEach(function (k) {
      if ((byDay[k] || 0) > 0)
        activeTs.push(new Date(k + "T00:00:00").getTime());
    });
    activeTs.sort(function (a, b) {
      return a - b;
    });
    function set(sel, text) {
      var el = panel.querySelector(sel);
      if (el) el.textContent = text;
    }
    if (!activeTs.length) {
      set("[data-push-latest]", "—");
      set("[data-push-latest-date]", "—");
      set("[data-push-interval]", "—");
      set("[data-push-cadence]", "—");
      set("[data-push-streak]", "—");
      return;
    }
    var latest = activeTs[activeTs.length - 1];
    var lastPushTs =
      data && data.lastPushAt ? Date.parse(data.lastPushAt) : NaN;
    var prevPushTs =
      data && data.prevPushAt ? Date.parse(data.prevPushAt) : NaN;
    if (!isNaN(lastPushTs)) {
      set(
        "[data-push-latest]",
        fmtRelative(new Date(lastPushTs).toISOString()) || "刚刚",
      );
      set("[data-push-latest-date]", fmtDateTime(lastPushTs));
    } else {
      var latestDate = new Date(latest);
      set(
        "[data-push-latest]",
        fmtRelative(latestDate.toISOString()) || "今天",
      );
      set(
        "[data-push-latest-date]",
        latestDate.getMonth() + 1 + "月" + latestDate.getDate() + "日",
      );
    }
    if (!isNaN(lastPushTs) && !isNaN(prevPushTs) && lastPushTs > prevPushTs) {
      set("[data-push-interval]", fmtDuration(lastPushTs - prevPushTs));
    } else if (activeTs.length >= 2) {
      var gapDays = Math.round(
        (latest - activeTs[activeTs.length - 2]) / DAY_MS,
      );
      set("[data-push-interval]", gapDays + " 天");
    } else {
      set("[data-push-interval]", "—");
    }
    if (activeTs.length >= 2) {
      var gaps = [];
      for (var i = 1; i < activeTs.length; i++) {
        gaps.push((activeTs[i] - activeTs[i - 1]) / DAY_MS);
      }
      var avg =
        gaps.reduce(function (a, b) {
          return a + b;
        }, 0) / gaps.length;
      set(
        "[data-push-cadence]",
        (Math.round(avg * 10) / 10).toString().replace(/\.0$/, "") + " 天/次",
      );
    } else {
      set("[data-push-cadence]", "—");
    }
    // 连续推送：以最近活跃日为终点向前数连续天数
    var byKey = {};
    activeTs.forEach(function (t) {
      byKey[dayKey(t)] = true;
    });
    var streak = 0;
    var cursor = latest;
    while (byKey[dayKey(cursor)]) {
      streak++;
      cursor -= DAY_MS;
    }
    set("[data-push-streak]", streak + " 天");
  }

  function pushMaxOf(byDay) {
    var max = 0;
    Object.keys(byDay).forEach(function (k) {
      if (byDay[k] > max) max = byDay[k];
    });
    return max || 1;
  }

  // 热力网格：daily = 每日计数 / weekly = 按周汇总（一行） /
  // cumulative = 累计计数；格子按列优先（周 × 星期）排布
  function renderPushGrid() {
    var panel = panelEl("push");
    if (!panel || !pushState) return;
    var grid = panel.querySelector("[data-push-grid]");
    var months = panel.querySelector("[data-push-months]");
    if (!grid) return;
    stopSnake();
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    if (months) while (months.firstChild) months.removeChild(months.firstChild);
    var byDay = pushState.byDay;
    var start = pushState.start || ghWindowStart();
    var weeks = pushWeeks();
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var mode = pushState.mode;

    // 相对浓度：density 放大计数相对 max 的比例，低活跃年份也能看出层次；
    // density = 1 时与原口径一致
    function levelOf(count, max) {
      if (count === 0) return 0;
      var ratio = (count * (pushState.density || 1)) / max;
      return Math.min(4, Math.max(1, Math.ceil(ratio * 4)));
    }
    function addCell(count, max, title, idx) {
      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "stats-heat-cell";
      cell.setAttribute("data-level", String(levelOf(count, max)));
      if (title) cell.title = title;
      if (idx != null) cell.setAttribute("data-cell-idx", String(idx));
      grid.appendChild(cell);
      return cell;
    }

    if (mode === "weekly") {
      grid.style.gridTemplateRows = "repeat(1, 0.56rem)";
      var weekTotals = [];
      var wmax = 1;
      for (var w = 0; w < weeks; w++) {
        var sum = 0;
        for (var wd = 0; wd < 7; wd++) {
          var d = new Date(start.getTime() + (w * 7 + wd) * DAY_MS);
          if (d.getTime() <= today.getTime())
            sum += byDay[dayKey(d.getTime())] || 0;
        }
        weekTotals.push(sum);
        if (sum > wmax) wmax = sum;
      }
      weekTotals.forEach(function (sum, w) {
        var ws = new Date(start.getTime() + w * 7 * DAY_MS);
        addCell(
          sum,
          wmax,
          dayKey(ws.getTime()) + " 这一周 · " + sum + " 次提交",
          null,
        );
      });
      if (months) months.style.display = "none";
      return;
    }

    grid.style.gridTemplateRows = "";
    if (months) months.style.display = "";
    var counts = [];
    var cmax = 1;
    var running = 0;
    for (var i = 0; i < weeks * 7; i++) {
      var day = new Date(start.getTime() + i * DAY_MS);
      var future = day.getTime() > today.getTime();
      var c = future ? 0 : byDay[dayKey(day.getTime())] || 0;
      running += c;
      var v = mode === "cumulative" ? running : c;
      counts.push({ day: day, future: future, raw: c, value: v });
      if (v > cmax) cmax = v;
    }
    var max = mode === "cumulative" ? cmax : pushMaxOf(byDay);
    counts.forEach(function (row, idx) {
      var cell = addCell(
        row.value,
        max,
        row.future
          ? ""
          : dayKey(row.day.getTime()) +
              " · " +
              row.raw +
              " 次提交" +
              (mode === "cumulative" ? "（累计 " + row.value + "）" : ""),
        idx,
      );
      if (row.future) cell.classList.add("stats-heat-cell--future");
      else if (dayKey(row.day.getTime()) === dayKey(today.getTime()))
        cell.classList.add("is-today");
    });
    // 月份行：每列（周一）月份变化时打一个标签，按列比例定位
    if (months) {
      var lastMonth = -1;
      for (var w2 = 0; w2 < weeks; w2++) {
        var monday = new Date(start.getTime() + w2 * 7 * DAY_MS);
        if (monday.getMonth() !== lastMonth) {
          lastMonth = monday.getMonth();
          var label = document.createElement("span");
          label.textContent = monday.getMonth() + 1 + "月";
          label.style.left = (w2 * 100) / weeks + "%";
          months.appendChild(label);
        }
      }
    }
    if (mode === "daily") startSnake(panel);
  }

  function bindPushControls(panel) {
    if (panel.getAttribute("data-push-bound")) return;
    panel.setAttribute("data-push-bound", "1");
    var modeBtns = panel.querySelectorAll("[data-push-mode]");
    modeBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        modeBtns.forEach(function (b) {
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        if (pushState) {
          pushState.mode = btn.getAttribute("data-push-mode") || "daily";
          renderPushGrid();
        }
      });
    });
    var speedBtns = panel.querySelectorAll("[data-snake-speed]");
    speedBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        speedBtns.forEach(function (b) {
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        if (snake) {
          snake.speed = Number(btn.getAttribute("data-snake-speed")) || 1;
          scheduleSnake();
        }
      });
    });
    var densityBtns = panel.querySelectorAll("[data-push-density]");
    densityBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        densityBtns.forEach(function (b) {
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        if (pushState) {
          pushState.density =
            Number(btn.getAttribute("data-push-density")) || 1;
          renderPushGrid();
        }
      });
    });
    var grid = panel.querySelector("[data-push-grid]");
    if (grid) {
      grid.addEventListener("click", function (evt) {
        var cell = evt.target.closest
          ? evt.target.closest("[data-cell-idx]")
          : null;
        if (!cell || !snake) return;
        var idx = Number(cell.getAttribute("data-cell-idx"));
        if (snake.foods.has(idx)) snake.foods.delete(idx);
        else if (!snake.bodySet.has(idx)) snake.foods.add(idx);
        paintSnake();
      });
      // 悬浮格子时 message 明细行同步显示该日计数，离开恢复默认句
      var detail = panel.querySelector("[data-push-heatmap-detail]");
      if (detail) {
        var detailDefault = detail.textContent;
        grid.addEventListener("mouseover", function (evt) {
          var cell = evt.target.closest
            ? evt.target.closest("[data-cell-idx]")
            : null;
          if (cell && cell.title) detail.textContent = cell.title;
        });
        grid.addEventListener("mouseleave", function () {
          detail.textContent = detailDefault;
        });
      }
    }
  }

  /* 贪吃蛇：在每日热力格上散步，吃掉访客点下的食物格增长。
     仅在 daily 模式 + 面板可见 + 文档可见时运行；减动效时不启动。 */
  var snake = null;
  var snakeObserver = null;

  function initSnake(panel) {
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    snake = {
      panel: panel,
      body: [3, 2, 1], // idx = 周*7 + 星期（列优先）
      bodySet: new Set([3, 2, 1]),
      dir: 7, // 向右（下一周同星期）
      foods: new Set(),
      gain: 1,
      grow: 0,
      speed: 1,
      timer: null,
      running: false,
    };
    // 初始食物：随机挑 3 个有提交记录的格子
    var grid = panel.querySelector("[data-push-grid]");
    if (grid) {
      var active = [];
      grid.querySelectorAll("[data-cell-idx]").forEach(function (c) {
        if (Number(c.getAttribute("data-level")) > 0)
          active.push(Number(c.getAttribute("data-cell-idx")));
      });
      for (var i = 0; i < 3 && active.length; i++) {
        var pick = active.splice(
          Math.floor(Math.random() * active.length),
          1,
        )[0];
        if (!snake.bodySet.has(pick)) snake.foods.add(pick);
      }
    }
    if (window.IntersectionObserver) {
      snakeObserver = new IntersectionObserver(function (entries) {
        snakeVisible = entries[0].isIntersecting;
        scheduleSnake();
      });
      snakeObserver.observe(panel);
    } else {
      snakeVisible = true;
    }
    document.addEventListener("visibilitychange", scheduleSnake);
    paintSnake();
    scheduleSnake();
  }

  var snakeVisible = false;

  function startSnake(panel) {
    if (!snake) return;
    snake.panel = panel;
    paintSnake();
    scheduleSnake();
  }

  function stopSnake() {
    if (snake && snake.timer) {
      clearTimeout(snake.timer);
      snake.timer = null;
    }
    if (snake) snake.running = false;
  }

  function scheduleSnake() {
    if (!snake) return;
    stopSnake();
    if (
      !pushState ||
      pushState.mode !== "daily" ||
      !snakeVisible ||
      document.hidden
    )
      return;
    snake.running = true;
    snake.timer = setTimeout(snakeTick, 280 / snake.speed);
  }

  function snakeTick() {
    if (!snake || !snake.running) return;
    var cols = pushWeeks();
    var rows = 7;
    var head = snake.body[0];
    var hc = Math.floor(head / rows);
    var hr = head % rows;
    // 目标：最近的食物；没有就沿当前方向
    var target = null;
    var best = Infinity;
    snake.foods.forEach(function (f) {
      var d = Math.abs(Math.floor(f / rows) - hc) + Math.abs((f % rows) - hr);
      if (d < best) {
        best = d;
        target = f;
      }
    });
    var dirs = [7, -7, 1, -1];
    function stepOk(idx, dir) {
      var c = Math.floor(idx / rows);
      var r = idx % rows;
      if (dir === 7) return c < cols - 1;
      if (dir === -7) return c > 0;
      if (dir === 1) return r < rows - 1;
      return r > 0;
    }
    function score(dir) {
      if (!stepOk(head, dir)) return -1;
      var nidx = head + dir;
      if (snake.bodySet.has(nidx) && nidx !== snake.body[snake.body.length - 1])
        return -1;
      if (target == null) return dir === snake.dir ? 2 : 1;
      var d =
        Math.abs(Math.floor(nidx / rows) - Math.floor(target / rows)) +
        Math.abs((nidx % rows) - (target % rows));
      return 100 - d;
    }
    var bestDir = snake.dir;
    var bestScore = -Infinity;
    // 随机打散同分方向，避免走死胡同时抖动
    dirs
      .slice()
      .sort(function () {
        return Math.random() - 0.5;
      })
      .forEach(function (dir) {
        var s = score(dir);
        if (s > bestScore) {
          bestScore = s;
          bestDir = dir;
        }
      });
    if (bestScore < 0) {
      // 无路可走：原地重置到左上角
      snake.body = [3, 2, 1];
      snake.bodySet = new Set(snake.body);
      snake.dir = 7;
      paintSnake();
      scheduleSnake();
      return;
    }
    snake.dir = bestDir;
    var next = head + bestDir;
    snake.body.unshift(next);
    snake.bodySet.add(next);
    if (snake.foods.has(next)) {
      snake.foods.delete(next);
      snake.grow += snake.gain;
    }
    if (snake.grow > 0) {
      snake.grow--;
    } else {
      var tail = snake.body.pop();
      if (tail !== next) snake.bodySet.delete(tail);
    }
    paintSnake();
    scheduleSnake();
  }

  function paintSnake() {
    if (!snake) return;
    var grid = snake.panel.querySelector("[data-push-grid]");
    if (!grid) return;
    grid
      .querySelectorAll(".is-snake, .is-snake-head, .is-food")
      .forEach(function (c) {
        c.classList.remove("is-snake", "is-snake-head", "is-food");
      });
    snake.foods.forEach(function (f) {
      var c = grid.querySelector('[data-cell-idx="' + f + '"]');
      if (c) c.classList.add("is-food");
    });
    snake.body.forEach(function (idx, i) {
      var c = grid.querySelector('[data-cell-idx="' + idx + '"]');
      if (c) c.classList.add(i === 0 ? "is-snake-head" : "is-snake");
    });
  }

  function showPushEmpty() {
    var panel = panelEl("push");
    if (!panel) return;
    var empty = panel.querySelector("[data-push-empty]");
    if (empty) empty.hidden = false;
    var status = panel.querySelector("[data-push-status]");
    if (status) status.textContent = "读取失败";
  }

  /* ---------------- 4. 访客活跃时间（星期 × 小时热力） ---------------- */

  function loadActivity() {
    var panel = panelEl("activity");
    if (!panel) return;
    umamiGet(
      "pageviews?" +
        rangeQuery(30) +
        "&unit=hour&timezone=" +
        encodeURIComponent(TZ),
    )
      .then(function (data) {
        var grid = {}; // wd(0=周一) -> [24]
        for (var w = 0; w < 7; w++) {
          grid[w] = [];
          for (var h = 0; h < 24; h++) grid[w].push(0);
        }
        var max = 0;
        ((data && data.pageviews) || []).forEach(function (p) {
          var d = new Date(p.x);
          var wd = (d.getDay() + 6) % 7;
          var hr = d.getHours();
          grid[wd][hr] += Number(p.y) || 0;
          if (grid[wd][hr] > max) max = grid[wd][hr];
        });
        panel
          .querySelectorAll("[data-activity-grid] .stats-heat-cell")
          .forEach(function (cell) {
            var wd = Number(cell.getAttribute("data-wd"));
            var h = Number(cell.getAttribute("data-h"));
            var v = grid[wd][h] || 0;
            var level =
              v === 0 ? 0 : Math.min(4, Math.ceil((v / (max || 1)) * 4));
            cell.setAttribute("data-level", String(level));
            cell.title =
              WEEKDAYS[wd] +
              " " +
              String(h).padStart(2, "0") +
              ":00 · " +
              fmtNum(v) +
              " 次浏览";
          });
        fillActivityStats(panel, grid);
      })
      .catch(function () {
        noteFailure("activity", "Umami 数据暂时读不到，请稍后再看。");
      });
  }

  // 活跃面板的 4 个 stat 色块 + 热力图下说明，全部由同一份小时网格派生
  function fillActivityStats(panel, grid) {
    var total = 0;
    var night = 0;
    var peakV = 0;
    var peakWd = 0;
    var peakH = 0;
    var wdTotals = [0, 0, 0, 0, 0, 0, 0];
    for (var w = 0; w < 7; w++) {
      for (var h = 0; h < 24; h++) {
        var v = grid[w][h] || 0;
        total += v;
        wdTotals[w] += v;
        if (h >= 22 || h < 6) night += v;
        if (v > peakV) {
          peakV = v;
          peakWd = w;
          peakH = h;
        }
      }
    }
    function set(sel, text) {
      var el = panel.querySelector(sel);
      if (el) el.textContent = text;
    }
    if (total > 0) {
      set(
        "[data-act-peak]",
        WEEKDAYS[peakWd] + " " + String(peakH).padStart(2, "0") + ":00",
      );
      var bestWd = 0;
      wdTotals.forEach(function (t, i) {
        if (t > wdTotals[bestWd]) bestWd = i;
      });
      set("[data-act-weekday]", WEEKDAYS[bestWd]);
      set("[data-act-night]", Math.round((night / total) * 100) + "%");
      set(
        "[data-activity-note]",
        "近 30 天共 " +
          fmtNum(total) +
          " 次浏览 · 大家最常在" +
          WEEKDAYS[peakWd] +
          " " +
          String(peakH).padStart(2, "0") +
          ":00 前后来访",
      );
    } else {
      set("[data-activity-note]", "近 30 天暂时没有小时级访问记录。");
    }
    getTodayStats()
      .then(function (t) {
        set("[data-act-today]", fmtNum(t.visitors));
      })
      .catch(function () {});
  }

  /* ---------------- 5/6/7. metrics：设备 / 浏览器 / 地域 / 来源 ---------------- */

  function metricsList(type, limit) {
    return umamiGet(
      "metrics?" + rangeQuery(30) + "&type=" + type + "&limit=" + limit,
    ).then(function (data) {
      var rows = Array.isArray(data) ? data : (data && data.items) || [];
      return rows
        .map(function (r) {
          return {
            label: String(r.x == null ? "" : r.x),
            value: Number(r.y) || 0,
          };
        })
        .filter(function (r) {
          return r.label !== "";
        });
    });
  }

  var DEVICE_LABELS = {
    desktop: "桌面端",
    mobile: "移动端",
    tablet: "平板",
    laptop: "笔记本",
    tv: "电视",
    console: "游戏机",
    wearable: "穿戴设备",
  };
  var CHANNEL_LABELS = {
    direct: "直接访问",
    search: "搜索引擎",
    social: "社交媒体",
    email: "邮件",
    referral: "引荐访问",
    ads: "广告",
    video: "视频",
    shopping: "购物",
    news: "新闻",
  };

  // 环形分段配色：由主题色相 --hue 旋转派生（与 CSS 的 --stats-v* 同一逻辑），
  // 「其他」合并项固定灰。脚本只在运行时读一次色相值，不写死站点颜色。
  var SEG_ROTATIONS = [0, 130, -45, 60, -185, 200];
  function segColor(row, i) {
    if (row && row.label === "其他") return "oklch(0.62 0.02 250)";
    var hue = 250;
    try {
      var raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--hue")
        .trim();
      var parsed = parseFloat(raw);
      if (!isNaN(parsed)) hue = parsed;
    } catch (e) {}
    var rot = SEG_ROTATIONS[i % SEG_ROTATIONS.length];
    var light = i % 2 ? 0.68 : 0.62;
    return "oklch(" + light + " 0.17 " + (hue + rot) + ")";
  }

  // 手写 SVG 环形图：rows 取前 6，其余合并为「其他」
  function drawDonut(svg, rows) {
    var NS = "http://www.w3.org/2000/svg";
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var total = rows.reduce(function (a, r) {
      return a + r.value;
    }, 0);
    var track = document.createElementNS(NS, "circle");
    track.setAttribute("cx", "50");
    track.setAttribute("cy", "50");
    track.setAttribute("r", "40");
    track.setAttribute("class", "stats-donut-track");
    svg.appendChild(track);
    if (!total) return 0;
    var C = 2 * Math.PI * 40;
    var offset = 0;
    rows.forEach(function (r, i) {
      var frac = r.value / total;
      if (frac <= 0) return;
      var c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", "50");
      c.setAttribute("cy", "50");
      c.setAttribute("r", "40");
      c.setAttribute("class", "stats-donut-segment");
      c.setAttribute("data-seg-index", String(i));
      c.setAttribute("stroke", segColor(r, i));
      c.setAttribute("stroke-dasharray", Math.max(0, frac * C - 1.5) + " " + C);
      c.setAttribute("stroke-dashoffset", String(-offset * C));
      c.setAttribute("transform", "rotate(-90 50 50)");
      svg.appendChild(c);
      offset += frac;
    });
    return total;
  }

  function renderLegend(ul, rows, total) {
    if (!ul) return;
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    rows.forEach(function (r, i) {
      var li = document.createElement("li");
      li.className = "stats-legend__item";
      li.setAttribute("data-seg-index", String(i));
      var dot = document.createElement("i");
      dot.style.background = segColor(r, i);
      var name = document.createElement("span");
      name.textContent = r.label;
      name.title = r.label;
      var val = document.createElement("strong");
      var pct = total ? Math.round((r.value / total) * 100) : 0;
      val.textContent = fmtNum(r.value) + " · " + pct + "%";
      li.appendChild(dot);
      li.appendChild(name);
      li.appendChild(val);
      ul.appendChild(li);
    });
    if (!rows.length) {
      var li = document.createElement("li");
      li.className = "stats-legend__empty";
      li.textContent = "暂无数据";
      ul.appendChild(li);
    }
  }

  // donut 扇区 ↔ 图例项双向悬浮同步（同 data-seg-index 两侧同置 data-active）
  function syncDonutHover(svg, ul) {
    if (!svg || !ul) return;
    function setActive(idx, on) {
      [svg, ul].forEach(function (root) {
        root
          .querySelectorAll('[data-seg-index="' + idx + '"]')
          .forEach(function (el) {
            if (on) el.setAttribute("data-active", "true");
            else el.removeAttribute("data-active");
          });
      });
    }
    function wire(el) {
      var idx = el.getAttribute("data-seg-index");
      el.addEventListener("mouseenter", function () {
        setActive(idx, true);
      });
      el.addEventListener("mouseleave", function () {
        setActive(idx, false);
      });
    }
    svg.querySelectorAll(".stats-donut-segment").forEach(wire);
    ul.querySelectorAll(".stats-legend__item").forEach(wire);
  }

  // Umami region 码（CN-XX）→ 省级 adcode（ISO 3166-2:CN），供中国地图上色/联动
  var REGION_ADCODE = {
    BJ: "110000",
    TJ: "120000",
    HE: "130000",
    SX: "140000",
    NM: "150000",
    LN: "210000",
    JL: "220000",
    HL: "230000",
    SH: "310000",
    JS: "320000",
    ZJ: "330000",
    AH: "340000",
    FJ: "350000",
    JX: "360000",
    SD: "370000",
    HA: "410000",
    HB: "420000",
    HN: "430000",
    GD: "440000",
    GX: "450000",
    HI: "460000",
    CQ: "500000",
    SC: "510000",
    GZ: "520000",
    YN: "530000",
    XZ: "540000",
    SN: "610000",
    GS: "620000",
    QH: "630000",
    NX: "640000",
    XJ: "650000",
    TW: "710000",
    HK: "810000",
    MO: "820000",
  };
  function regionAdcode(label) {
    var m = /^CN-([A-Z]{2})$/.exec(label || "");
    return m ? REGION_ADCODE[m[1]] || null : null;
  }

  // adcode → 短省名（排名 / 地图 title / 标记点共用，与参考同口径）
  var REGION_NAMES = {
    "110000": "北京",
    "120000": "天津",
    "130000": "河北",
    "140000": "山西",
    "150000": "内蒙古",
    "210000": "辽宁",
    "220000": "吉林",
    "230000": "黑龙江",
    "310000": "上海",
    "320000": "江苏",
    "330000": "浙江",
    "340000": "安徽",
    "350000": "福建",
    "360000": "江西",
    "370000": "山东",
    "410000": "河南",
    "420000": "湖北",
    "430000": "湖南",
    "440000": "广东",
    "450000": "广西",
    "460000": "海南",
    "500000": "重庆",
    "510000": "四川",
    "520000": "贵州",
    "530000": "云南",
    "540000": "西藏",
    "610000": "陕西",
    "620000": "甘肃",
    "630000": "青海",
    "640000": "宁夏",
    "650000": "新疆",
    "710000": "台湾",
    "810000": "香港",
    "820000": "澳门",
  };
  function regionShortName(adcode) {
    return REGION_NAMES[adcode] || adcode;
  }
  // 国内占比百分比（1 位小数，分母为国内访客总和）
  function fmtRegionPct(value, total) {
    return (total ? (Math.max(0, value) / total) * 100 : 0).toFixed(1) + "%";
  }
  function setRegionStatus(panel, text) {
    var el = panel ? panel.querySelector("[data-region-status]") : null;
    if (el) el.textContent = text;
  }

  // 地域卡右列：TOP 5 排行（国内省区，短名 + 国内占比百分比）
  function renderRegionRanking(ol, rows, total) {
    if (!ol) return;
    while (ol.firstChild) ol.removeChild(ol.firstChild);
    rows.slice(0, 5).forEach(function (r, i) {
      var li = document.createElement("li");
      li.className = "stats-region-card__item";
      if (r.adcode) {
        li.setAttribute("data-adcode", r.adcode);
        li.tabIndex = 0;
      }
      var pct = fmtRegionPct(r.value, total);
      li.setAttribute("aria-label", r.name + " " + pct);
      var idx = document.createElement("i");
      idx.textContent = String(i + 1).padStart(2, "0");
      var name = document.createElement("span");
      name.textContent = r.name;
      name.title = r.name;
      var val = document.createElement("strong");
      val.textContent = pct;
      li.appendChild(idx);
      li.appendChild(name);
      li.appendChild(val);
      ol.appendChild(li);
    });
    if (!rows.length) {
      var li = document.createElement("li");
      li.className = "stats-legend__empty";
      li.textContent = "暂无国内地域数据";
      ol.appendChild(li);
    }
  }

  function topWithOther(rows, limit) {
    if (rows.length <= limit) return rows;
    var head = rows.slice(0, limit);
    var rest = rows.slice(limit).reduce(function (a, r) {
      return a + r.value;
    }, 0);
    if (rest > 0) head.push({ label: "其他", value: rest });
    return head;
  }

  function loadDevices() {
    var panel = panelEl("devices");
    if (!panel) return;
    metricsList("device", 10)
      .then(function (rows) {
        rows = rows.map(function (r) {
          return {
            label: DEVICE_LABELS[r.label.toLowerCase()] || r.label,
            value: r.value,
          };
        });
        var top = topWithOther(rows, 5);
        var total = drawDonut(
          panel.querySelector('[data-donut="device"]'),
          top,
        );
        var totalEl = panel.querySelector('[data-donut-total="device"]');
        if (totalEl) totalEl.textContent = fmtNum(total);
        renderLegend(panel.querySelector('[data-legend="device"]'), top, total);
        syncDonutHover(
          panel.querySelector('[data-donut="device"]'),
          panel.querySelector('[data-legend="device"]'),
        );
      })
      .catch(function () {
        noteFailure("devices", "Umami 数据暂时读不到，请稍后再看。");
      });
    metricsList("browser", 8)
      .then(function (rows) {
        var top = topWithOther(rows, 5);
        var total = drawDonut(
          panel.querySelector('[data-donut="browser"]'),
          top,
        );
        renderLegend(
          panel.querySelector('[data-legend="browser"]'),
          top,
          total,
        );
        syncDonutHover(
          panel.querySelector('[data-donut="browser"]'),
          panel.querySelector('[data-legend="browser"]'),
        );
      })
      .catch(function () {});
  }

  function loadRegions() {
    var panel = panelEl("regions");
    if (!panel) return;
    metricsList("region", 100)
      .then(function (rows) {
        // 只保留国内省区（CN-XX），境外不展示；百分比以国内总和为分母
        var counts = {};
        rows.forEach(function (r) {
          var ad = regionAdcode(r.label);
          if (ad) counts[ad] = (counts[ad] || 0) + r.value;
        });
        var cnRows = Object.keys(counts)
          .map(function (ad) {
            return { adcode: ad, name: regionShortName(ad), value: counts[ad] };
          })
          .sort(function (a, b) {
            return b.value - a.value;
          });
        var total = cnRows.reduce(function (a, r) {
          return a + r.value;
        }, 0);
        regionCounts = counts;
        regionDomesticTotal = total;
        paintRegionMap();
        renderRegionRanking(
          panel.querySelector("[data-region-ranking]"),
          cnRows,
          total,
        );
        setRegionStatus(
          panel,
          cnRows.length
            ? "按近 30 天国内访客统计 · 国外暂不展示"
            : "暂未返回国内省区数据 · 国外暂不展示",
        );
      })
      .catch(function () {
        setRegionStatus(panel, "国内地域数据暂不可用 · 国外暂不展示");
        var ol = panel.querySelector("[data-region-ranking]");
        if (ol) {
          while (ol.firstChild) ol.removeChild(ol.firstChild);
          var li = document.createElement("li");
          li.className = "stats-legend__empty";
          li.textContent = "暂时没有可展示的国内地域数据";
          ol.appendChild(li);
        }
      });
  }

  /* 中国地图：省份路径放站内 upload（DataV 行政区划投影生成），
     初始化时 fetch；失败则静默只留排名。填色按国内占比分 5 档，
     与 TOP5 排名 / 标记点按 data-adcode 双向联动高亮。 */
  var regionMapData = null;
  var regionCounts = null;
  var regionDomesticTotal = 0;

  function loadRegionMap() {
    var panel = panelEl("regions");
    if (!panel) return;
    fetchJSON(
      "/upload/stats/china-provinces.json",
      { cache: "force-cache" },
      10000,
    )
      .then(function (data) {
        if (!data || !data.provinces) return;
        regionMapData = data;
        buildRegionMap();
      })
      .catch(function () {});
  }

  function buildRegionMap() {
    var panel = panelEl("regions");
    if (!panel || !regionMapData) return;
    var wrap = panel.querySelector("[data-region-map]");
    if (!wrap || wrap.getAttribute("data-built")) return;
    wrap.setAttribute("data-built", "1");
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", regionMapData.viewBox || "0 0 1000 696");
    svg.setAttribute("aria-hidden", "true");
    Object.keys(regionMapData.provinces).forEach(function (adcode) {
      var prov = regionMapData.provinces[adcode];
      if (!prov || !prov.d) return;
      var path = document.createElementNS(NS, "path");
      path.setAttribute("d", prov.d);
      if (adcode === "100000_JD") {
        // 南海诸岛九段线：只描边、不上色不交互
        path.setAttribute("class", "stats-region-line");
      } else {
        path.setAttribute("class", "stats-region-fill");
        path.setAttribute("data-adcode", adcode);
        path.setAttribute(
          "data-level",
          adcode === "710000" || adcode === "810000" || adcode === "820000"
            ? "base"
            : "none",
        );
        var title = document.createElementNS(NS, "title");
        title.textContent = regionShortName(adcode);
        path.appendChild(title);
      }
      svg.appendChild(path);
    });
    // TOP 5 标记点层（置于所有省份之上，paint 时按形心生成）
    var points = document.createElementNS(NS, "g");
    points.setAttribute("data-region-points", "");
    svg.appendChild(points);
    wrap.appendChild(svg);
    paintRegionMap();
    bindRegionSync(panel);
  }

  function paintRegionMap() {
    var panel = panelEl("regions");
    if (!panel || !regionMapData || !regionCounts) return;
    var max = 0;
    Object.keys(regionCounts).forEach(function (k) {
      if (regionCounts[k] > max) max = regionCounts[k];
    });
    var total = regionDomesticTotal || 0;
    panel.querySelectorAll(".stats-region-fill").forEach(function (path) {
      var ad = path.getAttribute("data-adcode");
      var v = regionCounts[ad] || 0;
      var title = path.querySelector("title");
      if (!v || !max) {
        // 无数据：台/港/澳浅底，其余省份深灰蓝；title 只留短名
        path.setAttribute(
          "data-level",
          ad === "710000" || ad === "810000" || ad === "820000"
            ? "base"
            : "none",
        );
        if (title) title.textContent = regionShortName(ad);
        return;
      }
      // 5 档：round(值/最大值 × 4) → 0..4（与参考同公式）
      var level = Math.min(4, Math.max(0, Math.round((v / max) * 4)));
      path.setAttribute("data-level", String(level));
      if (title)
        title.textContent =
          regionShortName(ad) + " · " + fmtRegionPct(v, total);
    });
    renderRegionPoints(panel, total);
  }

  // TOP 5 标记点：以省份路径包围盒中心为锚点（参考为固定坐标，我方画布不同，
  // 改用自有几何形心），半径随占比，data-adcode 参与面板联动高亮
  function renderRegionPoints(panel, total) {
    var group = panel.querySelector("[data-region-points]");
    if (!group || !regionCounts) return;
    while (group.firstChild) group.removeChild(group.firstChild);
    var NS = "http://www.w3.org/2000/svg";
    var top = Object.keys(regionCounts)
      .map(function (ad) {
        return { adcode: ad, value: regionCounts[ad] };
      })
      .filter(function (r) {
        return r.value > 0;
      })
      .sort(function (a, b) {
        return b.value - a.value;
      })
      .slice(0, 5);
    top.forEach(function (r, i) {
      var path = panel.querySelector(
        '.stats-region-fill[data-adcode="' + r.adcode + '"]',
      );
      if (!path || typeof path.getBBox !== "function") return;
      var box;
      try {
        box = path.getBBox();
      } catch (e) {
        return;
      }
      if (!box || !box.width || !box.height) return;
      var ratio = total ? r.value / total : 0;
      var circle = document.createElementNS(NS, "circle");
      circle.setAttribute("class", "stats-region-point is-rank-" + (i + 1));
      circle.setAttribute("data-adcode", r.adcode);
      circle.setAttribute("cx", String(box.x + box.width / 2));
      circle.setAttribute("cy", String(box.y + box.height / 2));
      circle.setAttribute("r", String(2.4 + Math.min(3.8, ratio * 12)));
      var title = document.createElementNS(NS, "title");
      title.textContent =
        regionShortName(r.adcode) + " " + fmtRegionPct(r.value, total);
      circle.appendChild(title);
      group.appendChild(circle);
    });
  }

  function bindRegionSync(panel) {
    if (panel.getAttribute("data-region-sync")) return;
    panel.setAttribute("data-region-sync", "1");
    function setActive(ad, on) {
      if (!ad) return;
      panel
        .querySelectorAll('[data-adcode="' + ad + '"]')
        .forEach(function (el) {
          if (on) el.setAttribute("data-active", "true");
          else el.removeAttribute("data-active");
        });
    }
    function fromEvent(e) {
      var t =
        e.target && e.target.closest ? e.target.closest("[data-adcode]") : null;
      return t ? t.getAttribute("data-adcode") : null;
    }
    panel.addEventListener("mouseover", function (e) {
      setActive(fromEvent(e), true);
    });
    panel.addEventListener("mouseout", function (e) {
      setActive(fromEvent(e), false);
    });
    panel.addEventListener("focusin", function (e) {
      setActive(fromEvent(e), true);
    });
    panel.addEventListener("focusout", function (e) {
      setActive(fromEvent(e), false);
    });
  }

  function loadSources() {
    var panel = panelEl("sources");
    if (!panel) return;
    function apply(rows, labelMap) {
      var mapped = rows.map(function (r) {
        return {
          label: labelMap
            ? labelMap[r.label.toLowerCase()] || r.label
            : r.label,
          value: r.value,
        };
      });
      var top = topWithOther(mapped, 5);
      var total = drawDonut(panel.querySelector('[data-donut="source"]'), top);
      var totalEl = panel.querySelector('[data-donut-total="source"]');
      if (totalEl) totalEl.textContent = fmtNum(total);
      renderLegend(panel.querySelector('[data-legend="source"]'), top, total);
      syncDonutHover(
        panel.querySelector('[data-donut="source"]'),
        panel.querySelector('[data-legend="source"]'),
      );
    }
    metricsList("channel", 10)
      .then(function (rows) {
        if (rows.length) apply(rows, CHANNEL_LABELS);
        else
          return metricsList("referrer", 10).then(function (r2) {
            apply(r2, null);
          });
      })
      .catch(function () {
        return metricsList("referrer", 10)
          .then(function (r2) {
            apply(r2, null);
          })
          .catch(function () {
            noteFailure("sources", "Umami 数据暂时读不到，请稍后再看。");
          });
      });
  }

  /* ---------------- 8. 最近评论（与侧边栏同源） ---------------- */

  var COMMENTS_LATEST_API =
    "/apis/api.recent-comments.halo.run/v1alpha1/comments/latest?size=8";
  var COMMENTS_POSTS_API =
    "/apis/api.content.halo.run/v1alpha1/posts?size=20&sort=metadata.creationTimestamp,desc";

  function toPlain(text) {
    if (!text) return "";
    return text
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`]*`/g, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^#+\s*/gm, "")
      .replace(/[*_~>`|]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // 正文渲染：DOMParser 白名单（只放行文本与 http(s) 贴纸图），无 innerHTML 注入面
  var BODY_TEXT_LIMIT = 90;
  function renderBody(el, html) {
    if (!html) {
      el.textContent = "（无内容）";
      return;
    }
    var doc = new DOMParser().parseFromString(html, "text/html");
    var budget = BODY_TEXT_LIMIT;
    var cut = false;
    function lastIsSpace() {
      var last = el.lastChild;
      return !!last && last.nodeType === 3 && /\s$/.test(last.nodeValue || "");
    }
    function appendText(rawText) {
      if (cut) return;
      var t = toPlain(rawText);
      if (!t) return;
      if (budget <= 0) {
        cut = true;
        return;
      }
      if (el.lastChild && !lastIsSpace()) t = " " + t;
      if (t.length > budget) {
        t = t.slice(0, budget) + "…";
        budget = 0;
        cut = true;
      } else {
        budget -= t.length;
      }
      el.appendChild(document.createTextNode(t));
    }
    function appendSticker(src, alt) {
      if (cut) return;
      var img = document.createElement("img");
      img.loading = "lazy";
      img.alt = alt || "表情";
      img.src = src;
      img.style.display = "inline-block";
      img.style.height = "1.5em";
      img.style.width = "auto";
      img.style.maxWidth = "1.5em";
      img.style.objectFit = "contain";
      img.style.verticalAlign = "-0.35em";
      img.style.margin = "0 1px";
      img.onerror = function () {
        if (img.parentNode) img.parentNode.removeChild(img);
      };
      el.appendChild(img);
      el.appendChild(document.createTextNode(" "));
    }
    function walk(node) {
      if (cut) return;
      if (node.nodeType === 3) {
        appendText(node.nodeValue);
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = node.tagName.toLowerCase();
      if (
        tag === "script" ||
        tag === "style" ||
        tag === "iframe" ||
        tag === "object" ||
        tag === "embed" ||
        tag === "link" ||
        tag === "meta"
      )
        return;
      if (tag === "img") {
        var src = node.getAttribute("src") || "";
        if (/^https?:\/\//i.test(src))
          appendSticker(src, node.getAttribute("alt") || "");
        return;
      }
      if (tag === "br") {
        if (el.lastChild && !lastIsSpace())
          el.appendChild(document.createTextNode(" "));
        return;
      }
      var child = node.firstChild;
      while (child) {
        var next = child.nextSibling;
        walk(child);
        child = next;
      }
    }
    walk(doc.body);
    var bodyText = (el.textContent || "").replace(/\s/g, "");
    if (!bodyText && !el.querySelector("img")) el.textContent = "（无内容）";
  }

  function resolveAvatar(owner, spec) {
    if (owner && owner.avatar) return owner.avatar;
    var anno =
      (owner && owner.annotations) ||
      (spec && spec.owner && spec.owner.annotations) ||
      {};
    var hash = anno["email-hash"];
    if (hash) {
      return (
        "https://weavatar.com/avatar/" +
        encodeURIComponent(hash) +
        "?d=mp&f=webp&s=64"
      );
    }
    return "";
  }

  function renderComments(comments, statusNote) {
    var panel = panelEl("comments");
    if (!panel) return;
    var list = panel.querySelector("[data-comments-list]");
    if (!list) return;
    var status = panel.querySelector("[data-comments-status]");
    if (status) {
      status.textContent =
        statusNote != null
          ? statusNote
          : comments.length
            ? ""
            : "暂时还没有评论，来坐第一排。";
    }
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!comments.length) return;
    var palette = [
      "#ef4444",
      "#f59e0b",
      "#10b981",
      "#3b82f6",
      "#8b5cf6",
      "#ec4899",
      "#14b8a6",
      "#f97316",
    ];
    comments.forEach(function (c) {
      var owner = c.owner || {};
      var spec = c.spec || {};
      var name = owner.displayName || "匿名";
      var avatar = resolveAvatar(owner, spec);

      var li = document.createElement("li");
      var link = document.createElement("a");
      link.className = "stats-comment";
      var permalink = c.__permalink || null;
      var cname = c.metadata && c.metadata.name;
      link.href = permalink
        ? permalink +
          (cname
            ? "#comment-next-comment-" + encodeURIComponent(cname)
            : "#comment")
        : "#";
      if (!permalink) {
        link.addEventListener("click", function (e) {
          e.preventDefault();
        });
      }

      var initial = (name || "?").trim().charAt(0).toUpperCase();
      var seed = 0;
      for (var i = 0; i < (name || "").length; i++) seed += name.charCodeAt(i);
      var color = palette[seed % palette.length];
      if (avatar) {
        var img = document.createElement("img");
        img.className = "stats-comment__avatar";
        img.loading = "lazy";
        img.alt = name;
        img.src = avatar;
        img.onerror = function () {
          if (img.parentNode)
            img.parentNode.replaceChild(makeInitial(initial, color), img);
        };
        link.appendChild(img);
      } else {
        link.appendChild(makeInitial(initial, color));
      }

      var body = document.createElement("span");
      body.className = "stats-comment__body";
      var meta = document.createElement("span");
      meta.className = "stats-comment__topline";
      var nm = document.createElement("b");
      nm.className = "stats-comment__name";
      nm.textContent = name;
      var tm = document.createElement("i");
      tm.className = "stats-comment__time";
      tm.textContent = fmtRelative(
        spec.creationTime || (c.metadata && c.metadata.creationTimestamp),
      );
      meta.appendChild(nm);
      meta.appendChild(tm);
      body.appendChild(meta);
      var postTitle = c.__postTitle || "";
      if (postTitle) {
        var post = document.createElement("span");
        post.className = "stats-comment__post";
        post.textContent = "评论于《" + postTitle + "》";
        post.title = postTitle;
        body.appendChild(post);
      }
      var text = document.createElement("p");
      text.className = "stats-comment__text";
      renderBody(text, spec.content || spec.raw || "");
      body.appendChild(text);
      link.appendChild(body);
      li.appendChild(link);
      list.appendChild(li);
    });
  }

  function makeInitial(initial, color) {
    var d = document.createElement("span");
    d.className = "stats-comment__avatar stats-comment__avatar--initial";
    d.style.backgroundColor = color;
    d.textContent = initial;
    return d;
  }

  function adaptItem(it) {
    return {
      metadata: { name: it.name },
      owner: {
        displayName: it.displayName,
        avatar: it.avatar,
        annotations: it.emailHash ? { "email-hash": it.emailHash } : {},
      },
      spec: {
        raw: it.content,
        content: it.content,
        creationTime: it.creationTime,
        subjectRef: it.subjectRef,
      },
      __permalink: it.permalink,
      __postTitle:
        it.postTitle ||
        it.subjectTitle ||
        (it.subjectRef && it.subjectRef.title) ||
        "",
    };
  }

  function loadComments() {
    if (!panelEl("comments")) return;
    fetchJSON(COMMENTS_LATEST_API, {}, 8000)
      .then(function (data) {
        renderComments(((data && data.items) || []).map(adaptItem));
      })
      .catch(function () {
        loadCommentsLegacy();
      });
  }

  // 聚合端点不可用时的兜底：最近文章 → 逐篇查评论 → 合并取最新 8 条（同侧边栏）
  function loadCommentsLegacy() {
    fetchJSON(COMMENTS_POSTS_API, {}, 8000)
      .then(function (data) {
        var posts = (data && data.items) || [];
        var permalinkMap = {};
        var titleMap = {};
        posts.forEach(function (p) {
          var nm = p.metadata && p.metadata.name;
          if (!nm) return;
          var perm =
            (p.status && p.status.permalink) ||
            (p.spec && p.spec.slug ? "/" + p.spec.slug : null);
          if (perm) permalinkMap[nm] = perm;
          if (p.spec && p.spec.title) titleMap[nm] = p.spec.title;
        });
        var withComments = posts.filter(function (p) {
          return (p.stats && p.stats.comment) > 0;
        });
        if (!withComments.length) {
          renderComments([]);
          return null;
        }
        return Promise.all(
          withComments.map(function (p) {
            var nm = p.metadata && p.metadata.name;
            var url =
              "/apis/api.halo.run/v1alpha1/comments?group=content.halo.run&kind=Post&name=" +
              encodeURIComponent(nm) +
              "&size=10";
            return fetchJSON(url, {}, 6000)
              .then(function (d) {
                return (d.items || []).filter(function (c) {
                  var s = c.spec || {};
                  return s.approved !== false && s.hidden !== true;
                });
              })
              .catch(function () {
                return [];
              });
          }),
        ).then(function (lists) {
          if (!lists) return;
          var all = lists.reduce(function (a, b) {
            return a.concat(b);
          }, []);
          all.sort(function (a, b) {
            var ta = new Date((a.spec && a.spec.creationTime) || 0).getTime();
            var tb = new Date((b.spec && b.spec.creationTime) || 0).getTime();
            return tb - ta;
          });
          var top = all.slice(0, 8);
          top.forEach(function (c) {
            var sr = c.spec && c.spec.subjectRef;
            c.__permalink = (sr && sr.name && permalinkMap[sr.name]) || null;
            c.__postTitle = (sr && sr.name && titleMap[sr.name]) || "";
          });
          renderComments(top);
        });
      })
      .catch(function () {
        renderComments([], "评论暂时读不到，请稍后再看。");
      });
  }

  /* Swup 换页清理：贪吃蛇的 document 级 visibilitychange 监听与
     IntersectionObserver 在离开本页时一次性拆除，否则每次进看板都会
     叠加一份历代闭包（先例：extend-pages.ts / post.astro 的
     astro:before-swap 一次性清理）。回来时是新 DOM、脚本重执行，
     initSnake 会重新注册，不受影响。 */
  document.addEventListener(
    "astro:before-swap",
    function () {
      stopSnake();
      if (snakeObserver) {
        snakeObserver.disconnect();
        snakeObserver = null;
      }
      document.removeEventListener("visibilitychange", scheduleSnake);
    },
    { once: true },
  );

  /* ---------------- 启动 ---------------- */

  bindPulseRange();
  bindPulseHover();
  loadPush();
  loadComments();
  if (!shareId) {
    setHeroStatus("offline", "未配置", "在主题设置中填入 Umami 分享链接后显示");
  } else {
    umamiInit().then(function (ok) {
      if (!ok) {
        setHeroStatus("offline", "暂时无法连接", "公开分享数据 · 连接失败");
        [
          "summary",
          "pulse",
          "activity",
          "devices",
          "regions",
          "sources",
        ].forEach(function (name) {
          noteFailure(
            name,
            "Umami 数据暂时读不到（分享链接可能已失效），请稍后再看。",
          );
        });
        return;
      }
      var nowD = new Date();
      setHeroStatus(
        "online",
        "实时公开数据",
        "更新于 " +
          String(nowD.getHours()).padStart(2, "0") +
          ":" +
          String(nowD.getMinutes()).padStart(2, "0"),
      );
      loadSummary();
      loadPulse(30);
      loadRanking();
      loadActivity();
      loadDevices();
      loadRegions();
      loadRegionMap();
      loadSources();
    });
  }
})();

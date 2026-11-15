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

  function fmtNum(n) {
    n = Number(n) || 0;
    try {
      if (typeof window.__etherealBigNum === "function") {
        return window.__etherealBigNum(n);
      }
    } catch (e) {}
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
    return fetchJSON(
      umamiBase +
        "/api/websites/" +
        encodeURIComponent(umami.websiteId) +
        "/" +
        path,
      { headers: { "x-umami-share-token": umami.token } },
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

  /* ---------------- 1. 顶部统计卡 ---------------- */

  function loadSummary() {
    if (!panelEl("summary")) return;
    var now = Date.now();
    var dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    var today = "startAt=" + dayStart.getTime() + "&endAt=" + now;
    var all = "startAt=0&endAt=" + now;
    Promise.all([umamiGet("stats?" + today), umamiGet("stats?" + all)])
      .then(function (rs) {
        setStat("todayVisitors", statVal(rs[0], "visitors"));
        setStat("todayPageviews", statVal(rs[0], "pageviews"));
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

    var NS = "http://www.w3.org/2000/svg";
    var g = panel.querySelector("[data-chart-points]");
    while (g.firstChild) g.removeChild(g.firstChild);
    viewsPts.forEach(function (p) {
      var c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", p.x);
      c.setAttribute("cy", p.y);
      c.setAttribute("r", "3");
      c.setAttribute("class", "stats-chart-point");
      g.appendChild(c);
    });

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

  function bindPulseRange() {
    var panel = panelEl("pulse");
    if (!panel) return;
    var btns = panel.querySelectorAll("[data-range]");
    btns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        btns.forEach(function (b) {
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        loadPulse(Number(btn.getAttribute("data-range")) || 30);
      });
    });
  }

  /* ---------------- 3. 推送节奏（GitHub 公开 API） ---------------- */

  var GH_CACHE_KEY = "ethereal-stats-github";
  var GH_CACHE_TTL = 10 * 60 * 1000;

  function loadPush() {
    var panel = panelEl("push");
    if (!panel) return;
    if (!githubRepo || githubRepo.indexOf("/") < 0) {
      showPushEmpty();
      return;
    }
    readGhCache()
      .then(function (cached) {
        if (cached) return cached;
        return fetchGhCommits().then(function (data) {
          try {
            sessionStorage.setItem(
              GH_CACHE_KEY,
              JSON.stringify({ ts: Date.now(), repo: githubRepo, data: data }),
            );
          } catch (e) {}
          return data;
        });
      })
      .then(renderPush)
      .catch(function () {
        showPushEmpty();
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

  // 近 15 周窗口：从 15 周前的周一开始，逐页拉 commits（至多 3 页 × 100）
  function fetchGhCommits() {
    var start = ghWindowStart();
    var sinceISO = start.toISOString();
    var byDay = {};
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
        list.forEach(function (c) {
          var date = c && c.commit && (c.commit.committer || c.commit.author);
          var t = date && (date.date || null);
          if (!t) return;
          var k = dayKey(new Date(t).getTime());
          byDay[k] = (byDay[k] || 0) + 1;
        });
        if (list.length === 100 && page < 3) return pull(page + 1);
        return byDay;
      });
    }
    return pull(1).then(function (map) {
      return { byDay: map, startISO: dayKey(start.getTime()) };
    });
  }

  function ghWindowStart() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    var monday = new Date(d.getTime() - ((d.getDay() + 6) % 7) * DAY_MS);
    return new Date(monday.getTime() - 14 * 7 * DAY_MS);
  }

  function renderPush(data) {
    var panel = panelEl("push");
    if (!panel || !data) return;
    var byDay = data.byDay || {};
    var start = ghWindowStart();
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var max = 0;
    var activeDays = 0;
    var total30 = 0;
    var latestTs = 0;
    Object.keys(byDay).forEach(function (k) {
      var v = byDay[k];
      if (v > max) max = v;
      if (v > 0) {
        activeDays++;
        var t = new Date(k + "T00:00:00").getTime();
        if (t > latestTs) latestTs = t;
        if (today.getTime() - t < 30 * DAY_MS) total30 += v;
      }
    });

    var grid = panel.querySelector("[data-push-grid]");
    if (grid) {
      while (grid.firstChild) grid.removeChild(grid.firstChild);
      for (var w = 0; w < 15; w++) {
        for (var wd = 0; wd < 7; wd++) {
          var day = new Date(start.getTime() + (w * 7 + wd) * DAY_MS);
          var cell = document.createElement("span");
          var future = day.getTime() > today.getTime();
          var count = future ? 0 : byDay[dayKey(day.getTime())] || 0;
          var level =
            count === 0 ? 0 : Math.min(4, Math.ceil((count / (max || 1)) * 4));
          cell.className =
            "stats-heat-cell" + (future ? " stats-heat-cell--future" : "");
          cell.setAttribute("data-level", String(level));
          if (!future) {
            cell.title = dayKey(day.getTime()) + " · " + count + " 次提交";
          }
          grid.appendChild(cell);
        }
      }
    }

    var latestEl = panel.querySelector("[data-push-latest]");
    if (latestEl) {
      latestEl.textContent = latestTs
        ? fmtRelative(new Date(latestTs).toISOString())
        : "—";
    }
    var c30 = panel.querySelector("[data-push-30d]");
    if (c30) c30.textContent = fmtNum(total30);
    var act = panel.querySelector("[data-push-active]");
    if (act) act.textContent = fmtNum(activeDays) + " 天";
    var status = panel.querySelector("[data-push-status]");
    if (status) status.textContent = "数据来自 GitHub";
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
      })
      .catch(function () {
        noteFailure("activity", "Umami 数据暂时读不到，请稍后再看。");
      });
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
      c.setAttribute("class", "stats-donut-seg stats-seg-" + ((i % 6) + 1));
      c.setAttribute("stroke-dasharray", Math.max(0, frac * C - 1.5) + " " + C);
      c.setAttribute("stroke-dashoffset", String(-offset * C));
      c.setAttribute("transform", "rotate(-90 50 50)");
      svg.appendChild(c);
      offset += frac;
    });
    return total;
  }

  function renderLegend(ul, rows, total) {
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    rows.forEach(function (r, i) {
      var li = document.createElement("li");
      var dot = document.createElement("i");
      dot.className = "stats-dot stats-seg-bg-" + ((i % 6) + 1);
      var name = document.createElement("span");
      name.className = "stats-legend__name";
      name.textContent = r.label;
      var val = document.createElement("b");
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

  function renderBars(ul, rows, total) {
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    var max = rows.reduce(function (a, r) {
      return Math.max(a, r.value);
    }, 0);
    rows.forEach(function (r) {
      var li = document.createElement("li");
      var name = document.createElement("span");
      name.className = "stats-bars__name";
      name.textContent = r.label;
      name.title = r.label;
      var track = document.createElement("span");
      track.className = "stats-bars__track";
      var fill = document.createElement("i");
      fill.className = "stats-bars__fill";
      fill.style.width = max ? Math.max(2, (r.value / max) * 100) + "%" : "0%";
      track.appendChild(fill);
      var val = document.createElement("b");
      var pct = total ? Math.round((r.value / total) * 100) : 0;
      val.textContent = fmtNum(r.value) + " · " + pct + "%";
      li.appendChild(name);
      li.appendChild(track);
      li.appendChild(val);
      ul.appendChild(li);
    });
    if (!rows.length) {
      var li = document.createElement("li");
      li.className = "stats-bars__empty";
      li.textContent = "暂无数据";
      ul.appendChild(li);
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
      })
      .catch(function () {
        noteFailure("devices", "Umami 数据暂时读不到，请稍后再看。");
      });
    metricsList("browser", 8)
      .then(function (rows) {
        var total = rows.reduce(function (a, r) {
          return a + r.value;
        }, 0);
        renderBars(
          panel.querySelector('[data-bars="browser"]'),
          rows.slice(0, 6),
          total,
        );
      })
      .catch(function () {});
  }

  function loadRegions() {
    var panel = panelEl("regions");
    if (!panel) return;
    metricsList("region", 30)
      .then(function (rows) {
        var total = rows.reduce(function (a, r) {
          return a + r.value;
        }, 0);
        renderBars(
          panel.querySelector("[data-region-list]"),
          rows.slice(0, 8),
          total,
        );
      })
      .catch(function () {
        noteFailure("regions", "Umami 数据暂时读不到，请稍后再看。");
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

  function renderComments(comments) {
    var panel = panelEl("comments");
    if (!panel) return;
    var list = panel.querySelector("[data-comments-list]");
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!comments.length) {
      var empty = document.createElement("li");
      empty.className = "stats-comments__empty";
      empty.textContent = "暂无评论";
      list.appendChild(empty);
      return;
    }
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
      li.className = "stats-comment";
      var link = document.createElement("a");
      link.className = "stats-comment__link";
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
      meta.className = "stats-comment__meta";
      var nm = document.createElement("b");
      nm.textContent = name;
      var tm = document.createElement("i");
      tm.textContent = fmtRelative(
        spec.creationTime || (c.metadata && c.metadata.creationTimestamp),
      );
      meta.appendChild(nm);
      meta.appendChild(tm);
      var text = document.createElement("span");
      text.className = "stats-comment__text";
      renderBody(text, spec.content || spec.raw || "");
      body.appendChild(meta);
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
        posts.forEach(function (p) {
          var nm = p.metadata && p.metadata.name;
          if (!nm) return;
          var perm =
            (p.status && p.status.permalink) ||
            (p.spec && p.spec.slug ? "/" + p.spec.slug : null);
          if (perm) permalinkMap[nm] = perm;
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
          });
          renderComments(top);
        });
      })
      .catch(function () {
        renderComments([]);
      });
  }

  /* ---------------- 启动 ---------------- */

  bindPulseRange();
  bindPulseHover();
  loadPush();
  loadComments();
  if (shareId) {
    umamiInit().then(function (ok) {
      if (!ok) {
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
      loadSummary();
      loadPulse(30);
      loadActivity();
      loadDevices();
      loadRegions();
      loadSources();
    });
  }
})();

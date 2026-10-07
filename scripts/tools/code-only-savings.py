# -*- coding: utf-8 -*-
"""代码侧减重机会盘点（不动图片）。
用法： python code-only-savings.py <zip>
"""
import re
import sys
import zipfile
import hashlib
from collections import Counter

z = zipfile.ZipFile(sys.argv[1])
pages = [
    n for n in z.namelist()
    if n.startswith("templates/") and n.endswith(".html") and "/" not in n[len("templates/"):]
]
pages = [p for p in pages if p not in ("templates/layout.html", "templates/schedule-calendar-card.html")]
data = {p: z.read(p).decode("utf-8", "ignore") for p in pages}
N = len(pages)

print("=" * 78)
print("A) 内联 SVG：是否跨页重复 ⇒ 可抽成外部 sprite")
print("=" * 78)
occ = Counter()
per = {}
for p, d in data.items():
    lst = []
    for m in re.finditer(r"<svg\b.*?</svg>", d, re.S):
        s = m.group(0)
        lst.append((hashlib.md5(s.encode()).hexdigest()[:12], len(s)))
    per[p] = lst
    for h, _ in set(lst):
        occ[h] += 1
ref = "templates/index.html"
tot = sum(sz for _, sz in per[ref])
shell = sum(sz for h, sz in per[ref] if occ[h] >= N * 0.9)
uniq_h = {}
for h, sz in per[ref]:
    if occ[h] >= N * 0.9:
        uniq_h[h] = sz
print("index.html 内联 SVG 共 %d 段 / %d B；其中跨页相同 %d B" % (len(per[ref]), tot, shell))
print("跨页相同部分去重后（= 抽 sprite 只需保留的） %d B" % sum(uniq_h.values()))
print("=> 若全部抽成 1 个外部 sprite：全包可减 %d B (%.2f MB)"
      % (sum(uniq_h.values()) * N - sum(uniq_h.values()),
         (sum(uniq_h.values()) * N - sum(uniq_h.values())) / 1048576))

print()
print("=" * 78)
print("B) 各页 <svg> 段数与体量（看是否每页一样）")
print("=" * 78)
for p in pages[:8]:
    lst = per[p]
    print("  %-42s n=%3d  %6d B" % (p.replace("templates/", ""), len(lst), sum(s for _, s in lst)))

print()
print("=" * 78)
print("C) CSS 构成（压缩后 / 未压缩）")
print("=" * 78)
rows = []
for i in z.infolist():
    if i.filename.endswith(".css"):
        rows.append((i.file_size, i.compress_size, i.filename))
rows.sort(reverse=True)
for u, c, f in rows:
    print("  raw %8d  zip %7d  %s" % (u, c, f.replace("templates/", "")))
print("  CSS 合计 raw %d / zip %d" % (sum(r[0] for r in rows), sum(r[1] for r in rows)))

print()
print("=" * 78)
print("D) 侧栏小组件：可回收字节（抽 WidgetSwitch 后）")
print("=" * 78)
d = data[ref]
blocks = [m.group(0) for m in re.finditer(r"<widget-layout\b.*?</widget-layout>", d, re.S)]
print("widget-layout 块 %d 个 / 合计 %d B" % (len(blocks), sum(map(len, blocks))))
sizes = sorted((len(b) for b in blocks), reverse=True)
print("  最大 6 块:", sizes[:6])
print("  最小 6 块:", sizes[-6:])
print("  th:case 数 =", d.count("th:case="), " th:switch 数 =", d.count("th:switch="))
# 内置侧栏兜底块（默认小组件）
print()
print("=" * 78)
print("E) 内联脚本的 <script> 标签开销")
print("=" * 78)
tags = [m.group(0) for m in re.finditer(r"<script\b[^>]*>", d)]
print("script 开标签 %d 个，合计 %d B" % (len(tags), sum(map(len, tags))))

# -*- coding: utf-8 -*-
"""内联脚本外置可行性量化：按「是否跨页逐字节相同」把每页内联脚本分类。
只读。用法： python inline-script-audit.py <zip>
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
# 排除非整页模板
pages = [p for p in pages if p not in ("templates/layout.html", "templates/schedule-calendar-card.html")]
data = {p: z.read(p).decode("utf-8", "ignore") for p in pages}

SCRIPT_RE = re.compile(r"<script\b[^>]*>(.*?)</script>", re.S)

# 统计每个脚本体在多少页出现
per_page = {}
for p, d in data.items():
    bodies = []
    for m in SCRIPT_RE.finditer(d):
        tag = m.group(0)
        if re.search(r"<script[^>]*\ssrc=", tag):
            continue
        b = m.group(1).strip()
        if len(b) < 200:
            continue
        bodies.append((hashlib.md5(b.encode()).hexdigest()[:12], len(b), b, m.start()))
    per_page[p] = bodies

occ = Counter()
for p, bs in per_page.items():
    for h, sz, b, pos in bs:
        occ[h] += 1

# 代表性页面
ref = "templates/index.html"
tot_all = tot_shell = tot_uniq_shell = 0
shell_scripts = Counter()  # hash -> (size, count_in_page)
detail = []
for h, sz, b, pos in per_page[ref]:
    n = occ[h]
    tot_all += sz
    if n >= len(pages) * 0.9:
        tot_shell += sz
        head = re.sub(r"\s+", " ", b)[:80]
        # 是否含 Thymeleaf 语法 ⇒ 不能外置
        th = bool(re.search(r"th:|\[\[|\$\{", b))
        detail.append((sz, n, th, head, h))

print("样本页: %s   共 %d 页" % (ref, len(pages)))
print("该页内联脚本（>=200B）合计: %d B" % tot_all)
print("其中「在 >=90%% 页面逐字节相同」的（= 外壳脚本）: %d B" % tot_shell)
print()
print("%8s %5s %6s  %s" % ("bytes", "pages", "可外置", "脚本开头"))
for sz, n, th, head, h in sorted(detail, reverse=True):
    print("%8d %5d %6s  %s" % (sz, n, "否" if th else "是", head))
print()
uniq = {}
for sz, n, th, head, h in detail:
    uniq[h] = (sz, th, head)
ok = sum(sz for sz, th, head in uniq.values() if not th)
bad = sum(sz for sz, th, head in uniq.values() if th)
print("外壳脚本去重后: 可外置 %d B / 含 Thymeleaf 不可外置 %d B" % (ok, bad))
print()
print("=> 若把可外置部分收拢成 1 个共享外壳 JS：")
print("   全包可减 %d B（%.2f MB）= %d B x %d 页 - 1 份" % (ok * len(pages) - ok, (ok * len(pages) - ok) / 1048576, ok, len(pages)))

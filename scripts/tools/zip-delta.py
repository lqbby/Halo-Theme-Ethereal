# -*- coding: utf-8 -*-
"""按「改动后重新压缩」估算 zip 收益（不动图片）。
用法： python zip-delta.py <zip>
"""
import re
import sys
import zlib
import zipfile

z = zipfile.ZipFile(sys.argv[1])
pages = [
    n for n in z.namelist()
    if n.startswith("templates/") and n.endswith(".html") and "/" not in n[len("templates/"):]
]
data = {p: z.read(p).decode("utf-8", "ignore") for p in pages}

SCRIPT = re.compile(r"(<script\b(?![^>]*\ssrc=)[^>]*>)(.*?)(</script>)", re.S)


def csize(s):
    """用 zip 默认 deflate(level 9) 估算该文本单独压缩后的大小"""
    return len(zlib.compress(s.encode("utf-8"), 9))


def strip_inline_scripts(d, keep_pred):
    """删掉 keep_pred(body) 为 False 的内联脚本体（保留标签）"""
    out = []
    last = 0
    for m in SCRIPT.finditer(d):
        body = m.group(2)
        if keep_pred(body):
            continue
        out.append(d[last:m.start()])
        out.append(m.group(1) + m.group(3))
        last = m.end()
    out.append(d[last:])
    return "".join(out)


def strip_svgs(d):
    return re.sub(r"<svg\b.*?</svg>", "", d, flags=re.S)


base_c = sum(csize(d) for d in data.values())
print("页面 HTML 压缩后合计（原始）: %d B" % base_c)

# 1) 全部内联脚本外置（含 Thymeleaf 的那批除外——保留）
TH = ("th:", "[[", "${")
th_bodies = 0


def removable(body):
    return not any(t in body for t in TH)


after = {}
th_kept = 0
for p, d in data.items():
    a = strip_inline_scripts(d, keep_pred=lambda b: not removable(b))
    after[p] = a
    for m in SCRIPT.finditer(d):
        if any(t in m.group(2) for t in TH):
            th_kept += len(m.group(2))
c1 = sum(csize(v) for v in after.values())
print()
print("1) 可外置的内联脚本全部外置（含 Thymeleaf 的保留在 HTML）")
print("   页面 HTML 压缩后: %d → %d  (省 %d B)" % (base_c, c1, base_c - c1))
print("   保留在 HTML 的含-th 脚本原始体量(每页口径已含重复): %d B" % th_kept)

# 2) 内联 SVG 全抽走
c2 = sum(csize(strip_svgs(v)) for v in after.values())
print()
print("2) 在 1) 基础上再把内联 SVG 抽成外部 sprite")
print("   页面 HTML 压缩后: %d → %d  (再省 %d B)" % (c1, c2, c1 - c2))

# 3) 只做 i18n 去重（每页 3 份 → 1 份）
I18N_MARK = "客户端 i18n：复用 Layout.astro 注入的全局助手"
seen = {p: 0 for p in data}
c3_total = 0
for p, d in data.items():
    cnt = [0]

    def keep(body):
        if I18N_MARK in body:
            cnt[0] += 1
            return cnt[0] <= 1
        return True

    a = strip_inline_scripts(d, keep_pred=keep)
    c3_total += csize(a)
print()
print("3) 只做「内联 i18n 助手」去重（每页 3 份 → 1 份）")
print("   页面 HTML 压缩后: %d → %d  (省 %d B)" % (base_c, c3_total, base_c - c3_total))

print()
print("=== 汇总（仅页面 HTML 部分，不含 CSS/JS 文件自身）===")
print("  步骤 1 省 %d B；步骤 1+2 省 %d B；步骤 3 省 %d B" % (base_c - c1, base_c - c2, base_c - c3_total))

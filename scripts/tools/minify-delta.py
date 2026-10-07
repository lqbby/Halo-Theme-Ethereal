# -*- coding: utf-8 -*-
"""估算「构建期压缩页内联脚本」的 zip 收益（不做外置、不改语义、源码零改动）。
用法： python minify-delta.py <zip>
"""
import sys
import zlib
import zipfile

z = zipfile.ZipFile(sys.argv[1])
pages = [
    n for n in z.namelist()
    if n.startswith("templates/") and n.endswith(".html") and "/" not in n[len("templates/"):]
]
data = {p: z.read(p).decode("utf-8", "ignore") for p in pages}

SCRIPT = __import__("re").compile(r"(<script\b(?![^>]*\ssrc=)[^>]*>)(.*?)(</script>)", __import__("re").S)


def strip_js(src):
    """粗粒度去注释（保留字符串/模板串语义）+ 折叠空白。仅用于估算。"""
    out = []
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c in "\"'`":
            q = c
            out.append(c)
            i += 1
            while i < n:
                ch = src[i]
                out.append(ch)
                if ch == "\\":
                    if i + 1 < n:
                        out.append(src[i + 1])
                        i += 2
                        continue
                if ch == q:
                    i += 1
                    break
                i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            i += 2
            while i + 1 < n and not (src[i] == "*" and src[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(c)
        i += 1
    s = "".join(out)
    # 折叠空白：多个空白/换行 → 单个空格（保守，不删空格）
    import re as _re
    s = _re.sub(r"[ \t]*\n[ \t]*", " ", s)
    s = _re.sub(r" {2,}", " ", s)
    return s


def csize(s):
    return len(zlib.compress(s.encode("utf-8"), 9))


total_before = total_after = 0
raw_before = raw_after = 0
th_before = th_after = 0
skipped_pages = 0
import re

for p, d in data.items():
    def repl(m):
        global raw_before, raw_after, th_before, th_after
        body = m.group(2)
        if len(body) < 200:
            return m.group(0)
        # 🔴 含 Thymeleaf natural-template 标记的**绝不能压缩**（压缩器会把 /*[[...]]*/ 当注释删掉）
        if "[[" in body or "]]" in body:
            th_before += len(body)
            th_after += len(body)
            return m.group(0)
        new = strip_js(body)
        raw_before += len(body)
        raw_after += len(new)
        return m.group(1) + new + m.group(3)

    nd = SCRIPT.sub(repl, d)
    total_before += csize(d)
    total_after += csize(nd)

print("页面 HTML 压缩后合计：%d → %d   （省 %d B）" % (total_before, total_after, total_before - total_after))
print()
print("可压缩的内联脚本体 原始 %d B → 压缩后 %d B  （去注释+折空白，省 %.1f%%）"
      % (raw_before, raw_after, 100 * (raw_before - raw_after) / max(1, raw_before)))
print("跳过的含 Thymeleaf 标记的脚本体：%d B（保持原样）" % th_before)
print()
print("=> 预期 zip 净减 ≈ %d B" % (total_before - total_after))
print("（注：这是「去注释 + 折叠空白」的保守估算；换 esbuild 真压缩器通常还能再省 5~12%）")

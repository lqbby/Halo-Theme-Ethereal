# -*- coding: utf-8 -*-
"""未引用 CSS 类审计（修正版）：
用法来源 = src/**/*.{astro,svelte,ts,js}（排除 styles 自身）+ scripts/**/*.mjs + templates/*.html
定义来源 = src/styles/*.css
只读。
"""
import os
import re
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
os.chdir(ROOT)

SKIP = {"node_modules", ".git", "dist", ".astro"}


def collect(root, exts, skip=SKIP):
    out = []
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in skip]
        for f in fn:
            if os.path.splitext(f)[1] in exts:
                out.append(os.path.join(dp, f).replace(os.sep, "/"))
    return sorted(out)


def read(p):
    try:
        return open(p, encoding="utf-8", errors="ignore").read()
    except OSError:
        return ""


# ---- 用法来源：源码（无 CSS）+ 产物 HTML ----
use_files = []
use_files += collect("src", {".astro", ".svelte", ".ts", ".js"})
use_files += collect("scripts", {".mjs", ".js", ".ts"})
use_files += collect("templates", {".html"})
usage = "\n".join(read(f) for f in use_files)

# ---- 定义来源：src/styles/*.css ----
rules = []  # (class, file, text)
for f in collect("src/styles", {".css"}):
    css = read(f)
    # 按规则切：选择器{...}，丢掉注释
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
        sel, body = m.group(1), m.group(2)
        for cm in re.finditer(r"\.([a-zA-Z_][\w-]*)", sel):
            rules.append((cm.group(1), os.path.basename(f), m.group(0)))

byclass = {}
for cls, f, txt in rules:
    byclass.setdefault(cls, []).append((f, txt))

print("src/styles 中出现的类总数: %d" % len(byclass))
dead = []
for cls in sorted(byclass):
    if re.search(r"(?<![A-Za-z0-9_-])" + re.escape(cls) + r"(?![A-Za-z0-9_-])", usage):
        continue
    tot = sum(len(t) + 1 for _, t in byclass[cls])
    dead.append((tot, cls, sorted({f for f, _ in byclass[cls]})))

dead.sort(reverse=True)
print("未被源码/产物引用的类: %d" % len(dead))
print()
print("%8s  %-42s %s" % ("~bytes", "class", "files"))
s = 0
for tot, cls, fs in dead:
    s += tot
    print("%8d  .%-41s %s" % (tot, cls, ",".join(fs)))
print()
print("合计可回收约 %d B（规则体原文长度，压缩后约 %d B）" % (s, s // 3))

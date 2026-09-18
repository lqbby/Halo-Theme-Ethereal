# -*- coding: utf-8 -*-
"""死代码审计：未引用的 CSS 类 / 未使用的 i18n 键 / 孤儿源文件。
只读，不修改任何文件。用法： python dead-code-audit.py [repo_root]
"""
import os
import re
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
os.chdir(ROOT)

SKIP_DIRS = {"node_modules", ".git", "dist", "templates", ".astro", "public"}


def collect(root, exts):
    out = []
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in SKIP_DIRS]
        for f in fn:
            if os.path.splitext(f)[1] in exts:
                out.append(os.path.join(dp, f).replace(os.sep, "/"))
    return sorted(out)


def read(path):
    try:
        return open(path, encoding="utf-8", errors="ignore").read()
    except OSError:
        return ""


SRC_EXTS = {".astro", ".svelte", ".ts", ".js", ".css", ".mjs"}
src_files = collect("src", SRC_EXTS) + collect("scripts", SRC_EXTS)
blob = "\n".join(read(f) for f in src_files)

# 也把构建产物里的引用算上（产物由源码生成，但可兜住「只在产物里出现」的情况）
for extra in ("templates", "public"):
    if os.path.isdir(extra):
        for f in collect(extra, {".html", ".js", ".css"}):
            blob += "\n" + read(f)


def used_anywhere(name):
    return re.search(r"(?<![A-Za-z0-9_-])" + re.escape(name) + r"(?![A-Za-z0-9_-])", blob)


print("=" * 78)
print("1) src/styles/*.css 中定义、但全仓（含产物）无引用的类")
print("=" * 78)
defined = {}
for f in collect("src/styles", {".css"}):
    css = read(f)
    for m in re.finditer(r"\.([a-zA-Z_][\w-]*)", css):
        defined.setdefault(m.group(1), set()).add(os.path.basename(f))
unused = [n for n in sorted(defined) if not used_anywhere(n)]
tot = 0
for n in unused:
    # 估算该类的规则体字节数
    bytes_ = 0
    for f in collect("src/styles", {".css"}):
        css = read(f)
        for m in re.finditer(r"\.(" + re.escape(n) + r")(?![A-Za-z0-9_-])[^{]*\{([^}]*)\}", css):
            bytes_ += len(m.group(0))
    tot += bytes_
    print("  .%-40s %-22s ~%d B" % (n, ",".join(sorted(defined[n])), bytes_))
print("  --> 共 %d 个未引用类，规则体合计约 %d B" % (len(unused), tot))

print()
print("=" * 78)
print("2) i18n 键：定义了但没有任何 #{...} / th:* 引用的键")
print("=" * 78)
keys = []
for line in read("i18n/default.properties").splitlines():
    m = re.match(r"^([a-zA-Z][\w.\-]*)\s*=", line)
    if m:
        keys.append(m.group(1))
i18n_blob = blob
for f in collect("i18n", {".properties"}) + collect("src", {".astro", ".ts", ".svelte"}):
    i18n_blob += "\n" + read(f)
dead_keys = []
for k in keys:
    if not re.search(re.escape(k) + r"(?![A-Za-z0-9_.\-])", blob):
        dead_keys.append(k)
for k in dead_keys:
    print("  " + k)
print("  --> 共 %d / %d 个键疑似未被引用" % (len(dead_keys), len(keys)))

print()
print("=" * 78)
print("3) 孤儿源文件（.astro/.svelte/.ts/.js，除自引用外无任何引用）")
print("=" * 78)
PAGE_DIR = "src/pages"
for f in collect("src", {".astro", ".svelte", ".ts", ".js"}):
    if f.startswith(PAGE_DIR):
        continue  # Astro 文件路由，无需 import
    base = os.path.basename(f)
    stem = os.path.splitext(base)[0]
    if stem.startswith("_") or f.endswith(".d.ts"):
        continue  # 共享模块 / 类型声明
    own = read(f)
    hits = 0
    for pat in (base, stem):
        rx = r"(?<![A-Za-z0-9_.\-])" + re.escape(pat) + r"(?![A-Za-z0-9_.\-])"
        hits += len(re.findall(rx, blob)) - len(re.findall(rx, own))
    if hits <= 0:
        print("  %-58s %6d B" % (f, os.path.getsize(f)))
print()
print("done")

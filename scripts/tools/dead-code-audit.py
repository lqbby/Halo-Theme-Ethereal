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

# 逐文件留一份内容：第 1 节判定类是否被使用时要排除「定义文件自身」，
# 只拼成一整块文本的话，类名必然在自己的定义处命中，审计恒为空。
contents = {f: read(f) for f in src_files}

# 也把构建产物里的引用算上（产物由源码生成，但可兜住「只在产物里出现」的情况）
for extra in ("templates", "public"):
    if os.path.isdir(extra):
        for f in collect(extra, {".html", ".js", ".css"}):
            contents[f] = read(f)

blob = "\n".join(contents.values())


def used_anywhere(name):
    return re.search(r"(?<![A-Za-z0-9_-])" + re.escape(name) + r"(?![A-Za-z0-9_-])", blob)


print("=" * 78)
print("1) src/styles/*.css 中定义、但全仓（含产物）无引用的类")
print("=" * 78)
defined = {}
for f in collect("src/styles", {".css"}):
    css = read(f)
    for m in re.finditer(r"\.([a-zA-Z_][\w-]*)", css):
        defined.setdefault(m.group(1), set()).add(f)


# 使用证据：定义文件自身不算——类名必然在自己的定义处出现，算上的话
# 每个类都「被使用」、结果恒为空。产物里的 .css 是定义文件的编译拷贝，
# 同理排除（产物 .html/.js 里的引用仍算数）。词元集合判定与 used_anywhere
# 的边界正则等价（按非词元字符切分取整词）。
def token_set(text):
    return set(re.findall(r"[A-Za-z0-9_-]+", text))


evidence_tokens = set()
styles_tokens = {}
for f, text in contents.items():
    if f.endswith(".css") and (f.startswith("templates/") or f.startswith("public/")):
        continue  # 产物样式表 = 定义的拷贝
    if f.startswith("src/styles/"):
        styles_tokens[f] = token_set(text)
    else:
        evidence_tokens |= token_set(text)


def class_used(name, defining_files):
    if name in evidence_tokens:
        return True
    # 其他样式文件里的选择器引用（如 .a .b）也算使用
    return any(
        name in toks for f, toks in styles_tokens.items() if f not in defining_files
    )


unused = [n for n in sorted(defined) if not class_used(n, defined[n])]
tot = 0
for n in unused:
    # 估算该类的规则体字节数
    bytes_ = 0
    for f in collect("src/styles", {".css"}):
        css = read(f)
        for m in re.finditer(r"\.(" + re.escape(n) + r")(?![A-Za-z0-9_-])[^{]*\{([^}]*)\}", css):
            bytes_ += len(m.group(0))
    tot += bytes_
    print("  .%-40s %-22s ~%d B" % (n, ",".join(sorted(os.path.basename(p) for p in defined[n])), bytes_))
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

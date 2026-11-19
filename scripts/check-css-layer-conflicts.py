#!/usr/bin/env python3
"""CSS 层叠冲突扫描器（2026-11-19）

用途：找出「同属性、同元素族，被更高优先级规则静默覆盖」的 CSS 声明。
这类 bug 静态类型检查、stylelint 都查不出，只能在浏览器里肉眼验证 —— 本脚本把
它们提前列出来。

为什么需要它：
  典型的历史事故——`html.reload-restoring #banner-wrapper { opacity: 0 }` 想在这个
  类挂载期间藏住壁纸层，但 `components.css` 里
  `html[data-banner-display="transparent"] #banner-wrapper { opacity: var(...) !important }`
  把它压掉了，导致「全屏透明」布局下刷新时壁纸层不参与「先藏后显」。

  🔴 更隐蔽的一层：CSS 规范在 **!important 时层叠反转** ——
     **layered 的 !important 胜过 unlayered 的 !important**。
  本仓库 `components.css` 整文件包在 `@layer components` 内，而 `transition.css`
  是 unlayered 的。所以 transition.css 里写 `!important` 反而**永远输**给
  components.css 的 `!important`（无论特异性多高）。修法是把自己也放进
  `@layer components`，同层再比特异性。

用法：
  python scripts/check-css-layer-conflicts.py            # 全部
  python scripts/check-css-layer-conflicts.py --only-banner   # 只看含 banner 的

判读：
  · 「低 … → 高 …」两行里，低的那条若是有意写的「初始态」（如 opacity:0），
    而被高的那条压掉，就是 bug；
  · 若低的只是「无状态基样式」、高的才是「状态类」（.submenu-open 等），
    那是正常的覆盖，可忽略。
"""

import argparse
import glob
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(__file__), "..")
STYLE_GLOB = os.path.join(ROOT, "src", "styles", "*.css")

# 这些属性一旦被静默覆盖，通常会造成「看不见 / 点不到 / 动画不跑」的体感问题
KEY_PROPS = {
    "opacity", "visibility", "display", "transform", "translate",
    "animation", "animation-name", "animation-delay", "animation-duration",
    "backdrop-filter", "pointer-events", "position", "z-index",
}


def specificity(sel: str):
    """粗略特异性 (id, class/attr/pseudo-class, element/pseudo-element)"""
    s = re.sub(r"::[a-z-]+", " 0elem0 ", sel)
    ids = len(re.findall(r"#[\w-]+", sel))
    classes = (
        len(re.findall(r"\.[\w-]+", sel))
        + len(re.findall(r"\[[^\]]+\]", sel))
        + len(re.findall(r":(?!:)[a-z-]+", sel))
    )
    elems = len(re.findall(r"(?<![\w.#\[:-])([a-z][\w-]*)", sel))
    return (ids, classes, elems)


def strip_comments(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def parse_file(path):
    """返回 [(file, layer_or_None, selector, prop, value, important, spec)]"""
    raw = strip_comments(open(path, encoding="utf8", errors="ignore").read())
    out = []
    # 逐层扫描 @layer 块（只处理单层嵌套，够用）
    layer_spans = []
    for m in re.finditer(r"@layer\s+([\w-]+)\s*\{", raw):
        start = m.end()
        depth, i = 1, start
        while i < len(raw) and depth:
            if raw[i] == "{":
                depth += 1
            elif raw[i] == "}":
                depth -= 1
            i += 1
        layer_spans.append((m.group(1), start, i - 1))

    def collect(text, layer, offset):
        for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", text):
            sel_raw = m.group(1).strip()
            if not sel_raw or sel_raw.lstrip().startswith("@"):
                continue
            body = m.group(2)
            for decl in body.split(";"):
                if ":" not in decl:
                    continue
                prop, _, val = decl.partition(":")
                prop, val = prop.strip().lower(), val.strip()
                if not prop or not val or prop.startswith("--"):
                    continue
                imp = "!important" in val
                val_clean = val.replace("!important", "").strip()
                for one in sel_raw.split(","):
                    one = one.strip()
                    if not one:
                        continue
                    out.append(
                        (os.path.basename(path), layer, one, prop, val_clean, imp, specificity(one))
                    )

    # 先从原文剔除 layer 块，处理 unlayered 部分
    masked = list(raw)
    for _, s, e in layer_spans:
        for j in range(s, e):
            masked[j] = " " if masked[j] != "\n" else "\n"
    collect("".join(masked), None, 0)
    for name, s, e in layer_spans:
        collect(raw[s:e], name, s)
    return out


def cascade_key(rule):
    """排序键：越大越赢。important > layer > 特异性 > 出现顺序（后者由调用方附加）"""
    _, layer, _, _, _, imp, spec = rule
    # !important 时 layer 反转：layered 的 important 胜 unlayered 的 important
    if imp:
        layer_rank = 1 if layer else 0
    else:
        layer_rank = 0 if layer else 1
    return (1 if imp else 0, layer_rank, spec)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only-banner", action="store_true", help="只看选择器含 banner 的")
    args = ap.parse_args()

    rules = []
    for f in sorted(glob.glob(STYLE_GLOB)):
        rules.extend(parse_file(f))

    buckets = defaultdict(list)
    for idx, r in enumerate(rules):
        f, layer, sel, prop, val, imp, spec = r
        if prop not in KEY_PROPS:
            continue
        last = re.sub(r"[>+~]", " ", sel).split()[-1] if sel else ""
        buckets[(prop, last)].append((idx, r))

    conflicts = []
    for (prop, last), items in buckets.items():
        if len(items) < 2:
            continue
        ranked = sorted(items, key=lambda kv: (cascade_key(kv[1]), kv[0]))
        low_idx, low = ranked[0]
        high_idx, high = ranked[-1]
        if low[4] == high[4]:          # 值相同，覆盖无害
            continue
        if cascade_key(low)[:2] == cascade_key(high)[:2] and low[6] < high[6]:
            pass                        # 同层同 important，靠特异性分出胜负，照报
        if args.only_banner and "banner" not in low[2] and "banner" not in high[2]:
            continue
        conflicts.append((prop, last, low, high))

    print(f"规则 {len(rules)} 条，可疑层叠冲突 {len(conflicts)} 组\n")
    print("读法：第一行是「被压的」声明，第二行是「压人的」；前者若是刻意写的初始态就该修。\n")
    for prop, last, low, high in conflicts:
        print(f"[{prop}] 元素族末段 = {last}")
        print(f"   低  layer={low[1] or 'unlayered':12} imp={low[5]!s:5} spec={low[6]}  {low[0]}  {low[2][:62]}")
        print(f"      → {low[4][:64]}")
        print(f"   高  layer={high[1] or 'unlayered':12} imp={high[5]!s:5} spec={high[6]}  {high[0]}  {high[2][:62]}")
        print(f"      → {high[4][:64]}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())

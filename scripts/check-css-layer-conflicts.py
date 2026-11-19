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


def strip_keyframes(css: str) -> str:
    """剔除 @keyframes 整块 —— 其内部的 from/to/百分比不是选择器，混进比对会
    产生大量假冲突（实测 35 组里 8 组来自这里：不同 keyframes 的 `from` 被当成
    同一「元素族」）。"""
    return re.sub(
        r"@(?:-webkit-)?keyframes\s+[\w-]+\s*\{(?:[^{}]|\{[^{}]*\})*\}", "", css
    )


def family(sel: str) -> str:
    """元素族标识：取选择器最后两段（组合符归一为空格）。
    只取最后一段会把 `#navbar-card > a` 与 `.navbar-menu .group > a` 判为同族
    （末段都是 `a`），产生误报；要求两段可显著降低噪声。"""
    parts = re.sub(r"[>+~]", " ", sel).split()
    return " ".join(parts[-2:]) if len(parts) >= 2 else " ".join(parts)


# 「胜者」带这些即视为状态/开关覆盖（正常设计，不是冲突）
STATE_HINT = re.compile(
    r":(hover|focus|focus-within|focus-visible|active|disabled|checked|target|not\()"
    r"|\.(is-[\w-]+|has-[\w-]+|onload-animation|dragging|loading|scrolled|hidden"
    r"|open|opened|closed|expanded|collapsed|active|ready|enter|reveal|visible"
    # 带前缀的开关类：navbar-blur-enabled / mods-card-pattern / banner-text-hidden…
    r"|[\w-]+-(?:enabled|disabled|pattern|hidden|open|opened|closed|active|ready"
    r"|visible|scrolled|expanded|collapsed|restoring|faded|reveal)"
    r"|submenu-open|nav-menu-open)"
    r"|\[data-[\w-]+"
    r"|:(root|where|is)\(",
    re.I,
)


def parse_file(path):
    """返回 [(file, layer_or_None, selector, prop, value, important, spec)]"""
    raw = strip_keyframes(
        strip_comments(open(path, encoding="utf8", errors="ignore").read())
    )
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
    ap.add_argument("--all", action="store_true", help="连状态覆盖也列出（默认跳过）")
    ap.add_argument(
        "--fail", action="store_true", help="有待查冲突时以非 0 退出（CI 守卫用）"
    )
    args = ap.parse_args()

    rules = []
    for f in sorted(glob.glob(STYLE_GLOB)):
        rules.extend(parse_file(f))

    buckets = defaultdict(list)
    for idx, r in enumerate(rules):
        f, layer, sel, prop, val, imp, spec = r
        if prop not in KEY_PROPS:
            continue
        buckets[(prop, family(sel))].append((idx, r))

    conflicts = []
    state_skipped = 0
    for (prop, fam), items in buckets.items():
        if len(items) < 2:
            continue
        ranked = sorted(items, key=lambda kv: (cascade_key(kv[1]), kv[0]))
        low = ranked[0][1]
        high = ranked[-1][1]
        if low[4] == high[4]:          # 值相同，覆盖无害
            continue
        # 同一选择器 + 同一 layer ⇒ 纯「后覆盖前」（媒体查询内覆盖、!important 提权等），
        # 不是被别的规则压掉，跳过；layer 不同才是真陷阱，保留。
        if low[2] == high[2] and low[1] == high[1]:
            continue
        if args.only_banner and "banner" not in low[2] and "banner" not in high[2]:
            continue
        # 胜者带状态类/伪类/[data-*] ⇒ 正常的状态覆盖，默认不报（--all 才显示）
        is_state = bool(STATE_HINT.search(high[2]))
        if is_state and not args.all:
            state_skipped += 1
            continue
        conflicts.append((prop, fam, low, high, is_state))

    print(
        f"规则 {len(rules)} 条；待查冲突 {len(conflicts)} 组"
        f"（已自动跳过 {state_skipped} 组状态覆盖，--all 可显示）\n"
    )
    print("读法：第一行是「被压的」声明，第二行是「压人的」；前者若是刻意写的初始态就该修。\n")
    for prop, fam, low, high, is_state in conflicts:
        tag = "  [状态覆盖]" if is_state else ""
        print(f"[{prop}] 元素族 = {fam}{tag}")
        print(
            f"   败  layer={low[1] or 'unlayered':12} imp={low[5]!s:5} spec={low[6]}  {low[0]}  {low[2][:60]}"
        )
        print(f"       → {low[4][:62]}")
        print(
            f"   胜  layer={high[1] or 'unlayered':12} imp={high[5]!s:5} spec={high[6]}  {high[0]}  {high[2][:60]}"
        )
        print(f"       → {high[4][:62]}")
        print()
    if args.fail and conflicts:
        print(f"❌ 有 {len(conflicts)} 组待查冲突；确认是 bug 就修，是正常覆盖就补进 STATE_HINT。")
        return 1
    print("✅ 无待查冲突")
    return 0


if __name__ == "__main__":
    sys.exit(main())

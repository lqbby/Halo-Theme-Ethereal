# -*- coding: utf-8 -*-
"""主题包差分 -- 比对两个 Ethereal 发布包的「真实差异」，滤掉构建随机量。

为什么需要它（而不是直接比 md5 / difflib）：
  · astro 构建**非确定**：music-widget-<随机id>、astro-island uid="…" 每次构建都不同；
    静态资源带内容哈希 ⇒ 文件名本身会变；HTML 里的 /assets/xxx.<hash>.css 引用同理。
  · 字符串级 difflib.SequenceMatcher 在 400KB 单行 HTML 上要跑好几分钟（O(n·m)）。
  ⇒ 正确姿势：① 文件名去哈希配对；② 文本按已知随机量归一化；
     ③ 用 30-gram 集合做 O(n) 差分，直接列出「B 里有、A 里没有」的字符串段。

用法：
  python pkg-diff.py <A.zip> <B.zip>            # 总览：文件集合 + 哪些文件有差异
  python pkg-diff.py <A.zip> <B.zip> <文件路径>  # 细看某个文件的增删文本段（可用通配片段）

判据：总览里「归一化后一致」之外的文件，每一个都必须能对上本次改动的预期；
      对不上就是**隐藏改动**，别放行（曾靠它抓出「每页多出 221 字节」的全站共用组件副作用）。
"""
import difflib
import re
import sys
import zipfile

# ── 构建随机量 / 缓存串：必须全部抹掉，否则全是假差异 ──────────────────────
NORMS = [
    # 小组件的随机 id：形如 music-widget-okjnsa9（字母数字混合，别只写 \d+）
    (re.compile(r"music-widget-[0-9a-z]+"), "music-widget-<N>"),
    # astro 岛 / 组件实例 uid
    (re.compile(r'uid="[A-Za-z0-9_-]{3,}"'), 'uid="<U>"'),
    (re.compile(r'data-id="[0-9a-f]{8,}"'), 'data-id="<H>"'),
    # 带内容哈希的静态资源引用（文件名与 HTML 引用两处都要抹）
    (re.compile(r"([A-Za-z0-9_.-]+)\.[A-Za-z0-9_-]{8}\.(css|js)"), r"\1.<H>.\2"),
    # 版本号 / 缓存穿透参数
    (re.compile(r"\?v=[0-9][0-9.]*"), "?v=<V>"),
    (re.compile(r'const bannerVersion="[^"]*"'), 'const bannerVersion="<V>"'),
    (re.compile(r'nonce="[^"]*"'), 'nonce="<X>"'),
    (re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'), "<UUID>"),
]

HASHED_NAME = re.compile(r"\.[0-9A-Za-z_-]{8,12}\.(css|js|mjs)$")


def norm_text(s):
    for rx, rep in NORMS:
        s = rx.sub(rep, s)
    return s


def norm_name(n):
    return HASHED_NAME.sub(r".<H>.\1", n)


def load(path):
    z = zipfile.ZipFile(path)
    return {n: z.read(n) for n in z.namelist() if not n.endswith("/")}


def to_text(b):
    try:
        return norm_text(b.decode("utf-8"))
    except UnicodeDecodeError:
        return None


G = 30


def runs(new, oldset, g=G, merge_gap=40):
    """new 中所有「g-gram 不出现在 oldset」的连续区间（相邻区间间隔 < merge_gap 时合并）"""
    out, cur = [], None
    for i in range(len(new) - g + 1):
        if new[i:i + g] in oldset:
            if cur is not None:
                out.append(cur)
                cur = None
        elif cur is None:
            cur = [i, i + g]
        else:
            cur[1] = i + g
    if cur is not None:
        out.append(cur)
    merged = []
    for s, e in out:
        if merged and s - merged[-1][1] < merge_gap:
            merged[-1][1] = e
        else:
            merged.append([s, e])
    return merged


def frag(s, cap=200):
    return repr(s if len(s) <= cap else s[:100] + " ‹…› " + s[-100:])


def main():
    A_, B_ = load(sys.argv[1]), load(sys.argv[2])
    print("A = %s  (%d 项)" % (sys.argv[1], len(A_)))
    print("B = %s  (%d 项)" % (sys.argv[2], len(B_)))

    setA = {norm_name(n): n for n in A_}
    setB = {norm_name(n): n for n in B_}
    onlyA = sorted(set(setA) - set(setB))
    onlyB = sorted(set(setB) - set(setA))
    if onlyA or onlyB:
        print("\n⚠️ 文件集合不同：仅A有=%s 仅B有=%s" % (onlyA or "无", onlyB or "无"))
    else:
        print("\n文件集合一致（去哈希 basename 配对后 %d 项）" % len(setA))

    if len(sys.argv) > 3:
        pat = sys.argv[3]
        keys = [k for k in setB if pat in k] or [k for k in setA if pat in k]
        if not keys:
            print("找不到匹配 %r 的文件" % pat)
            return
        for k in keys:
            ta, tb = to_text(A_[setA[k]]), to_text(B_[setB[k]])
            print("\n########## %s ##########" % k)
            if ta == tb:
                print("归一化后完全一致 ⇒ 原差异均为随机量")
                continue
            sa = {ta[i:i + G] for i in range(len(ta) - G + 1)}
            sb = {tb[i:i + G] for i in range(len(tb) - G + 1)}
            add, rem = runs(tb, sa), runs(ta, sb)
            print("新增 %d 段：" % len(add))
            for s, e in add:
                print("  +%-4d %s" % (e - s, frag(tb[s:e])))
            print("删除 %d 段：" % len(rem))
            for s, e in rem:
                print("  -%-4d %s" % (e - s, frag(ta[s:e])))
        return

    diff, same, binn = [], 0, 0
    for k in sorted(set(setA) & set(setB)):
        ta, tb = to_text(A_[setA[k]]), to_text(B_[setB[k]])
        if ta is None or tb is None:
            if A_[setA[k]] == B_[setB[k]]:
                same += 1
            else:
                binn += 1
            continue
        if ta == tb:
            same += 1
        else:
            diff.append((k, len(A_[setA[k]]), len(B_[setB[k]])))
    print("\n归一化后一致 %d ；二进制/无法解码 %d ；**有差异 %d**" % (same, binn, len(diff)))
    for k, sa, sb in diff:
        print("  ~ %-50s %8d -> %8d (%+d B)" % (k, sa, sb, sb - sa))
    if diff:
        print("\n提示：逐个 `python pkg-diff.py A B <文件路径>` 看完每一处，再决定是否放行。")


if __name__ == "__main__":
    main()

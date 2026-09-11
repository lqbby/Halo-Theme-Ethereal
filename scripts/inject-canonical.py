"""
批量为页面注入 canonical。

策略：在 `<MainGridLayout ...>` 的结束 `>` 之后，插入/并入
  <Fragment slot="head">
    <Canonical path="..." />
  </Fragment>

- 已有 Fragment slot="head" 的页面：直接在 Fragment 内插一行
- 没有的页面：新增 Fragment 块

⚠️ photo.astro **刻意排除**：照片详情页的 URL 由 photo 插件的 `photoUrl.detail(photo)`
   工具生成，主题端拿不到 permalink 字段，硬编码路径会产出 404 canonical
   （错误的 canonical 比没有更糟 —— 会把权重指向死链）。
"""
import re
import pathlib

ROOT = pathlib.Path(r"D:\WorkBuddy sjk\halo\ethereal\src\pages")

# 页面 → canonical 路径参数（全部已核实）
PLAN = {
    # ---- A 类：Halo 实体，有 permalink 字段 ----
    "post":             '"${post.status.permalink}"',
    "page":             '"${singlePage.status.permalink}"',
    "category":         '"${category.status.permalink}"',
    "tag":              '"${tag.status.permalink}"',
    "skills":           '"${singlePage.status.permalink}"',
    "timeline":         '"${singlePage.status.permalink}"',
    # ---- 动态详情页：主题自定义路由（已线上实测形态）----
    "moment":           '"|/moments/${moment.metadata.name}|"',
    "portfolio-detail": '"|/portfolio/${project.slug}|"',
    # ---- B 类：主题静态页，路径为编译期常量（已线上实测 200）----
    "archives":         '"/archives"',
    "tags":             '"/tags"',
    "categories":       '"/categories"',
    "series":           '"/series"',
    "moments":          '"/moments"',
    "photos":           '"/photos"',
    "equipments":       '"/equipments"',
    "portfolio":        '"/portfolio"',
    "bangumis":         '"/bangumis"',
    "statistics":       '"/statistics"',
    "wishes":           '"/wishes"',
    "friends":          '"/friends"',
    "links":            '"/links"',
    "index":            '"/"',
    # ---- 刻意排除 ----
    # "photo":  照片详情页，URL 由插件 photoUrl.detail() 生成，主题拿不到 permalink
    # "schedule-calendar": 线上 /schedule-calendar 为 404（非公开路由）
    # "error/*": 错误页无需 canonical
}

stats = {"new_fragment": [], "into_existing": [], "skipped": []}

for stem, path_arg in PLAN.items():
    fp = ROOT / f"{stem}.astro"
    if not fp.exists():
        print("!! missing", fp)
        continue
    src = fp.read_text(encoding="utf-8")

    if "canonical" in src:
        stats["skipped"].append(stem + "(已存在)")
        continue

    if not re.search(r'^import MainGridLayout from "\.\./layouts/MainGridLayout\.astro";$',
                     src, re.M):
        print("!! no MainGridLayout import:", stem)
        continue

    # 1) 加 import
    src = re.sub(
        r'(^import MainGridLayout from "\.\./layouts/MainGridLayout\.astro";$)',
        r'\1\nimport Canonical from "../components/misc/Canonical.astro";',
        src, count=1, flags=re.M)

    # 2) 定位 <MainGridLayout ...> 的结束 '>'（行首无缩进的 '>'）
    m = re.search(r'^<MainGridLayout\b', src, re.M)
    if not m:
        print("!! MainGridLayout tag not found:", stem)
        continue
    close = src.index("\n>", m.start()) + len("\n>")

    # 3) 紧随其后是否已有 Fragment slot="head"
    after = src[close:]
    fm = re.match(r'\s*<Fragment slot="head">', after)
    if fm:
        ins = close + fm.end()
        src = src[:ins] + f'\n    <Canonical path={path_arg} />' + src[ins:]
        stats["into_existing"].append(stem)
    else:
        block = ('\n  <Fragment slot="head">\n'
                 '    <!-- SEO：canonical（解决带/不带尾斜杠的重复内容） -->\n'
                 f'    <Canonical path={path_arg} />\n'
                 '  </Fragment>')
        src = src[:close] + block + src[close:]
        stats["new_fragment"].append(stem)

    fp.write_text(src, encoding="utf-8")

print("新增 Fragment：", len(stats["new_fragment"]), stats["new_fragment"])
print("并入已有 Fragment：", len(stats["into_existing"]), stats["into_existing"])
print("跳过：", len(stats["skipped"]), stats["skipped"])

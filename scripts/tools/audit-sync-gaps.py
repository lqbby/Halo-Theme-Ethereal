# 严格排查：页面用到的自定义类 / i18n 词条 / 脚本依赖 是否缺失
import io
import os
import re

# ── 收集所有 CSS 文本 ──
css_text = []
for root in ("ethereal/src/styles", "ethereal/public/assets"):
    for f in os.listdir(root):
        if f.endswith(".css"):
            css_text.append(io.open(os.path.join(root, f), encoding="utf-8").read())
# 补上各 .astro/.svelte 的内联 <style>（本地习惯：页面级 <style is:global> 写页面样式）
for root, _dirs, files in os.walk("ethereal/src"):
    for f in files:
        if f.endswith((".astro", ".svelte")):
            t = io.open(os.path.join(root, f), encoding="utf-8").read()
            for m in re.finditer(r"<style[^>]*>(.*?)</style>", t, re.S):
                css_text.append(m.group(1))
css_all = "\n".join(css_text)

# ── Tailwind / 通用工具类前缀（排除，避免误报）──
TW_PREFIX = (
    "text- bg- border- rounded- shadow- p- px- py- pt- pb- pl- pr- m- mx- my- mt- mb- ml- mr- "
    "w- h- min- max- gap- flex- grid- items- justify- content- self- order- col- row- space- "
    "font- leading- tracking- opacity- duration- delay- ease- transition- transform- translate- "
    "scale- rotate- skew- origin- z- top- right- bottom- left- inset- overflow- object- aspect- "
    "cursor- select- pointer- resize- list- align- whitespace- break- truncate- line-clamp- "
    "relative absolute fixed sticky static hidden block inline flex table contents visible "
    "sr-only group isolate antialiased container dark inset-0 outline- ring- divide- from- to- via- "
    "placeholder- caret- accent- decoration- underline- uppercase lowercase capitalize first- last- "
    "even- odd- hover- focus- active- disabled- before- after- group- peer- motion- backdrop- "
    "backface- will- scroll- snap- touch- user- fill- stroke- "
)
TW_WORDS = set(TW_PREFIX.split())


def is_custom(cls: str) -> bool:
    if not re.fullmatch(r"[a-z][a-z0-9]*(-[a-z0-9]+)+", cls):
        return False
    # 带 Tailwind 语义前缀的一律排除
    for p in TW_WORDS:
        if cls == p.rstrip("-") or cls.startswith(p):
            return False
    return True


# ── 扫描页面（含其 import 的本地组件，1 层）──
pages = sorted(f for f in os.listdir("ethereal/src/pages") if f.endswith(".astro"))
missing_classes = {}
missing_i18n = {}
missing_scripts = {}

for page in pages:
    p = "ethereal/src/pages/" + page
    text = io.open(p, encoding="utf-8").read()
    files = [(page, text)]
    # 一层 import 的本地组件
    for m in re.finditer(r'from "(\.\./components/[^"]+\.astro)"', text):
        cp = os.path.normpath(os.path.join("ethereal/src/pages", m.group(1)))
        if os.path.exists(cp):
            files.append((os.path.relpath(cp, "ethereal/src"), io.open(cp, encoding="utf-8").read()))

    for name, t in files:
        for m in re.finditer(r'class="([^"]+)"', t):
            for cls in m.group(1).split():
                if is_custom(cls) and ("." + cls) not in css_all:
                    missing_classes.setdefault(cls, set()).add(name)
        for m in re.finditer(r"#\{([a-zA-Z0-9_.]+)[(}]", t):
            key = m.group(1)
            hit = False
            for lang in ("zh_CN", "zh_TW", "default"):
                f = "ethereal/i18n/%s.properties" % lang
                if os.path.exists(f) and ("\n" + key + "=") in ("\n" + io.open(f, encoding="utf-8").read()):
                    hit = True
                    break
            if not hit:
                missing_i18n.setdefault(key, set()).add(name)
    # 脚本依赖
    for m in re.finditer(r"assets/([a-z0-9.-]+)\.js", text):
        js = m.group(1)
        cands = ["ethereal/src/scripts/assets/%s.ts" % js, "ethereal/src/scripts/assets/%s.js" % js,
                 "ethereal/public/assets/%s.js" % js]
        if not any(os.path.exists(c) for c in cands):
            missing_scripts.setdefault(js, set()).add(page)

print("=" * 60)
print("① 用了但 CSS 未定义的自定义类：", len(missing_classes))
for k, v in sorted(missing_classes.items()):
    print("   %-28s ← %s" % (k, ", ".join(sorted(v))[:70]))
print("=" * 60)
print("② 用了但 i18n 缺的键：", len(missing_i18n))
for k, v in sorted(missing_i18n.items()):
    print("   %-34s ← %s" % (k, ", ".join(sorted(v))[:60]))
print("=" * 60)
print("③ 引用了但找不到源码的脚本：", len(missing_scripts))
for k, v in sorted(missing_scripts.items()):
    print("   %-28s ← %s" % (k, ", ".join(sorted(v))[:60]))

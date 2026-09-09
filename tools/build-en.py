# -*- coding: utf-8 -*-
"""Generate the English site at /en/ from the Czech pages in the repo root.

The Czech HTML files are the source of truth for structure and Czech text.
English text lives in tools/translations.json, keyed by the data-i18n
attributes already present in the markup.

Each page has a logical id (index, products, function, contact, dark,
corten) and a separate filename per language, so both trees carry
keyword-bearing slugs in their own language.

Run after editing any Czech page or the translations:

    python tools/build-en.py

Safe to re-run; every step is idempotent.
"""

import io
import json
import os
import re
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
EN_DIR = os.path.join(ROOT, "en")
SITE = "https://pahoclock.com"

# logical page id -> filename in each language
FILES = {
    "index":    {"cs": "index.html",                  "en": "index.html"},
    "products": {"cs": "slovni-hodiny.html",          "en": "word-clocks.html"},
    "function": {"cs": "jak-funguji.html",            "en": "how-it-works.html"},
    "contact":  {"cs": "kontakt.html",                "en": "contact.html"},
    "dark":     {"cs": "slovni-hodiny-dark.html",     "en": "word-clock-dark.html"},
    "corten":   {"cs": "slovni-hodiny-corten.html",   "en": "word-clock-corten.html"},
}

# the pre-rename filenames, kept alive as redirect stubs
LEGACY = {
    "products": "products.html",
    "function": "function.html",
    "contact":  "contact.html",
    "dark":     "dark.html",
    "corten":   "corten.html",
}

PAGES = ["index", "products", "function", "contact", "dark", "corten"]

IMAGES = {
    "index":    "/images/pahoclock_dark_main.jpg",
    "products": "/images/pahoclock_main.JPEG",
    "function": "/images/pahoclock_dark_main.jpg",
    "contact":  "/images/pahoclock_dark_main.jpg",
    "dark":     "/images/pahoclock_dark_main.jpg",
    "corten":   "/images/pahoclock_main.JPEG",
}

PRIORITY = {"index": "1.0", "products": "0.9", "corten": "0.8",
            "dark": "0.8", "function": "0.7", "contact": "0.6"}

with io.open(os.path.join(HERE, "translations.json"), encoding="utf-8") as fh:
    TR = json.load(fh)
STRINGS = TR["strings"]
META = TR["pages"]
ALTS = TR["alts"]


def read(path):
    with io.open(path, encoding="utf-8") as fh:
        return fh.read()


def write(path, text):
    with io.open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def cs_file(page):
    return FILES[page]["cs"]


def en_file(page):
    return FILES[page]["en"]


def cs_url(page):
    return SITE + ("/" if page == "index" else "/" + cs_file(page))


def en_url(page):
    return SITE + "/en/" + ("" if page == "index" else en_file(page))


# ─────────────────────────────────────────────────────────────────────────────
# English structured data
# ─────────────────────────────────────────────────────────────────────────────

ORG_ID = SITE + "/#organization"

ORG = {
    "@type": "Organization",
    "@id": ORG_ID,
    "name": "pahoclock",
    "url": SITE + "/",
    "logo": SITE + "/images/logo_circle_crop.png",
    "email": "opavlas@icloud.com",
    "telephone": "+420737640746",
    "sameAs": ["https://www.instagram.com/paho_clock"],
}


def product_ld(page, name, material, finish, weight):
    return {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "pahoclock " + name,
        "description": STRINGS[page + ".desc"],
        "image": SITE + IMAGES[page],
        "url": en_url(page),
        "sku": "pahoclock-" + page,
        "brand": {"@type": "Brand", "name": "pahoclock"},
        "material": material,
        "color": finish,
        "width": {"@type": "QuantitativeValue", "value": 47.5, "unitCode": "CMT"},
        "height": {"@type": "QuantitativeValue", "value": 47.5, "unitCode": "CMT"},
        "weight": {"@type": "QuantitativeValue", "value": weight, "unitCode": "KGM"},
        "offers": {
            "@type": "Offer",
            "url": en_url(page),
            "price": "20000",
            "priceCurrency": "CZK",
            "availability": "https://schema.org/InStock",
            "itemCondition": "https://schema.org/NewCondition",
            "seller": {"@id": ORG_ID},
        },
    }


def crumbs(page, name):
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home",
             "item": en_url("index")},
            {"@type": "ListItem", "position": 2, "name": "Products",
             "item": en_url("products")},
            {"@type": "ListItem", "position": 3, "name": name, "item": en_url(page)},
        ],
    }


def page_ld(page):
    if page == "index":
        return [{"@context": "https://schema.org", "@graph": [
            ORG,
            {"@type": "WebSite", "@id": SITE + "/en/#website", "url": en_url("index"),
             "name": "pahoclock", "inLanguage": "en",
             "publisher": {"@id": ORG_ID}},
        ]}]
    if page == "products":
        return [{"@context": "https://schema.org", "@type": "CollectionPage",
                 "name": "pahoclock word clocks", "url": en_url(page), "inLanguage": "en",
                 "mainEntity": {"@type": "ItemList", "itemListElement": [
                     {"@type": "ListItem", "position": 1, "name": "pahoclock Dark",
                      "url": en_url("dark")},
                     {"@type": "ListItem", "position": 2, "name": "pahoclock Corten",
                      "url": en_url("corten")},
                 ]}}]
    if page == "function":
        return [{"@context": "https://schema.org", "@type": "WebPage",
                 "name": "How the pahoclock word clock tells time", "url": en_url(page),
                 "inLanguage": "en", "isPartOf": {"@id": SITE + "/en/#website"},
                 "description": STRINGS["function.desc"]}]
    if page == "contact":
        return [{"@context": "https://schema.org", "@type": "ContactPage",
                 "url": en_url(page), "inLanguage": "en", "name": "Contact — pahoclock",
                 "about": {"@id": ORG_ID},
                 "mainEntity": dict(ORG, contactPoint={
                     "@type": "ContactPoint", "contactType": "customer service",
                     "email": "opavlas@icloud.com", "telephone": "+420737640746",
                     "availableLanguage": ["en", "cs"]})}]
    if page == "dark":
        return [product_ld(page, "Dark", STRINGS["dark.material"],
                           STRINGS["dark.finish"], 5),
                crumbs(page, "Dark")]
    if page == "corten":
        return [product_ld(page, "Corten", STRINGS["corten.material"],
                           STRINGS["corten.finish"], 3),
                crumbs(page, "Corten")]
    raise KeyError(page)


# ─────────────────────────────────────────────────────────────────────────────
# Head rewriting
# ─────────────────────────────────────────────────────────────────────────────

VIEWPORT = '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'

HEAD_DROP = re.compile(
    r'^\s*(<title>|<meta name="description"|<link rel="canonical"|<link rel="icon"'
    r'|<link rel="apple-touch-icon"|<link rel="alternate" hreflang'
    r'|<meta property="og:|<meta name="twitter:'
    r'|<script type="application/ld\+json">)')

LANGJS = re.compile(r'^\s*<script src="(\.\./)?js/lang\.js"></script>\s*$')


def en_head(page):
    m = META[page]
    title, desc = m["title"], m["desc"]
    img = SITE + IMAGES[page]
    L = []
    L.append('  <title>%s</title>\n' % title)
    L.append('  <meta name="description" content="%s">\n' % desc)
    L.append('  <link rel="canonical" href="%s">\n' % en_url(page))
    L.append('  <link rel="alternate" hreflang="cs" href="%s">\n' % cs_url(page))
    L.append('  <link rel="alternate" hreflang="en" href="%s">\n' % en_url(page))
    L.append('  <link rel="alternate" hreflang="x-default" href="%s">\n' % cs_url(page))
    L.append('  <link rel="icon" href="../images/logo_circle_crop.png">\n')
    L.append('  <link rel="apple-touch-icon" href="../images/logo_circle_crop.png">\n')
    L.append('  <meta property="og:type" content="%s">\n'
             % ("product" if page in ("dark", "corten") else "website"))
    L.append('  <meta property="og:site_name" content="pahoclock">\n')
    L.append('  <meta property="og:locale" content="en_US">\n')
    L.append('  <meta property="og:locale:alternate" content="cs_CZ">\n')
    L.append('  <meta property="og:title" content="%s">\n' % title)
    L.append('  <meta property="og:description" content="%s">\n' % desc)
    L.append('  <meta property="og:url" content="%s">\n' % en_url(page))
    L.append('  <meta property="og:image" content="%s">\n' % img)
    L.append('  <meta name="twitter:card" content="summary_large_image">\n')
    L.append('  <meta name="twitter:title" content="%s">\n' % title)
    L.append('  <meta name="twitter:description" content="%s">\n' % desc)
    L.append('  <meta name="twitter:image" content="%s">\n' % img)
    for obj in page_ld(page):
        L.append('  <script type="application/ld+json">%s</script>\n'
                 % json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
    return L


# ─────────────────────────────────────────────────────────────────────────────
# Step 1 — patch the Czech pages: hreflang, language link, drop lang.js
# ─────────────────────────────────────────────────────────────────────────────

def fix_cs_urls(src):
    """Point every absolute URL at the current Czech filenames.

    The Czech head metadata (canonical, og:url, JSON-LD) is hand-written in
    the page, so a rename would otherwise leave it aimed at the old URL.
    """
    for page, legacy in LEGACY.items():
        src = src.replace(SITE + "/" + legacy, cs_url(page))
    return src


def patch_czech(page):
    path = os.path.join(ROOT, cs_file(page))
    lines = fix_cs_urls(read(path)).splitlines(True)
    out = []
    for line in lines:
        if line.strip().startswith('<link rel="alternate" hreflang'):
            continue
        if LANGJS.match(line):
            continue
        out.append(line)
        if line.strip().startswith('<link rel="canonical"'):
            out.append('  <link rel="alternate" hreflang="cs" href="%s">\n' % cs_url(page))
            out.append('  <link rel="alternate" hreflang="en" href="%s">\n' % en_url(page))
            out.append('  <link rel="alternate" hreflang="x-default" href="%s">\n'
                       % cs_url(page))
    src = "".join(out)
    href = "en/" + ("" if page == "index" else en_file(page))
    link = ('<a class="lang-toggle" href="%s" hreflang="en" '
            'aria-label="Switch to English">EN</a>' % href)
    src, n = re.subn(r'<button class="lang-toggle"[^>]*>EN</button>', link, src)
    if n == 0:  # already patched by an earlier run
        src, n = re.subn(r'<a class="lang-toggle"[^>]*>EN</a>', link, src)
    assert n == 1, "%s: language toggle not found" % page
    write(path, src)


# ─────────────────────────────────────────────────────────────────────────────
# Step 2 — generate the English page from the patched Czech page
# ─────────────────────────────────────────────────────────────────────────────

I18N = re.compile(r'<(\w+)([^>]*\sdata-i18n="([^"]+)"[^>]*)>(.*?)</\1>', re.S)


def translate(match):
    tag, attrs, key, body = match.groups()
    if key in STRINGS:
        body = STRINGS[key]
    return "<%s%s>%s</%s>" % (tag, attrs, body, tag)


def build_en(page):
    src = read(os.path.join(ROOT, cs_file(page)))

    # head: strip the Czech metadata, insert the English metadata
    out, done = [], False
    for line in src.splitlines(True):
        if HEAD_DROP.match(line):
            continue
        out.append(line)
        if not done and line == VIEWPORT:
            out.extend(en_head(page))
            done = True
    assert done, page
    src = "".join(out)

    src = src.replace('<html lang="cs">', '<html lang="en">', 1)
    src = I18N.sub(translate, src)

    # alt text is an attribute, so data-i18n does not reach it
    for cs, en in ALTS.items():
        src = src.replace('alt="%s"' % cs, 'alt="%s"' % en)

    # internal links point at the English filenames
    for other in PAGES:
        src = src.replace('href="%s"' % cs_file(other), 'href="%s"' % en_file(other))

    # this page now lives one directory down
    src = re.sub(r'(src|href)="(css/|images/|js/|function/)', r'\1="../\2', src)
    src = src.replace("url('images/", "url('../images/")

    # language link points back to the Czech page
    back = "../" + ("" if page == "index" else cs_file(page))
    src = re.sub(r'<a class="lang-toggle"[^>]*>EN</a>',
                 '<a class="lang-toggle" href="%s" hreflang="cs" '
                 'aria-label="Přepnout do češtiny">CZ</a>' % back, src)

    if not os.path.isdir(EN_DIR):
        os.makedirs(EN_DIR)
    write(os.path.join(EN_DIR, en_file(page)), src)


# ─────────────────────────────────────────────────────────────────────────────
# Step 3 — keep the pre-rename URLs alive as redirect stubs
# ─────────────────────────────────────────────────────────────────────────────

STUB = u"""<!DOCTYPE html>
<html lang="%(lang)s">
<head>
  <meta charset="UTF-8">
  <title>%(title)s</title>
  <meta name="robots" content="noindex, follow">
  <link rel="canonical" href="%(canonical)s">
  <meta http-equiv="refresh" content="0; url=%(target)s">
</head>
<body>
  <p>%(sentence)s <a href="%(target)s">%(target)s</a></p>
</body>
</html>
"""


def build_stubs():
    for page, legacy in LEGACY.items():
        # Czech tree
        write(os.path.join(ROOT, legacy), STUB % {
            "lang": "cs",
            "title": u"Stránka se přesunula — pahoclock",
            "canonical": cs_url(page),
            "target": cs_file(page),
            "sentence": u"Tato stránka se přesunula na",
        })
        # English tree, where the filename actually changed
        if legacy != en_file(page):
            write(os.path.join(EN_DIR, legacy), STUB % {
                "lang": "en",
                "title": "Page moved — pahoclock",
                "canonical": en_url(page),
                "target": en_file(page),
                "sentence": "This page has moved to",
            })


# ─────────────────────────────────────────────────────────────────────────────
# Step 4 — sitemap covering both languages
# ─────────────────────────────────────────────────────────────────────────────

def build_sitemap():
    today = datetime.date.today().isoformat()
    sitemap_images = {
        "index": ["/images/pahoclock_dark_main.jpg"],
        "products": ["/images/pahoclock_dark_main.jpg", "/images/pahoclock_main.JPEG"],
        "dark": ["/images/pahoclock_dark_main.jpg"],
        "corten": ["/images/pahoclock_main.JPEG"],
    }
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<?xml-stylesheet type="text/xsl" href="%s/sitemap.xsl"?>' % SITE,
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
           'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" '
           'xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    order = ["index", "products", "corten", "dark", "function", "contact"]
    for page in order:
        for loc in (cs_url(page), en_url(page)):
            out.append("<url>")
            out.append("<loc>%s</loc>" % loc)
            out.append('<xhtml:link rel="alternate" hreflang="cs" href="%s"/>' % cs_url(page))
            out.append('<xhtml:link rel="alternate" hreflang="en" href="%s"/>' % en_url(page))
            out.append('<xhtml:link rel="alternate" hreflang="x-default" href="%s"/>'
                       % cs_url(page))
            out.append("<lastmod>%s</lastmod>" % today)
            out.append("<priority>%s</priority>" % PRIORITY[page])
            for img in sitemap_images.get(page, []):
                out.append("<image:image><image:loc>%s%s</image:loc></image:image>"
                           % (SITE, img))
            out.append("</url>")
    out.append("</urlset>")
    write(os.path.join(ROOT, "sitemap.xml"), "\n".join(out) + "\n")


# ─────────────────────────────────────────────────────────────────────────────
# Step 5 — the language link is an <a> now, so it needs a button's styling
# ─────────────────────────────────────────────────────────────────────────────

ANCHOR_CSS = """
a.lang-toggle {
  text-decoration: none;
  display: inline-block;
  line-height: normal;
}
"""


def patch_css():
    path = os.path.join(ROOT, "css", "style.css")
    css = read(path)
    if "a.lang-toggle" in css:
        return
    anchor = ".lang-toggle:hover {\n  color: var(--text);\n  border-color: var(--text-secondary);\n}\n"
    assert anchor in css, "could not find .lang-toggle:hover to anchor the new rule"
    write(path, css.replace(anchor, anchor + ANCHOR_CSS, 1))


if __name__ == "__main__":
    patch_css()
    for p in PAGES:
        patch_czech(p)
        build_en(p)
        print("built en/" + en_file(p))
    build_stubs()
    print("redirect stubs: %d" % (len(LEGACY) * 2 - 1))
    build_sitemap()
    print("sitemap.xml: %d urls" % (len(PAGES) * 2))

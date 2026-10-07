"""Cuts Kimono's two typefaces down to the Latin the app shows, as the website's
font files are. The full Japanese sets are 8–9 MB a weight; these are tens of KB.
Run after adding a weight: python3 scripts/fonts.py (needs fonttools)."""
from pathlib import Path
from fontTools import subset

here = Path(__file__).resolve().parent.parent
source = here / "node_modules" / "@expo-google-fonts"
fonts = {
    "ShipporiMincho_600SemiBold": source / "shippori-mincho/600SemiBold/ShipporiMincho_600SemiBold.ttf",
    "ZenKakuGothicNew_400Regular": source / "zen-kaku-gothic-new/400Regular/ZenKakuGothicNew_400Regular.ttf",
    "ZenKakuGothicNew_500Medium": source / "zen-kaku-gothic-new/500Medium/ZenKakuGothicNew_500Medium.ttf",
    "ZenKakuGothicNew_700Bold": source / "zen-kaku-gothic-new/700Bold/ZenKakuGothicNew_700Bold.ttf",
}
# Basic Latin, Latin-1, Latin Extended-A, and the punctuation the copy uses (’ “ ” – — … · → ↓ •).
unicodes = "U+0020-007E,U+00A0-017F,U+2010-2027,U+2030-203A,U+2190-2193,U+20AC"
for name, path in fonts.items():
    options = subset.Options()
    options.layout_features = ["kern", "liga", "calt", "pnum", "tnum", "lnum"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    font = subset.load_font(str(path), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(unicodes))
    subsetter.subset(font)
    out = here / "assets" / "fonts" / f"{name}.ttf"
    subset.save_font(font, str(out), options)
    print(f"{out.name}: {out.stat().st_size // 1024} KB")

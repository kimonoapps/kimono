"""Silkscreen Kimono: the case, from iandchasse's Silkscreen enclosure with Kimono's branch on its back.

SPDX-License-Identifier: CERN-OHL-S-2.0
Modified from silkscreen-enclosures (Copyright (c) 2026 idc LLC, CERN-OHL-S v2), enclosures/case-426/src/build.py,
at commit 658f955f6665dc816de83914dbf117388d349828. See NOTICE.txt and LICENSE.txt beside this file.

What changed from the original: the back carries Kimono's ink branch (kimono-branch.svg, beside this file) where the
Silkscreen book icon was (params.LOGO_BACK, same place and depth, smaller: 18 mm wide), and Kimono's wordmark
(kimono-wordmark.svg) where the Silkscreen wordmark was, above the grip grooves (params.LOGO_BACK_WORDMARK, same place,
depth and weight, 22 mm wide). Everything else is the 4.26" standard build as published: the tub (the front, with the
e-paper window), the lid (the back) and its side keys, the four bottom keys and the display as the case holds it.
Both marks are cut 0.4 mm into the back and their inlays (the bodies that fill the cuts, printed in a second colour:
white on the crimson case) are exported too.

Usage, from a checkout of https://github.com/iandchasse/silkscreen-enclosures with its case-426 requirements:
    SILKSCREEN_VARIANT=standard python build_case.py <checkout>/enclosures/case-426/src <out dir>
Then make_model.py <out dir> makes silkscreen-kimono.glb.
"""
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC, OUT = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
OUT.mkdir(parents=True, exist_ok=True)
os.environ.setdefault('SILKSCREEN_VARIANT', 'standard')
sys.path.insert(0, str(SRC))

import cadquery as cq          # noqa: E402
import params as P             # noqa: E402

# Kimono's branch on the back, where the Silkscreen icon was, and its wordmark where the Silkscreen wordmark was
P.LOGO_BACK = dict(svg=str(HERE / 'kimono-branch.svg'), painter=False, mirror=True, width=18.0, depth=0.4,
                   x=(P.X0 + P.X1) / 2, y=(P.Y0 + P.Y1) / 2, min_feature=0.36, min_stroke=0.7)
P.LOGO_BACK_WORDMARK = dict(P.LOGO_BACK_WORDMARK, svg=str(HERE / 'kimono-wordmark.svg'), part=None, painter=False, width=22.0)

import tub, lid, keys, refs, logo, sidekeys   # noqa: E402,E401

parts = {
    'tub': tub.build,
    'lid': lambda: lid.build(keys=False),          # the lid's body; its side keys apart, as build.py splits them
    **{f'skey_{r}': (lambda r=r: sidekeys.build(r)) for r in P.TAB_ROOTS},
    'mark': lambda: logo.inlay(P.LOGO_BACK),
    'mark_word': lambda: logo.inlay(P.LOGO_BACK_WORDMARK),
    'display': refs.display,
    **{f'key_{r}': (lambda r=r: keys.key(keys.key_x(r))) for r in P.KEY_REFS},
}
for name, make in parts.items():
    cq.exporters.export(make(), str(OUT / f'{name}.stl'), tolerance=0.03, angularTolerance=0.15)
    print(name, flush=True)

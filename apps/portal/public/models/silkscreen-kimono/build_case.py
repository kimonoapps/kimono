"""Silkscreen Kimono: the case, from iandchasse's Silkscreen enclosure with Kimono's mark on its back.

SPDX-License-Identifier: CERN-OHL-S-2.0
Modified from silkscreen-enclosures (Copyright (c) 2026 idc LLC, CERN-OHL-S v2), enclosures/case-426/src/build.py,
at commit 658f955f6665dc816de83914dbf117388d349828. See NOTICE.txt and LICENSE.txt beside this file.

What changed from the original: the back carries Kimono's mark (kimono-mark.svg, beside this file: the ink branch in
white on a rose rounded square, Kimono's first icon) where the Silkscreen book icon was (params.LOGO_BACK, the same
place and depth, a little wider), and the Silkscreen wordmark above the grip grooves is left off
(params.LOGO_BACK_WORDMARK). Everything else is the 4.26" standard build as published: the tub (the front, with the
e-paper window), the lid (the back, with its side keys), the four bottom keys and the display as the case holds it.
The square is cut 0.4 mm into the back and filled by two inlays printed as the lid's first layers: the rose square
with the branch cut out of it (logo.py's painter pass) and the white branch that fills that cut.

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

# Kimono's mark on the back, where the Silkscreen icon was; no wordmark. The lid takes the whole square (LOGO_BACK);
# ROSE is the same drawing painted, so the branch comes out of it (both are placed by the square's bounds, so they agree)
P.LOGO_BACK = dict(svg=str(HERE / 'kimono-mark.svg'), painter=False, mirror=True, width=34.0, depth=0.4,
                   x=(P.X0 + P.X1) / 2, y=(P.Y0 + P.Y1) / 2, min_feature=0.36)
ROSE = dict(P.LOGO_BACK, painter=True, min_stroke=0.7)
P.LOGO_BACK_WORDMARK = None

import tub, lid, keys, refs, logo   # noqa: E402,E401

parts = {
    'tub': tub.build,
    'lid': lid.build,
    'mark': lambda: logo.inlay(ROSE),
    'mark_white': lambda: logo.inlay(P.LOGO_BACK).cut(logo.inlay(ROSE)),
    'display': refs.display,
    **{f'key_{r}': (lambda r=r: keys.key(keys.key_x(r))) for r in P.KEY_REFS},
}
for name, make in parts.items():
    cq.exporters.export(make(), str(OUT / f'{name}.stl'), tolerance=0.03, angularTolerance=0.15)
    print(name, flush=True)

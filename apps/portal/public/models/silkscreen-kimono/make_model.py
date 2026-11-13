"""Silkscreen Kimono: build_case.py's parts as one small GLB for the profile badge (silkscreen-kimono.glb).

SPDX-License-Identifier: CERN-OHL-S-2.0
Part of the Silkscreen Kimono model, from iandchasse's Silkscreen enclosure (idc LLC, CERN-OHL-S v2): see NOTICE.txt.

The case in a deep crimson rose, the back a shade deeper, the keys white, the branch and the wordmark inlaid in white on the back, the keys, and on the screen a
faint page of text (Jane Austen, public domain). Each part is decimated for the web and shaded smooth only across soft
edges. CAD millimetres (X right, Y up, Z toward the screen) become glTF metres, which share the axes.

Usage: python make_model.py <build_case.py's out dir> [font.ttf]
"""
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
PARTS = Path(sys.argv[1])
FONT = sys.argv[2] if len(sys.argv) > 2 else None

# hw.py: the panel's active area, centred on the board
ACTIVE_W, ACTIVE_H, ACTIVE_CX, ACTIVE_CY = 55.68, 92.8, 30.0, 61.5

LOOK = {  # part: (colour, roughness, faces kept)
    'tub': ('#b0263c', .58, 16000),
    'lid': ('#a12236', .62, 14000),
    'mark': ('#fff4f1', .55, 3000),
    'mark_word': ('#fff4f1', .55, 3000),
    'display': ('#2f2e2c', .4, 400),
}
KEY = ('#fff4f1', .5, 400)


def material(colour, rough, texture=None):
    rgba = [int(colour[i:i + 2], 16) / 255 for i in (1, 3, 5)] + [1.0]
    return trimesh.visual.material.PBRMaterial(baseColorFactor=rgba if texture is None else [1.0, 1.0, 1.0, 1.0], metallicFactor=0.0,
                                               roughnessFactor=rough, baseColorTexture=texture)


def part(name, colour, rough, faces):
    m = trimesh.load_mesh(PARTS / f'{name}.stl')
    m.merge_vertices()
    if len(m.faces) > faces:
        m = m.simplify_quadric_decimation(face_count=faces)
    m.apply_scale(0.001)
    m = trimesh.graph.smooth_shade(m, angle=np.radians(28))
    m.visual = trimesh.visual.TextureVisuals(material=material(colour, rough))
    return m


def page(w=600, h=1000):
    """A faint page, as an e-paper panel shows one."""
    im = Image.new('RGB', (w, h), '#e9e7e1')
    d = ImageDraw.Draw(im)
    big = ImageFont.truetype(FONT, 34) if FONT else ImageFont.load_default()
    body = ImageFont.truetype(FONT, 21) if FONT else ImageFont.load_default()
    ink = '#86837c'
    d.text((w / 2, 92), 'Chapter 1', font=big, fill=ink, anchor='mm')
    text = ('It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of '
            'a wife. However little known the feelings or views of such a man may be on his first entering a neighbourhood, '
            'this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful '
            'property of some one or other of their daughters. "My dear Mr. Bennet," said his lady to him one day, "have you '
            'heard that Netherfield Park is let at last?" Mr. Bennet replied that he had not. "But it is," returned she; "for '
            'Mrs. Long has just been here, and she told me all about it." Mr. Bennet made no answer. "Do you not want to know '
            'who has taken it?" cried his wife impatiently. "You want to tell me, and I have no objection to hearing it." This '
            'was invitation enough.').split()
    x0, x1, y, lh = 54, w - 54, 160, 36
    line = []
    for word in text + [None]:
        trial = ' '.join(line + [word]) if word else None
        if word and d.textlength(trial, font=body) <= x1 - x0:
            line.append(word)
            continue
        if word:                                  # justified, as a reader sets it
            gaps = len(line) - 1
            spare = (x1 - x0) - sum(d.textlength(t, font=body) for t in line)
            x = x0
            for t in line:
                d.text((x, y), t, font=body, fill=ink)
                x += d.textlength(t, font=body) + (spare / gaps if gaps else 0)
        else:
            d.text((x0, y), ' '.join(line), font=body, fill=ink)
        y += lh
        line = [word] if word else []
        if y > h - 90:
            break
    d.text((w / 2, h - 46), '1', font=body, fill='#a6a39b', anchor='mm')
    return im


def screen(z):
    """The page on the panel's active area, a hair in front of the glass."""
    w, h = ACTIVE_W * 0.001, ACTIVE_H * 0.001
    cx, cy, z = ACTIVE_CX * 0.001, ACTIVE_CY * 0.001, z * 0.001 + 0.00002
    v = np.array([[cx - w / 2, cy - h / 2, z], [cx + w / 2, cy - h / 2, z], [cx + w / 2, cy + h / 2, z], [cx - w / 2, cy + h / 2, z]])
    m = trimesh.Trimesh(v, [[0, 1, 2], [0, 2, 3]], process=False)
    m.visual = trimesh.visual.TextureVisuals(uv=[[0, 0], [1, 0], [1, 1], [0, 1]], material=material('#ffffff', .9, page()))
    return m


scene = trimesh.Scene()
for name, look in LOOK.items():
    scene.add_geometry(part(name, *look), node_name=name, geom_name=name)
for f in sorted([*PARTS.glob('key_*.stl'), *PARTS.glob('skey_*.stl')]):
    scene.add_geometry(part(f.stem, *KEY), node_name=f.stem, geom_name=f.stem)
glass = trimesh.load_mesh(PARTS / 'display.stl').bounds[1][2]
scene.add_geometry(screen(glass), node_name='page', geom_name='page')
out = HERE / 'silkscreen-kimono.glb'
out.write_bytes(scene.export(file_type='glb'))
print(out, out.stat().st_size // 1024, 'KB')

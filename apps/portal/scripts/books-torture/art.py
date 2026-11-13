"""Seeded image makers: Pillow 'photos' and flat illustrations, plus
reportlab vector drawings exported as SVG (labels stay real text)."""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from common import CTX

FONT_DIR = '/usr/share/fonts/truetype/dejavu/'


def font(size, bold=False):
    return ImageFont.truetype(FONT_DIR + ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'), size)


def save(img, name, quality=88):
    """Save into the work dir; photos as JPEG, flat art as PNG. Returns the file name."""
    if name.endswith('.jpg'):
        img.convert('RGB').save(CTX.work / name, quality=quality, optimize=False, progressive=False)
    else:
        img.save(CTX.work / name, optimize=False)
    return name


def _lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vgrad(w, h, stops):
    """stops: list of (pos 0..1, (r,g,b))."""
    ys = np.linspace(0, 1, h)
    arr = np.zeros((h, w, 3), dtype=np.float32)
    for c in range(3):
        col = np.interp(ys, [s[0] for s in stops], [s[1][c] for s in stops])
        arr[:, :, c] = col[:, None]
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGB')


def ridge(rng, w, base, amp, rough=0.55, octaves=9):
    """1-D fractal height line (midpoint displacement)."""
    n = 2 ** octaves + 1
    pts = np.zeros(n)
    pts[0], pts[-1] = rng.uniform(-1, 1, 2) * amp
    step, scale = n - 1, amp
    while step > 1:
        half = step // 2
        for i in range(half, n, step):
            pts[i] = (pts[i - half] + pts[i + half]) / 2 + rng.uniform(-1, 1) * scale
        scale *= rough
        step = half
    xs = np.linspace(0, n - 1, w)
    return base + np.interp(xs, np.arange(n), pts)


def grain(img, rng, amount=10):
    arr = np.asarray(img).astype(np.float32)
    arr += rng.normal(0, amount, arr.shape[:2])[:, :, None]
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGB')


def vignette(img, strength=0.35):
    w, h = img.size
    y, x = np.ogrid[0:h, 0:w]
    d = np.sqrt(((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2)
    m = 1 - strength * np.clip(d - 0.4, 0, 1)
    arr = np.asarray(img).astype(np.float32) * m[:, :, None]
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGB')


def glow(img, xy, r, color, alpha=180):
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x, y = xy
    d.ellipse([x - r * 3, y - r * 3, x + r * 3, y + r * 3], fill=color + (alpha // 3,))
    layer = layer.filter(ImageFilter.GaussianBlur(r * 1.5))
    d = ImageDraw.Draw(layer)
    d.ellipse([x - r, y - r, x + r, y + r], fill=color + (255,))
    base = img.convert('RGBA')
    base.alpha_composite(layer)
    return base.convert('RGB')


MOODS = {
    'day': [(0, (92, 140, 205)), (0.55, (178, 205, 230)), (1, (225, 232, 236))],
    'dusk': [(0, (40, 44, 92)), (0.45, (196, 104, 92)), (0.75, (240, 170, 100)), (1, (250, 214, 150))],
    'mist': [(0, (170, 178, 184)), (1, (222, 224, 220))],
    'night': [(0, (8, 12, 34)), (1, (40, 52, 86))],
    'dawn': [(0, (120, 140, 190)), (0.6, (236, 190, 180)), (1, (250, 230, 200))],
}


def landscape(seed, w=1600, h=1000, mood='day', lake=True, trees=True):
    rng = np.random.default_rng(seed)
    stops = MOODS[mood]
    img = vgrad(w, h, stops)
    sky_low = stops[-1][1]
    sun = (int(w * rng.uniform(0.2, 0.8)), int(h * rng.uniform(0.18, 0.4)))
    if mood in ('dusk', 'dawn'):
        img = glow(img, sun, h // 16, (255, 236, 190))
    elif mood == 'night':
        d = ImageDraw.Draw(img)
        for _ in range(300):
            x, y = rng.integers(0, w), rng.integers(0, int(h * 0.5))
            b = int(rng.uniform(120, 255))
            d.point((x, y), fill=(b, b, b))
        img = glow(img, sun, h // 24, (240, 240, 225), alpha=90)
    elif mood == 'day':
        clouds = Image.new('RGBA', img.size, (0, 0, 0, 0))
        cd = ImageDraw.Draw(clouds)
        for _ in range(14):
            cx, cy = rng.uniform(0, w), rng.uniform(0.05, 0.35) * h
            for _ in range(6):
                rx, ry = rng.uniform(40, 140), rng.uniform(15, 40)
                ox, oy = rng.uniform(-90, 90), rng.uniform(-15, 15)
                cd.ellipse([cx + ox - rx, cy + oy - ry, cx + ox + rx, cy + oy + ry], fill=(255, 255, 255, 120))
        clouds = clouds.filter(ImageFilter.GaussianBlur(12))
        img = img.convert('RGBA')
        img.alpha_composite(clouds)
        img = img.convert('RGB')
    d = ImageDraw.Draw(img)
    horizon = int(h * (0.62 if lake else 0.75))
    layers = 4
    far = {'day': (70, 96, 120), 'dusk': (60, 40, 70), 'mist': (110, 116, 120), 'night': (14, 18, 30), 'dawn': (90, 90, 120)}[mood]
    near = {'day': (40, 70, 40), 'dusk': (30, 20, 30), 'mist': (60, 66, 62), 'night': (5, 6, 10), 'dawn': (45, 50, 60)}[mood]
    for i in range(layers):
        t = i / (layers - 1)
        col = _lerp(_lerp(sky_low, far, 0.55), near, t)
        base = horizon - (layers - i) * h * 0.06
        line = ridge(rng, w, base, h * (0.12 - 0.02 * i), rough=0.5 + 0.05 * i)
        poly = [(x, line[x]) for x in range(w)] + [(w, horizon), (0, horizon)]
        d.polygon(poly, fill=col)
    if lake:
        top = img.crop((0, 0, w, horizon))
        refl = top.transpose(Image.FLIP_TOP_BOTTOM).resize((w, h - horizon))
        refl = Image.blend(refl, Image.new('RGB', refl.size, (30, 50, 70)), 0.35)
        rd = ImageDraw.Draw(refl)
        for _ in range(140):
            y = int(rng.uniform(0, h - horizon))
            x = int(rng.uniform(0, w))
            ln = int(rng.uniform(20, 160))
            c = tuple(int(v) for v in np.asarray(refl.getpixel((min(x, w - 1), y))) * 1.15)
            rd.line([(x, y), (x + ln, y)], fill=tuple(min(255, v) for v in c), width=2)
        img.paste(refl.filter(ImageFilter.GaussianBlur(1.2)), (0, horizon))
    else:
        d.rectangle([0, horizon, w, h], fill=near)
    if trees:
        d = ImageDraw.Draw(img)
        tc = tuple(max(0, v - 25) for v in near)
        for _ in range(int(rng.integers(5, 12))):
            x = rng.uniform(0, w)
            if lake and rng.uniform() < 0.5:
                x = rng.uniform(0, w * 0.18) if rng.uniform() < 0.5 else rng.uniform(w * 0.82, w)
            base = horizon + rng.uniform(0, 0.05) * h
            th = rng.uniform(0.15, 0.32) * h
            tw = th * 0.28
            for k in range(5):
                yy = base - th * k / 5
                ww = tw * (1 - k / 6)
                d.polygon([(x - ww, yy), (x + ww, yy), (x, yy - th * 0.4)], fill=tc)
    if mood == 'mist':
        fog = vgrad(w, h, [(0, (230, 230, 228)), (1, (200, 204, 204))])
        img = Image.blend(img, fog, 0.25)
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    return vignette(grain(img, rng, 7), 0.25)


def city(seed, w=1600, h=1000, night=False):
    rng = np.random.default_rng(seed)
    img = vgrad(w, h, MOODS['night' if night else 'dusk'])
    d = ImageDraw.Draw(img)
    street = int(h * 0.82)
    for layer in range(3):
        x = -20
        shade = (30 + layer * 18, 30 + layer * 16, 45 + layer * 18) if night else (70 - layer * 18, 60 - layer * 15, 70 - layer * 15)
        while x < w:
            bw = rng.uniform(60, 180)
            bh = rng.uniform(0.18, 0.55 - layer * 0.08) * h
            top = street - bh
            d.rectangle([x, top, x + bw, street], fill=shade)
            if rng.uniform() < 0.2:
                d.polygon([(x, top), (x + bw / 2, top - bw * 0.4), (x + bw, top)], fill=shade)
            if layer == 2:
                for wy in np.arange(top + 12, street - 20, 26):
                    for wx in np.arange(x + 10, x + bw - 14, 22):
                        if rng.uniform() < (0.45 if night else 0.25):
                            c = (250, 214, 130) if rng.uniform() < 0.8 else (200, 230, 250)
                            d.rectangle([wx, wy, wx + 10, wy + 14], fill=c)
            x += bw + rng.uniform(2, 14)
    d.rectangle([0, street, w, h], fill=(25, 25, 30))
    for i in range(0, w, 120):
        d.rectangle([i, street + (h - street) * 0.5, i + 60, street + (h - street) * 0.5 + 6], fill=(200, 190, 120))
    if night:
        for _ in range(8):
            x = rng.uniform(0, w)
            img = glow(img, (int(x), int(street - 70)), 6, (255, 220, 160), alpha=200)
    return vignette(grain(img.filter(ImageFilter.GaussianBlur(0.7)), rng, 9), 0.3)


def sea(seed, w=1600, h=1000, mood='day'):
    rng = np.random.default_rng(seed)
    img = landscape(seed, w, h, mood=mood, lake=True, trees=False)
    d = ImageDraw.Draw(img)
    horizon = int(h * 0.62)
    bx, by = rng.uniform(0.25, 0.7) * w, horizon + h * 0.08
    s = h * 0.09
    d.polygon([(bx - s, by), (bx + s * 1.2, by), (bx + s, by + s * 0.35), (bx - s * 0.8, by + s * 0.35)], fill=(50, 30, 25))
    d.line([(bx + s * 0.1, by), (bx + s * 0.1, by - s * 1.6)], fill=(40, 30, 25), width=4)
    d.polygon([(bx + s * 0.14, by - s * 1.55), (bx + s * 0.14, by - s * 0.1), (bx + s * 1.0, by - s * 0.1)], fill=(236, 226, 205))
    d.polygon([(bx + s * 0.06, by - s * 1.4), (bx + s * 0.06, by - s * 0.15), (bx - s * 0.7, by - s * 0.15)], fill=(214, 200, 180))
    for _ in range(6):
        gx, gy = rng.uniform(0, w), rng.uniform(0.1, 0.4) * h
        gs = rng.uniform(8, 18)
        d.line([(gx - gs, gy - gs / 2), (gx, gy), (gx + gs, gy - gs / 2)], fill=(40, 40, 50), width=3)
    return img


def forest(seed, w=1600, h=1000):
    rng = np.random.default_rng(seed)
    img = vgrad(w, h, [(0, (150, 175, 140)), (0.6, (90, 120, 80)), (1, (50, 60, 35))])
    d = ImageDraw.Draw(img)
    for depth in range(4):
        col = _lerp((150, 170, 140), (30, 38, 24), depth / 3)
        for _ in range(10 + depth * 3):
            x = rng.uniform(0, w)
            tw = rng.uniform(10, 26) * (1 + depth * 0.7)
            d.rectangle([x - tw / 2, 0, x + tw / 2, h], fill=col)
    rays = Image.new('RGBA', img.size, (0, 0, 0, 0))
    rd = ImageDraw.Draw(rays)
    for _ in range(5):
        x = rng.uniform(0, w)
        rd.polygon([(x, 0), (x + 60, 0), (x + 380, h), (x + 220, h)], fill=(255, 250, 210, 40))
    img = img.convert('RGBA')
    img.alpha_composite(rays.filter(ImageFilter.GaussianBlur(25)))
    img = img.convert('RGB')
    d = ImageDraw.Draw(img)
    for _ in range(400):
        x, y = rng.uniform(0, w), rng.uniform(0.85, 1) * h
        d.ellipse([x - 6, y - 3, x + 6, y + 3], fill=_lerp((60, 80, 40), (120, 110, 60), rng.uniform()))
    return vignette(grain(img.filter(ImageFilter.GaussianBlur(1.0)), rng, 8), 0.4)


def still_life(seed, w=1400, h=1000):
    rng = np.random.default_rng(seed)
    img = vgrad(w, h, [(0, (70, 60, 52)), (0.62, (120, 104, 88)), (0.63, (96, 64, 40)), (1, (60, 40, 26))])
    sh = Image.new('L', img.size, 0)
    sd = ImageDraw.Draw(sh)
    objs = []
    vx = w * rng.uniform(0.3, 0.45)
    objs.append(('vase', vx))
    for _ in range(3):
        objs.append(('fruit', w * rng.uniform(0.5, 0.8)))
    table = h * 0.66
    for kind, x in objs:
        sd.ellipse([x - 60, table - 10, x + 140, table + 30], fill=120)
    img = Image.composite(Image.new('RGB', img.size, (30, 20, 12)), img, sh.filter(ImageFilter.GaussianBlur(18)))
    d = ImageDraw.Draw(img)
    for kind, x in objs:
        if kind == 'vase':
            col = (60, 90, 120)
            d.ellipse([x - 110, table - 330, x + 110, table - 20], fill=col)
            d.rectangle([x - 40, table - 420, x + 40, table - 260], fill=col)
            d.ellipse([x - 60, table - 440, x + 60, table - 400], fill=(40, 60, 80))
            for k in range(30):
                t = k / 30
                d.arc([x - 110 + t * 60, table - 330 + t * 40, x + 110 - t * 120, table - 20 - t * 60], 200, 260,
                      fill=_lerp(col, (220, 230, 240), t), width=3)
        else:
            r = rng.uniform(45, 70)
            y = table - r + 6
            col = [(200, 60, 40), (220, 160, 40), (120, 160, 50)][int(rng.integers(0, 3))]
            for k in range(25):
                t = k / 25
                rr = r * (1 - t)
                d.ellipse([x - rr - t * r * 0.3, y - rr - t * r * 0.3, x + rr - t * r * 0.3, y + rr - t * r * 0.3],
                          fill=_lerp(tuple(int(c * 0.6) for c in col), (255, 240, 220) if t > 0.85 else col, min(1, t * 1.3)))
    return vignette(grain(img.filter(ImageFilter.GaussianBlur(1.2)), rng, 6), 0.45)


# -- flat picture-book illustrations -----------------------------------------

def hedgehog(d, x, y, s, facing=1, body=(150, 105, 70), spikes=(90, 60, 40)):
    for k in range(14):
        a = math.pi * (0.1 + 0.8 * k / 13)
        px, py = x - facing * math.cos(a) * s * 0.2, y - math.sin(a) * s * 0.55
        d.polygon([(px - s * 0.14, py + s * 0.05), (px + s * 0.14, py + s * 0.05),
                   (x - facing * math.cos(a) * s * 0.85, y - math.sin(a) * s * 0.95)], fill=spikes)
    d.ellipse([x - s * 0.75, y - s * 0.6, x + s * 0.75, y + s * 0.25], fill=spikes)
    d.ellipse([x + facing * s * 0.2 - s * 0.45, y - s * 0.35, x + facing * s * 0.2 + s * 0.45, y + s * 0.25], fill=body)
    nx = x + facing * s * 0.75
    d.polygon([(x + facing * s * 0.4, y - s * 0.25), (nx, y - s * 0.05), (x + facing * s * 0.4, y + s * 0.15)], fill=body)
    d.ellipse([nx - s * 0.07, y - s * 0.12, nx + s * 0.07, y + s * 0.02], fill=(30, 20, 20))
    ex = x + facing * s * 0.42
    d.ellipse([ex - s * 0.06, y - s * 0.22, ex + s * 0.06, y - s * 0.1], fill=(20, 20, 20))
    for fx in (-0.3, 0.3):
        d.ellipse([x + fx * s - s * 0.1, y + s * 0.15, x + fx * s + s * 0.1, y + s * 0.3], fill=body)


def illustration(seed, scene, w=1500, h=1000):
    rng = np.random.default_rng(seed)
    night = scene in ('night', 'moon', 'home', 'empty')
    sky = [(0, (30, 40, 90)), (1, (70, 70, 140))] if night else [(0, (140, 200, 230)), (1, (230, 240, 220))]
    if scene == 'rain':
        sky = [(0, (120, 130, 150)), (1, (180, 185, 190))]
    img = vgrad(w, h, sky)
    d = ImageDraw.Draw(img)
    ground = int(h * 0.72)
    if night:
        for _ in range(80):
            x, y = rng.uniform(0, w), rng.uniform(0, h * 0.6)
            r = rng.uniform(2, 5)
            d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 245, 200))
    if scene in ('moon', 'home'):
        mx, my, mr = w * 0.75, h * 0.2, h * 0.09
        d.ellipse([mx - mr, my - mr, mx + mr, my + mr], fill=(250, 240, 190))
    elif scene not in ('rain', 'night', 'empty'):
        sx, sy, sr = w * 0.15, h * 0.18, h * 0.08
        d.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=(255, 210, 80))
    hills = [(110, 170, 90), (80, 140, 70)] if not night else [(40, 60, 70), (25, 40, 50)]
    for i, col in enumerate(hills):
        cx = rng.uniform(0.2, 0.8) * w
        d.ellipse([cx - w * 0.8, ground - h * (0.18 - i * 0.06), cx + w * 0.8, ground + h * 0.5], fill=col)
    d.rectangle([0, ground, w, h], fill=hills[-1])
    if scene == 'river':
        d.polygon([(0, h * 0.85), (w, h * 0.78), (w, h * 0.92), (0, h)], fill=(90, 150, 210))
        d.polygon([(w * 0.55, h * 0.8), (w * 0.75, h * 0.8), (w * 0.7, h * 0.85), (w * 0.6, h * 0.85)], fill=(160, 90, 50))
    if scene in ('garden', 'home', 'morning'):
        hx, hy = w * 0.68, ground
        d.rectangle([hx, hy - h * 0.25, hx + w * 0.18, hy], fill=(210, 120, 80) if not night else (120, 70, 60))
        d.polygon([(hx - 20, hy - h * 0.25), (hx + w * 0.09, hy - h * 0.42), (hx + w * 0.18 + 20, hy - h * 0.25)], fill=(120, 60, 50))
        d.rectangle([hx + w * 0.07, hy - h * 0.12, hx + w * 0.11, hy], fill=(80, 50, 30))
        win = (255, 220, 120) if night else (180, 220, 240)
        d.rectangle([hx + w * 0.02, hy - h * 0.2, hx + w * 0.055, hy - h * 0.15], fill=win)
        d.rectangle([hx + w * 0.125, hy - h * 0.2, hx + w * 0.16, hy - h * 0.15], fill=win)
    if scene in ('garden', 'morning'):
        for _ in range(12):
            fx, fy = rng.uniform(0.05, 0.6) * w, rng.uniform(ground + 20, h - 30)
            c = [(240, 90, 110), (250, 200, 60), (240, 240, 250), (170, 110, 220)][int(rng.integers(0, 4))]
            d.line([(fx, fy), (fx, fy + 40)], fill=(50, 110, 50), width=4)
            for a in range(5):
                ang = a * 2 * math.pi / 5
                d.ellipse([fx + math.cos(ang) * 12 - 9, fy + math.sin(ang) * 12 - 9, fx + math.cos(ang) * 12 + 9, fy + math.sin(ang) * 12 + 9], fill=c)
            d.ellipse([fx - 6, fy - 6, fx + 6, fy + 6], fill=(250, 220, 90))
    if scene == 'rain':
        for _ in range(250):
            x, y = rng.uniform(0, w), rng.uniform(0, h)
            d.line([(x, y), (x - 6, y + 22)], fill=(200, 210, 230), width=2)
        ux, uy = w * 0.42, ground - h * 0.25
        d.pieslice([ux - 130, uy - 90, ux + 130, uy + 90], 180, 360, fill=(220, 60, 60))
        d.line([(ux, uy), (ux, uy + 150)], fill=(60, 40, 40), width=6)
    if scene == 'forest':
        for _ in range(9):
            tx = rng.uniform(0, w)
            d.rectangle([tx - 14, ground - h * 0.3, tx + 14, ground + 10], fill=(100, 70, 40))
            d.ellipse([tx - 110, ground - h * 0.55, tx + 110, ground - h * 0.22], fill=(60, 130, 60))
    hedgehog(d, w * 0.38, ground + h * 0.12, h * 0.16, facing=1 if rng.uniform() < 0.6 else -1)
    if scene in ('friends', 'home', 'river'):
        bx, by = w * 0.2, ground + h * 0.08
        d.ellipse([bx - 50, by - 60, bx + 50, by + 40], fill=(120, 120, 130))
        d.ellipse([bx - 35, by - 105, bx + 35, by - 45], fill=(130, 130, 140))
        d.ellipse([bx - 40, by - 130, bx - 20, by - 85], fill=(130, 130, 140))
        d.ellipse([bx + 20, by - 130, bx + 40, by - 85], fill=(130, 130, 140))
        d.ellipse([bx - 15, by - 85, bx - 5, by - 75], fill=(20, 20, 20))
        d.ellipse([bx + 5, by - 85, bx + 15, by - 75], fill=(20, 20, 20))
    return img


def icon_key(size=64):
    img = Image.new('RGBA', (size * 2, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = (170, 130, 50, 255)
    d.ellipse([4, 8, size - 8, size - 8], outline=c, width=size // 8)
    d.rectangle([size - 12, size // 2 - 5, size * 2 - 8, size // 2 + 5], fill=c)
    d.rectangle([size * 2 - 22, size // 2, size * 2 - 14, size - 14], fill=c)
    d.rectangle([size * 2 - 40, size // 2, size * 2 - 32, size - 18], fill=c)
    return img


def vignette_ornament(seed, w=900, h=360):
    """A small engraved-looking vignette (dense line hatching)."""
    rng = np.random.default_rng(seed)
    img = Image.new('RGB', (w, h), (250, 247, 240))
    d = ImageDraw.Draw(img)
    line = ridge(rng, w, h * 0.55, h * 0.2)
    for y in range(0, h, 5):
        for x0 in range(0, w, 3):
            if y > line[x0]:
                d.point((x0, y), fill=(40, 34, 30))
    for x in range(0, w, 6):
        d.line([(x, line[x] - 2), (x, line[x])], fill=(40, 34, 30))
    for _ in range(4):
        tx = rng.uniform(0.1, 0.9) * w
        ty = line[int(tx)]
        for k in range(0, 60, 4):
            d.line([(tx - (60 - k) / 2, ty - k * 1.5), (tx + (60 - k) / 2, ty - k * 1.5)], fill=(40, 34, 30))
    return img


# -- vector drawings ----------------------------------------------------------

def polyline(d, pts, **kw):
    """Open polyline as separate segments (renderSVG leaves PolyLine fill unset = black in SVG)."""
    from reportlab.graphics.shapes import Line
    for i in range(0, len(pts) - 2, 2):
        d.add(Line(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], **kw))


def drawing_svg(drawing, name):
    from reportlab.graphics import renderSVG
    svg = renderSVG.drawToString(drawing)
    (CTX.work / name).write_text(svg, encoding='utf-8')
    return name

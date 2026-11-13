"""Cases 9-13: image-heavy books."""
import math
import re

import numpy as np
from PIL import Image, ImageDraw
from reportlab.graphics.shapes import Circle, Drawing, Group, Line, Polygon, Rect, String
from reportlab.lib.colors import HexColor as C
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

import art
from common import BOOK_CSS, Book, esc, merge_pdfs, out, save_book, save_case, tmp, weasy


def _norm(s):
    return ' '.join(s.replace('­', '').split())


def first_words(pdf, page_index, n=6, top_mm=14, bottom_mm=22):
    import pymupdf
    pg = pymupdf.open(str(pdf))[page_index]
    mm = 72 / 25.4
    ws = [w for w in pg.get_text('words', sort=True) if w[1] > top_mm * mm and w[3] < pg.rect.height - bottom_mm * mm]
    return ' '.join(w[4] for w in ws[:n])


# 9 ---------------------------------------------------------------------------
STORY = [
    "For as long as anyone in Halse could remember, there had been a Tolley on the ferry. Old Abel Tolley had worked it for fifty years, pulling the flat black boat across the river on its chain, twelve times a day in summer and as often as he was called in winter, and when his arms gave out his son Walter took the chain, and when Walter's arms gave out — which they did sooner, for Walter was fonder of the Crown and Anchor than his father had been — his daughter Nell took it from him, at the age of fourteen, without asking anybody's permission.",
    "There were people in Halse who said a girl had no business on a ferry. Nell let them say it. She said nothing at all, which was a habit she had learned early, and went on pulling the boat across, morning and evening, in rain and fog and the white glare of August, until the people who said it found that they needed to cross the river more than they needed to be right, and paid their penny like everybody else.",
    "FIG1",
    "The river at Halse is wide and brown and slow for most of the year, and the crossing is easy enough. But twice or three times a winter the rain comes down off the moors for days together, and the river rises, and turns the colour of strong tea, and begins to carry things — branches, fence-posts, hayricks, once a whole henhouse with the hens still in it, protesting — and then the ferry does not run, and the people on the far bank must go round by the bridge at Wenlow, which is nine miles.",
    "It was on such a night, in the February that Nell was seventeen, that the knocking came at the toll-house door.",
    "She went down with the lamp and found a boy of ten or eleven on the step, soaked to the skin, with no coat and one boot. He had run, he said, all the way from Coldharbour Farm on the far side of the hill, and then all the way back again when he found the ferry-bell would not ring, and then all the way round to the toll-house by the long path, because his mother was took bad and the doctor lived on this side of the river, and was there any way across, any way at all?",
    "MIDFIG",
    "‘Fetch the doctor,’ she said. ‘Tell him to bring his bag and his best coat. I'll have the boat ready.’",
    "The doctor, when he came, was a small round man named Pargeter who had lived in Halse for thirty years and had never once been seen to hurry. He looked at the river, and he looked at Nell, and he said, ‘Miss Tolley, I have a wife and a great many unpaid accounts, and I should like to see both of them again.’ Then he put his bag in the bottom of the boat and climbed in after it.",
    "FIG2",
    "Of the crossing itself Nell would never say much. She told her own daughter, years afterwards, that she remembered the cold of the chain and the noise of the water and the doctor's voice, very calm, reciting the bones of the hand to keep himself from being sick; and that halfway over something struck the boat so hard that it swung right round on the chain and she thought the iron post had gone at last; and that it had not. That was all she would say. The rest she kept, as she kept most things, to herself.",
    "KEY",
    "The iron post on the far bank was replaced that spring by order of the parish council, and a brass plate was put on the new one with Nell's name on it and the date. The plate is still there, though you have to know where to look, for the brambles have grown over it. The ferry is not. They built a bridge at Halse in the year of the old King's jubilee, and the flat black boat was hauled up on the bank and left there, and in the end it rotted away, as boats do.",
    "But there are people in Halse, even now, who say that on February nights when the river is high you can hear a chain running somewhere out in the dark, and the sound of a calm voice reciting the bones of the hand — scaphoid, lunate, triquetral, pisiform — all the way across.",
]
MID_A = "Nell looked past him at the river. In the dark she could not see it, but she could hear it, a long low roar like a crowd a great way off, and under the roar, every now and then, a knock and a grind as something heavy went by."
MID_B = "She thought of the chain, and the ring-bolts at either end, and the old iron post on the far bank that her grandfather had always said was the best piece of iron in the county and her father had always said was rotten through."
KEY_A = "They reached Coldharbour a little after two. The boy's mother lived, and so did the baby that came that night, a girl, who was named Nell after the ferry and Pargeter after the doctor, though the second name was quietly dropped when she went to school. In the morning the boy's father walked down to the river and found Nell asleep in the bottom of the boat, still holding the chain, and in her other hand the little brass key"
KEY_B = "of the toll-house door, which she had forgotten to put down when she left it, and which she had held, she supposed, all the way across."
PLATES = [('Plate I. The river in flood, from the toll-house window.', lambda: art.landscape(901, 1300, 1900, mood='mist')),
          ('Plate II. Nell at the tiller, the night of the crossing.', lambda: art.sea(902, 1300, 1900, mood='night'))]


def illustrated():
    b = Book('illustrated', "The Ferryman's Daughter", 'Edith Marrable',
             'Illustrated story: head vignette, captioned images between paragraphs, an image inside a paragraph, a tiny '
             'inline image in a line of text, and two full-page plates that interrupt the text between pages.')
    vign = art.save(art.vignette_ornament(900), 'ill-vign.png')
    f1 = art.save(art.sea(903, 1600, 1000, mood='dusk'), 'ill-ferry.jpg')
    f2 = art.save(art.landscape(904, 1600, 900, mood='night', lake=True), 'ill-night.jpg')
    mid = art.save(art.forest(905, 1600, 800), 'ill-mid.jpg')
    key = art.save(art.icon_key(64), 'ill-key.png')
    b.chapter("The Ferryman's Daughter")
    b.fig(vign, None, cls='vign')
    for para in STORY:
        if para == 'FIG1':
            b.fig(f1, 'The ferry at the Halse crossing, looking downstream.')
        elif para == 'FIG2':
            b.fig(f2, 'The far bank, and the iron post, by lamplight.')
        elif para == 'MIDFIG':
            b.images += 1
            b.html(f'<p>{esc(MID_A)}<span class="midfig"><img src="{mid}" alt=""></span>{esc(MID_B)}</p>')
            b.t(MID_A + ' ' + MID_B)
        elif para == 'KEY':
            b.images += 1
            b.html(f'<p>{esc(KEY_A)} <img class="inl" src="{key}" alt=""> {esc(KEY_B)}</p>')
            b.t(KEY_A + ' ' + KEY_B)
        else:
            b.p(esc(para))
    b.p('THE END', cls='end')
    css = BOOK_CSS + """
    @page :first { @bottom-center { content: none } }
    h1 { font-size: 20pt; font-style: italic; margin-top: 10mm; }
    .vign img { width: 70%; }
    .midfig { display: block; margin: 0.8em 0; text-align: center; }
    .midfig img { width: 100%; }
    img.inl { height: 0.9em; vertical-align: -0.1em; }
    .end { text-align: center; text-indent: 0; letter-spacing: 0.3em; margin-top: 1.5em; font-size: 9pt; }
    p { hyphens: manual; }
    html { font-size: 11.5pt; }
    """
    body = tmp('ill-body.pdf')
    weasy(b.document(css), body)
    import pypdf
    n = len(pypdf.PdfReader(str(body)).pages)
    def mid_para(k):
        probe = _norm(first_words(body, k))
        return not any(_norm(t).startswith(probe) for t in b.truth)
    cands = [k for k in range(1, n) if mid_para(k)]
    after = [cands[0], cands[-1]] if len(cands) >= 2 else [1, n - 1]
    plate_pdfs = []
    for i, (cap, mk) in enumerate(PLATES):
        name = art.save(mk(), f'ill-plate{i + 1}.jpg')
        html = (f'<html><head><style>@page {{ size: 140mm 216mm; margin: 14mm; }} body {{ margin:0; font-family: "Noto Serif"; }}'
                f'img {{ width: 100%; height: 170mm; object-fit: cover; display: block; border: 0.5pt solid #333; }}'
                f'p {{ text-align: center; font-size: 9.5pt; font-style: italic; margin-top: 4mm; }}</style></head>'
                f'<body><img src="{name}"><p>{esc(cap)}</p></body></html>')
        plate_pdfs.append(weasy(html, tmp(f'ill-plate{i + 1}.pdf')))
    # Place plate captions in truth next to the paragraph the page break falls in.
    for (cap, _), k in reversed(list(zip(PLATES, after))):
        probe = _norm(first_words(body, k))
        idx = next(i for i, t in enumerate(b.truth) if probe in _norm(t))
        pos = idx if _norm(b.truth[idx]).startswith(probe) else idx + 1
        b.truth.insert(pos, cap)
    b.images += 2
    b.captions += [c for c, _ in PLATES]
    w = pypdf.PdfWriter()
    r = pypdf.PdfReader(str(body))
    for i, page in enumerate(r.pages):
        w.add_page(page)
        if i + 1 in after:
            w.append(str(plate_pdfs[after.index(i + 1)]))
    w.add_metadata({'/Title': b.title, '/Author': b.author})
    with open(out('illustrated.pdf'), 'wb') as f:
        w.write(f)
    b.truth = [t for t in b.truth if t != 'THE END'] + ['THE END']
    save_book(b, out('illustrated.pdf'),
              notes=f'Full-page plates are inserted after body pages {after} and interrupt a paragraph mid-sentence where the page '
                    'break falls; truth puts each plate caption after the interrupted paragraph. Plates have no page numbers '
                    '(body page numbers skip them). One forest image sits inside a paragraph (the text before and after it is '
                    'ONE paragraph); the brass key is a tiny inline image inside a line. The head vignette has no caption.',
              must_keep=['scaphoid, lunate, triquetral, pisiform', MID_A + ' ' + MID_B, KEY_A + ' ' + KEY_B])


# 10 --------------------------------------------------------------------------
PICTURE = [
    ('morning', 'Pim the hedgehog woke up early, because something was wrong.', 'below'),
    ('empty', 'Last night the moon had been there. Tonight the sky was empty.', 'over'),
    ('garden', '“Have you seen the moon?” Pim asked the flowers. The flowers only nodded in the wind.', 'below'),
    ('river', '“Have you seen the moon?” Pim asked Hare, by the river. “Not since Tuesday,” said Hare.', 'below'),
    ('forest', 'Pim looked in the forest, under every leaf. He found three beetles and a button, but no moon.', 'below'),
    ('rain', 'Then it rained, and Pim sat under a big red umbrella and felt very small.', 'over'),
    ('friends', '“Don’t worry,” said Hare. “Things that are lost are often just hiding.”', 'below'),
    ('night', 'Pim looked up, and up, and up. Behind the very last cloud there was a thin silver smile.', 'over'),
    ('moon', '“There you are,” said Pim. “You were only getting smaller, so you could get big again.”', 'below'),
    ('home', 'And Pim went home to bed, and the moon watched over him all night long.', 'below'),
]


def picture_book():
    b = Book('picture-book', 'Pim and the Lost Moon', 'Hattie Brindle',
             'Children\'s picture book: one big flat-colour illustration per page and one or two sentences of large text, '
             'sometimes printed over the picture.')
    cover = art.save(art.illustration(1000, 'moon', 1500, 1000), 'pb-cover.png')
    b.images += 1
    b.html(f'<section class="pg cover"><img src="{cover}" alt=""><h1>Pim and the Lost Moon</h1><p class="by">Hattie Brindle</p></section>')
    b.t('Pim and the Lost Moon')
    b.t('Hattie Brindle')
    for i, (scene, text, mode) in enumerate(PICTURE):
        img = art.save(art.illustration(1001 + i, scene, 1500, 1000), f'pb-{i + 1}.png')
        b.images += 1
        b.html(f'<section class="pg {mode}"><img src="{img}" alt=""><p>{esc(text)}</p></section>')
        b.t(text)
    b.html('<section class="pg end"><p>The End</p></section>')
    b.t('The End')
    css = """
    @page { size: 250mm 200mm; margin: 0; }
    body { margin: 0; font-family: 'URW Bookman', 'Noto Serif'; }
    .pg { width: 250mm; height: 200mm; position: relative; break-after: page; overflow: hidden; }
    .pg img { position: absolute; left: 12mm; top: 10mm; width: 226mm; height: 150.7mm; border-radius: 4mm; }
    .pg p { position: absolute; left: 20mm; right: 20mm; top: 166mm; font-size: 21pt; line-height: 1.25; text-align: center; margin: 0; }
    .pg.over img { left: 0; top: 0; width: 250mm; height: 200mm; border-radius: 0; }
    .pg.over p { top: 18mm; color: #fffbe8; font-weight: bold; font-size: 24pt; }
    .cover { background: #20284a; }
    .cover img { top: 40mm; }
    .cover h1 { position: absolute; top: 8mm; left: 0; right: 0; text-align: center; color: #fff4c0; font-size: 32pt; margin: 0; }
    .cover .by { top: auto; bottom: 0mm; color: #fff4c0; font-size: 14pt; }
    .end p { top: 90mm; font-size: 30pt; font-style: italic; }
    .end { break-after: auto; }
    """
    weasy(b.document(css), out('picture-book.pdf'))
    save_book(b, out('picture-book.pdf'),
              notes='Each page is one picture plus a sentence or two. On three pages the text is printed over the picture '
                    '(cream bold on a dark sky). No page numbers. Cover has title and author over a dark background.',
              chapters=[], must_keep=['“Not since Tuesday,” said Hare.', 'a thin silver smile'])


# 11 --------------------------------------------------------------------------
def photo_essay():
    b = Book('photo-essay', 'Salt Road', 'Tomas Reid',
             'Photo essay: large photographs with captions underneath, one caption set beside its photo, and a few paragraphs.')
    ph = [
        (art.landscape(1101, 1800, 1100, mood='day'), 'The causeway at low water, looking east towards Morrow Island. The posts mark the safe line; the old road ran a little to the north.'),
        (art.sea(1102, 1300, 1000, mood='day'), 'Refuge box, mile two. Built in 1887 after a carrier and his horse were caught by the tide, it has been rebuilt four times since.'),
        (art.landscape(1103, 1800, 1000, mood='dusk', lake=False), 'Samphire pickers at the edge of the saltmarsh, late August.'),
        (art.sea(1104, 1800, 1000, mood='dusk'), 'The tide coming in over the cockle beds. It moves, the island people say, at the speed of a walking horse.'),
        (art.city(1105, 1800, 1000, night=True), 'Morrow village from the harbour wall at night.'),
        (art.landscape(1106, 1800, 1000, mood='mist'), 'Fog on the sands, early morning. On days like this the island children are kept home from the mainland school.'),
    ]
    names = [art.save(im, f'pe-{i}.jpg') for i, (im, _) in enumerate(ph)]
    b.chapter('Salt Road')
    b.p('Four miles across Morrow Sands, twice a day', cls='dek')
    b.p('Photographs and words by Tomas Reid', cls='by')
    b.fig(names[0], ph[0][1], cls='full')
    b.p('The causeway across Morrow Sands is four miles long, and for about six hours of every twelve it is not there. The '
        'tide comes in across the flats from the south-west, filling the channels first and then the hollows, until the line '
        'of tarred posts that marks the road is standing up to its shoulders in grey water and the island is an island again.')
    b.p('Two hundred and forty people live on Morrow. They know the tide tables the way other people know their own '
        'telephone numbers, and they talk about the crossing the way other people talk about the weather: constantly, and '
        'without ever seeming to tire of it.')
    b.images += 1
    b.captions.append(ph[1][1])
    b.html(f'<figure class="beside"><img src="{names[1]}" alt=""><figcaption>{esc(ph[1][1])}</figcaption></figure>')
    b.t(ph[1][1])
    b.fig(names[2], ph[2][1], cls='half')
    b.fig(names[3], ph[3][1], cls='half')
    b.p('Everyone has a story about someone who left it too late. The refuge boxes, three of them, perched on iron legs '
        'beside the road, were built for those people. Most years nobody uses them. Some years somebody does, and spends a '
        'cold, loud night watching the water go by underneath, and is collected in the morning by a neighbour with a flask '
        'and a long, patient expression.')
    b.fig(names[4], ph[4][1], cls='full')
    b.p('I walked the causeway eleven times over two summers, always with someone from the island, never alone. On the last '
        'crossing, in fog so thick that the posts came up out of it one at a time like people stepping out of a crowd, my '
        'guide stopped halfway, listened for a while, and said that she could hear the tide turning. I could not hear '
        'anything at all. We walked on a little faster after that.')
    b.fig(names[5], ph[5][1], cls='full')
    css = """
    @page { size: 230mm 280mm; margin: 16mm 18mm 18mm;
      @bottom-right { content: counter(page); font: 8pt 'Liberation Sans'; } }
    html { font-family: 'Liberation Serif'; font-size: 11pt; line-height: 1.5; }
    h1 { font: bold 40pt 'Liberation Sans'; letter-spacing: -0.02em; margin: 0; }
    .dek { font: italic 15pt 'Liberation Serif'; margin: 2pt 0 4pt; }
    .by { font: 8pt 'Liberation Sans'; text-transform: uppercase; letter-spacing: 0.15em; margin-bottom: 10pt; }
    p { margin: 0 0 0.8em; width: 70%; }
    figure { margin: 0 0 12pt; break-inside: avoid; }
    figure img { width: 100%; display: block; }
    figcaption { font: 8pt/1.35 'Liberation Sans'; color: #333; margin-top: 3pt; width: 70%; }
    figure.half { display: inline-block; width: 48.5%; vertical-align: top; margin-right: 2%; }
    figure.half + figure.half { margin-right: 0; }
    figure.half figcaption { width: 100%; }
    figure.beside { display: flex; align-items: flex-end; gap: 6mm; }
    figure.beside img { width: 66%; }
    figure.beside figcaption { width: 30%; border-left: 1pt solid #000; padding-left: 4pt; }
    """
    weasy(b.document(css), out('photo-essay.pdf'))
    save_book(b, out('photo-essay.pdf'),
              notes='Captions are under each photo except the refuge box photo, whose caption sits to its right, bottom-aligned. '
                    'Two photos sit side by side with their own captions.', chapters=['Salt Road'],
              must_keep=['Morrow Sands', 'at the speed of a walking horse'])


# 12 --------------------------------------------------------------------------
def _box(d, x, y, w, h, label, fill='#e8eef6'):
    d.add(Rect(x, y, w, h, fillColor=C(fill), strokeColor=C('#1b2a40'), strokeWidth=0.8, rx=3, ry=3))
    lines = label.split('\n')
    for i, ln in enumerate(lines):
        d.add(String(x + w / 2, y + h / 2 + (len(lines) / 2 - i - 0.75) * 9, ln, fontName='Helvetica', fontSize=7.5, textAnchor='middle'))


def _arrow(d, x1, y1, x2, y2, col='#1b2a40'):
    d.add(Line(x1, y1, x2, y2, strokeColor=C(col), strokeWidth=0.9))
    a = math.atan2(y2 - y1, x2 - x1)
    s = 5
    d.add(Polygon([x2, y2, x2 - s * math.cos(a - 0.4), y2 - s * math.sin(a - 0.4), x2 - s * math.cos(a + 0.4), y2 - s * math.sin(a + 0.4)],
                  fillColor=C(col), strokeColor=None))


def diagram_flow():
    d = Drawing(470, 170)
    labels = ['Intake\nscreens', 'Coagulation', 'Settling\ntank', 'Rapid sand\nfilters', 'Chlorine\ncontact', 'Clear-water\nreservoir']
    xs = [5 + i * 78 for i in range(6)]
    for x, lab in zip(xs, labels):
        _box(d, x, 100, 62, 34, lab)
    for i in range(5):
        _arrow(d, xs[i] + 62, 117, xs[i + 1], 117)
    _box(d, xs[3], 22, 62, 30, 'Washwater\nlagoon', fill='#f3ead6')
    _arrow(d, xs[3] + 20, 100, xs[3] + 20, 52)
    d.add(String(xs[3] + 24, 74, 'backwash', fontName='Helvetica-Oblique', fontSize=7))
    _arrow(d, xs[3] + 62, 37, xs[2] + 31, 37, col='#7a4b12')
    d.add(Line(xs[2] + 31, 37, xs[2] + 31, 100, strokeColor=C('#7a4b12'), strokeWidth=0.9, strokeDashArray=[2, 2]))
    d.add(String(xs[2] - 2, 60, 'recycled supernatant', fontName='Helvetica-Oblique', fontSize=7, textAnchor='end'))
    _arrow(d, xs[5] + 31, 100, xs[5] + 31, 60)
    d.add(String(xs[5] + 31, 48, 'To distribution', fontName='Helvetica', fontSize=7.5, textAnchor='middle'))
    d.add(String(5, 152, 'Raw water from River Hart', fontName='Helvetica', fontSize=7.5))
    _arrow(d, 30, 148, 30, 134)
    return art.drawing_svg(d, 'dia-flow.svg')


def diagram_chart():
    d = Drawing(420, 200)
    x0, y0, x1, y1 = 50, 36, 400, 185
    d.add(Rect(x0, y0, x1 - x0, y1 - y0, fillColor=None, strokeColor=C('#000000'), strokeWidth=0.6))
    for hr in range(0, 25, 3):
        x = x0 + (x1 - x0) * hr / 24
        d.add(Line(x, y0, x, y0 - 3))
        d.add(String(x, y0 - 12, str(hr), fontName='Helvetica', fontSize=7, textAnchor='middle'))
    for v in [0, 5, 10, 15, 20]:
        y = y0 + (y1 - y0) * v / 20
        d.add(Line(x0 - 3, y, x0, y))
        d.add(String(x0 - 6, y - 2.5, str(v), fontName='Helvetica', fontSize=7, textAnchor='end'))
        if v:
            d.add(Line(x0, y, x1, y, strokeColor=C('#dddddd'), strokeWidth=0.4))
    rng = np.random.default_rng(1201)
    raw, fil = [], []
    for i in range(49):
        t = i / 2
        r = 8 + 7 * math.exp(-((t - 14) ** 2) / 6) + rng.normal(0, 0.6)
        f = 0.3 + 0.08 * r + rng.normal(0, 0.05)
        raw += [x0 + (x1 - x0) * t / 24, y0 + (y1 - y0) * r / 20]
        fil += [x0 + (x1 - x0) * t / 24, y0 + (y1 - y0) * f / 20]
    art.polyline(d, raw, strokeColor=C('#8a5a14'), strokeWidth=1.2)
    art.polyline(d, fil, strokeColor=C('#145a8a'), strokeWidth=1.2)
    d.add(Line(x0, y0 + (y1 - y0) * 1 / 20, x1, y0 + (y1 - y0) * 1 / 20, strokeColor=C('#c00000'), strokeWidth=0.8, strokeDashArray=[4, 2]))
    d.add(String(x1 - 3, y0 + (y1 - y0) * 1 / 20 + 3, 'Limit 1.0 NTU', fontName='Helvetica', fontSize=6.5, textAnchor='end', fillColor=C('#c00000')))
    d.add(String((x0 + x1) / 2, 6, 'Hour of day', fontName='Helvetica', fontSize=8, textAnchor='middle'))
    g = Group(String(0, 0, 'Turbidity (NTU)', fontName='Helvetica', fontSize=8, textAnchor='middle'))
    g.transform = (0, 1, -1, 0, 16, (y0 + y1) / 2)
    d.add(g)
    d.add(Line(x0 + 10, y1 - 12, x0 + 26, y1 - 12, strokeColor=C('#8a5a14'), strokeWidth=1.2))
    d.add(String(x0 + 30, y1 - 14.5, 'Raw water', fontName='Helvetica', fontSize=7))
    d.add(Line(x0 + 10, y1 - 24, x0 + 26, y1 - 24, strokeColor=C('#145a8a'), strokeWidth=1.2))
    d.add(String(x0 + 30, y1 - 26.5, 'Filtered water', fontName='Helvetica', fontSize=7))
    return art.drawing_svg(d, 'dia-chart.svg')


def diagram_map():
    d = Drawing(420, 300)
    d.add(Rect(0, 0, 420, 300, fillColor=C('#f4f1e6'), strokeColor=C('#555555'), strokeWidth=0.6))
    river = []
    for i in range(43):
        y = 300 - i * 7.2
        river += [150 + 40 * math.sin(i / 6) + i * 1.5, y]
    left = [(river[i] - 9, river[i + 1]) for i in range(0, len(river), 2)]
    right = [(river[i] + 9, river[i + 1]) for i in range(len(river) - 2, -1, -2)]
    d.add(Polygon([c for p in left + right for c in p], fillColor=C('#a9c8e4'), strokeColor=C('#6d93b8'), strokeWidth=0.6))
    d.add(Circle(95, 225, 28, fillColor=C('#a9c8e4'), strokeColor=C('#6d93b8'), strokeWidth=0.6))
    d.add(Line(0, 120, 420, 150, strokeColor=C('#c9a34a'), strokeWidth=4))
    d.add(Line(0, 120, 420, 150, strokeColor=C('#fff2c4'), strokeWidth=2))
    d.add(Rect(250, 175, 70, 45, fillColor=C('#c9c9c9'), strokeColor=C('#333333'), strokeWidth=0.8))
    d.add(Rect(280, 60, 60, 40, fillColor=C('#a9c8e4'), strokeColor=C('#333333'), strokeWidth=0.8))
    d.add(Line(205, 245, 250, 205, strokeColor=C('#1b2a40'), strokeWidth=1.2, strokeDashArray=[3, 2]))
    d.add(Line(300, 175, 305, 100, strokeColor=C('#1b2a40'), strokeWidth=1.2, strokeDashArray=[3, 2]))
    d.add(Circle(200, 250, 4, fillColor=C('#1b2a40')))
    lab = lambda x, y, t, **kw: d.add(String(x, y, t, fontName=kw.get('f', 'Helvetica'), fontSize=kw.get('s', 8), textAnchor=kw.get('a', 'start'), fillColor=C(kw.get('c', '#111111'))))
    lab(95, 222, 'Mill Pond', a='middle', f='Helvetica-Oblique', c='#1d4f7a')
    lab(208, 254, 'North Intake')
    lab(285, 224, 'Treatment Works', a='middle', f='Helvetica-Bold')
    lab(310, 50, 'Service Reservoir', a='middle')
    lab(30, 112, 'Hartwell Road', f='Helvetica-Bold', s=7.5)
    lab(178, 30, 'River Hart', f='Helvetica-Oblique', c='#1d4f7a', s=9)
    lab(330, 160, 'raw main', f='Helvetica-Oblique', s=6.5)
    lab(225, 240, 'raw main', f='Helvetica-Oblique', s=6.5)
    d.add(Polygon([390, 270, 384, 252, 396, 252], fillColor=C('#111111')))
    lab(390, 276, 'N', a='middle', f='Helvetica-Bold', s=9)
    d.add(Rect(20, 15, 100, 4, fillColor=C('#111111')))
    d.add(Rect(70, 15, 50, 4, fillColor=C('#ffffff'), strokeColor=C('#111111'), strokeWidth=0.5))
    lab(20, 24, '0', s=6.5)
    lab(120, 24, '500 m', a='middle', s=6.5)
    return art.drawing_svg(d, 'dia-map.svg')


def diagram_filter():
    d = Drawing(380, 210)
    layers = [('Supernatant water (1.2 m)', '#cfe3f3'), ('Anthracite, 0.6 m', '#3a3a3a'), ('Silica sand, 0.3 m', '#e5d29a'),
              ('Support gravel, 0.2 m', '#9a8f80'), ('Underdrain with nozzles', '#6c7a89')]
    hs = [55, 40, 30, 22, 18]
    y = 190
    for (name, col), h in zip(layers, hs):
        y -= h
        d.add(Rect(30, y, 190, h, fillColor=C(col), strokeColor=C('#222222'), strokeWidth=0.6))
        d.add(Line(220, y + h / 2, 240, y + h / 2, strokeWidth=0.5))
        d.add(String(245, y + h / 2 - 3, name, fontName='Helvetica', fontSize=7.5))
    _arrow(d, 125, 205, 125, 180)
    d.add(String(132, 196, 'inflow', fontName='Helvetica-Oblique', fontSize=7))
    _arrow(d, 125, 25, 125, 5)
    d.add(String(132, 10, 'filtered water out', fontName='Helvetica-Oblique', fontSize=7))
    return art.drawing_svg(d, 'dia-filter.svg')


def diagrams():
    b = Book('diagrams', 'Hartwell Waterworks: Operator\'s Handbook, Section 3', 'Hartwell Water Board',
             'Technical manual with four vector diagrams (flow chart, line chart, labelled map, layered cross-section) whose '
             'labels are real text, numbered sections, a caution box and a table.')
    figs = [diagram_flow(), diagram_chart(), diagram_map(), diagram_filter()]
    b.p('Section 3', cls='secno')
    b.chapter('Treatment Process and Daily Checks')
    b.heading('3.1 Overview', tag='h2')
    b.p('Raw water is drawn from the River Hart at the North Intake and passes through six stages before it reaches the '
        'service reservoir (Figure 3.1). Each stage has its own checks, set out in 3.3. Operators must sign the daily log '
        'at the end of each shift.', cls='noindent')
    b.fig(figs[0], 'Figure 3.1 Treatment stages at Hartwell. Dashed line: supernatant returned from the washwater lagoon.')
    b.heading('3.2 Turbidity', tag='h2')
    b.p('Turbidity is measured continuously on the raw and filtered water. Raw turbidity normally rises in the afternoon '
        'when the river is disturbed upstream; filtered turbidity should stay well below the 1.0 NTU limit (Figure 3.2). '
        'A filtered reading above 0.5 NTU for more than fifteen minutes is the first sign that a filter needs backwashing.',
        cls='noindent')
    b.fig(figs[1], 'Figure 3.2 Typical turbidity over 24 hours, raw and filtered.')
    b.html('<div class="caution">')
    b.p('<b>CAUTION.</b> Never backwash two filters at the same time. The washwater lagoon cannot take the volume, and the '
        'settling tank will be overloaded by the returned supernatant.', cls='noindent')
    b.html('</div>')
    b.heading('3.3 Site layout', tag='h2')
    b.p('The works sits between Hartwell Road and the river (Figure 3.3). The raw main runs underground from the North '
        'Intake to the works, and the treated main from the works to the service reservoir south of the road. The Mill Pond '
        'is not part of the supply and must not be used for abstraction.', cls='noindent')
    b.fig(figs[2], 'Figure 3.3 Site plan of the North Intake, works and service reservoir.')
    b.heading('3.4 Filters', tag='h2')
    b.p('Each rapid filter is a dual-media bed of anthracite over sand (Figure 3.4). Head loss across the bed rises as it '
        'clogs; backwash when it reaches 2.4 m or after 72 hours in service, whichever comes first.', cls='noindent')
    b.fig(figs[3], 'Figure 3.4 Cross-section of a rapid gravity filter (not to scale).')
    b.table(['Parameter', 'Normal', 'Alarm', 'Action'],
            [['Filtered turbidity', '&lt; 0.3 NTU', '0.5 NTU', 'Backwash filter'],
             ['Free chlorine at outlet', '0.4–0.6 mg/l', '&lt; 0.2 mg/l', 'Check dosing pump'],
             ['Filter head loss', '&lt; 2.0 m', '2.4 m', 'Backwash filter'],
             ['Reservoir level', '60–90 %', '&lt; 40 %', 'Call duty manager']],
            caption='Table 3.1 Alarm thresholds')
    css = BOOK_CSS + """
    @page { size: A4; margin: 20mm 20mm 22mm;
      @top-left { content: "Operator's Handbook"; font: 8pt 'Liberation Sans'; color: #555; }
      @top-right { content: 'Section 3'; font: 8pt 'Liberation Sans'; color: #555; }
      @bottom-center { content: '3\\2013' counter(page); font: 8pt 'Liberation Sans'; } }
    html { font-family: 'Liberation Sans'; font-size: 10pt; }
    p { text-align: left; }
    .secno { text-indent: 0; font-size: 10pt; color: #555; text-transform: uppercase; letter-spacing: 0.2em; }
    h1 { text-align: left; font-size: 20pt; font-weight: bold; margin: 0 0 1em; break-before: auto; }
    h2 { font-size: 11.5pt; margin-top: 1.4em; }
    figure img { width: 88%; }
    figcaption { font-style: normal; font-size: 8.5pt; text-align: left; margin-left: 6%; }
    .caution { border: 1.2pt solid #b00; background: #fff1f0; padding: 6pt 8pt; margin: 1em 0; }
    """
    weasy(b.document(css), out('diagrams.pdf'))
    save_book(b, out('diagrams.pdf'),
              notes='All four figures are SVG drawn by reportlab and embedded as vectors: their labels (box names, axis '
                    'titles, map names, layer names) are real PDF text but belong to the figures, NOT to the body truth. An '
                    'EPUB should keep each diagram as an image (rasterised or SVG) with its caption; label text leaking into '
                    'paragraphs is a failure. Page numbers are "3-n" (furniture).',
              must_keep=['(Figure 3.1)', '0.5 NTU', 'whichever comes first'],
              figure_label_samples=['Rapid sand', 'Washwater', 'Turbidity (NTU)', 'Hour of day', 'Mill Pond', 'Hartwell Road',
                                    'Silica sand, 0.3 m', 'Underdrain with nozzles'])


# 13 --------------------------------------------------------------------------
PAL = {'night': (34, 40, 78), 'mill': (60, 50, 60), 'fair': (40, 30, 70), 'sky': (120, 160, 210)}


def _figure(d, x, y, s, kind, face=1):
    if kind == 'mira':
        d.polygon([(x, y - s * 1.1), (x - s * 0.45, y), (x + s * 0.45, y)], fill=(200, 50, 50))
        d.ellipse([x - s * 0.25, y - s * 1.55, x + s * 0.25, y - s * 1.05], fill=(240, 205, 170))
        d.pieslice([x - s * 0.28, y - s * 1.6, x + s * 0.28, y - s * 1.1], 180, 360, fill=(90, 50, 30))
        d.ellipse([x + face * s * 0.08 - 3, y - s * 1.33 - 3, x + face * s * 0.08 + 3, y - s * 1.33 + 3], fill=(20, 20, 20))
    elif kind == 'grandad':
        d.rectangle([x - s * 0.35, y - s * 1.5, x + s * 0.35, y], fill=(110, 110, 120))
        d.ellipse([x - s * 0.28, y - s * 2.1, x + s * 0.28, y - s * 1.5], fill=(235, 200, 170))
        d.pieslice([x - s * 0.28, y - s * 1.95, x + s * 0.28, y - s * 1.4], 0, 180, fill=(240, 240, 240))
        d.ellipse([x + face * s * 0.1 - 3, y - s * 1.85 - 3, x + face * s * 0.1 + 3, y - s * 1.85 + 3], fill=(20, 20, 20))
    elif kind == 'fox':
        d.polygon([(x - s * 0.5, y), (x + s * 0.5, y), (x, y - s * 0.9)], fill=(220, 110, 30))
        d.polygon([(x - s * 0.35, y - s * 0.8), (x + s * 0.35, y - s * 0.8), (x + face * s * 0.5, y - s * 1.15), (x, y - s * 1.35)], fill=(230, 120, 40))
        d.polygon([(x - s * 0.3, y - s * 1.1), (x - s * 0.15, y - s * 1.55), (x, y - s * 1.2)], fill=(200, 90, 20))
        d.polygon([(x + s * 0.05, y - s * 1.2), (x + s * 0.2, y - s * 1.6), (x + s * 0.3, y - s * 1.1)], fill=(200, 90, 20))
        d.ellipse([x - face * s * 0.6 - s * 0.4, y - s * 0.4, x - face * s * 0.6 + s * 0.4, y - s * 0.1], fill=(230, 130, 50))
        d.ellipse([x + face * s * 0.12 - 3, y - s * 1.05 - 3, x + face * s * 0.12 + 3, y - s * 1.05 + 3], fill=(20, 20, 20))
    elif kind == 'lantern':
        d.line([(x, y - s * 0.6), (x, y - s * 0.4)], fill=(60, 40, 20), width=3)
        d.ellipse([x - s * 0.22, y - s * 0.42, x + s * 0.22, y + s * 0.02], fill=(255, 200, 80))


def _panel_img(seed, scene, who, w=800, h=560, lanterns=0, sfx=None, baked=()):
    rng = np.random.default_rng(seed)
    bg = PAL.get(scene, (80, 80, 110))
    img = art.vgrad(w, h, [(0, bg), (1, tuple(min(255, c + 50) for c in bg))])
    d = ImageDraw.Draw(img)
    ground = int(h * 0.82)
    if scene in ('night', 'fair'):
        for _ in range(30):
            x, y = rng.uniform(0, w), rng.uniform(0, h * 0.4)
            d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(250, 240, 200))
        for k in range(5):
            bx = k * w / 5 + rng.uniform(0, 30)
            bh = rng.uniform(0.3, 0.55) * h
            d.rectangle([bx, ground - bh, bx + w / 5 - 20, ground], fill=(24, 26, 50))
            d.polygon([(bx - 8, ground - bh), (bx + (w / 5 - 20) / 2, ground - bh - 50), (bx + w / 5 - 12, ground - bh)], fill=(50, 30, 40))
    if scene == 'mill':
        d.rectangle([w * 0.1, h * 0.15, w * 0.9, ground], fill=(80, 64, 60))
        for k in range(6):
            d.line([(w * 0.1, h * 0.15 + k * 60), (w * 0.9, h * 0.15 + k * 60)], fill=(60, 48, 46), width=4)
    d.rectangle([0, ground, w, h], fill=(50, 50, 40) if scene != 'fair' else (70, 50, 40))
    for k in range(lanterns):
        lx, ly = rng.uniform(0.05, 0.95) * w, rng.uniform(0.15, 0.45) * h
        art_img = art.glow(img, (int(lx), int(ly)), 12, (255, 200, 90), alpha=200)
        img.paste(art_img)
        d = ImageDraw.Draw(img)
    xs = np.linspace(w * 0.25, w * 0.75, max(1, len(who)))
    for x, k in zip(xs, who):
        _figure(d, x, ground + 10, h * 0.28 if k != 'grandad' else h * 0.24, k, face=1 if x < w / 2 else -1)
    if sfx:
        f = art.font(70, bold=True)
        d.text((w * 0.5, h * 0.45), sfx, font=f, fill=(255, 220, 60), stroke_width=5, stroke_fill=(30, 20, 20))
    for (bx, by, bw, text, kind) in baked:
        f = art.font(26, bold=True)
        lines = _wrap_px(text, f, bw * (0.9 if kind == 'cap' else 0.7))
        bh = 34 * len(lines) + (28 if kind == 'cap' else 44)
        if kind == 'cap':
            d.rectangle([bx, by, bx + bw, by + bh], fill=(255, 236, 150), outline=(0, 0, 0), width=3)
        else:
            d.ellipse([bx, by, bx + bw, by + bh + 10], fill=(255, 255, 255), outline=(0, 0, 0), width=3)
            d.polygon([(bx + bw * 0.4, by + bh + 4), (bx + bw * 0.55, by + bh + 4), (bx + bw * 0.45, by + bh + 50)], fill=(255, 255, 255), outline=(0, 0, 0))
        for i, ln in enumerate(lines):
            tw = d.textlength(ln, font=f)
            d.text((bx + (bw - tw) / 2, by + (14 if kind == 'cap' else 24) + i * 34), ln, font=f, fill=(0, 0, 0))
    return img


def _wrap_px(text, f, width):
    words, lines, cur = text.split(), [], ''
    tmpd = ImageDraw.Draw(Image.new('RGB', (10, 10)))
    for wd in words:
        t = (cur + ' ' + wd).strip()
        if tmpd.textlength(t, font=f) <= width or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = wd
    lines.append(cur)
    return lines


COMIC = [
    [  # page 1
        ('night', ['mira', 'grandad'], 0, None, [('cap', 'Brindleford, the night before the Lantern Fair.')]),
        ('night', ['mira'], 0, None, [('say', 'Grandad, every lantern in the square has gone out!')]),
        ('night', ['grandad'], 0, None, [('say', "Not gone out, Mira. Gone. Somebody's taken them.")]),
        ('night', [], 0, None, [('cap', 'Somebody had. A trail of candle-wax led down to the river.')]),
        ('night', ['mira'], 0, None, [('say', 'Look — wax drips! They go all the way to the old mill.')]),
        ('night', ['grandad', 'mira'], 0, None, [('say', "Then that's where we're going. Bring the little lantern. The one that never goes out.")]),
    ],
    [  # page 2
        ('mill', [], 6, None, [('cap', 'The old mill.'), ('say', "Who's there? Go away! These are MINE now!")]),
        ('mill', ['mira'], 0, None, [('say', 'We just want the lanterns back. The Fair is tomorrow!')]),
        ('mill', ['fox'], 3, 'KRASH!', [('say', 'The Fair, the Fair! Nobody ever brings a lantern for ME.')]),
        ('mill', ['mira', 'fox'], 0, None, [('say', '...Is that why you took them? Because you were lonely?')]),
        ('mill', ['fox'], 0, None, [('say', '...Maybe.')]),
        ('mill', ['grandad', 'fox'], 0, None, [('say', 'Then come to the Fair with us. You can carry the biggest one.')]),
    ],
    [  # page 3: lettering baked into the raster art
        ('fair', [], 12, None, [('cap', 'The next evening...')]),
        ('fair', ['fox'], 8, None, [('say', "It's... it's so bright!")]),
        ('fair', ['mira'], 8, None, [('say', "That's what happens when you share them.")]),
        ('fair', ['grandad'], 8, None, [('say', "Best Lantern Fair in forty years, I'd say.")]),
        ('fair', ['fox', 'mira', 'grandad'], 14, None, [('cap', 'And every year after that, the fox carried the first lantern.')]),
        ('fair', [], 20, None, [('cap', 'THE END')]),
    ],
]


def comic():
    pdfmetrics.registerFont(TTFont('CBold', art.FONT_DIR + 'DejaVuSans-Bold.ttf'))
    pdfmetrics.registerFont(TTFont('CReg', art.FONT_DIR + 'DejaVuSans.ttf'))
    W, H = 170 * 2.8346, 260 * 2.8346
    path = out('comic.pdf')
    c = canvas.Canvas(str(path), pagesize=(W, H), invariant=1)
    c.setTitle('The Lantern Thief')
    c.setAuthor('Jonah Vellacott')
    truth = ['The Lantern Thief']
    margin, gut = 22, 8
    top = H - 60
    pw, ph = (W - 2 * margin - gut) / 2, (top - 30 - 2 * gut) / 3
    seed = 1300
    images = 0
    for pi, page in enumerate(COMIC):
        if pi == 0:
            c.setFont('CBold', 26)
            c.drawCentredString(W / 2, H - 42, 'THE LANTERN THIEF')
        else:
            c.setFont('CReg', 8)
        c.setFont('CReg', 8)
        c.drawCentredString(W / 2, 14, str(pi + 1))
        for k, (scene, who, lant, sfx, texts) in enumerate(page):
            col, row = k % 2, k // 2
            x = margin + col * (pw + gut)
            y = top - (row + 1) * ph - row * gut
            seed += 1
            baked = []
            if pi == 2:
                bx = 30
                for kind, t in texts:
                    baked.append((bx, 26, 500 if kind == 'say' else 560, t, kind))
            img = _panel_img(seed, scene, who, lanterns=lant, sfx=sfx, baked=baked)
            name = f'comic-{pi}-{k}.jpg'
            art.save(img, name)
            images += 1
            c.drawImage(str(art.CTX.work / name), x, y, pw, ph)
            c.setLineWidth(2)
            c.rect(x, y, pw, ph)
            if pi < 2:
                by = y + ph - 8
                for kind, t in texts:
                    if kind == 'cap':
                        lines = simpleSplit(t, 'CBold', 7.5, pw - 20)
                        bh = 10 * len(lines) + 6
                        c.setFillColorRGB(1, 0.93, 0.6)
                        c.rect(x + 4, by - bh, pw - 8, bh, fill=1, stroke=1)
                        c.setFillColorRGB(0, 0, 0)
                        c.setFont('CBold', 7.5)
                        for i, ln in enumerate(lines):
                            c.drawString(x + 9, by - 10 - i * 10, ln)
                        by -= bh + 6
                    else:
                        bw = pw * 0.78
                        lines = simpleSplit(t, 'CBold', 8, bw * 0.7)
                        bh = 10.5 * len(lines) + 22
                        bx = x + (pw - bw) / 2 + (8 if k % 2 else -8)
                        c.setFillColorRGB(1, 1, 1)
                        c.setLineWidth(1.2)
                        c.ellipse(bx, by - bh, bx + bw, by, fill=1, stroke=1)
                        p = c.beginPath()
                        p.moveTo(bx + bw * 0.42, by - bh + 2)
                        p.lineTo(bx + bw * 0.38, by - bh - 16)
                        p.lineTo(bx + bw * 0.55, by - bh + 3)
                        c.drawPath(p, fill=1, stroke=0)
                        c.line(bx + bw * 0.42, by - bh + 1, bx + bw * 0.38, by - bh - 16)
                        c.line(bx + bw * 0.38, by - bh - 16, bx + bw * 0.55, by - bh + 2)
                        c.setFillColorRGB(0, 0, 0)
                        c.setFont('CBold', 8)
                        for i, ln in enumerate(lines):
                            c.drawCentredString(bx + bw / 2, by - 16 - i * 10.5, ln)
                        by -= bh + 20
            truth.extend(t for _, t in texts)
        c.showPage()
    c.save()
    save_case('comic', 'The Lantern Thief', 'Jonah Vellacott',
              'Three comic pages, six panels each: caption boxes and speech balloons. Pages 1-2 letter balloons as real '
              'text over raster panels; on page 3 the lettering is baked into the panel images (needs OCR).',
              '\n\n'.join(truth) + '\n',
              {'chapters': [], 'images': images, 'captions': [], 'notes': 0, 'verse_blocks': 0, 'tables': 0,
               'must_keep': ["Not gone out, Mira. Gone. Somebody's taken them.", '...Maybe.', 'These are MINE now!'],
               'raster_only_text': [t for _, _, _, _, ts in COMIC[2] for _, t in ts]},
              notes='Truth is the lettering in reading order (page, then panel left-to-right, top-to-bottom; within a panel '
                    'caption box then balloon). Speakers are not named in the art. The "KRASH!" sound effect is drawn into a '
                    'panel image and is not in truth. Page 3 lettering exists only as pixels; without OCR it cannot be '
                    'recovered (listed under expect.raster_only_text). Panels count as images (18).',
              pdf=path)


CASES = [illustrated, picture_book, photo_essay, diagrams, comic]

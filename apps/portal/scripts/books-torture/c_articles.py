"""Cases 7-8: a magazine feature and an academic paper."""
from reportlab.lib.colors import HexColor as C
from reportlab.graphics.shapes import Drawing, Line, PolyLine, Polygon, Rect, String

import art
from common import Book, esc, out, save_book, weasy


# 7 ---------------------------------------------------------------------------
MAG_BODY = [
    "At four in the morning the only light in Vell comes from the bakehouse at the bottom of Church Lane, and the only sound is the scrape of Rosa Albanell's iron peel across the oven floor. She has been doing this, by her own count, for forty-one years — first as her mother's helper, then as her mother's replacement, and now, at seventy-three, as the last person in the valley who knows exactly how long a faggot of vine prunings takes to bring a stone oven up to heat in February.",
    "‘You don't measure it,’ she says, when I ask. ‘You listen to it. When the stone stops ticking, it's ready.’ She says this as though it were the most obvious thing in the world, and then she goes back to listening.",
    "Vell, a village of some three hundred people strung along a ridge above the river Sorre, once had nine communal ovens. Every household paid a small fee — in coins, in flour, or in firewood — for the right to bake there on its appointed day, and every loaf was marked with a family's sign, pressed into the dough with a carved wooden stamp before it went in, so that it could be claimed when it came out. Some of the stamps are still in use. Most of them hang on kitchen walls now, beside the calendars.",
    "The ovens closed one by one through the second half of the last century, as electric cookers arrived and young families left for the towns. By 1990 there was only one left, the bakehouse on Church Lane, and by 2005 it was firing only twice a week. ‘Everybody said it would be the next to go,’ says Joaquim Ferrer, who runs the village shop and sits on the parish council. ‘Everybody except Rosa. She just kept lighting it.’",
    "What changed was not, at first, anything to do with bread. In 2014 a storm brought down the power lines along the ridge and left Vell without electricity for nine days. On the second morning, people began to arrive at the bakehouse with bowls of dough they had mixed by candlelight. On the third morning there was a queue. By the end of the week the oven was running from four in the morning until after dark, and Rosa had taught eleven people how to read the colour of the stone.",
    "Several of them never stopped. Today the bakehouse fires five days a week, run by a loose cooperative of about thirty households who take turns with the fire and the sweeping. There is a waiting list for Saturdays. A schoolteacher from the next valley drives her class up once a term to watch the loaves go in. And the old wooden stamps have come back off the kitchen walls: Ferrer counts at least forty families who mark their bread again, some with signs that have been in use since before anyone can remember, and a few with new ones — a bicycle, a cat, a set of initials, and, on one memorable occasion, a very small and quite detailed tractor.",
    "None of this is to say that the oven is easy. It eats wood — a cubic metre a week in winter — and the cooperative spends much of its time arguing about where the next load is coming from. The roof leaks. The chimney needs relining, and the quote for the work is more than the cooperative has raised in five years of bake sales. And there is the question nobody likes to ask out loud, which is what will happen when Rosa can no longer come down Church Lane at four in the morning.",
    "She is unsentimental about it. ‘The oven doesn't care who lights it,’ she says. ‘It only cares that somebody does.’ She has spent the past two winters training a successor, a quiet former electrician named Pau Serrat, who moved to Vell from Barcelona during the storm year and never went back. He says he is still learning to hear the stone. ‘Some mornings I think I've got it,’ he says. ‘Then she looks at me, and I know I haven't.’",
    "At half past six the first batch comes out — round, dark, dusted with flour, each one bearing its small pressed sign — and is laid on the long wooden shelf by the door. Outside, the sky over the Sorre is turning the colour of weak tea, and people are already arriving with empty baskets. Rosa watches them come. Then she turns back to the oven, opens the iron door a hand's width, and listens.",
]
PULL = ["“The oven doesn't care who lights it. It only cares that somebody does.”",
        "By the end of the week the oven was running from four in the morning until after dark."]


def magazine():
    b = Book('magazine', 'The Ovens of Vell', 'Ines Carraway',
             'Three-column magazine feature: kicker, headline, standfirst, byline, drop cap, pull quotes, tinted sidebar, photos with captions.')
    imgs = [
        (art.save(art.landscape(701, 1800, 1000, mood='dawn'), 'mag-dawn.jpg'), 'Dawn over the Sorre valley, seen from the top of Church Lane.'),
        (art.save(art.still_life(702, 1400, 1000), 'mag-bread.jpg'), "Bread cooling on the shelf by the bakehouse door. Each loaf carries its family's pressed sign."),
        (art.save(art.forest(703, 1000, 1300), 'mag-wood.jpg'), "Vine prunings and pine stacked for the winter in a neighbour's yard."),
        (art.save(art.landscape(704, 1600, 1000, mood='mist', lake=False), 'mag-mist.jpg'), 'Mist settles over the ridge. For nine days in 2014 the village had no power.'),
    ]
    b.p('Food &amp; Place', cls='kicker')
    b.chapter('The Ovens of Vell', cls='headline')
    b.p('In a hill village where the last communal bakehouse was supposed to close, a storm, a stubborn baker and forty '
        'wooden bread stamps have brought the fire back.', cls='standfirst')
    b.p('Words by Ines Carraway · Photographs by Tomas Reid', cls='byline')
    b.fig(imgs[0][0], imgs[0][1], cls='hero')
    b.html('<div class="cols">')
    for i, para in enumerate(MAG_BODY):
        b.p(f'<span class="dc">{para[0]}</span>{esc(para[1:])}' if i == 0 else esc(para), cls='first' if i == 0 else '')
        if i == 1:
            b.html(f'<blockquote class="pull">{esc(PULL[0])}</blockquote>')
        if i == 2:
            b.fig(imgs[1][0], imgs[1][1])
        if i == 4:
            b.html('<aside class="side">')
            b.heading('How a communal oven is fired', tag='h3')
            steps = ['The night before, the baker lays a fire of vine prunings and broken pine on the oven floor.',
                     'Around 3 a.m. the fire is lit and fed for about ninety minutes, until the dome turns from black to white.',
                     'The embers are raked out and the floor is swabbed with a wet mop of rags.',
                     "The oven is sealed and left to ‘settle’ for twenty minutes; the stone ticks as it cools.",
                     'The first loaves go in when the ticking stops.']
            b.lst([esc(s) for s in steps], tag='ol', cls='steps')
            b.html('</aside>')
            b.fig(imgs[2][0], imgs[2][1])
        if i == 5:
            b.html(f'<blockquote class="pull">{esc(PULL[1])}</blockquote>')
        if i == 6:
            b.fig(imgs[3][0], imgs[3][1])
    b.p('■', cls='end')
    b.html('</div>')
    css = """
    @page { size: A4; margin: 16mm 14mm 18mm 14mm;
      @bottom-left { content: 'HINTERLAND \\00b7  SPRING 2026'; font: 7pt 'Liberation Sans'; letter-spacing: 0.1em; }
      @bottom-right { content: counter(page); font: bold 8pt 'Liberation Sans'; } }
    html { font-family: 'Liberation Serif'; font-size: 9.6pt; line-height: 1.38; }
    p { margin: 0; text-align: justify; text-indent: 1em; hyphens: auto; }
    .kicker { text-indent: 0; font: bold 8pt 'Liberation Sans'; letter-spacing: 0.25em; text-transform: uppercase; color: #b4441c; }
    h1.headline { font: bold 44pt/1 'Liberation Serif'; margin: 4pt 0 8pt; letter-spacing: -0.01em; }
    .standfirst { text-indent: 0; font: italic 14pt/1.3 'Liberation Serif'; width: 75%; margin-bottom: 6pt; }
    .byline { text-indent: 0; font: bold 7.5pt 'Liberation Sans'; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 8pt; }
    figure { margin: 0 0 8pt; break-inside: avoid; }
    figure img { width: 100%; display: block; }
    figcaption { font: 7.2pt/1.3 'Liberation Sans'; color: #444; margin-top: 3pt; }
    .hero figcaption { text-align: right; }
    .cols { columns: 3; column-gap: 5mm; column-rule: 0.4pt solid #bbb; }
    .first { text-indent: 0; }
    .dc { float: left; font: bold 34pt/0.8 'Liberation Serif'; padding: 3pt 3pt 0 0; color: #b4441c; }
    blockquote.pull { margin: 8pt 0; padding: 6pt 0; border-top: 2pt solid #b4441c; border-bottom: 0.6pt solid #b4441c;
      font: italic 15pt/1.2 'Liberation Serif'; color: #b4441c; break-inside: avoid; }
    aside.side { background: #efe6d6; padding: 6pt 7pt; margin: 6pt 0 8pt; font: 8pt/1.35 'Liberation Sans'; break-inside: avoid; }
    aside.side h3 { font: bold 9pt 'Liberation Sans'; margin: 0 0 4pt; text-transform: uppercase; letter-spacing: 0.06em; }
    ol.steps { margin: 0; padding-left: 12pt; }
    ol.steps li { margin-bottom: 2pt; }
    .end { text-align: right; color: #b4441c; }
    """
    weasy(b.document(css), out('magazine.pdf'))
    b.truth = [t for t in b.truth if t != '■']
    save_book(b, out('magazine.pdf'),
              notes='Pull quotes repeat body sentences and are NOT in truth (an EPUB may drop them or keep them once as '
                    f'styled quotes): {PULL}. The kicker "Food & Place", standfirst and byline are in truth. The sidebar box '
                    '(heading + numbered steps) is placed in truth where it sits in the column flow. Folio "HINTERLAND · SPRING 2026" '
                    'and page numbers are furniture. Drop cap on the first paragraph.',
              must_keep=['Rosa Albanell', 'When the stone stops ticking', 'Pau Serrat', 'very small and quite detailed tractor'],
              pull_quotes=PULL)


# 8 ---------------------------------------------------------------------------
def chart_song():
    w, h = 360, 220
    d = Drawing(w, h)
    x0, y0, x1, y1 = 48, 40, 345, 205
    d.add(Rect(x0, y0, x1 - x0, y1 - y0, fillColor=None, strokeColor=C('#000000'), strokeWidth=0.6))
    for hr in range(0, 25, 4):
        x = x0 + (x1 - x0) * hr / 24
        d.add(Line(x, y0, x, y0 - 3, strokeWidth=0.6))
        d.add(String(x, y0 - 13, f'{hr:02d}:00', fontName='Helvetica', fontSize=7, textAnchor='middle'))
    for v in range(0, 13, 3):
        y = y0 + (y1 - y0) * v / 12
        d.add(Line(x0 - 3, y, x0, y, strokeWidth=0.6))
        d.add(String(x0 - 6, y - 2.5, str(v), fontName='Helvetica', fontSize=7, textAnchor='end'))
    import math
    def series(peak, amp, shift):
        pts = []
        for i in range(97):
            t = i / 4
            v = amp * math.exp(-((t - peak) ** 2) / 3) + 0.45 * amp * math.exp(-((t - shift) ** 2) / 5) + 0.6
            pts += [x0 + (x1 - x0) * t / 24, y0 + (y1 - y0) * min(v, 11.8) / 12]
        return pts
    urb, wood = series(4.6, 10.5, 19.5), series(5.6, 8.5, 20.2)
    band = [(urb[i], urb[i + 1] + 8) for i in range(0, len(urb), 2)] + [(urb[i], max(y0, urb[i + 1] - 8)) for i in range(len(urb) - 2, -1, -2)]
    d.add(Polygon([c for p in band for c in p], fillColor=C('#cfd8e6'), strokeColor=None))
    art.polyline(d, urb, strokeColor=C('#1d3d7a'), strokeWidth=1.3)
    art.polyline(d, wood, strokeColor=C('#7a1d1d'), strokeWidth=1.1)
    d.add(String((x0 + x1) / 2, 8, 'Time of day (h)', fontName='Helvetica', fontSize=8, textAnchor='middle'))
    lab = String(0, 0, 'Song output (phrases per min)', fontName='Helvetica', fontSize=8, textAnchor='middle')
    from reportlab.graphics.shapes import Group
    g = Group(lab)
    g.transform = (0, 1, -1, 0, 14, (y0 + y1) / 2)
    d.add(g)
    d.add(Line(250, 190, 266, 190, strokeColor=C('#1d3d7a'), strokeWidth=1.3))
    d.add(String(270, 187.5, 'Urban (n = 6)', fontName='Helvetica', fontSize=7))
    d.add(Line(250, 178, 266, 178, strokeColor=C('#7a1d1d'), strokeWidth=1.1))
    d.add(String(270, 175.5, 'Woodland (n = 4)', fontName='Helvetica', fontSize=7))
    return art.drawing_svg(d, 'paper-fig1.svg')


REFS = [
    'Halloway, R. and Pinset, J. (2011). Dawn chorus timing under artificial light. <i>Journal of Avian Acoustics</i> 14(2), 113–129.',
    'Mbeki-Thorne, A. (2016). Noise, light and the urban songbird: a review. <i>Urban Ecology Letters</i> 3, 41–58.',
    'Oyelaran, M. and Lindqvist, T. (2019). A twenty-pound acoustic recorder for long deployments. <i>Methods in Field Ornithology</i> 7(4), 288–301.',
    'Castellan, F., Voss, H. and Ito, R. (2014). Song rate as a proxy for territory quality. <i>Behavioural Notes</i> 22, 9–17.',
    'Ramaswamy, P. (2020). Cosinor models for count data in ecology. <i>Statistical Ecology Quarterly</i> 11(1), 1–24.',
    'Delacroix-Hume, B. (2008). <i>The Blackbird in Town and Country</i>. Eastmarch University Press.',
    'Kowalczyk, Z. and Adeyemi, O. (2018). Street lighting spectra and avian activity onset. <i>Light &amp; Life</i> 5, 77–92.',
    'Nygaard, S. (2021). False dawns: early song under sodium lamps. <i>Journal of Avian Acoustics</i> 24(1), 5–19.',
]


def paper():
    b = Book('paper', 'Diurnal Patterns in Song Output of Urban Blackbirds: Evidence from a Low-Cost Acoustic Array',
             'Mara Oyelaran, Tobias Lindqvist, Priya Ramaswamy',
             'Two-column academic paper: title block, abstract, [n] citations, figure and table captions, equations, footnotes, references.')
    fig1 = chart_song()
    fig2 = art.save(art.city(802, 1400, 1000, night=False), 'paper-fig2.jpg')
    b.manual_fn = True
    b.html('<header class="tb">')
    b.chapter(b.title, cls='ptitle')
    b.p('Mara Oyelaran<sup>1</sup>, Tobias Lindqvist<sup>2</sup> and Priya Ramaswamy<sup>1</sup>', cls='authors')
    b.p('<sup>1</sup>Department of Zoology, University of Eastmarch    <sup>2</sup>Institute for Urban Ecology, Harrowgate Polytechnic', cls='affil')
    b.p('Correspondence: m.oyelaran@example.org', cls='affil')
    b.html('<div class="abstract">')
    b.heading('Abstract', tag='h2', cls='abs-h')
    b.p('Urban blackbirds (<i>Turdus merula</i>) are often reported to begin singing earlier than woodland birds, but most '
        'studies rely on a few mornings of manual observation. We deployed ten low-cost recorders for 61 days at six urban and '
        'four woodland sites and counted song phrases automatically. Urban birds started singing a median of 52 minutes earlier '
        'and reached peak output 1.1 h sooner. A cosinor model with a light-at-night covariate explained 71% of the deviance in '
        'hourly phrase counts. Street lighting, not noise, was the strongest predictor of early onset.', cls='noindent')
    b.p('<b>Keywords:</b> song rate; dawn chorus; light pollution; passive acoustic monitoring', cls='kw')
    b.html('</div></header><div class="cols">')
    b.chapter('1 Introduction', tag='h2', cls='sec', record=True)
    b.p('The timing of the dawn chorus is among the most visible effects of city life on birds [1, 2]. Early song has been '
        'linked to artificial light [7, 8] and to daytime noise [2], but the two are hard to separate because they are '
        'correlated in most cities.[[fn:Our six urban sites were chosen to break this correlation: two are lit but quiet, two '
        'noisy but dark, and two both.]] Manual counts are also expensive, which limits sample sizes to a handful of mornings '
        'per site [4].', cls='noindent')
    b.p('Here we use a cheap recorder design [3] to follow song output around the clock for two months, and model hourly '
        'counts with a cosinor regression [5]. We ask whether urban birds sing earlier, whether they sing more, and which of '
        'light or noise better explains the difference.')
    b.chapter('2 Methods', tag='h2', cls='sec', record=True)
    b.heading('2.1 Sites and recorders', tag='h3')
    b.p('Recorders were mounted 3 m above ground on lamp posts or trees (Figure 2) and sampled at 16 kHz from 1 March to 30 '
        'April. Each unit cost under £20 in parts.[[fn:Bill of materials and firmware are archived with the data.]] '
        'Light at night <i>L</i> was measured once per site with a handheld lux meter at midnight.', cls='noindent')
    b.heading('2.2 Phrase counts and model', tag='h3')
    b.p('A template detector counted song phrases per minute, <i>s</i><sub><i>i</i></sub>(<i>t</i>), for bird <i>i</i>. The '
        'site-level song rate is the mean over the <i>N</i> birds detected:', cls='noindent')
    b.html('<div class="eq"><span class="m"><i>r</i>(<i>t</i>) = <span class="frac"><span>1</span><span><i>N</i></span></span> '
           '<span class="big">∑</span><sub><i>i</i>=1</sub><sup><i>N</i></sup> <i>s</i><sub><i>i</i></sub>(<i>t</i>)</span>'
           '<span class="eqn">(1)</span></div>')
    b.t('r(t) = (1/N) ∑_{i=1}^{N} s_i(t) (1)')
    b.p('Hourly counts were modelled as Poisson with a log link and a 24-hour harmonic:', cls='noindent')
    b.html('<div class="eq"><span class="m">log λ(<i>t</i>) = β<sub>0</sub> + β<sub>1</sub> cos(2π<i>t</i>/24) '
           '+ β<sub>2</sub> sin(2π<i>t</i>/24) + γ<i>L</i></span><span class="eqn">(2)</span></div>')
    b.t('log λ(t) = β_0 + β_1 cos(2πt/24) + β_2 sin(2πt/24) + γL (2)')
    b.p('Peak time follows as <i>t</i>* = (24/2π) atan2(β<sub>2</sub>, β<sub>1</sub>).')
    b.chapter('3 Results', tag='h2', cls='sec', record=True)
    b.p('We detected 41 singing males (26 urban, 15 woodland) and counted 2.3 million phrases. Urban birds started singing a '
        'median of 52 minutes before woodland birds and peaked earlier (Figure 1). The evening peak was weaker at both kinds '
        'of site.', cls='noindent')
    b.fig(fig1, 'Figure 1: Mean song output by hour at urban (blue) and woodland (red) sites. Shaded band: 95% interval for urban sites.')
    b.p('Table 1 gives the fitted coefficients of model (2). Light at night had a strong positive effect on early-morning '
        'song; adding a noise term did not improve the fit (ΔAIC = 1.4).')
    b.table(['Term', 'Estimate', 'SE', '<i>p</i>'],
            [['β<sub>0</sub>', '1.82', '0.04', '&lt;0.001'], ['β<sub>1</sub>', '0.61', '0.03', '&lt;0.001'],
             ['β<sub>2</sub>', '0.88', '0.03', '&lt;0.001'], ['γ (per 10 lx)', '0.12', '0.02', '&lt;0.001'],
             ['Noise (per 10 dB)', '0.02', '0.03', '0.51']],
            caption='Table 1: Fitted coefficients of model (2), all sites pooled.')
    b.fig(fig2, 'Figure 2: A recorder unit mounted 3 m up a lamp post at urban site U4.')
    b.chapter('4 Discussion', tag='h2', cls='sec', record=True)
    b.p('Our results agree with earlier short-term studies that city blackbirds sing earlier [1, 8], and extend them to a '
        'full two-month season. The light covariate alone accounts for most of the urban shift, which suggests that dimming '
        'or re-timing street lights could restore a more natural chorus [7]. Song output overall was not higher in town, '
        'contrary to [6]. A cheap array is enough to answer these questions at many more sites than manual counts allow.',
        cls='noindent')
    b.heading('Acknowledgements', tag='h3')
    b.p('We thank the Eastmarch parks department for access to lamp posts, and two anonymous reviewers.', cls='noindent')
    b.chapter('References', tag='h2', cls='sec', record=True)
    b.lst(REFS, tag='ol', cls='refs')
    b.html('</div>')
    css = """
    @page { size: A4; margin: 18mm 15mm 20mm 15mm;
      @top-left { content: 'Oyelaran et al.'; font: italic 7.5pt 'Liberation Serif'; }
      @top-right { content: 'Urban Ecology Letters 9 (2026)'; font: italic 7.5pt 'Liberation Serif'; }
      @bottom-center { content: counter(page); font: 8pt 'Liberation Serif'; }
      @footnote { border-top: 0.4pt solid #000; padding-top: 2pt; } }
    @page :first { @top-left { content: none } @top-right { content: none } }
    html { font-family: 'Liberation Serif'; font-size: 9.5pt; line-height: 1.3; }
    p { margin: 0; text-align: justify; text-indent: 1em; hyphens: auto; }
    .noindent { text-indent: 0; }
    .tb { text-align: center; margin-bottom: 10pt; }
    h1.ptitle { font: bold 16pt/1.2 'Liberation Serif'; margin: 0 6% 8pt; }
    .authors { text-align: center; text-indent: 0; font-size: 11pt; }
    .affil { text-align: center; text-indent: 0; font-size: 8pt; font-style: italic; }
    .abstract { margin: 10pt 8% 0; text-align: justify; font-size: 9pt; }
    h2.abs-h { font-size: 9.5pt; margin: 0 0 3pt; }
    .kw { text-indent: 0; margin-top: 4pt; }
    .cols { columns: 2; column-gap: 6mm; }
    h2 { font-size: 10.5pt; margin: 9pt 0 3pt; }
    h3 { font-size: 9.5pt; font-style: italic; font-weight: normal; margin: 6pt 0 2pt; }
    .eq { display: flex; justify-content: space-between; align-items: center; margin: 6pt 0 6pt 4%; font-family: 'Liberation Serif'; }
    .eq .m { font-size: 9.8pt; white-space: nowrap; }
    .fncall { font-size: 70%; line-height: 0; }
    .frac { display: inline-block; vertical-align: middle; text-align: center; font-size: 8.5pt; }
    .frac span { display: block; padding: 0 1pt; }
    .frac span + span { border-top: 0.5pt solid #000; }
    .big { font-size: 15pt; vertical-align: middle; }
    figure { margin: 6pt 0; break-inside: avoid; }
    figure img { width: 100%; }
    figcaption { font-size: 8pt; text-align: justify; margin-top: 2pt; }
    table { border-collapse: collapse; margin: 6pt auto; font-size: 8.5pt; border-top: 1pt solid #000; border-bottom: 1pt solid #000; }
    caption { font-size: 8pt; margin-bottom: 3pt; text-align: left; }
    th { border-bottom: 0.5pt solid #000; text-align: left; padding: 2pt 6pt; }
    td { padding: 1.5pt 6pt; }
    .fn { float: footnote; font-size: 7.5pt; text-indent: 0; }
    ::footnote-call { font-size: 70%; vertical-align: super; line-height: 0; }
    ol.refs { padding-left: 16pt; margin: 0; font-size: 8pt; list-style-type: '[' counter(list-item) '] '; }
    ol.refs li { margin-bottom: 2pt; text-align: left; }
    """
    notes_txt = '  '.join(f'{i}. {t}' for i, t in enumerate(b.fn_texts, 1)).replace("'", "\\'")
    css += f"""@page :first {{ margin-bottom: 30mm; @bottom-left {{ content: '{notes_txt}'; font: 7.5pt/1.3 'Liberation Serif';
      vertical-align: top; text-align: left; border-top: 0.4pt solid #000; padding-top: 3pt; width: 100%; }}
      @bottom-center {{ content: none }} }}"""
    weasy(b.document(css), out('paper.pdf'))
    save_book(b, out('paper.pdf'),
              notes='Display equations (1) and (2) are linearised in truth in a LaTeX-like form; inline math (s_i(t), t*) is '
                    'whatever plain text the sub/superscripts give ("si(t)"): compare equations loosely. Citation brackets '
                    'like [1, 8] and [5] must stay. Figure 1 is a vector chart (axis labels and legend are real text, NOT in '
                    'truth); Figure 2 is a raster photo. The table caption is above the table. Reference numbers are list '
                    'markers ([1]...[8]) and not in truth. Running heads and journal line are furniture. "chapters" lists the '
                    'numbered section headings. Both footnotes are set in the bottom margin of page 1 (WeasyPrint footnotes misplace '
                    'in multi-column flow); they sit after the body of their section in truth.',
              must_keep=['[1, 2]', '[7, 8]', '[4]', '[3]', '(Figure 2)', '(Figure 1)', 'Turdus merula', 'ΔAIC = 1.4',
                         'Delacroix-Hume, B. (2008).'])


CASES = [magazine, paper]

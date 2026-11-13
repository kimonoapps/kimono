"""Cases 14-16: columns with spanning figures, a fully furnished book, scripts."""
import re

from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import BaseDocTemplate, Flowable, Frame, PageTemplate, Paragraph

import art
from common import (BOOK_CSS, Book, esc, gutenberg, merge_pdfs, out, paragraphs, plain, save_book, save_case, tmp,
                    weasy)

LIB = '/usr/share/fonts/truetype/liberation/'


# 14 --------------------------------------------------------------------------
class Mark(Flowable):
    def __init__(self, idx, log):
        super().__init__()
        self.idx, self.log = idx, log

    def wrap(self, aw, ah):
        return 0, 0

    def draw(self):
        self.log.setdefault(self.idx, self.canv.getPageNumber())


def columns():
    pdfmetrics.registerFont(TTFont('LS', LIB + 'LiberationSerif-Regular.ttf'))
    pdfmetrics.registerFont(TTFont('LSI', LIB + 'LiberationSerif-Italic.ttf'))
    pdfmetrics.registerFont(TTFont('LSB', LIB + 'LiberationSerif-Bold.ttf'))
    pdfmetrics.registerFontFamily('LS', normal='LS', italic='LSI', bold='LSB', boldItalic='LSB')
    paras = paragraphs(gutenberg('pg1022.txt'))
    body = [t for _, t in paras if t not in ('WALKING', 'by Henry David Thoreau')]
    words, take = 0, []
    for t in body:
        take.append(t)
        words += len(t.split())
        if words > 3300:
            break
    W, H = 612, 792
    m, gut = 40, 14
    cw = (W - 2 * m - 2 * gut) / 3
    colx = [m + i * (cw + gut) for i in range(3)]
    top, bot = H - m, m + 14
    figs = {
        1: (art.save(art.landscape(1401, 1600, 900, mood='day'), 'col-1.jpg'), 'The meadows below Fair Haven Hill, late afternoon. The figure spans the first two columns.'),
        2: (art.save(art.forest(1402, 1100, 1000), 'col-2.jpg'), 'A wood-path in October. This picture straddles the gutter between the second and third columns.'),
        3: (art.save(art.landscape(1403, 2000, 700, mood='dusk', lake=True), 'col-3.jpg'), 'Sunset over the river, from the railroad causeway: the full width of the page.'),
    }
    cap_style = ParagraphStyle('cap', fontName='LSI', fontSize=8, leading=10)
    title_h = 86
    # page 1: title band, figure over cols 1-2
    f1h = 2 * cw + gut
    f1_img_h = f1h * 9 / 16
    f1_top = top - title_h
    f1_bot = f1_top - f1_img_h - 30
    p1 = [Frame(m, top - title_h, W - 2 * m, title_h, id='title', showBoundary=0, leftPadding=0, rightPadding=0),
          Frame(colx[0], bot, cw, f1_bot - bot, id='c1', leftPadding=0, rightPadding=0),
          Frame(colx[1], bot, cw, f1_bot - bot, id='c2', leftPadding=0, rightPadding=0),
          Frame(colx[2], bot, cw, top - title_h - bot, id='c3', leftPadding=0, rightPadding=0)]
    # page 2: figure straddling the col2/col3 gutter, mid-page
    f2w, f2h = 190, 190 * 10 / 11
    f2x = colx[2] - gut / 2 - f2w / 2
    f2y0, f2y1 = H / 2 - f2h / 2 - 22, H / 2 + f2h / 2
    p2 = [Frame(colx[0], bot, cw, top - bot, id='a1', leftPadding=0, rightPadding=0)]
    p2 += [Frame(colx[1], f2y1 + 6, cw, top - f2y1 - 6, id='b1', leftPadding=0, rightPadding=0),
           Frame(colx[1], f2y0, f2x - 8 - colx[1], f2y1 + 6 - f2y0, id='b2', leftPadding=0, rightPadding=0),
           Frame(colx[1], bot, cw, f2y0 - 6 - bot, id='b3', leftPadding=0, rightPadding=0)]
    p2 += [Frame(colx[2], f2y1 + 6, cw, top - f2y1 - 6, id='d1', leftPadding=0, rightPadding=0),
           Frame(f2x + f2w + 8, f2y0, colx[2] + cw - f2x - f2w - 8, f2y1 + 6 - f2y0, id='d2', leftPadding=0, rightPadding=0),
           Frame(colx[2], bot, cw, f2y0 - 6 - bot, id='d3', leftPadding=0, rightPadding=0)]
    # page 3: full-width figure at the bottom
    f3h = (W - 2 * m) * 7 / 20
    f3_top = bot + f3h + 26
    p3 = [Frame(x, f3_top + 8, cw, top - f3_top - 8, leftPadding=0, rightPadding=0) for x in colx]
    pn = [Frame(x, bot, cw, top - bot, leftPadding=0, rightPadding=0) for x in colx]

    def furniture(c, doc):
        c.setFont('LS', 8)
        c.drawCentredString(W / 2, m - 6, str(doc.page))
        if doc.page > 1:
            c.drawString(m, H - m + 12, 'WALKING')
            c.drawRightString(W - m, H - m + 12, 'Henry David Thoreau')

    def draw_fig(c, key, x, y, w, h):
        name, cap = figs[key]
        c.drawImage(ImageReader(str(art.CTX.work / name)), x, y, w, h)
        p = Paragraph(esc(cap), cap_style)
        _, ph = p.wrap(w, 40)
        p.drawOn(c, x, y - ph - 3)

    def on1(c, doc):
        furniture(c, doc)
        draw_fig(c, 1, colx[0], f1_top - f1_img_h, f1h, f1_img_h)

    def on2(c, doc):
        furniture(c, doc)
        draw_fig(c, 2, f2x, f2y0 + 22, f2w, f2h - 22 + 22 - 22)

    def on3(c, doc):
        furniture(c, doc)
        draw_fig(c, 3, m, bot + 26, W - 2 * m, f3h)

    log = {}
    doc = BaseDocTemplate(str(out('columns.pdf')), pagesize=(W, H), title='Walking', author='Henry David Thoreau',
                          invariant=1, leftMargin=m, rightMargin=m, topMargin=m, bottomMargin=m)
    doc.afterPage = lambda: doc.handle_nextPageTemplate({1: 'p2', 2: 'p3'}.get(doc.page, 'pn'))
    doc.addPageTemplates([PageTemplate('p1', p1, onPage=on1),
                          PageTemplate('p2', p2, onPage=on2),
                          PageTemplate('p3', p3, onPage=on3),
                          PageTemplate('pn', pn, onPage=furniture)])
    st = ParagraphStyle('b', fontName='LS', fontSize=9.6, leading=12.4, alignment=TA_JUSTIFY, firstLineIndent=10)
    story = [Paragraph('Walking', ParagraphStyle('t', fontName='LSB', fontSize=34, leading=38)),
             Paragraph('Henry David Thoreau', ParagraphStyle('a', fontName='LSI', fontSize=13, leading=18, spaceBefore=4))]
    from reportlab.platypus import FrameBreak
    story.append(FrameBreak())
    for i, t in enumerate(take):
        story.append(Mark(i, log))
        story.append(Paragraph(esc(t).replace('_', ''), st))
    doc.build(story)
    truth = ['Walking', 'Henry David Thoreau']
    pages = {1: 1, 2: 2, 3: 3}
    placed = set()
    for i, t in enumerate(take):
        for k, pg in pages.items():
            if k not in placed and log.get(i, 99) >= pg:
                truth.append(figs[k][1])
                placed.add(k)
        truth.append(t.replace('_', ''))
    for k in pages:
        if k not in placed:
            truth.append(figs[k][1])
    save_case('columns', 'Walking', 'Henry David Thoreau',
              'Three-column reportlab layout of a public-domain essay with figures spanning two columns, straddling a '
              'gutter (text wraps on both sides) and spanning all three.',
              '\n\n'.join(truth) + '\n',
              {'chapters': ['Walking'], 'images': 3, 'captions': [figs[k][1] for k in (1, 2, 3)], 'notes': 0,
               'verse_blocks': 0, 'tables': 0, 'must_keep': ['Sainte-Terrer', 'sans terre']},
              notes='Text: the opening ~3,300 words of Thoreau\'s "Walking" (1862, public domain, from Project Gutenberg '
                    '#1022), set by reportlab. Figures are drawn behind the flow, so caption positions in truth are '
                    'approximate: each caption is placed before the first paragraph that starts on the figure\'s page. On '
                    'page 2 the column text runs past the figure in narrowed frames on both sides of it.',
              pdf=out('columns.pdf'))


# 15 --------------------------------------------------------------------------
ESSAYS = ['Of Truth', 'Of Death', 'Of Revenge', 'Of Adversity']
NOTES = {
    'Of Truth': [
        ('said jesting Pilate', 'fn', 'John 18:38. The word ‘jesting’ is Bacon’s; the gospel says only that Pilate went out again to the Jews.'),
        ('vinum daemonum', 'en', '‘The wine of devils.’ Bacon gives no source; the phrase is often attributed to one of the Church Fathers, though no exact match has been found.'),
        ('The poet, that beautified the sect', 'fn', 'Lucretius, whose poem gave Epicurean philosophy its finest verse. The passage paraphrased here opens Book II of <i>De Rerum Natura</i>.'),
        ('turn upon the poles of truth', 'en', 'A favourite figure: the mind as a sphere turning on fixed poles, like the heavens in the old astronomy.'),
    ],
    'Of Death': [
        ('Pompa mortis magis terret, quam mors ipsa.', 'fn', '‘The trappings of death frighten more than death itself.’ Attributed to Seneca.'),
        ('Augustus Caesar died in a compliment', 'en', 'Suetonius reports his last words to his wife: ‘Livia, mindful of our marriage, live on, and farewell.’'),
        ('Extinctus amabitur idem.', 'en', 'Horace, <i>Epistles</i> II.1.14: ‘the same man, once dead, will be loved.’'),
    ],
    'Of Revenge': [
        ('wild justice', 'fn', 'Perhaps the most quoted phrase in the <i>Essays</i>. ‘Wild’ here means untamed, outside the law, rather than frenzied.'),
        ('Cosmus, duke of Florence', 'en', 'Cosimo de’ Medici (1389–1464). The saying is recorded in several collections of apophthegms, including Bacon’s own.'),
    ],
    'Of Adversity': [
        ('Bona rerum secundarum optabilia; adversarum mirabilia.', 'fn', 'Seneca, <i>Epistles</i> 66: ‘The good things of prosperity are to be wished for; those of adversity, to be wondered at.’'),
        ('in an earthen pot or pitcher', 'en', 'Bacon’s version of the myth is unusual; most accounts have Hercules cross the ocean in a golden cup lent by the Sun.'),
        ('hearse-like airs', 'fn', 'Funeral music. A hearse was originally a frame for candles set over a coffin.'),
    ],
}
GLOSS = [('giddiness', 'fickleness, changeability of opinion', 'Truth'), ('discoursing wits', 'minds given to argument', 'Truth'),
         ('mummeries', 'masked shows, mimes', 'Truth'), ('carbuncle', 'a red precious stone', 'Truth'), ('poesy', 'poetry', 'Truth'),
         ('vantage ground', 'a position of advantage', 'Truth'), ('round dealing', 'plain, honest dealing', 'Truth'),
         ('allay', 'alloy; a baser metal mixed in', 'Truth'), ('embaseth', 'debases, lowers in value', 'Truth'), ('stay', 'wait', 'Truth'),
         ('tribute', 'payment due', 'Death'), ('mortification', 'ascetic self-denial', 'Death'), ('blacks', 'mourning clothes', 'Death'),
         ('obsequies', 'funeral rites', 'Death'), ('mates', 'overcomes, checkmates', 'Death'), ('preoccupateth', 'anticipates', 'Death'),
         ('niceness', 'fastidiousness', 'Death'), ('satiety', 'weariness from excess', 'Death'), ('despatch', 'haste, speed in business', 'Death'),
         ('dolors', 'pains, griefs', 'Death'), ('canticle', 'a hymn or song', 'Death'), ('wild justice', 'justice taken outside the law', 'Revenge'),
         ('put out of office', 'deprive of its function', 'Revenge'), ('before hand', 'ahead; with the advantage', 'Revenge'),
         ('generous', 'noble, well-born', 'Revenge'), ('infortunate', 'unfortunate', 'Revenge'), ('tune', 'frame of mind', 'Revenge'),
         ('high speech', 'lofty saying', 'Adversity'), ('transcendences', 'flights beyond the ordinary', 'Adversity'),
         ('lively', 'vividly', 'Adversity'), ('in a mean', 'moderately', 'Adversity'), ('heroical', 'heroic', 'Adversity'),
         ('hearse-like airs', 'funeral music', 'Adversity'), ('pencil', 'paintbrush', 'Adversity'), ('distastes', 'annoyances', 'Adversity'),
         ('sad', 'dark, sober in colour', 'Adversity'), ('lightsome', 'light-coloured, bright', 'Adversity'),
         ('incensed', 'burned like incense', 'Adversity'), ('discover', 'reveal', 'Adversity'), ('bark', 'a small ship', 'Adversity')]


def bacon_essays():
    lines = gutenberg('pg575.txt').split('\n')
    starts = [i for i, l in enumerate(lines) if re.fullmatch(r'Of [A-Z][A-Za-z ,\-\']+', l.strip()) and i > 100]
    out_ = {}
    for t in ESSAYS:
        i = next(k for k in starts if lines[k].strip() == t)
        j = next(k for k in starts if k > i)
        out_[t] = [p for _, p in paragraphs('\n'.join(lines[i + 1:j]))]
    return out_


def notes():
    texts = bacon_essays()
    b = Book('notes', 'Four Essays', 'Francis Bacon',
             'Annotated edition: roman-numbered front matter, footnotes and endnotes, running heads by chapter, '
             'drop caps, small caps, ligatures, hyphenation, chapters opening on recto pages, a table across two pages.')
    # front matter (roman numerals) ------------------------------------------
    b.html('<section class="tp">')
    b.p('Four Essays', cls='tp-title')
    b.p('or Counsels, Civil and Moral', cls='tp-sub')
    b.p('Francis Bacon', cls='tp-auth')
    b.p('Edited, with notes and a glossary, by H. M. Sallow', cls='tp-ed')
    b.html('</section><section class="verso">')
    b.p('The text of the essays follows the edition of 1625 in modern spelling. Notes, glossary and preface © 2026 '
        'the editor. This edition may be freely copied.', cls='small')
    b.html('</section><section class="contents">CONTENTS</section>')
    b.chapter('Preface', cls='chapter front')
    b.p('<span class="dc">F</span><span class="sc">rancis Bacon</span> published the first ten of his Essays in 1597, '
        'when he was thirty-six, and went on revising and enlarging them for the rest of his life; the edition of 1625, the '
        'last he saw through the press, contains fifty-eight. The four printed here are among the shortest and the best '
        'known. The text follows the 1625 edition in modern spelling, with Bacon’s punctuation, which is heavier than '
        'ours, left largely as it stands.[[fn:Where the old pointing seemed likely to mislead a modern reader, a comma has '
        'been silently removed; nothing has been added.]]', cls='first')
    b.p('Bacon wrote, as he said himself, ‘dispersed meditations’, not treatises: each essay circles its subject, '
        'quotes the ancients, turns a proverb over, and ends, as often as not, with a sentence that sounds like a verdict and '
        'reads like a question. The Latin quotations he scattered through them have been kept, and are translated in the '
        'footnotes or in the notes at the end of the book; the footnotes also gloss words whose meaning has shifted since '
        'his day, such as <span class="sc">wild</span>, <span class="sc">sad</span> and <span class="sc">generous</span>.')
    b.p('A short glossary of such words follows the notes, for readers who would rather look a word up once than meet its '
        'explanation many times. The editor is grateful to the officers of the Eastmarch Library for the loan of a 1625 '
        'quarto, and to its first owner, whose marginal ‘fie!’ against the essay on revenge has been a fine and '
        'steadying influence on the notes.')
    b.flush_notes()
    front_html = ''.join(b.body)
    b.body = []
    # body (arabic) ---------------------------------------------------------
    for t in ESSAYS:
        b.html('<section class="essay">')
        b.chapter(t)
        for k, para in enumerate(texts[t]):
            src = esc(para)
            for phrase, kind, note in NOTES[t]:
                e = esc(phrase)
                if e in src:
                    src = src.replace(e, f'{e}[[{kind}:{note}]]', 1)
            if k == 0:
                m = re.match(r'([A-Z]+(?: [A-Z]+)*)\b', src)
                head = m.group(1)
                src = f'<span class="dc">{head[0]}</span><span class="sc">{head[1:].lower()}</span>' + src[len(head):]
                b.p(src, cls='first')
            else:
                b.p(src)
        b.html('</section>')
    for t in ESSAYS:
        for phrase, _, _ in NOTES[t]:
            assert any(phrase in p for p in texts[t]), phrase
    b.html('<section class="essay">')
    b.endnotes_section('Notes')
    b.html('</section><section class="essay">')
    b.chapter('Glossary')
    b.table(['Word', 'Sense in Bacon', 'Essay'], [[w, s, e] for w, s, e in GLOSS], cls='gloss')
    b.html('</section>')
    css = BOOK_CSS + """
    @page { margin: 20mm 16mm 20mm 18mm; }
    @page :left { margin-left: 16mm; margin-right: 18mm;
      @top-left { content: 'Four Essays'; font: italic 8.5pt 'Noto Serif'; }
      @bottom-center { content: none } @bottom-left { content: counter(page); font: 9pt 'Noto Serif'; } }
    @page :right {
      @top-right { content: string(chap, first-except); font: italic 8.5pt 'Noto Serif'; }
      @bottom-center { content: none } @bottom-right { content: counter(page); font: 9pt 'Noto Serif'; } }
    @page :blank { @top-left { content: none } @top-right { content: none } @bottom-left { content: none } @bottom-right { content: none } }
    html { hyphens: auto; font-variant-ligatures: common-ligatures; }
    p { orphans: 1; widows: 1; }
    h1 { string-set: chap content(); break-before: auto; font-variant: small-caps; letter-spacing: 0.06em; margin: 18mm 0 10mm; }
    section.essay { break-before: right; } section.essay:first-child { break-before: auto; }
    .dc { float: left; font-size: 34pt; line-height: 0.9; padding: 1pt 3pt 0 0; margin-top: 1pt; }
    .first { text-indent: 0; }
    .sc { font-variant: small-caps; letter-spacing: 0.03em; }
    .en { text-indent: -1.4em; padding-left: 1.4em; font-size: 9.5pt; margin-bottom: 0.4em; text-align: left; }
    .enn { display: inline-block; width: 1.4em; text-indent: 0; }
    sup.enref { font-size: 65%; line-height: 0; }
    table.gloss { width: 100%; font-size: 9pt; }
    table.gloss th { border-bottom: 0.8pt solid #000; font-variant: small-caps; }
    table.gloss tr { break-inside: avoid; }
    """
    body_pdf = tmp('notes-body.pdf')
    weasy(b.document(css), body_pdf)
    # chapter start pages for the contents
    import pymupdf
    doc = pymupdf.open(str(body_pdf))
    starts = {}
    for t in ESSAYS + ['Notes', 'Glossary']:
        for i, pg in enumerate(doc):
            blocks = pg.get_text('blocks', sort=True)
            if any(bl[4].strip().lower() == t.lower() and bl[1] > 60 for bl in blocks[:2]):
                starts[t] = i + 1
                break
    # page-break hyphenation check: last body line on a page ending in a hyphen
    hy = []
    for i, pg in enumerate(doc):
        ls = []
        for bl in pg.get_text('dict')['blocks']:
            for ln in bl.get('lines', []):
                sp = [s for s in ln['spans'] if 10 < s['size'] < 11]
                if sp:
                    ls.append((ln['bbox'][3], ''.join(s['text'] for s in ln['spans'])))
        if ls and max(ls)[1].rstrip().endswith(('-', '‐')):
            hy.append(i + 1)
    toc = ''.join(f'<tr><td>{t}</td><td class="pg">{starts.get(t, "")}</td></tr>' for t in ['Preface'] + ESSAYS + ['Notes', 'Glossary'])
    toc = toc.replace('<td class="pg"></td>', '<td class="pg">PREFACE_PG</td>', 1)
    front_html = front_html.replace('<section class="contents">CONTENTS</section>',
                                    f'<section class="contents"><h1 class="ct">Contents</h1><table class="toc">{toc}</table></section>')
    front_css = css + """
    @page :left { @bottom-left { content: counter(page, lower-roman); } }
    @page :right { @bottom-right { content: counter(page, lower-roman); } @top-right { content: none } }
    @page :left { @top-left { content: none } }
    @page :first { @bottom-right { content: none } }
    .tp { text-align: center; break-after: page; padding-top: 30mm; }
    .tp p { text-align: center; text-indent: 0; }
    .tp-title { font-size: 26pt; font-variant: small-caps; letter-spacing: 0.08em; }
    .tp-sub { font-style: italic; font-size: 12pt; margin-bottom: 18mm; }
    .tp-auth { font-size: 15pt; font-variant: small-caps; letter-spacing: 0.1em; margin-bottom: 40mm; }
    .tp-ed { font-size: 10pt; }
    .verso { break-after: page; padding-top: 140mm; }
    .verso p { text-indent: 0; font-size: 8.5pt; text-align: left; }
    .contents { break-before: right; break-after: page; }
    h1.ct { break-before: auto; }
    table.toc { width: 80%; margin: 0 auto; font-size: 10.5pt; }
    table.toc td { border: none; padding: 3pt 0; }
    table.toc td.pg { text-align: right; }
    h1.front { break-before: right; }
    """
    front_pdf = tmp('notes-front.pdf')
    weasy(b.document(front_css, body=front_html), front_pdf)
    fdoc = pymupdf.open(str(front_pdf))
    pidx = next(i for i, pg in enumerate(fdoc) if any(bl[4].strip().lower() == 'preface' and bl[1] > 60 for bl in pg.get_text('blocks', sort=True)[:2]))
    roman = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][pidx]
    weasy(b.document(front_css, body=front_html.replace('PREFACE_PG', roman)), front_pdf)
    import pypdf
    nfront = len(pypdf.PdfReader(str(front_pdf)).pages)
    merge_pdfs([front_pdf, body_pdf], out('notes.pdf'))
    # contents line for the preface: its roman page
    save_book(b, out('notes.pdf'),
              notes=f'{nfront} front-matter pages numbered in lower-case roman (title page unnumbered), then the body from 1 in '
                    'arabic. Chapters open on right-hand pages, so some left pages are blank. Running heads: book title on left '
                    'pages, chapter title on right pages (none on chapter openings). Footnotes are in truth after their '
                    'chapter body; endnotes are the "Notes" chapter. The Contents page is navigation and NOT in truth; title '
                    'page and copyright verso are. Drop caps and small caps open each essay: truth has the plain text '
                    '("What is truth?", "Men fear death"; the 1625-style all-caps "WHAT"/"MEN" also acceptable). Ligatures '
                    '(fi, fl, ff, ffi) are shaped by the font: truth has plain letters. Text is hyphenated (hyphens: auto); '
                    f'pages whose last body line ends in a hyphen (break across pages): {hy or "none detected"}. The glossary '
                    'table runs over two pages with its header row repeated. Essay text: Bacon (1625), public domain, from '
                    'Project Gutenberg #575, including its stray apostrophe in "canticle is\', Nunc dimittis".',
              must_keep=["the sweetest canticle is', Nunc dimittis", 'Pompa mortis magis terret, quam mors ipsa.',
                         'vinum daemonum', 'wild justice', 'Bona rerum secundarum optabilia; adversarum mirabilia.',
                         '--Extinctus amabitur idem.'],
              page_break_hyphen_pages=hy, front_matter_pages=nfront)


# 16 --------------------------------------------------------------------------
SCRIPTS = {
    'ar': ('المطر في المدينة', [
        'في صباح يوم من أيام الخريف، استيقظت المدينة على صوت المطر. كان الماء ينساب على زجاج النوافذ، والناس يسيرون في الشوارع تحت مظلاتهم الملونة. جلس الشيخ يوسف في مقهاه الصغير عند زاوية السوق، وقدّم الشاي بالنعناع لكل من دخل هاربًا من البلل.',
        'قال لأحد الزبائن: «المطر رحمة، يغسل الغبار عن الأشجار وعن القلوب أيضًا». ضحك الشاب ولم يجب، لكنه بقي حتى توقف المطر، وعندما خرج كانت الشمس قد عادت، والشوارع تلمع كأنها مرآة كبيرة.',
        'وفي المساء، عادت العصافير إلى أعشاشها، وأضاءت المصابيح واحدًا بعد الآخر. وكتب يوسف في دفتره الصغير: «اليوم، الثاني عشر من تشرين الأول، سقط المطر ثلاث ساعات، وشربنا أربعين (٤٠) كوبًا من الشاي».',
    ]),
    'he': ('הספרייה הקטנה', [
        'בקצה הרחוב שלנו יש ספרייה קטנה, ובה עובדת אישה זקנה בשם מרים. הספרייה נפתחה בשנת 1952, ומרים עובדת בה כמעט מאז. היא מכירה כל ספר על המדפים, ויודעת בדיוק איזה ספר מתאים לכל ילד שנכנס בדלת.',
        'כשהייתי בן שמונה, היא נתנה לי ספר על ים ועל אוניות, ואמרה: "קרא את זה לאט. ספרים טובים לא בורחים." קראתי אותו שלוש פעמים.',
        'היום אני כבר מבוגר, אבל עדיין אני הולך לספרייה בכל יום שישי. מרים עדיין שם, יושבת ליד החלון עם כוס תה, ועדיין היא אומרת לכל ילד אותו משפט בדיוק.',
    ]),
    'zh': ('山中的茶馆', [
        '在山路的拐弯处，有一家小小的茶馆。茶馆没有名字，门口只挂着一盏旧灯笼。老板姓林，六十多岁，每天天还没亮就起来烧水。来往的旅人走累了，都会在这里坐一会儿，喝一杯热茶，看看远处的云。',
        '林老板话不多。有人问他为什么不给茶馆起个名字，他笑着说：“山有名字，路有名字，茶馆就不用了。”下雨的时候，茶馆里坐满了人，大家一边听雨，一边聊天，谁也不急着走。',
        '雨停了，云散了，旅人们继续上路。林老板把杯子一个个洗干净，放回架子上，等待下一个走累了的人。',
    ]),
    'ja': ('駅のベンチ', [
        '小さな駅のホームに、古い木のベンチがある。毎朝七時十五分、同じおばあさんがそこに座って、電車を待っている。でも、電車が来ても、おばあさんは乗らない。',
        'ある日、駅員の田中さんが聞いた。「どちらへお出かけですか。」おばあさんはにっこり笑って答えた。「どこへも行きませんよ。ここで春を待っているんです。」',
        '田中さんは少し考えてから、となりに座った。線路のむこうに、桜のつぼみが少しだけふくらんでいた。',
    ]),
}
VERT = ('雪の夜', [
    '雪が静かに降っている。窓の外の町は、白くてやわらかい。母は台所でみそ汁を作り、父は古いラジオを直している。わたしはこたつに入って、本を読んでいる。',
    '「明日は学校、休みかな。」弟が小さな声で言った。だれも答えなかったけれど、みんな少しだけ笑った。',
])
MIXED = ('Notes from a Market', [
    'At the Tuesday market in Marseille, the spice seller writes her prices in three scripts: كمون (cumin) at 4 € the bag, '
    '八角 (star anise) at 6 €, and za’atar, which she labels only زعتر, because, she says, anyone who needs a translation '
    'does not need za’atar.',
    'Her neighbour sells 豆腐 and 味噌 from a cool-box, under a hand-written sign that says お茶あります — ‘we have tea’. '
    'The sign over the gate reads «سوق الثلاثاء – Tuesday Market – 火曜市» in letters a foot high.',
    'On the way out, a boy hands me a flyer: مرحبا بكم — Welcome — 欢迎光临. On the back, in smaller print: '
    'الطبعة ٣ / 第3版 / third printing, 2026.',
])
VFORMS = {'、': '︑', '。': '︒', '「': '﹁', '」': '﹂', '，': '︐', 'ー': '︱'}


def vertical_page(path, title, paras):
    import subprocess
    from fontTools.ttLib import TTFont as FT
    from reportlab.pdfgen import canvas
    font_path = subprocess.run(['fc-match', '-f', '%{file}', 'IPAGothic'], capture_output=True, text=True).stdout.strip()
    pdfmetrics.registerFont(TTFont('IPAG', font_path))
    cmap = FT(font_path).getBestCmap()
    W, H = 148 * 2.8346, 210 * 2.8346
    c = canvas.Canvas(str(path), pagesize=(W, H), invariant=1)
    size, pitch, colgap = 13, 14.5, 24
    x = W - 40
    top, bottom = H - 50, 50

    def column(text, x, y0, fs=size):
        y = y0
        for ch in text:
            if y - pitch < bottom:
                x -= colgap
                y = y0
            g = VFORMS.get(ch, ch)
            if g != ch and ord(g) not in cmap:
                g = ch
            dx, dy = 0, 0
            if g == ch and ch in '、。，':
                dx, dy = fs * 0.55, fs * 0.6
            c.setFont('IPAG', fs)
            c.drawCentredString(x + dx, y - fs + dy, g)
            y -= pitch * fs / size
        return x

    c.setFont('IPAG', 18)
    x = column(title, x, top - 10, fs=18) - colgap * 1.6
    for p in paras:
        x = column('　' + p, x, top) - colgap
    c.setFont('IPAG', 8)
    c.drawCentredString(W / 2, 22, '5')
    c.showPage()
    c.save()


def scripts():
    css = BOOK_CSS + """
    @page { size: 148mm 210mm; margin: 22mm 18mm; }
    h1 { break-before: auto; font-weight: bold; margin-bottom: 1.2em; }
    section { break-before: page; } section:first-child { break-before: auto; }
    p { text-indent: 0; margin-bottom: 0.8em; }
    .ar { font-family: 'Noto Naskh Arabic'; font-size: 14pt; line-height: 1.8; }
    .he { font-family: 'Noto Serif Hebrew'; font-size: 13pt; line-height: 1.7; }
    .zh { font-family: 'Noto Serif CJK SC'; font-size: 12pt; line-height: 1.9; text-indent: 2em; }
    .zh p, .ja p { text-indent: 1em; text-align: left; }
    .ja { font-family: 'Noto Serif CJK JP'; font-size: 12pt; line-height: 1.9; }
    .mx { font-family: 'Noto Serif', 'Noto Naskh Arabic', 'Noto Serif CJK JP'; font-size: 11pt; line-height: 1.8; text-align: left; }
    .mx p { text-align: left; }
    """
    b = Book('scripts', 'Six Scripts', 'Various',
             'One page each of Arabic, Hebrew, Simplified Chinese, horizontal Japanese, vertical Japanese, and a page mixing '
             'Latin, Arabic and CJK inline (bidi).')
    order = []
    for key in ['ar', 'he', 'zh', 'ja']:
        title, paras = SCRIPTS[key]
        rtl = ' dir="rtl"' if key in ('ar', 'he') else ''
        b.html(f'<section class="{key}" lang="{key}"{rtl}>')
        b.chapter(title)
        for p in paras:
            b.p(esc(p))
        b.html('</section>')
    first = b.body
    b.body = []
    b.chapter(VERT[0])
    for p in VERT[1]:
        b.t(p)
    b.body = []
    b.html('<section class="mx" lang="en">')
    b.chapter(MIXED[0])
    for p in MIXED[1]:
        b.p(esc(p))
    b.html('</section>')
    p1 = weasy(b.document(css, body=''.join(first)), tmp('scripts-a.pdf'))
    p3 = weasy(b.document(css + "@page { @bottom-center { content: '6' } }", body=''.join(b.body)), tmp('scripts-c.pdf'))
    p2 = tmp('scripts-v.pdf')
    vertical_page(p2, *VERT)
    merge_pdfs([p1, p2, p3], out('scripts.pdf'))
    save_book(b, out('scripts.pdf'),
              notes='Arabic (Noto Naskh Arabic) and Hebrew (Noto Serif Hebrew) pages are right-to-left (dir=rtl) with '
                    'Arabic-Indic digits (٤٠) and a Latin-digit year (1952) inside RTL text. Chinese: Noto Serif CJK SC; '
                    'Japanese: Noto Serif CJK JP. VERTICAL JAPANESE: no tool in the image typesets vertical text (WeasyPrint '
                    'ignores writing-mode: vertical-rl), so page 5 is hand-set with reportlab, one glyph at a time in '
                    'right-to-left columns, in IPAGothic (Noto CJK is CFF-based and reportlab cannot embed it). Punctuation '
                    'uses vertical presentation forms (U+FE11 ︑, U+FE12 ︒, U+FE41 ﹁, U+FE42 ﹂) in the PDF; truth uses the '
                    'normal characters (、。「」). Page 6 mixes Latin, Arabic and CJK runs inline. Page numbers are '
                    'furniture.',
              must_keep=['٤٠', '1952', 'お茶あります', 'زعتر', '火曜市', '第3版'])


CASES = [columns, notes, scripts]

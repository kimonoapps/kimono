"""Shared helpers: a tiny book model that renders HTML for WeasyPrint and,
from the same calls, the ground-truth text and expectations."""
import html as _html
import json
import os
import re
import shutil
import subprocess
from pathlib import Path


class Ctx:
    out: Path = Path('/out')
    work: Path = Path('/tmp/torture-work')
    cache: Path = Path(__file__).resolve().parent / 'cache'
    index: list = []


CTX = Ctx()

# Fixed dates so repeated runs give identical files.
os.environ.setdefault('SOURCE_DATE_EPOCH', '1767225600')  # 2026-01-01


def esc(s):
    return _html.escape(s, quote=False)


def plain(src, collapse=True):
    """Inline HTML -> plain text (keeps <br> as newline)."""
    s = re.sub(r'<br\s*/?>', '\n', src)
    s = re.sub(r'<span class="furn">.*?</span>', '', s, flags=re.S)
    s = re.sub(r'<[^>]+>', '', s)
    s = _html.unescape(s).replace('­', '')
    if collapse:
        s = re.sub(r'[ \t\r\f\v]+', ' ', s)
        s = re.sub(r' *\n *', '\n', s)
    return s.strip()


NOTE_RE = re.compile(r'\[\[(fn|en|sn):(.+?)\]\]', re.S)


class Book:
    """Collects body HTML and truth blocks in reading order.

    Inline syntax inside paragraphs: [[fn:text]] = footnote (truth: after
    the chapter body), [[en:text]] = endnote (truth: in the Notes section).
    Note call numbers are not part of the truth.
    """

    def __init__(self, case, title, author, about, lang='en'):
        self.case, self.title, self.author, self.about, self.lang = case, title, author, about, lang
        self.body, self.truth = [], []
        self.notes_buf, self.endnotes = [], []
        self.chapters, self.captions = [], []
        self.images = self.nnotes = self.verse_blocks = self.tables = 0
        self.manual_fn, self.fn_texts = False, []

    # -- raw access -------------------------------------------------------
    def html(self, h):
        self.body.append(h)

    def t(self, text):
        self.truth.append(text)

    def _inline(self, src, collapse=True):
        def rep(m):
            kind, txt = m.group(1), m.group(2)
            self.nnotes += 1
            if kind == 'fn' and self.manual_fn:
                self.notes_buf.append(plain(txt))
                self.fn_texts.append(plain(txt))
                return f'<sup class="fncall">{len(self.fn_texts)}</sup>'
            if kind in ('fn', 'sn'):
                self.notes_buf.append(plain(txt))
                return f'<span class="{"fn" if kind == "fn" else "side"}">{txt}</span>'
            self.endnotes.append(txt)
            return f'<sup class="enref">{len(self.endnotes)}</sup>'
        h = NOTE_RE.sub(rep, src)
        t = plain(NOTE_RE.sub('', src), collapse)
        return h, t

    # -- blocks -------------------------------------------------------------
    def chapter(self, title, html_title=None, cls='chapter', tag='h1', record=True, attrs=''):
        self.flush_notes()
        self.body.append(f'<{tag} class="{cls}"{attrs}>{html_title or esc(title)}</{tag}>')
        self.truth.append(title)
        if record:
            self.chapters.append(title)

    def heading(self, title, tag='h2', cls='', html_title=None):
        self.body.append(f'<{tag} class="{cls}">{html_title or esc(title)}</{tag}>')
        self.truth.append(title)

    def p(self, src, cls='', tag='p', attrs=''):
        h, t = self._inline(src)
        c = f' class="{cls}"' if cls else ''
        self.body.append(f'<{tag}{c}{attrs}>{h}</{tag}>')
        if t:
            self.truth.append(t)

    def ps(self, text, cls=''):
        """Several paragraphs separated by blank lines."""
        for para in re.split(r'\n\s*\n', text.strip()):
            self.p(' '.join(para.split()), cls=cls)

    def verse(self, text, cls='verse', count=True):
        """Stanzas separated by blank lines; leading spaces = indent (2 per em).
        A line starting with '>' is a turnover-prone long line (no change)."""
        if count:
            self.verse_blocks += 1
        out = [f'<div class="{cls}">']
        for st in re.split(r'\n[ \t]*\n', text.strip('\n')):
            lines = st.split('\n')
            out.append('<p class="stanza">')
            tl = []
            for ln in lines:
                ind = (len(ln) - len(ln.lstrip(' '))) / 2
                body = ln.strip()
                h, t = self._inline(body, collapse=False)
                out.append(f'<span class="l" style="margin-left:{ind}em">{h}</span>')
                tl.append(t)
            out.append('</p>')
            self.truth.append('\n'.join(tl))
        out.append('</div>')
        self.body.append(''.join(out))

    def fig(self, src, caption=None, cls='fig', style='', cap_html=None, count=True, img_style=''):
        if count:
            self.images += 1
        cap = ''
        if caption:
            self.captions.append(caption)
            self.truth.append(caption)
            cap = f'<figcaption>{cap_html or esc(caption)}</figcaption>'
        st = f' style="{style}"' if style else ''
        ist = f' style="{img_style}"' if img_style else ''
        self.body.append(f'<figure class="{cls}"{st}><img src="{src}" alt=""{ist}>{cap}</figure>')

    def table(self, header, rows, caption=None, cls='', cap_html=None, caption_below=False):
        self.tables += 1
        th = ''.join(f'<th>{c}</th>' for c in header)
        trs = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
        cap = f'<caption>{cap_html or esc(caption)}</caption>' if caption else ''
        style = ' style="caption-side:bottom"' if caption_below else ''
        self.body.append(f'<table class="{cls}"{style}>{cap}<thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table>')
        lines = [' | '.join(plain(c) for c in header)] + [' | '.join(plain(c) for c in r) for r in rows]
        if caption and not caption_below:
            self.captions.append(caption)
            self.truth.append(caption)
        self.truth.append('\n'.join(lines))
        if caption and caption_below:
            self.captions.append(caption)
            self.truth.append(caption)

    def lst(self, items, cls='list', tag='ul'):
        self.body.append(f'<{tag} class="{cls}">' + ''.join(f'<li>{i}</li>' for i in items) + f'</{tag}>')
        self.truth.append('\n'.join(plain(i) for i in items))

    def flush_notes(self):
        self.truth.extend(self.notes_buf)
        self.notes_buf = []

    def endnotes_section(self, title='Notes', cls='chapter notes-h'):
        self.chapter(title, cls=cls)
        for i, n in enumerate(self.endnotes, 1):
            self.body.append(f'<p class="en"><span class="enn">{i}.</span> {n}</p>')
            self.truth.append(plain(n))

    # -- output -------------------------------------------------------------
    def document(self, css, body=None):
        self.flush_notes()
        return (f'<!doctype html><html lang="{self.lang}"><head><meta charset="utf-8">'
                f'<title>{esc(self.title)}</title><meta name="author" content="{esc(self.author)}">'
                f'<meta name="dcterms.created" content="2026-01-01T00:00:00Z">'
                f'<style>{css}</style></head><body>{body if body is not None else "".join(self.body)}</body></html>')

    def truth_text(self):
        self.flush_notes()
        return '\n\n'.join(b for b in self.truth if b.strip()) + '\n'

    def expect(self, **over):
        e = {'chapters': self.chapters, 'images': self.images, 'captions': self.captions,
             'notes': self.nnotes, 'verse_blocks': self.verse_blocks, 'tables': self.tables,
             'must_keep': []}
        e.update(over)
        return e


# -- rendering ---------------------------------------------------------------

def weasy(html_str, path):
    from weasyprint import HTML
    HTML(string=html_str, base_url=str(CTX.work) + '/').write_pdf(str(path))
    return path


def page_count(path):
    try:
        import pypdf
        return len(pypdf.PdfReader(str(path)).pages)
    except Exception:
        return None


def out(name):
    return CTX.out / name


def tmp(name):
    return CTX.work / name


def save_case(case, title, author, about, truth, expect, notes='', pdf=None, pages=None, check=True):
    pdf = pdf or out(f'{case}.pdf')
    if pages is None:
        pages = page_count(pdf)
    if check:
        missing = [w for w in expect.get('must_keep', []) if w not in truth]
        if missing:
            raise AssertionError(f'{case}: must_keep not in truth: {missing}')
        for c in expect.get('captions', []):
            if c not in truth:
                raise AssertionError(f'{case}: caption not in truth: {c}')
    (CTX.out / f'{case}.truth.txt').write_text(truth, encoding='utf-8')
    meta = {'case': case, 'title': title, 'author': author, 'pages': pages, 'about': about,
            'expect': expect, 'notes': notes}
    (CTX.out / f'{case}.meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    CTX.index.append({'case': case, 'pdf': f'{case}.pdf', 'title': title, 'pages': pages, 'about': about})
    print(f'  {case}: {pages} pages', flush=True)


def save_book(b, pdf, notes='', **expect_over):
    save_case(b.case, b.title, b.author, b.about, b.truth_text(), b.expect(**expect_over), notes=notes, pdf=pdf)


def run(*cmd):
    subprocess.run([str(c) for c in cmd], check=True)


def merge_pdfs(paths, dest):
    import pypdf
    w = pypdf.PdfWriter()
    for p in paths:
        w.append(str(p))
    w.add_metadata({'/CreationDate': "D:20260101000000Z", '/ModDate': "D:20260101000000Z"})
    with open(dest, 'wb') as f:
        w.write(f)
    return dest


def clean_work():
    if CTX.work.exists():
        shutil.rmtree(CTX.work)
    CTX.work.mkdir(parents=True)


# Base CSS shared by the book-like cases.
BOOK_CSS = """
@page { size: 140mm 216mm; margin: 18mm 16mm 20mm 18mm;
  @bottom-center { content: counter(page); font: 9pt 'Noto Serif'; } }
html { font-family: 'Noto Serif'; font-size: 10.5pt; line-height: 1.42; }
body { margin: 0; }
p { margin: 0; text-align: justify; text-indent: 1.2em; }
h1 + p, h2 + p, .noindent, figure + p, .verse + p { text-indent: 0; }
h1 { font-size: 17pt; font-weight: normal; text-align: center; margin: 0 0 1.4em; break-before: page; }
h1:first-child { break-before: auto; }
h2 { font-size: 12pt; margin: 1.2em 0 0.5em; }
.verse { margin: 0.8em 0 0.8em 2em; }
.verse .stanza { text-indent: 0; text-align: left; margin: 0 0 0.7em; }
.verse .l { display: block; padding-left: 2em; text-indent: -2em; }
figure { margin: 1em 0; text-align: center; break-inside: avoid; }
figure img { max-width: 100%; }
figcaption { font-size: 8.5pt; font-style: italic; margin-top: 0.3em; text-align: center; }
.fn { float: footnote; font-size: 8pt; text-indent: 0; text-align: left; }
::footnote-call { font-size: 70%; vertical-align: super; line-height: 0; }
::footnote-marker { font-size: 8pt; }
@page { @footnote { border-top: 0.5pt solid #555; padding-top: 2pt; margin-top: 8pt; } }
table { border-collapse: collapse; margin: 1em auto; font-size: 9pt; }
th, td { border-bottom: 0.5pt solid #777; padding: 2pt 5pt; text-align: left; vertical-align: top; }
caption { font-size: 9pt; font-style: italic; margin-bottom: 4pt; }
"""


def catchwords(src, dest, fontfile, size=10, right=16, bottom=12, skip_top=16):
    """Early-printing catchwords: first word of the next page, bottom right (mm)."""
    import pymupdf
    mm = 72 / 25.4
    doc = pymupdf.open(str(src))
    fnt = pymupdf.Font(fontfile=fontfile)
    for i in range(len(doc) - 1):
        nxt = doc[i + 1]
        words = [w for w in nxt.get_text('words', sort=True) if w[1] > skip_top * mm and w[3] < nxt.rect.height - 22 * mm]
        if not words:
            continue
        word = words[0][4]
        pg = doc[i]
        x = pg.rect.width - right * mm - fnt.text_length(word, size)
        pg.insert_text((x, pg.rect.height - bottom * mm), word, fontsize=size, fontname='cw', fontfile=fontfile)
    doc.save(str(dest), garbage=3, deflate=True, no_new_id=True)


def gutenberg(name):
    """Body of a cached Project Gutenberg text (header/licence stripped)."""
    p = CTX.cache / name
    if not p.exists():
        raise FileNotFoundError(f'{p} missing: run fetch.sh first')
    s = p.read_text(encoding='utf-8').replace('\r', '')
    s = s.split('*** START OF THE PROJECT GUTENBERG EBOOK', 1)[1].split('\n', 1)[1]
    return s.split('*** END OF THE PROJECT GUTENBERG EBOOK', 1)[0]


def paragraphs(text):
    """Blank-line separated paragraphs; returns (indented, joined_text)."""
    out = []
    for block in re.split(r'\n[ \t]*\n', text):
        if not block.strip():
            continue
        lines = block.split('\n')
        ind = all(l.startswith('  ') for l in lines if l.strip())
        out.append((ind, ' '.join(l.strip() for l in lines if l.strip())))
    return out

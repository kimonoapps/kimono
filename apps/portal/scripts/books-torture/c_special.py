"""Cases 17-20: a 600+ page novel, a scan, encrypted, broken and mislabelled PDFs."""
import json
import re
import shutil
import subprocess

import numpy as np
from PIL import Image, ImageFilter

from common import (BOOK_CSS, CTX, Book, esc, gutenberg, out, page_count, paragraphs, run, save_book, save_case, tmp,
                    weasy)


def _italics(t):
    return re.sub(r'_([^_]+)_', r'<i>\1</i>', esc(t))


# 17 --------------------------------------------------------------------------
def long():
    text = gutenberg('pg2701.txt')
    start = [m.start() for m in re.finditer(r'^CHAPTER 1\. Loomings\.$', text, re.M)][-1]
    body = text[start:]
    parts = re.split(r'^(CHAPTER \d+\. .*|Epilogue)$', body, flags=re.M)
    b = Book('long', 'Moby-Dick; or, The Whale', 'Herman Melville',
             'The whole of Moby-Dick (135 chapters and Epilogue) typeset as a 600+ page book with running heads and page numbers.')
    b.html('<section class="tp"><p class="t1">MOBY-DICK</p><p class="t2">or, The Whale</p><p class="t3">Herman Melville</p></section>')
    b.t('MOBY-DICK')
    b.t('or, The Whale')
    b.t('Herman Melville')
    for i in range(1, len(parts), 2):
        title = parts[i].strip()
        b.chapter(title, html_title=esc(title))
        for ind, para in paragraphs(parts[i + 1]):
            b.html(f'<p class="{"bq" if ind else ""}">{_italics(para)}</p>')
            b.t(para.replace('_', ''))
    css = BOOK_CSS + """
    @page { size: 5in 7.75in; margin: 0.6in 0.5in 0.65in 0.55in; @bottom-center { content: none } }
    @page :left { @top-left { content: counter(page); font: 8.5pt 'Noto Serif'; }
      @top-center { content: 'MOBY-DICK'; font: 8pt 'Noto Serif'; letter-spacing: 0.15em; } }
    @page :right { @top-right { content: counter(page); font: 8.5pt 'Noto Serif'; }
      @top-center { content: string(chap); font: italic 8.5pt 'Noto Serif'; } }
    @page :first { @top-center { content: none } @top-right { content: none } }
    html { font-size: 10pt; line-height: 1.36; hyphens: auto; }
    h1 { string-set: chap content(); font-size: 13pt; margin: 0.5in 0 0.3in; }
    p.bq { margin: 0.4em 1.2em; text-indent: 0; font-size: 9.2pt; }
    .tp { text-align: center; padding-top: 1.6in; break-after: page; }
    .tp p { text-align: center; text-indent: 0; }
    .t1 { font-size: 26pt; letter-spacing: 0.12em; } .t2 { font-style: italic; font-size: 13pt; margin-bottom: 1in; }
    .t3 { font-size: 13pt; letter-spacing: 0.1em; }
    """
    weasy(b.document(css), out('long.pdf'))
    save_book(b, out('long.pdf'),
              notes='Public domain: Herman Melville, Moby-Dick (1851), text from Project Gutenberg #2701 with the Gutenberg '
                    'header/licence removed. Etymology and Extracts front matter omitted; starts at Chapter 1. Each chapter '
                    'opens a new page. Running heads: page number + "MOBY-DICK" on left pages, page number + chapter title '
                    'on right pages. Indented passages (quoted documents, the hymn in Chapter 9) are set as smaller block '
                    'quotes. Gutenberg _italics_ are italic and appear without underscores in truth. Hyphenated (hyphens: auto).',
              must_keep=['Call me Ishmael.', 'CHAPTER 135. The Chase.—Third Day.', 'only found another orphan.'])


# 18 --------------------------------------------------------------------------
def scanned():
    text = gutenberg('pg11.txt')
    m = list(re.finditer(r'^CHAPTER I\.\n', text, re.M))[-1]
    end = re.search(r'^CHAPTER II\.', text[m.end():], re.M).start()
    ch = text[m.end():m.end() + end]
    sub, rest = ch.strip('\n').split('\n', 1)
    b = Book('scanned', "Alice's Adventures in Wonderland, Chapter I", 'Lewis Carroll',
             'Image-only scan of a typeset book chapter (200 dpi greyscale, skewed, speckled), no text layer.')
    b.chapter(f'CHAPTER I. {sub.strip()}', html_title=f'CHAPTER I.<br><span class="sub">{esc(sub.strip())}</span>')
    for ind, para in paragraphs(rest):
        if set(para.replace(' ', '')) <= {'*'}:
            b.html('<p class="stars">* * * * * * *</p>')
            continue
        b.p(_italics(para), cls='bq' if ind else '')
    css = BOOK_CSS + """
    @page { size: 5.25in 8in; margin: 0.7in 0.6in 0.75in 0.65in;
      @top-center { content: "ALICE'S ADVENTURES IN WONDERLAND"; font: 7.5pt 'C059'; letter-spacing: 0.12em; }
      @bottom-center { content: counter(page); font: 9pt 'C059'; } }
    @page :first { @top-center { content: none } }
    html { font-family: 'C059', 'Noto Serif'; font-size: 11pt; line-height: 1.38; hyphens: auto; }
    h1 { font-size: 13pt; letter-spacing: 0.1em; } .sub { font-size: 15pt; letter-spacing: 0; font-style: italic; }
    .stars { text-align: center; text-indent: 0; margin: 0.6em 0; }
    """
    src = tmp('scan-src.pdf')
    weasy(b.document(css), src)
    run('pdftoppm', '-r', 200, '-gray', '-png', src, tmp('scan'))
    pages = sorted(CTX.work.glob('scan-*.png'))
    rng = np.random.default_rng(1800)
    jpgs = []
    for i, p in enumerate(pages):
        im = Image.open(p).convert('L')
        a = np.asarray(im).astype(np.float32)
        a = 255 - (255 - a) * 0.88                      # ink not quite black
        a = a * 0.9 + 12                                # grey paper
        h, w = a.shape
        x = np.linspace(-1, 1, w)[None, :]
        side = 1 if i % 2 == 0 else -1
        a -= 38 * np.clip(side * -x - 0.75, 0, 1) * 4   # gutter shadow
        a += rng.normal(0, 7, a.shape)
        for _ in range(140):                            # dust specks
            y0, x0 = rng.integers(0, h - 3), rng.integers(0, w - 3)
            a[y0:y0 + rng.integers(1, 4), x0:x0 + rng.integers(1, 4)] = rng.uniform(40, 120)
        im = Image.fromarray(a.clip(0, 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(0.6))
        im = im.rotate(float(rng.uniform(-0.9, 0.9)), resample=Image.BICUBIC, expand=False, fillcolor=205)
        jp = tmp(f'scan-{i:02d}.jpg')
        im.save(jp, quality=70)
        jpgs.append(str(jp))
    run('img2pdf', '--pagesize', '5.25inx8in', '--creationdate', '2026-01-01T00:00:00', '--moddate',
        '2026-01-01T00:00:00', '-o', out('scanned.pdf'), *jpgs)
    b.truth = [t for t in b.truth]
    save_book(b, out('scanned.pdf'),
              notes='No text layer at all: every page is a single greyscale JPEG (200 dpi, rotated up to ±0.9°, grey paper, '
                    'noise, specks, gutter shadow). Only OCR (tesseract is in the sandbox) can recover the text. Source: '
                    'Lewis Carroll (1865), public domain, Project Gutenberg #11, Chapter I only. The "* * *" row is an '
                    'ornament and not in truth. Running head and page numbers are furniture.', images=0,
              must_keep=['Down the Rabbit-Hole', 'DRINK ME'])


# 19 --------------------------------------------------------------------------
def _copy_meta(src_case, case, about, notes, extra=None):
    meta = json.loads((CTX.out / f'{src_case}.meta.json').read_text())
    truth = (CTX.out / f'{src_case}.truth.txt').read_text()
    e = meta['expect']
    if extra:
        e.update(extra)
    pages = page_count(out(f'{case}.pdf')) or meta['pages']
    save_case(case, meta['title'], meta['author'], about, truth, e, notes=notes, pdf=out(f'{case}.pdf'), pages=pages,
              check=False)


def _ensure(case, fn):
    if not (CTX.out / f'{case}.pdf').exists():
        fn()


def encrypted():
    from c_wording import long_sentences
    _ensure('long-sentences', long_sentences)
    run('qpdf', '--static-id', '--static-aes-iv', '--encrypt', '', 'kimono-owner', '256', '--print=full', '--modify=none',
        '--extract=y', '--', out('long-sentences.pdf'), out('encrypted.pdf'))
    _copy_meta('long-sentences', 'encrypted', 'Copy of long-sentences encrypted with AES-256: owner password only; '
               'printing and copying allowed, modification not allowed. Opens without a password.',
               'qpdf --encrypt "" kimono-owner 256 --print=full --modify=none --extract=y. Empty user password, so any '
               'reader opens it; text extraction is permitted. Same truth as long-sentences.')
    run('qpdf', '--static-id', '--static-aes-iv', '--encrypt', 'kimono', 'kimono-owner', '256', '--', out('long-sentences.pdf'),
        out('encrypted-userpw.pdf'))
    _copy_meta('long-sentences', 'encrypted-userpw', 'Copy of long-sentences that needs a user password to open (AES-256).',
               'User password: "kimono" (owner: "kimono-owner"). Without the password nothing can be read: expect a clear '
               '"password required" error, not a crash or an empty book. With the password, same truth as long-sentences.',
               {'user_password': 'kimono'})


# 20 --------------------------------------------------------------------------
def broken():
    from c_articles import magazine, paper
    _ensure('magazine', magazine)
    _ensure('paper', paper)
    data = (CTX.out / 'magazine.pdf').read_bytes()
    (CTX.out / 'broken-truncated.pdf').write_bytes(data[:len(data) // 2])
    _copy_meta('magazine', 'broken-truncated', 'The magazine PDF cut off at exactly half its bytes (no xref, no trailer).',
               f'First {len(data) // 2} of {len(data)} bytes of magazine.pdf. Expect either a clean "damaged file" error or a '
               'partial recovery of the first page; truth is the full magazine text for scoring whatever is recovered.')
    data = bytearray((CTX.out / 'paper.pdf').read_bytes())
    rng = np.random.default_rng(2000)
    mid = len(data) // 2
    data[mid:mid + 4096] = rng.integers(0, 256, 4096, dtype=np.uint8).tobytes()
    xref = data.rfind(b'\nxref')
    if xref > 0:
        seg = bytearray(data[xref:xref + 2000])
        digits = [i for i, ch in enumerate(seg) if 48 <= ch <= 57]
        for i in rng.choice(digits, size=len(digits) // 3, replace=False):
            seg[i] = 48 + int(rng.integers(0, 10))
        data[xref:xref + 2000] = seg
    (CTX.out / 'broken-garbage.pdf').write_bytes(bytes(data))
    _copy_meta('paper', 'broken-garbage', 'The paper PDF with 4 KB of random bytes over its middle and a third of the '
               'xref offset digits scrambled.',
               'Byte offset %d..%d overwritten with seeded random bytes; xref table offsets corrupted (stream lengths and '
               'object numbers untouched elsewhere). Readers that rebuild the xref by scanning may recover most pages; '
               'whatever stream the garbage hit is lost. Truth is the original paper text.' % (mid, mid + 4096))


def toc():
    from c_layout import notes
    _ensure('notes', notes)
    import pypdf
    from pypdf.generic import (ArrayObject, DictionaryObject, NameObject, NumberObject, TextStringObject,
                               NullObject)
    meta = json.loads((CTX.out / 'notes.meta.json').read_text())
    nfront = meta['expect']['front_matter_pages']
    r = pypdf.PdfReader(str(out('notes.pdf')))
    w = pypdf.PdfWriter(clone_from=r)
    n = len(w.pages)
    # Page labels: roman front matter, arabic body, then a lettered appendix range for the last two pages.
    w.set_page_label(0, nfront - 1, style='/r')
    w.set_page_label(nfront, n - 3, style='/D', start=1)
    w.set_page_label(n - 2, n - 1, style='/D', prefix='G-', start=1)
    # Broken outline built by hand.
    items = [('Preface', 4), ('Of Truth', nfront), ('Of Death (wrong page)', n - 1), ('Of Envy', 'missing-dest'),
             ('Of Revenge', 999), ('Notes', None), ('Glossary', -5)]
    outline = DictionaryObject({NameObject('/Type'): NameObject('/Outlines')})
    outline_ref = w._add_object(outline)
    refs = []
    for title, target in items:
        d = DictionaryObject({NameObject('/Title'): TextStringObject(title), NameObject('/Parent'): outline_ref})
        if isinstance(target, int) and 0 <= target < n:
            d[NameObject('/Dest')] = ArrayObject([w.pages[target].indirect_reference, NameObject('/Fit')])
        elif isinstance(target, int):
            d[NameObject('/Dest')] = ArrayObject([NumberObject(target), NameObject('/Fit')])
        elif target == 'missing-dest':
            d[NameObject('/Dest')] = TextStringObject('chapter-envy')
        else:
            d[NameObject('/Dest')] = NullObject()
        refs.append(w._add_object(d))
    for i, ref in enumerate(refs):
        o = ref.get_object()
        if i > 0:
            o[NameObject('/Prev')] = refs[i - 1]
        if i < len(refs) - 1:
            o[NameObject('/Next')] = refs[i + 1]
    outline[NameObject('/First')] = refs[0]
    outline[NameObject('/Last')] = refs[-2]          # wrong: skips the last item
    outline[NameObject('/Count')] = NumberObject(42)  # wrong count
    w._root_object[NameObject('/Outlines')] = outline_ref
    w._root_object[NameObject('/PageMode')] = NameObject('/UseOutlines')
    w.add_metadata({'/Title': 'Four Essays', '/Author': 'Francis Bacon'})
    with open(out('toc.pdf'), 'wb') as f:
        w.write(f)
    _copy_meta('notes', 'toc', 'The annotated Bacon edition with a broken outline and /PageLabels (roman, arabic, then "G-1").',
               f'/PageLabels: pages 1-{nfront} lower roman, then arabic from 1, last two pages "G-1", "G-2" (the printed '
               'numbers on those pages say otherwise). Outline: "Preface" ok-ish, "Of Truth" correct, "Of Death (wrong '
               'page)" points to the last page, "Of Envy" is a named destination that does not exist (and no such chapter), '
               '"Of Revenge" points to page index 999, "Notes" has a null /Dest, "Glossary" a negative page; /Outlines '
               '/Last skips the final item and /Count is 42 (PyMuPDF 2.1 get_toc() returns [] for it; pypdf lists all seven). '
               'Chapters must come from the text, not the outline. Same truth as notes.', {'outline_is_broken': True})


CASES = [long, scanned, encrypted, broken, toc]

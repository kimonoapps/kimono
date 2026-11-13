# Books PDF torture set

Generates PDFs that stress the PDF → EPUB converter (`src/lib/books/convert/`), each with the text a
perfect EPUB would contain.

```sh
./fetch.sh   # once: public-domain Gutenberg texts into cache/ (Moby-Dick, Bacon, Alice, Thoreau)
docker run --rm \
  -v "$PWD":/gen:ro -v /path/to/out:/out \
  ghcr.io/kimonoapps/kimono-sandbox:0.9.8 /opt/kimono/python/bin/python /gen/make.py /out [case ...]
```

Per case: `<case>.pdf`, `<case>.truth.txt`, `<case>.meta.json`; plus `index.json`.

Truth conventions: reading order; paragraphs separated by blank lines; verse lines on their own lines
(stanzas separated by blank lines, indentation dropped, internal spaces kept); tables as one block, a row per
line, cells joined by ` | `; captions where the figure sits; footnotes after the body of their chapter,
endnotes in their Notes chapter, note call numbers omitted. No running heads, page numbers or catchwords.
`meta.notes` explains anything case-specific.

Seeds are fixed. Everything is byte-identical between runs except `scanned` and the two `encrypted*` files
(same content; qpdf's AES-256 key is random).

Files: `make.py` (runner), `common.py` (book model → HTML + truth), `art.py` (Pillow pictures, reportlab
diagrams as SVG), `c_wording.py`, `c_articles.py`, `c_images.py`, `c_layout.py`, `c_special.py`.

Run the converter over the set (`scripts/books-torture-run.mjs`): time, memory, Claude's tokens and cost,
whether the word check held, words kept and added against the truth, reading order, pictures and captions.

```sh
node --experimental-transform-types --import ./scripts/ts-resolve.mjs \
  scripts/books-torture-run.mjs /path/to/out /path/to/results [case ...]
```

`KIMONO_CLAUDE_TOKEN` (or `ANTHROPIC_API_KEY` with `ANTHROPIC_BASE_URL`, as in a Kimono sandbox) adds the
Claude pass; without either it measures the base conversion alone.

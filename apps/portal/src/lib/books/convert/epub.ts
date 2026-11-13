/*
 * The book's text (structure.ts's Markdown) into an EPUB 3 that EPUB 2
 * readers open too: a nav document and a toc.ncx, the cover named both ways,
 * and chapters cut into files of a few thousand words so a small reader
 * (Kimono Read has an ESP32's memory) never has to hold a whole book's part.
 */
import { deflateRawSync } from "node:zlib";

export type EpubMeta = { id: string; title: string; authors: string[]; isbn: string | null; language: string; publisher?: string; year?: number | null };

const FILE_WORDS = 5000;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Block = { kind: "h"; level: number; text: string } | { kind: "p"; text: string } | { kind: "note"; id: string; text: string };

function blocksOf(text: string): Block[] {
  const blocks = parse(text);
  /* Chapters marked one level down (a lone "#" for the book's title, "##" for each chapter): the "##" are the chapters. */
  const heads = blocks.filter((b): b is Extract<Block, { kind: "h" }> => b.kind === "h");
  const ones = heads.filter((h) => h.level === 1).length, twos = heads.filter((h) => h.level === 2).length;
  if (ones <= 1 && twos >= 2) for (const h of heads) if (h.level > 1) h.level--;
  return blocks;
}

function parse(text: string): Block[] {
  return text.split(/\n{2,}/).map((raw) => raw.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean).map((b): Block => {
    const h = /^(#{1,3})\s+(.+)$/.exec(b);
    if (h) return { kind: "h", level: h[1].length, text: h[2] };
    const n = /^\[\^(\d+)\]:\s*(.*)$/.exec(b);
    if (n) return { kind: "note", id: n[1], text: n[2] };
    return { kind: "p", text: b.replace(/^\\(#|\[)/, "$1") };
  });
}

/** Inline Markdown to XHTML: *italic*, **bold**, \* and note marks. */
function inline(text: string, noteHref: (id: string) => string): string {
  let s = esc(text).replace(/\\\*/g, "\u0003").replace(/\\\\/g, "\\");
  s = s.replace(/\*\*(?=\S)([^*]+?)\*\*/g, "<b>$1</b>").replace(/\*(?=\S)([^*]+?)\*/g, "<i>$1</i>").replace(/\*/g, "");
  s = s.replace(/\[\^(\d+)\]/g, (_, id: string) => `<a epub:type="noteref" id="r${id}" href="${noteHref(id)}"><sup>${id}</sup></a>`);
  return s.replace(/\u0003/g, "*");
}

type Doc = { file: string; title: string | null; level: number; blocks: Block[] };

/** Chapters at each "#", then cut at "##" or between paragraphs when a file gets long. */
function documents(text: string, bookTitle: string): Doc[] {
  const docs: Doc[] = [];
  let doc: Doc | null = null, count = 0;
  const open = (title: string | null, level: number) => {
    doc = { file: `text/part${String(docs.length + 1).padStart(4, "0")}.xhtml`, title, level, blocks: [] };
    docs.push(doc);
    count = 0;
  };
  for (const block of blocksOf(text)) {
    const n = block.kind === "note" ? 0 : block.text.split(/\s+/).length;
    if (block.kind === "h" && block.level === 1) open(block.text, 1);
    else if (!doc) open(block.kind === "h" ? block.text : bookTitle, block.kind === "h" ? block.level : 1);
    else if (block.kind === "h" && block.level === 2 && count > FILE_WORDS / 2) open(block.text, 2);
    else if (block.kind === "p" && count > FILE_WORDS) open(null, 0);
    doc!.blocks.push(block);
    count += n;
  }
  return docs;
}

const xhtml = (lang: string, title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head><meta charset="UTF-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head>
<body>
${body}
</body>
</html>
`;

const STYLE = `body { margin: 0 4%; line-height: 1.45; }
h1, h2, h3 { line-height: 1.2; page-break-after: avoid; break-after: avoid; }
h1 { margin: 2em 0 1em; text-align: center; }
p { margin: 0; text-indent: 1.2em; text-align: justify; }
h1 + p, h2 + p, h3 + p, p.first { text-indent: 0; }
a[epub|type~="noteref"] { text-decoration: none; }
aside.notes { margin-top: 2em; border-top: 1px solid; padding-top: .5em; font-size: .9em; }
aside.notes p { text-indent: 0; margin-bottom: .4em; }
img.cover { display: block; max-width: 100%; max-height: 100%; margin: 0 auto; }
`;

/* Books keeps a record's language as its source gave it, often three letters ("spa"); EPUB wants a BCP 47 tag ("es"). */
const twoLetter: Record<string, string> = {
  eng: "en", fre: "fr", fra: "fr", ger: "de", deu: "de", spa: "es", ita: "it", por: "pt", jpn: "ja", chi: "zh", zho: "zh", rus: "ru",
  dut: "nl", nld: "nl", swe: "sv", dan: "da", nor: "no", fin: "fi", pol: "pl", cze: "cs", ces: "cs", gre: "el", ell: "el", tur: "tr",
  kor: "ko", ara: "ar", heb: "he", hin: "hi", lat: "la", hun: "hu", rum: "ro", ron: "ro", ukr: "uk", cat: "ca", per: "fa", fas: "fa",
};
export function languageTag(raw: string): string {
  const l = raw.trim().toLowerCase();
  if (twoLetter[l]) return twoLetter[l];
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(l) ? l : "en";
}

export type Built = { bytes: Uint8Array; chapters: string[]; files: string[] };

export function buildEpub(text: string, meta: EpubMeta, cover: Uint8Array | null): Built {
  const lang = languageTag(meta.language);
  const docs = documents(text, meta.title);
  if (!docs.length) docs.push({ file: "text/part0001.xhtml", title: meta.title, level: 1, blocks: [{ kind: "p", text: "" }] });
  const noteFile = new Map<string, string>();
  for (const d of docs) for (const b of d.blocks) if (b.kind === "note") noteFile.set(b.id, d.file);
  const refFile = new Map<string, string>();
  for (const d of docs) for (const b of d.blocks) if (b.kind !== "note") for (const m of b.text.matchAll(/\[\^(\d+)\]/g)) if (!refFile.has(m[1])) refFile.set(m[1], d.file);
  const rel = (from: string, to: string, anchor: string) => (from === to ? "" : to.replace(/^text\//, "")) + `#${anchor}`;

  const files: [string, Uint8Array | string][] = [];
  for (const d of docs) {
    const body: string[] = [];
    const notes: string[] = [];
    for (const b of d.blocks) {
      if (b.kind === "h") body.push(`<h${b.level}>${inline(b.text, (id) => rel(d.file, noteFile.get(id) ?? d.file, `n${id}`))}</h${b.level}>`);
      else if (b.kind === "p") body.push(`<p>${inline(b.text, (id) => rel(d.file, noteFile.get(id) ?? d.file, `n${id}`))}</p>`);
      else {
        const back = refFile.get(b.id);
        const label = back ? `<a href="${rel(d.file, back, `r${b.id}`)}">${b.id}</a>` : b.id;
        notes.push(`<aside epub:type="footnote" id="n${b.id}"><p>${label}. ${inline(b.text, (id) => rel(d.file, noteFile.get(id) ?? d.file, `n${id}`))}</p></aside>`);
      }
    }
    const title = d.title ?? meta.title;
    const notesBlock = notes.length ? `\n<aside class="notes" epub:type="footnotes">\n${notes.join("\n")}\n</aside>` : "";
    files.push([`OEBPS/${d.file}`, xhtml(lang, title.replace(/\\?\*/g, (m) => m === "\\*" ? "*" : ""), `<section epub:type="${d.level === 1 ? "chapter" : "bodymatter"}">\n${body.join("\n")}${notesBlock}\n</section>`)]);
  }

  /* Contents: each chapter, and the sections a chapter was cut at, under it. */
  type Entry = { title: string; file: string; children: Entry[] };
  const toc: Entry[] = [];
  for (const d of docs) {
    if (!d.title) continue;
    const title = d.title.replace(/\\\*/g, "\u0003").replace(/\*/g, "").replace(/\u0003/g, "*").replace(/\[\^\d+\]/g, "");
    const entry = { title, file: d.file, children: [] };
    if (d.level === 2 && toc.length) toc[toc.length - 1].children.push(entry); else toc.push(entry);
  }
  const navList = (entries: Entry[]): string => `<ol>${entries.map((e) => `<li><a href="${e.file}">${esc(e.title)}</a>${e.children.length ? navList(e.children) : ""}</li>`).join("")}</ol>`;
  files.push(["OEBPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head><meta charset="UTF-8"/><title>${esc(meta.title)}</title></head>
<body>
<nav epub:type="toc" id="toc"><h1>${esc(meta.title)}</h1>${navList(toc)}</nav>
</body>
</html>
`]);
  let order = 0;
  const ncxPoints = (entries: Entry[]): string => entries.map((e) => `<navPoint id="np${++order}" playOrder="${order}"><navLabel><text>${esc(e.title)}</text></navLabel><content src="${e.file}"/>${ncxPoints(e.children)}</navPoint>`).join("\n");
  files.push(["OEBPS/toc.ncx", `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${esc(meta.id)}"/><meta name="dtb:depth" content="2"/></head>
<docTitle><text>${esc(meta.title)}</text></docTitle>
<navMap>
${ncxPoints(toc)}
</navMap>
</ncx>
`]);
  files.push(["OEBPS/style.css", STYLE]);
  if (cover) {
    files.push(["OEBPS/cover.jpg", cover]);
    files.push(["OEBPS/cover.xhtml", xhtml(lang, meta.title, `<section epub:type="cover"><img class="cover" src="cover.jpg" alt="${esc(meta.title)}"/></section>`).replace(/\.\.\/style\.css/, "style.css")]);
  }

  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="style" href="style.css" media-type="text/css"/>`,
    ...(cover ? [`<item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>`, `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`] : []),
    ...docs.map((d, i) => `<item id="part${i + 1}" href="${d.file}" media-type="application/xhtml+xml"/>`),
  ];
  const spine = [...(cover ? [`<itemref idref="cover" linear="yes"/>`] : []), ...docs.map((_, i) => `<itemref idref="part${i + 1}"/>`)];
  files.push(["OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">${esc(meta.id)}</dc:identifier>
${meta.isbn && meta.id !== `urn:isbn:${meta.isbn}` ? `<dc:identifier id="isbn">urn:isbn:${esc(meta.isbn)}</dc:identifier>\n` : ""}<dc:title>${esc(meta.title)}</dc:title>
${meta.authors.map((a, i) => `<dc:creator id="author${i + 1}">${esc(a)}</dc:creator>`).join("\n")}
<dc:language>${lang}</dc:language>
${meta.publisher ? `<dc:publisher>${esc(meta.publisher)}</dc:publisher>\n` : ""}${meta.year ? `<dc:date>${meta.year}</dc:date>\n` : ""}<meta property="dcterms:modified">${modified}</meta>
${cover ? `<meta name="cover" content="cover-image"/>\n` : ""}</metadata>
<manifest>
${manifest.join("\n")}
</manifest>
<spine toc="ncx">
${spine.join("\n")}
</spine>
</package>
`]);

  const bytes = zip([
    ["mimetype", "application/epub+zip", false],
    ["META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`, true],
    ...files.map(([name, data]): [string, Uint8Array | string, boolean] => [name, data, !name.endsWith(".jpg")]),
  ]);
  return { bytes, chapters: toc.map((t) => t.title), files: files.map(([n]) => n) };
}

/* ── A small ZIP writer: the EPUB's mimetype first and stored, the rest deflated. ── */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(entries: [string, Uint8Array | string, boolean][]): Uint8Array {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  /* 1 January 2026, 00:00: a fixed time, so the same book always zips the same. */
  const time = 0, date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const [name, content, compress] of entries) {
    const data = typeof content === "string" ? enc.encode(content) : content;
    const packed = compress ? new Uint8Array(deflateRawSync(data, { level: 9 })) : data;
    const crc = crc32(data);
    const nameBytes = enc.encode(name);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true);
    head.setUint16(8, compress ? 8 : 0, true); head.setUint16(10, time, true); head.setUint16(12, date, true);
    head.setUint32(14, crc, true); head.setUint32(18, packed.length, true); head.setUint32(22, data.length, true);
    head.setUint16(26, nameBytes.length, true); head.setUint16(28, 0, true);
    local.push(new Uint8Array(head.buffer), nameBytes, packed);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, compress ? 8 : 0, true); dir.setUint16(12, time, true); dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true); dir.setUint32(20, packed.length, true); dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true); dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

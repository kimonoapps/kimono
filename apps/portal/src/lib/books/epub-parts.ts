/**
 * 本 An EPUB, a part at a time. An EPUB is a zip; a reader needs its
 * container, its package (OPF) and the chapter it opens on, not the whole
 * book. This reads the zip's directory from the end of the file, then
 * inflates only the part asked for, so a book opens after a few small
 * requests and each chapter arrives as it's turned to. Pure (fs + zlib), so
 * scripts/test-books.mjs can check it.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

type Part = { name: string; method: number; compressed: number; size: number; header: number };
export type EpubDirectory = { size: number; parts: Map<string, Part> };

export class EpubProblem extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}

function readAt(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  const got = readSync(fd, buffer, 0, length, position);
  return buffer.subarray(0, got);
}

/* Directories read lately, by file and size: a reader asks for many parts of the same book. */
const known = new Map<string, EpubDirectory>();

/** The zip's directory: every part's name, size and where it starts. */
export function directoryOf(path: string): EpubDirectory {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const cached = known.get(path);
    if (cached && cached.size === size) return cached;
    /* The end-of-directory record sits in the last 64 KB (it may carry a comment). */
    const tail = readAt(fd, Math.max(0, size - 65_557), Math.min(size, 65_557));
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new EpubProblem("This isn't an EPUB the reader can open.");
    const count = tail.readUInt16LE(end + 10);
    const dirSize = tail.readUInt32LE(end + 12);
    const dirAt = tail.readUInt32LE(end + 16);
    if (dirAt === 0xffffffff || count === 0xffff) throw new EpubProblem("This EPUB is too large for the reader.");
    const dir = readAt(fd, dirAt, dirSize);
    const parts = new Map<string, Part>();
    for (let at = 0, i = 0; i < count && at + 46 <= dir.length; i++) {
      if (dir.readUInt32LE(at) !== 0x02014b50) throw new EpubProblem("This EPUB is damaged.");
      const method = dir.readUInt16LE(at + 10);
      const compressed = dir.readUInt32LE(at + 20);
      const length = dir.readUInt32LE(at + 24);
      const nameLength = dir.readUInt16LE(at + 28);
      const extra = dir.readUInt16LE(at + 30);
      const comment = dir.readUInt16LE(at + 32);
      const header = dir.readUInt32LE(at + 42);
      const name = dir.subarray(at + 46, at + 46 + nameLength).toString("utf8");
      if (!name.endsWith("/")) parts.set(name, { name, method, compressed, size: length, header });
      at += 46 + nameLength + extra + comment;
    }
    const found = { size, parts };
    known.set(path, found);
    if (known.size > 64) known.delete(known.keys().next().value!);
    return found;
  } finally {
    closeSync(fd);
  }
}

/** A part's path inside the book, as asked for: no leading slash, no climbing out, percent-escapes undone. */
export function partName(raw: string): string | null {
  let name: string;
  try { name = decodeURIComponent(raw); } catch { return null; }
  name = name.replace(/^\/+/, "");
  if (!name || name.split("/").some((s) => s === ".." || s === ".")) return null;
  return name;
}

/** One part of the book, inflated. Parts are looked up as named, then without regard to case (some books disagree with themselves). */
export function readPart(path: string, rawName: string): { bytes: Buffer; name: string } {
  const name = partName(rawName);
  if (!name) throw new EpubProblem("No such part of this book.", 404);
  const { parts } = directoryOf(path);
  const part = parts.get(name) ?? [...parts.values()].find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!part) throw new EpubProblem("No such part of this book.", 404);
  if (part.size > 64 * 1024 * 1024) throw new EpubProblem("That part of the book is too large.", 413);
  const fd = openSync(path, "r");
  try {
    const local = readAt(fd, part.header, 30);
    if (local.readUInt32LE(0) !== 0x04034b50) throw new EpubProblem("This EPUB is damaged.");
    const dataAt = part.header + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    const raw = readAt(fd, dataAt, part.compressed);
    if (part.method === 0) return { bytes: raw, name: part.name };
    if (part.method === 8) return { bytes: inflateRawSync(raw, { maxOutputLength: part.size + 1024 }), name: part.name };
    throw new EpubProblem("This EPUB uses a compression the reader doesn't know.");
  } finally {
    closeSync(fd);
  }
}

const types: Record<string, string> = {
  xhtml: "application/xhtml+xml; charset=utf-8", html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  xml: "application/xml; charset=utf-8", opf: "application/oebps-package+xml; charset=utf-8", ncx: "application/x-dtbncx+xml; charset=utf-8",
  css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", svg: "image/svg+xml",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2", mp3: "audio/mpeg", mp4: "video/mp4", txt: "text/plain; charset=utf-8",
};
export const typeOfPart = (name: string) => types[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** A file's address as a path segment (base64url), so a whole book has one base URL its parts sit under. */
export const bookPathId = (address: string) => Buffer.from(address, "utf8").toString("base64url");
export const addressOfPathId = (id: string) => { try { return Buffer.from(id, "base64url").toString("utf8"); } catch { return ""; } };

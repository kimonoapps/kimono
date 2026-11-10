/*
 * Quran and hadith, fetched from published sources rather than written by
 * Kimono AI: it cites a reference (a ```quran or ```hadith block) and the chat
 * shows the real text, its translation and the tafsir from here.
 *
 *   Quran   api.quran.com: Uthmani text, Saheeh International (English) and
 *           Muhammad Hamidullah (French), and the tafsirs listed below.
 *   Hadith  fawazahmed0/hadith-api: Arabic, English and French editions of
 *           the six books, the Muwatta, an-Nawawi's forty and hadith qudsi,
 *           with their grades.
 *
 * Neither changes, so answers are kept in memory for as long as the Portal runs.
 */

const quranApi = "https://api.quran.com/api/v4";
const hadithMirrors = ["https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions", "https://raw.githubusercontent.com/fawazahmed0/hadith-api/1/editions"];

export type Lang = "en" | "fr";
const translationIds: Record<Lang, number> = { en: 20, fr: 31 };

/** Tafsirs offered under a passage, in this order. */
export const tafsirs = [
  { id: 169, name: "Ibn Kathir", lang: "en" },
  { id: 91, name: "Al-Sa'di", lang: "ar" },
  { id: 16, name: "Al-Muyassar", lang: "ar" },
  { id: 15, name: "Al-Tabari", lang: "ar" },
  { id: 90, name: "Al-Qurtubi", lang: "ar" },
] as const;

export const hadithBooks: Record<string, { name: string; fr: boolean }> = {
  bukhari: { name: "Sahih al-Bukhari", fr: true },
  muslim: { name: "Sahih Muslim", fr: true },
  abudawud: { name: "Sunan Abi Dawud", fr: true },
  tirmidhi: { name: "Jami' at-Tirmidhi", fr: false },
  nasai: { name: "Sunan an-Nasa'i", fr: true },
  ibnmajah: { name: "Sunan Ibn Majah", fr: true },
  malik: { name: "Muwatta Malik", fr: true },
  nawawi: { name: "An-Nawawi's Forty", fr: true },
  qudsi: { name: "Forty Hadith Qudsi", fr: true },
};

/* What's been fetched, kept small: the oldest goes first once it's full. */
const cache = new Map<string, Promise<unknown>>();
function kept<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;
  const promise = load();
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  if (cache.size > 4000) cache.delete(cache.keys().next().value as string);
  return promise;
}

async function json(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).host}`);
  return response.json();
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function text(html: string): string {
  return html
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (all, name: string) => name[0] === "#" ? String.fromCodePoint(parseInt(name.slice(name[1] === "x" ? 2 : 1), name[1] === "x" ? 16 : 10)) : entities[name.toLowerCase()] ?? all)
    .replace(/\s+/g, " ")
    .trim();
}

/** A reference such as 2:255, 7:80-81 or 7:80-7:82. */
export function parseQuranRef(ref: string): { surah: number; from: number; to: number } | null {
  const m = /^\s*(\d{1,3})\s*:\s*(\d{1,3})(?:\s*[-–]\s*(?:(\d{1,3})\s*:\s*)?(\d{1,3}))?\s*$/.exec(ref);
  if (!m) return null;
  const surah = Number(m[1]);
  const from = Number(m[2]);
  const to = m[4] ? Number(m[4]) : from;
  if (m[3] && Number(m[3]) !== surah) return null;
  if (surah < 1 || surah > 114 || from < 1 || to < from || to - from > 40) return null;
  return { surah, from, to };
}

type Chapter = { name: string; arabic: string; meaning: string; verses: number };
const chapter = (surah: number) => kept(`ch:${surah}`, async (): Promise<Chapter> => {
  const { chapter: c } = await json(`${quranApi}/chapters/${surah}?language=en`) as { chapter: { name_simple: string; name_arabic: string; verses_count: number; translated_name: { name: string } } };
  return { name: c.name_simple, arabic: c.name_arabic, meaning: c.translated_name.name, verses: c.verses_count };
});

export type Verse = { key: string; number: number; arabic: string; translation: Record<Lang, string> };
const verse = (key: string) => kept(`v:${key}`, async (): Promise<Verse> => {
  const { verse: v } = await json(`${quranApi}/verses/by_key/${key}?fields=text_uthmani&translations=${translationIds.en},${translationIds.fr}`) as { verse: { verse_number: number; text_uthmani: string; translations: { resource_id: number; text: string }[] } };
  const of = (lang: Lang) => text(v.translations.find((t) => t.resource_id === translationIds[lang])?.text ?? "");
  return { key, number: v.verse_number, arabic: v.text_uthmani, translation: { en: of("en"), fr: of("fr") } };
});

/** Where a text was taken from, for the footer under it. */
export type Source = { name: string; url: string };

export type Passage = { ref: string; surah: number; chapter: Chapter; before: Verse[]; verses: Verse[]; after: Verse[]; tafsirs: typeof tafsirs; source: Source };

/** The verses cited, with one on each side for context (grey in the chat). */
export async function quranPassage(ref: string): Promise<Passage | null> {
  const parsed = parseQuranRef(ref);
  if (!parsed) return null;
  const { surah, from } = parsed;
  const ch = await chapter(surah);
  if (from > ch.verses) return null;
  const to = Math.min(parsed.to, ch.verses);
  const range = (a: number, b: number) => Promise.all(Array.from({ length: Math.max(0, b - a + 1) }, (_, n) => verse(`${surah}:${a + n}`)));
  const [before, verses, after] = await Promise.all([range(Math.max(1, from - 1), from - 1), range(from, to), range(to + 1, Math.min(ch.verses, to + 1))]);
  const key = from === to ? `${surah}:${from}` : `${surah}:${from}-${to}`;
  return { ref: key, surah, chapter: ch, before, verses, after, tafsirs, source: { name: "Quran.com API", url: `https://quran.com/${surah}/${from}${to > from ? `-${to}` : ""}` } };
}

/** A heading, a paragraph, an Arabic quotation, or (gloss) a short Arabic phrase with its translation beside it. */
export type TafsirPart = { kind: "h" | "p" | "ar" | "gloss"; text: string; ar?: string };
export type Tafsir = { id: number; name: string; lang: string; covers: string[]; parts: TafsirPart[]; edition: string; source: Source };

/* Tafsir text arrives as HTML: headings, paragraphs and Arabic quotations. It's turned into plain parts, never shown as HTML. */
function tafsirParts(html: string): TafsirPart[] {
  const parts: TafsirPart[] = [];
  const add = (kind: TafsirPart["kind"], body: string) => { const t = text(body); if (t) parts.push({ kind, text: t }); };
  const loose = (body: string) => body.split(/<br\s*\/?>/i).forEach((chunk) => add("p", chunk));
  let last = 0;
  for (const m of html.matchAll(/<(h[1-6]|p|div)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    loose(html.slice(last, m.index));
    add(m[1][0].toLowerCase() === "h" ? "h" : /arabic/.test(m[2]) ? "ar" : "p", m[3]);
    last = m.index + m[0].length;
  }
  loose(html.slice(last));
  /* Ibn Kathir quotes a verse a phrase at a time, each followed by its meaning in brackets: keep them together as one line. */
  const joined: TafsirPart[] = [];
  for (let n = 0; n < parts.length; n++) {
    const part = parts[n], next = parts[n + 1];
    if (part.kind === "ar" && part.text.length < 160 && next?.kind === "p" && next.text.startsWith("(")) { joined.push({ kind: "gloss", ar: part.text, text: next.text }); n++; }
    else joined.push(part);
  }
  return joined;
}

export async function tafsir(id: number, key: string): Promise<Tafsir | null> {
  const known = tafsirs.find((t) => t.id === id);
  if (!known || !parseQuranRef(key)) return null;
  return kept(`t:${id}:${key}`, async () => {
    const { tafsir: t } = await json(`${quranApi}/tafsirs/${id}/by_ayah/${key}`) as { tafsir: { text: string; verses: Record<string, unknown>; resource_name?: string; slug?: string; translated_name?: { name?: string } } };
    const [surah, verse] = key.split(":");
    return { id, name: known.name, lang: known.lang, covers: Object.keys(t.verses ?? {}), parts: tafsirParts(t.text ?? ""), edition: t.translated_name?.name || t.resource_name || known.name,
      source: { name: "Quran.com API", url: `https://quran.com/${surah}:${verse}/tafsirs/${t.slug ?? ""}`.replace(/\/$/, "") } };
  });
}

export type Hadith = { book: string; bookName: string; number: number; chapter: string | null; arabic: string; translation: Partial<Record<Lang, string>>; grades: { name: string; grade: string }[]; source: Source };

async function edition(name: string, number: number) {
  let failure: unknown;
  for (const base of hadithMirrors) {
    try {
      const data = await json(`${base}/${name}/${number}.min.json`) as { metadata: { section: Record<string, string> }; hadiths: { text: string; grades?: { name: string; grade: string }[] }[] };
      return data;
    } catch (error) { failure = error; }
  }
  throw failure;
}

export async function hadith(book: string, number: number): Promise<Hadith | null> {
  const known = hadithBooks[book];
  if (!known || !Number.isInteger(number) || number < 1 || number > 99999) return null;
  return kept(`h:${book}:${number}`, async (): Promise<Hadith | null> => {
    const [ara, eng, fra] = await Promise.all([
      edition(`ara-${book}`, number).catch(() => null),
      edition(`eng-${book}`, number),
      known.fr ? edition(`fra-${book}`, number).catch(() => null) : Promise.resolve(null),
    ]);
    const first = eng.hadiths[0];
    if (!first?.text && !ara?.hadiths[0]?.text) return null;
    const section = Object.values(eng.metadata.section ?? {})[0] ?? null;
    return {
      book, bookName: known.name, number,
      chapter: section,
      arabic: ara?.hadiths[0]?.text?.trim() ?? "",
      translation: { en: first?.text?.trim() ?? "", ...(fra?.hadiths[0]?.text ? { fr: fra.hadiths[0].text.trim() } : {}) },
      grades: (first?.grades ?? []).filter((g) => g.grade),
      source: { name: "hadith-api by fawazahmed0", url: "https://github.com/fawazahmed0/hadith-api" },
    };
  });
}

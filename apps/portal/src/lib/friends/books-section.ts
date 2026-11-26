import type { ShelfItem } from "../books/model";
import type { Section } from "./model";

/**
 * 本 Books on a Kimono profile: what someone is reading (and how far), wants
 * to read and has read, from their Books shelf; and whether they read on a
 * Kimono Reader. Books keeps both (lib/books); a profile only reads them.
 */
export function booksSectionsFrom(shelf: ShelfItem[]): Section[] {
  const latest = [...shelf].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  /* What they're on, then what they want and have read; how they rated each is a mark on its cover. */
  const rows: [string, string, (b: ShelfItem) => boolean][] = [
    ["reading", "Reading now", (b) => b.state === "reading"], ["want", "Want to read", (b) => b.state === "want"], ["read", "Read", (b) => b.state === "read"],
  ];
  return rows.map(([state, title, has]) => ({
    app: "books", appName: "Books", kind: state, title,
    items: latest.filter(has).slice(0, 24).map((b) => ({
      app: "books", itemId: b.key, title: b.title,
      subtitle: [b.authors[0], b.year].filter(Boolean).join(" · ") || null,
      cover: b.cover, href: `/books?b=${encodeURIComponent(b.key)}`,
      progress: state === "reading" ? Math.min(1, Math.max(0, b.fraction)) : null,
      rating: b.rating ?? null,
      /* When it last changed. */
      at: Date.parse(b.updatedAt) || null,
    })),
  })).filter((s) => s.items.length > 0);
}

async function booksOn() {
  const [{ booksConfig }, { getPlatformSettings }] = await Promise.all([import("../books/config"), import("../settings")]);
  return booksConfig(await getPlatformSettings()).enabled;
}

/** Someone's Books rows for their profile; nothing while Books is off. */
export async function booksSections(viewer: string, username: string): Promise<Section[]> {
  void viewer;
  if (!(await booksOn())) return [];
  const { listShelf } = await import("../books");
  return booksSectionsFrom(listShelf(username.toLowerCase()));
}

/**
 * What a profile's Books widgets show: their latest reviews (with how they
 * rated the book) and the books they've read. The profile asks only when
 * friends may see their Read shelf.
 */
export async function booksExtras(username: string) {
  if (!(await booksOn())) return null;
  const { booksDb, getBook } = await import("../books");
  const rows = booksDb().prepare("SELECT key, rating, review, reviewed_at, updated_at FROM shelf WHERE username = ? AND state = 'read' ORDER BY updated_at DESC LIMIT 60")
    .all(username.toLowerCase()) as { key: string; rating: string | null; review: string | null; reviewed_at: number | null; updated_at: number }[];
  const books = rows.flatMap((r) => { const b = getBook(r.key); return b ? [{ r, b }] : []; });
  const view = ({ r, b }: (typeof books)[number]) => ({ key: b.key, title: b.title, author: b.authors[0] ?? "", cover: b.cover, rating: (r.rating as "down" | "up" | "love" | null) ?? null, at: r.updated_at });
  return {
    reviews: books.filter(({ r }) => r.review?.trim()).sort((x, y) => (y.r.reviewed_at ?? 0) - (x.r.reviewed_at ?? 0)).slice(0, 6)
      .map((x) => ({ ...view(x), review: x.r.review!.trim().slice(0, 600) })),
    read: books.slice(0, 40).map(view),
  };
}

/** Since when they've read on a Kimono Reader (the profile's badge), or null. It's about the device, so it shows whatever the Books switch says. */
export async function kimonoReadOf(username: string): Promise<{ since: string } | null> {
  const { kimonoReadSince } = await import("../books");
  const since = kimonoReadSince(username.toLowerCase());
  return since ? { since } : null;
}

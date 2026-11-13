import type { ShelfItem } from "../books/model";
import type { Section } from "./model";

/**
 * 本 Books on a Kimono profile: what someone is reading (and how far), wants
 * to read and has read, from their Books shelf; and whether they read on a
 * Kimono Read. Books keeps both (lib/books); a profile only reads them.
 */
export function booksSectionsFrom(shelf: ShelfItem[]): Section[] {
  const latest = [...shelf].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  /* What they're on, then what they want, have read, and loved or liked (as Watch's rows are). */
  const rows: [string, string, (b: ShelfItem) => boolean][] = [
    ["reading", "Reading now", (b) => b.state === "reading"], ["want", "Want to read", (b) => b.state === "want"], ["read", "Read", (b) => b.state === "read"],
    ["loved", "Loved", (b) => b.rating === "love"], ["liked", "Liked", (b) => b.rating === "up"],
  ];
  return rows.map(([state, title, has]) => ({
    app: "books", appName: "Books", kind: state, title,
    items: latest.filter(has).slice(0, 24).map((b) => ({
      app: "books", itemId: b.key, title: b.title,
      subtitle: [b.authors[0], b.year].filter(Boolean).join(" · ") || null,
      cover: b.cover, href: `/books?b=${encodeURIComponent(b.key)}`,
      progress: state === "reading" ? Math.min(1, Math.max(0, b.fraction)) : null,
      /* When it last changed, so a title taken off the profile comes back once you read on or rate it again. */
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

/** Since when they've read on a Kimono Read (the profile's badge), or null. It's about the device, so it shows whatever the Books switch says. */
export async function kimonoReadOf(username: string): Promise<{ since: string } | null> {
  const { kimonoReadSince } = await import("../books");
  const since = kimonoReadSince(username.toLowerCase());
  return since ? { since } : null;
}

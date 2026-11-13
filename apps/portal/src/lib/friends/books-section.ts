import type { ShelfItem } from "../books/model";
import type { Section } from "./model";

/**
 * 本 Books on a Kimono profile: what someone is reading (and how far), has
 * read and wants to read, from their Books shelf. Books keeps the shelf
 * (lib/books); a profile only reads it.
 */
export function booksSectionsFrom(shelf: ShelfItem[]): Section[] {
  const latest = [...shelf].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const rows: [ShelfItem["state"], string][] = [["reading", "Reading now"], ["read", "Read"], ["want", "Want to read"]];
  return rows.map(([state, title]) => ({
    app: "books", appName: "Books", kind: state, title,
    items: latest.filter((b) => b.state === state).slice(0, 24).map((b) => ({
      app: "books", itemId: b.key, title: b.title,
      subtitle: [b.authors[0], b.year].filter(Boolean).join(" · ") || null,
      cover: b.cover, href: null,
      progress: state === "reading" && b.fraction > 0 ? Math.min(1, b.fraction) : null,
    })),
  })).filter((s) => s.items.length > 0);
}

/**
 * Someone's Books rows for their profile. Books' shelf isn't readable from here yet
 * (lib/books is to export `listShelf(username)`); until then a profile shows no Books rows.
 */
export async function booksSections(viewer: string, username: string): Promise<Section[]> {
  void viewer; void username;
  return [];
}

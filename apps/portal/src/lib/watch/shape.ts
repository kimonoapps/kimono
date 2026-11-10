/**
 * Each copy's picture shape, as measured when it last played (the packager's
 * probe). A copy's name rarely says it was cropped to 16:9; its shape does,
 * so the next pick for that title passes over it (./releases.ts offShape).
 */

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { cached, keep } from "./model";
import { expectedShape, type Framing } from "./releases";

const ttl = 60 * 24 * 60 * 60 * 1000;
const key = (url: string) => `shape:${createHash("sha256").update(url).digest("hex").slice(0, 32)}`;

export function noteShape(db: DatabaseSync, url: string, aspect: number | null) {
  if (aspect && Number.isFinite(aspect)) keep(db, key(url), Math.round(aspect * 1000) / 1000, ttl);
}

export function framingOf(db: DatabaseSync, title: { kind: string; year: number | null }): Framing {
  return { expected: expectedShape(title.kind, title.year), shapeOf: (url) => cached<number>(db, key(url)) };
}

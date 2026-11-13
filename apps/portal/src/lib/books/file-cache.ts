import "server-only";

import { join } from "node:path";
import { stateDir } from "../state";
import { FileCache } from "./cache";

/** Books' one file cache, in the Portal's state folder. */
const g = globalThis as unknown as { kimonoBookCache?: FileCache };
export function bookFileCache(): FileCache {
  const gb = Number(process.env.KIMONO_BOOKS_CACHE_GB) || 4;
  return (g.kimonoBookCache ??= new FileCache(join(stateDir, "books", "files"), gb * 1024 ** 3));
}

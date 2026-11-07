import { apiError, apiJson } from "@/lib/api-v1";
import { db, publicFile, publicFolder } from "@/lib/drive";
import { driveConfig } from "@/lib/drive/config";
import { isNoteName, notes, textOf, titleOf } from "@/lib/notes";
import { getPlatformSettings } from "@/lib/settings";

/**
 * What a public link shows, without signing in: one note `{ note: { title, text, updatedAt } }`,
 * or a notebook `{ notebook: { name, sections, notes: [{ id, parentId, title, text, updatedAt }] } }`.
 * Read-only. Nothing about who wrote it or where it lives in Kimono.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return notes(async () => {
    if (!driveConfig(await getPlatformSettings()).publicLinks) return apiError(404, "This link doesn't work.");
    const file = publicFile(db(), token);
    if (file) {
      if (!isNoteName(file.name)) return apiError(404, "This link doesn't work.");
      return noStore({ note: { title: titleOf(file.name), text: await textOf(file.blob), updatedAt: file.updatedAt } });
    }
    const folder = publicFolder(db(), token);
    if (!folder) return apiError(404, "This link doesn't work.");
    const sections = folder.nodes.filter((n) => n.kind === "folder").map((n) => ({ id: n.id, parentId: n.parentId === folder.folder.id ? null : n.parentId, name: n.name }));
    const found = await Promise.all(folder.nodes.filter((n) => n.kind === "file" && isNoteName(n.name))
      .map(async (n) => ({ id: n.id, parentId: n.parentId === folder.folder.id ? null : n.parentId, title: titleOf(n.name), text: await textOf(n.blob), updatedAt: n.updatedAt })));
    return noStore({ notebook: { name: folder.folder.name, sections, notes: found.sort((a, b) => b.updatedAt - a.updatedAt) } });
  });
}

function noStore(body: unknown) {
  const response = apiJson(body);
  response.headers.set("Cache-Control", "private, no-cache");
  response.headers.set("X-Robots-Tag", "noindex");
  return response;
}

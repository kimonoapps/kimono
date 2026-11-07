import { apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { createNote, library, notes } from "@/lib/notes";

/** Your notebooks, their sections, and every note in them, newest first, each with a line of its text. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return notes(async () => {
    const response = apiJson(await library(user.username));
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}

/** A new note: `{ parent?, title?, text? }`. Without a parent it goes in your own notebook. */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return notes(async () => apiJson(await createNote(user.username, read.body as { parent?: unknown; title?: unknown; text?: unknown }), 201));
}

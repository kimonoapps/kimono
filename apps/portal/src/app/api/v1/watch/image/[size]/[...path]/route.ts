import { image } from "@/lib/watch";

type Context = { params: Promise<{ size: string; path: string[] }> };

/* Posters and stills: open like TMDB's own, since image loaders don't always send a sign-in header. */
export async function GET(_request: Request, { params }: Context) {
  const { size, path } = await params;
  return image(size, path);
}

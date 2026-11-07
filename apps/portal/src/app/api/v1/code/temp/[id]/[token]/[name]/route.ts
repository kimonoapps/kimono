import { tempLink } from "@/lib/code";

type Context = { params: Promise<{ id: string; token: string; name: string }> };

/** A file Kimono AI linked for one of its tools (kimono-link): open to whoever has the link, until it expires. */
export async function GET(request: Request, { params }: Context) {
  const { id, token, name } = await params;
  return tempLink(request, id, token, name);
}

export const HEAD = GET;

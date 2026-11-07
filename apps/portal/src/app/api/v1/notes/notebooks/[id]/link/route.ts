import { deleteLink, isNotebook, postLink } from "@/lib/notes/sharing";

type Context = { params: Promise<{ id: string }> };

/** Turns on the notebook's public link: anyone with it can read its notes, without signing in. */
export async function POST(request: Request, { params }: Context) {
  return postLink(request, (await params).id, isNotebook);
}

/** Turns it off. */
export async function DELETE(request: Request, { params }: Context) {
  return deleteLink(request, (await params).id, isNotebook);
}

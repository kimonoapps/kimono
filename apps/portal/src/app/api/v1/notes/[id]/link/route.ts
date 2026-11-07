import { deleteLink, isNote, postLink } from "@/lib/notes/sharing";

type Context = { params: Promise<{ id: string }> };

/** Turns on the note's public link: anyone with it can read it, without signing in. */
export async function POST(request: Request, { params }: Context) {
  return postLink(request, (await params).id, isNote);
}

/** Turns it off. */
export async function DELETE(request: Request, { params }: Context) {
  return deleteLink(request, (await params).id, isNote);
}

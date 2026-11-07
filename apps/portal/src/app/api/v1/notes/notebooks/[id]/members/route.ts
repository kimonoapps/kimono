import { getSharing, isNotebook, putSharing } from "@/lib/notes/sharing";

type Context = { params: Promise<{ id: string }> };

/** Who a notebook is shared with beyond its space, who sees it in its space, and its public link. */
export async function GET(_request: Request, { params }: Context) {
  return getSharing((await params).id, isNotebook);
}

/** Shares it with someone, changes what they may do, or (role null) takes them off: `{ username, role }`. Anyone may leave. */
export async function PUT(request: Request, { params }: Context) {
  return putSharing(request, (await params).id, isNotebook);
}

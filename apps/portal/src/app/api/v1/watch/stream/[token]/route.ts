import { relay } from "@/lib/watch";

type Context = { params: Promise<{ token: string }> };

/* The sealed token is the permission: players can't always send a sign-in header. */
export async function GET(request: Request, { params }: Context) {
  return relay(request, (await params).token);
}

export async function HEAD(request: Request, { params }: Context) {
  return relay(request, (await params).token);
}

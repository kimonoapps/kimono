import { hlsRelay } from "@/lib/watch";

type Context = { params: Promise<{ token: string; path: string[] }> };

/* HLS for browsers, AirPlay and Chromecast: the sealed token is the permission, like a stream's. */
export async function GET(request: Request, { params }: Context) {
  const { token, path } = await params;
  return hlsRelay(request, token, path);
}

export async function HEAD(request: Request, { params }: Context) {
  const { token, path } = await params;
  return hlsRelay(request, token, path);
}

/* Receivers ask first when they send Range from another origin. */
export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": "range",
      "access-control-max-age": "86400",
    },
  });
}

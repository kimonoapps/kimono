import { NextResponse, type NextRequest } from "next/server";

/**
 * /api/v1 answers the phone app from any origin when it shows a bearer token.
 * Such a request is never authenticated by cookie (see lib/api-v1.ts), and the
 * cross-origin answer carries no credentials, so this lends nothing to another
 * site that it didn't already hold. Cookie requests from other sites stay
 * unreadable, as before.
 */
const allow = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "600",
};

/**
 * Notes' MCP server and its sign-in answer any origin the same way: none of
 * them reads a cookie, so a browser-based client (the MCP Inspector, a web
 * chat) may call them and read the 401 that says where to sign in.
 */
const mcpAllow = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "600",
};

const portalOrigin = () => (process.env.KIMONO_PORTAL_URL || process.env.AUTH_URL?.replace(/\/api\/auth\/?$/, "") || "http://localhost:3000").replace(/\/+$/, "");

function mcp(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/mcp/authorize" || path.startsWith("/mcp/authorize/")) {
    /* People allow apps where they're signed in: on the Portal's own address, never in a frame. */
    const portal = new URL(portalOrigin());
    const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0].trim().toLowerCase();
    if (request.method === "GET" && host && host !== portal.host) return NextResponse.redirect(new URL(`${path}${request.nextUrl.search}`, portal));
    const response = NextResponse.next();
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    return response;
  }
  if (request.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: mcpAllow });
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(mcpAllow)) response.headers.set(key, value);
  return response;
}

export function proxy(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/v1/")) return mcp(request);
  if (request.method === "OPTIONS") {
    const asked = request.headers.get("access-control-request-headers")?.toLowerCase() || "";
    if (!asked.includes("authorization") && request.nextUrl.pathname !== "/api/v1/sign-in") return new NextResponse(null, { status: 204 });
    return new NextResponse(null, { status: 204, headers: allow });
  }
  if (!request.headers.has("authorization") && request.nextUrl.pathname !== "/api/v1/sign-in") return NextResponse.next();
  const response = NextResponse.next();
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}

/* Uploads stream their bodies straight to disk; a proxy in front would buffer them.
   The rest of the Notes address is sent to the Portal by the appliance's proxy (lib/deployment.ts). */
export const config = { matcher: ["/api/v1/((?!drive/uploads).*)", "/mcp", "/mcp/:path*", "/.well-known/oauth-protected-resource/:path*", "/.well-known/oauth-authorization-server/:path*"] };

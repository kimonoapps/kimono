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

export function proxy(request: NextRequest) {
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

/* Uploads stream their bodies straight to disk; a proxy in front would buffer them. */
export const config = { matcher: "/api/v1/((?!drive/uploads).*)" };

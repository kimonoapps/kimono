import { NextResponse, type NextRequest } from "next/server";
import { appIssuer } from "@/lib/app-tokens";

/**
 * Signing in a TV. Kimono Watch on a TV shows a code and a QR code for this
 * address; the person opens it on their phone, signs in if they aren't, and
 * enters (or, from the QR code, already has) the code. The code is checked
 * and approved where every Kimono sign-in happens, and the TV picks up its
 * own sign-in from there.
 */
export function GET(request: NextRequest) {
  const issuer = appIssuer();
  if (!issuer) return new NextResponse("Signing in a TV isn't set up on this Kimono yet.", { status: 503 });
  const target = new URL("/device", new URL(issuer).origin);
  /* Only the digits the TV shows: whatever else is in the address stays behind. */
  const code = (request.nextUrl.searchParams.get("code") || "").replace(/\D/g, "").slice(0, 12);
  if (code) target.searchParams.set("code", code);
  return NextResponse.redirect(target, 302);
}

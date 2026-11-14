/**
 * Vouches for the Kimono app on iPhone: passwords saved for this Kimono's
 * website are offered in the app and the other way round, and the addresses
 * the app has screens for open in it when it's installed (Universal Links).
 * iOS only asks the addresses the app was built for (kimonolabs.dev); serving
 * it everywhere costs nothing and is ready if a Kimono's own build adds its address.
 * The paths match the app's routeOfLink (apps/compose/shared/.../Links.kt).
 */
const kimonoIos = "DF8FQFRCS5.app.kimono.compose";

const opensInApp = ["/code", "/notes", "/drive", "/books", "/ai/c/*", "/ai/a/*"];

export function GET() {
  return Response.json({
    webcredentials: { apps: [kimonoIos] },
    applinks: { details: [{ appIDs: [kimonoIos], components: opensInApp.map((path) => ({ "/": path })) }] },
  }, { headers: { "Cache-Control": "public, max-age=3600" } });
}

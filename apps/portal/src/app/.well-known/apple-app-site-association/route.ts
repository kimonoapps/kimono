/**
 * Vouches for the Kimono app on iPhone, so passwords saved for this Kimono's
 * website are offered in the app and the other way round. iOS only asks the
 * addresses the app was built for (kimonolabs.dev); serving it everywhere
 * costs nothing and is ready if a Kimono's own build adds its address.
 */
const kimonoIos = "DF8FQFRCS5.app.kimono.compose";

export function GET() {
  return Response.json({ webcredentials: { apps: [kimonoIos] } }, { headers: { "Cache-Control": "public, max-age=3600" } });
}

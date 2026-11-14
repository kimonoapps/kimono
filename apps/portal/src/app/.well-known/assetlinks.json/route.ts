/**
 * Vouches for the Kimono app on Android, so the phone's password manager
 * treats a password saved for this Kimono's website and one saved in the
 * app as the same, and the addresses the app has screens for open in it
 * (App Links). Every Kimono serves it, whatever its address.
 */
const kimonoAndroid = {
  package: "app.kimono.compose",
  /* The release signing certificate's SHA-256: public, and the same on every build. */
  certificate: "DB:24:A9:2D:6B:1D:F0:A9:EA:02:73:9C:98:38:F2:3C:9E:D1:9E:E9:85:F5:68:51:F9:74:CA:96:75:C7:79:33",
};

export function GET() {
  return Response.json([{
    relation: ["delegate_permission/common.get_login_creds", "delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: kimonoAndroid.package, sha256_cert_fingerprints: [kimonoAndroid.certificate] },
  }], { headers: { "Cache-Control": "public, max-age=3600" } });
}

// Whether App Store Connect has an app for a bundle ID: prints "yes" or "no".
// node scripts/asc-has-app.mjs app.kimono.watch, with ASC_KEY (the .p8's
// text), ASC_KEY_ID and ASC_ISSUER_ID in the environment. Apple's API can't
// create the app itself; the release skips a build for one that isn't there.
import { createSign } from "node:crypto";

const bundleId = process.argv[2];
const { ASC_KEY, ASC_KEY_ID, ASC_ISSUER_ID } = process.env;
if (!bundleId || !ASC_KEY || !ASC_KEY_ID || !ASC_ISSUER_ID) { console.error("usage: ASC_KEY=… ASC_KEY_ID=… ASC_ISSUER_ID=… node asc-has-app.mjs <bundle id>"); process.exit(2); }
const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const unsigned = `${part({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" })}.${part({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: "appstoreconnect-v1" })}`;
const signature = createSign("SHA256").update(unsigned).sign({ key: ASC_KEY, dsaEncoding: "ieee-p1363" }).toString("base64url");
const response = await fetch(`https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=bundleId`, {
  headers: { Authorization: `Bearer ${unsigned}.${signature}` },
});
if (!response.ok) { console.error(`App Store Connect answered ${response.status}`); process.exit(1); }
const { data } = await response.json();
console.log(data.some((app) => app.attributes?.bundleId === bundleId) ? "yes" : "no");

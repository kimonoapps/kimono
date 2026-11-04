import { readReleases } from "@/lib/app-releases";
import { updateFor } from "@/lib/app-updates";
import { syncTestflightIfDue } from "@/lib/testflight";

/**
 * Whether this phone's Kimono app should update: `?platform=android|ios&build=N`.
 * Open to phones that aren't signed in, so an update that's needed reaches
 * them before anything else does. It says only what's published.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const platform = query.get("platform");
  const build = Number(query.get("build"));
  if ((platform !== "android" && platform !== "ios") || !Number.isInteger(build) || build < 0) {
    return Response.json({ error: "Say which platform and build." }, { status: 400 });
  }
  /* iPhones ask here: a good moment to bring TestFlight in step, without making them wait for it. */
  if (platform === "ios") void syncTestflightIfDue().catch(() => {});
  const { releases, iosLink } = await readReleases();
  const update = updateFor(releases, platform, build);
  const origin = new URL(request.url).origin;
  return Response.json({
    ...update,
    /* Android installs the package itself; an iPhone goes to TestFlight. */
    url: !update.available ? null : platform === "android" ? `${origin}/api/v1/app/packages/${update.build}` : iosLink,
  }, { headers: { "Cache-Control": "no-store" } });
}

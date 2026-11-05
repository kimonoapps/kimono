import { InkPortraitFrame, Seal } from "@kimono/ui";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { Crossing } from "@/components/crossing";
import { HoldSeal } from "@/components/hold-seal";
import { LineIcon } from "@/components/line-icon";
import { Portrait } from "@/components/portrait";
import { picturePathFor } from "@/lib/pictures";
import { getPlatformSettings } from "@/lib/settings";
import { readReleases, setRequired } from "@/lib/app-releases";
import type { AppPlatform } from "@/lib/app-updates";
import { redirect } from "next/navigation";
import { forgetTestflightKey, saveTestflightKey, syncTestflight, syncTestflightIfDue, testflightSettings } from "@/lib/testflight";
import { isApiKey } from "@/lib/testflight-token";

export const metadata = { title: "Phone app · Admin" };

async function admin() {
  const current = await auth();
  if (!current?.user || (current.user.role !== "owner" && current.user.role !== "admin")) redirect("/");
  return current.user;
}

/** Runs an admin change and comes back, with what went wrong if anything did. */
async function then(work: () => Promise<unknown>) {
  try { await work(); } catch (error) {
    redirect(`/admin/phone-app?error=${encodeURIComponent(error instanceof Error ? error.message : "That didn't work.")}`);
  }
  redirect("/admin/phone-app");
}

export default async function PhoneAppPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/");
  /* Keeps TestFlight in step at most hourly; the page shows the last result without waiting. */
  void syncTestflightIfDue().catch(() => {});
  const [settings, { releases }, query, testflight] = await Promise.all([getPlatformSettings(), readReleases({ fresh: true }), searchParams, testflightSettings().catch(() => null)]);

  async function toggleRequired(form: FormData) {
    "use server";
    await admin();
    await then(() => setRequired(form.get("platform") as AppPlatform, Number(form.get("build")), form.get("required") === "true"));
  }
  async function saveTestflight(form: FormData) {
    "use server";
    await admin();
    await then(async () => {
      const issuerId = String(form.get("issuerId") || "").trim();
      const keyId = String(form.get("keyId") || "").trim();
      const file = form.get("key");
      const privateKey = file instanceof File && file.size > 0 && file.size < 10_000 ? (await file.text()).trim() : "";
      if (!/^[0-9a-f-]{36}$/i.test(issuerId)) throw new Error("The issuer ID looks like 57246542-96fe-1a63-e053-0824d011072a.");
      if (!/^[A-Z0-9]{10}$/.test(keyId)) throw new Error("The key ID is ten letters and numbers, like 2X9R4HXF34.");
      if (!isApiKey(privateKey)) throw new Error("Choose the .p8 key file App Store Connect gave you.");
      await saveTestflightKey({ issuerId, keyId, privateKey, groupName: "Kimono" });
      await syncTestflight();
    });
  }
  async function syncNow() {
    "use server";
    await admin();
    await then(() => syncTestflight());
  }
  async function forgetKey() {
    "use server";
    await admin();
    await then(() => forgetTestflightKey());
  }

  const platforms: { platform: AppPlatform; label: string }[] = [{ platform: "android", label: "Android" }, { platform: "ios", label: "iPhone" }];
  const pictures = new Map(await Promise.all((testflight?.statuses ?? []).map(async (row) => [row.username, await picturePathFor(row.username)] as const)));
  const checked = (at: number | string) => new Date(at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });

  /*
   * Phone app (design/mockups/m3-everywhere.html): two release cards with the
   * version as the big number and "Required" as a switch. Testers are a list
   * of portraits with plain status; sync is a small action at the top, and
   * forgetting the key is held.
   */
  return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
    <div className="page phone-app-page">
      <div className="topbar">
        <Crossing kind="kakejiku" className="back" href="/admin" aria-label="Back to Admin"><LineIcon name="back" /></Crossing>
        <span><h1>Phone app</h1><p className="sub">Phones offer each release when opened. A required one must be installed first.</p></span>
      </div>
      {query.error ? <p role="alert" className="app-notice is-error">{query.error}</p> : null}

      <div className="cols">
        {platforms.map(({ platform, label }, index) => {
          const release = releases.find((r) => r.platform === platform);
          const tone = index === 0 ? { background: "var(--tertiary-container)", color: "var(--on-tertiary-container)" } : { background: "var(--secondary-container)" };
          if (!release) return <div className="card release-card" key={platform} style={{ background: "var(--sc)" }}><span className="eyebrow">{label}</span><span className="release-version is-none">Not built</span><small>No {label} app was built for this release.</small></div>;
          return <div className="card release-card" key={platform} style={tone}>
            <span className="eyebrow" style={{ color: tone.color }}>{label}</span>
            <span className="release-version">{release.version}</span>
            <small>{platform === "android" ? `Build ${release.build}${release.size ? ` · ${(release.size / 1_000_000).toFixed(0)} MB` : ""}` : `Build ${release.build} · TestFlight`}</small>
            <form action={toggleRequired} className="release-required">
              <input type="hidden" name="platform" value={platform} />
              <input type="hidden" name="build" value={release.build} />
              <input type="hidden" name="required" value={String(!release.required)} />
              <span><b>Required</b><small>{release.required ? "Phones must install it before going on" : "Phones offer it; people can wait"}</small></span>
              <button className="joint" role="switch" type="submit" aria-checked={release.required} aria-label={`Require ${label} ${release.version}`} />
            </form>
          </div>;
        })}
      </div>

      {testflight ? <>
        <div className="testers-head">
          <div className="label">TestFlight testers</div>
          {testflight.lastSync ? <small>Checked {checked(testflight.lastSync.at)}</small> : null}
          <form action={syncNow}><button className="txt" type="submit"><LineIcon name="restore" />Sync now</button></form>
        </div>
        {testflight.lastSync && !testflight.lastSync.ok ? <p role="alert" className="app-notice is-error">{testflight.lastSync.message}</p> : null}
        {testflight.statuses.length ? <div className="seg">
          {testflight.statuses.map((row) => <div className="row" key={row.username}>
            <InkPortraitFrame seed={row.username} weight={5}><Portrait name={row.name} username={row.username} picture={pictures.get(row.username)} size={36} /></InkPortraitFrame>
            <span className="text"><b>{row.name}</b><small>@{row.username} · {testerLine(row.status, row.email)}{Object.entries(row.also ?? {}).map(([app, status]) => ` · ${app}: ${status}`).join("")}</small></span>
            <span className={row.status === "tester" ? "k-ink-dot k-running" : row.status.startsWith("error") || row.status === "no email" ? "k-ink-dot k-wants" : "k-ink-dot"}>{row.status.startsWith("error") ? "Problem" : testerLabel(row.status)}</span>
          </div>)}
        </div> : <p className="lead phone-empty">Nobody has asked for the iPhone app yet. People ask from Get the app on their iPhone.</p>}
        <div className="card testflight-key">
          <span><b>App Store Connect key {testflight.keyId}</b><small>People who ask on their iPhone are invited at their Kimono email and added to {appList(testflight.lastSync?.apps)} once they accept. When their Kimono access ends, they&rsquo;re taken off.</small></span>
          <form action={forgetKey}><HoldSeal label="Hold to forget key" holdingLabel="Keep holding" /></form>
        </div>
      </> : <>
        <div className="label">TestFlight</div>
        <form action={saveTestflight} className="card testflight-setup">
          <p className="lead">Give Kimono an App Store Connect API key with the Admin role, and anyone with a Kimono account can get the iPhone app from the website on their iPhone.</p>
          <div className="sheet-pair">
            <label className="field"><small>Issuer ID</small><input name="issuerId" required autoComplete="off" placeholder="57246542-96fe-1a63-e053-0824d011072a" /></label>
            <label className="field"><small>Key ID</small><input name="keyId" required autoComplete="off" placeholder="2X9R4HXF34" /></label>
          </div>
          <label className="field"><small>Key file (.p8)</small><input name="key" type="file" accept=".p8" required /></label>
          <div className="sheet-actions"><Seal type="submit">Save and sync</Seal></div>
        </form>
      </>}
    </div>
  </AppShell>;
}

/** What a tester's status means, in a few words. */
function testerLine(status: string, email?: string | null) {
  if (status === "tester") return "Kimono installed through TestFlight";
  if (status.startsWith("invited")) return email ? `Invite sent to ${email}` : "Invite sent";
  if (status === "added") return "Accepted, not installed yet";
  if (status === "no email") return "Needs an email on their account";
  if (status === "not requested") return "Hasn't asked yet";
  if (status === "no Kimono access") return "Their Kimono access has ended";
  if (status === "removed") return "Taken off TestFlight";
  return status;
}

/** "Kimono", "Kimono and Kimono Photos": the iPhone apps App Store Connect has. */
function appList(apps: string[] | undefined) {
  const names = apps?.length ? apps : ["Kimono"];
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
}

/** A tester status as a short label beside the name. */
function testerLabel(status: string) {
  if (status.startsWith("invited")) return "Invited";
  return ({ added: "Added", removed: "Removed", "no email": "No email", "not requested": "Not requested", "no Kimono access": "No access" } as Record<string, string>)[status] ?? status;
}


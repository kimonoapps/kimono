import { Compartment, Field, Form, FormActions, Note, PageHeader, Row, Rows, Seal, StatedSeal } from "@kimono/ui";
import { auth } from "@/auth";
import { AdminNavigation } from "@/components/admin-navigation";
import { AppShell } from "@/components/app-shell";
import { getPlatformSettings } from "@/lib/settings";
import { publishRelease, readReleases, removeRelease, setIosLink, setRequired } from "@/lib/app-releases";
import type { AppPlatform, AppRelease } from "@/lib/app-updates";
import { redirect } from "next/navigation";
import { PublishAndroid } from "./publish-android";

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
  const [settings, { releases, iosLink }, query] = await Promise.all([getPlatformSettings(), readReleases(), searchParams]);
  const of = (platform: AppPlatform) => releases.filter((r) => r.platform === platform).sort((a, b) => b.build - a.build);
  const next = (platform: AppPlatform) => Math.max(0, ...of(platform).map((r) => r.build)) + 1;

  async function toggleRequired(form: FormData) {
    "use server";
    await admin();
    await then(() => setRequired(form.get("platform") as AppPlatform, Number(form.get("build")), form.get("required") === "true"));
  }
  async function remove(form: FormData) {
    "use server";
    await admin();
    await then(() => removeRelease(form.get("platform") as AppPlatform, Number(form.get("build"))));
  }
  async function publishIos(form: FormData) {
    "use server";
    const user = await admin();
    await then(() => publishRelease({ platform: "ios", version: form.get("version"), build: form.get("build"), notes: form.get("notes"), required: form.get("required") === "on" }, user.username));
  }
  async function saveLink(form: FormData) {
    "use server";
    await admin();
    await then(() => setIosLink(String(form.get("link") || "")));
  }

  const list = (platform: AppPlatform) => {
    const items = of(platform);
    if (!items.length) return <Note>Nothing published yet. Phones keep the version they have.</Note>;
    return <Rows>{items.map((release, index) => <Row
      key={release.build}
      title={`${release.version} · build ${release.build}`}
      lead={<>
        {index === 0 ? <StatedSeal state="running">Latest</StatedSeal> : null}
        {release.required ? <StatedSeal state="wants">Required</StatedSeal> : null}
      </>}
      action={<div className="k-seal-group">
        <form action={toggleRequired}>
          <input type="hidden" name="platform" value={platform} />
          <input type="hidden" name="build" value={release.build} />
          <input type="hidden" name="required" value={String(!release.required)} />
          <Seal type="submit" tone="quiet" compact>{release.required ? "Make optional" : "Require"}</Seal>
        </form>
        <form action={remove}>
          <input type="hidden" name="platform" value={platform} />
          <input type="hidden" name="build" value={release.build} />
          <Seal type="submit" tone="danger" compact>Take down</Seal>
        </form>
      </div>}
    >{describe(release)}</Row>)}</Rows>;
  };

  return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
    <div className="page admin-page">
      <AdminNavigation active="phone-app" />
      <PageHeader title="Phone app" description="Publish new versions of the Kimono app. Phones offer each one when it opens; a required version must be installed before Kimono can be used again." />
      {query.error ? <p className="admin-notice error">{query.error}</p> : null}

      <Compartment label="Android">
        {list("android")}
        <PublishAndroid nextBuild={next("android")} />
      </Compartment>

      <Compartment label="iPhone">
        {list("ios")}
        <Form action={publishIos} afterRows>
          <Note>iPhone versions arrive through TestFlight. Publish the build here once it is there, to offer or require it.</Note>
          <Field label="Version"><input name="version" placeholder="0.2.0" required autoComplete="off" /></Field>
          <Field label="Build"><input name="build" type="number" min={next("ios")} defaultValue={next("ios")} required /></Field>
          <Field label="What's new"><textarea name="notes" rows={3} placeholder="Optional." /></Field>
          <Field label="Required"><input type="checkbox" name="required" /></Field>
          <FormActions><Seal type="submit">Publish</Seal></FormActions>
        </Form>
        <Form action={saveLink} afterRows>
          <Field label="Where iPhones update"><input name="link" defaultValue={iosLink} required /></Field>
          <FormActions><Seal type="submit" tone="quiet">Save</Seal></FormActions>
        </Form>
      </Compartment>
    </div>
  </AppShell>;
}

function describe(release: AppRelease) {
  if (release.publishedBy === "kimono" && !release.publishedAt) {
    return `Comes with this Kimono release, from GitHub${release.size ? ` · ${(release.size / 1_000_000).toFixed(1)} MB` : ""}`;
  }
  const when = new Date(release.publishedAt).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
  const size = release.size ? ` · ${(release.size / 1_000_000).toFixed(1)} MB` : "";
  return `Published ${when} by @${release.publishedBy}${size}${release.notes ? ` · ${release.notes}` : ""}`;
}

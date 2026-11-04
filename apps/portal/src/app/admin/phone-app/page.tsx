import { Compartment, Field, Form, FormActions, Note, PageHeader, Row, Rows, Seal, StatedSeal } from "@kimono/ui";
import { auth } from "@/auth";
import { AdminNavigation } from "@/components/admin-navigation";
import { AppShell } from "@/components/app-shell";
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
  const [settings, { releases }, query, testflight] = await Promise.all([getPlatformSettings(), readReleases(), searchParams, testflightSettings().catch(() => null)]);

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

  return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
    <div className="page admin-page">
      <AdminNavigation active="phone-app" />
      <PageHeader title="Phone app" description="Each Kimono release builds the phone apps. Phones offer them when opened; a required one must be installed first." />
      {query.error ? <p className="admin-notice error">{query.error}</p> : null}

      <Compartment label="This release">
        {releases.length ? <Rows>{platforms.map(({ platform, label }) => {
          const release = releases.find((r) => r.platform === platform);
          if (!release) return <Row key={platform} title={label}>Not built for this release</Row>;
          return <Row
            key={platform}
            title={`${label} · ${release.version}`}
            lead={release.required ? <StatedSeal state="wants">Required</StatedSeal> : null}
            action={<form action={toggleRequired}>
              <input type="hidden" name="platform" value={platform} />
              <input type="hidden" name="build" value={release.build} />
              <input type="hidden" name="required" value={String(!release.required)} />
              <Seal type="submit" tone="quiet" compact>{release.required ? "Make optional" : "Require"}</Seal>
            </form>}
          >{platform === "android" ? `Build ${release.build}${release.size ? ` · ${(release.size / 1_000_000).toFixed(1)} MB` : ""}` : `Build ${release.build} · TestFlight`}</Row>;
        })}</Rows> : <Note>No phone apps were built for this release.</Note>}
      </Compartment>

      <Compartment label="TestFlight" wants={!testflight}>
        {testflight ? <>
          <Note>Everyone with a Kimono account and an email is invited to test the iPhone app, and added once they accept. People whose Kimono access ends are taken off again. Key {testflight.keyId} · group {testflight.groupName}.</Note>
          {testflight.lastSync ? <p className={`admin-notice ${testflight.lastSync.ok ? "success" : "error"}`}>Last checked {new Date(testflight.lastSync.at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}: {testflight.lastSync.message}</p> : null}
          {testflight.statuses.length ? <Rows>{testflight.statuses.map((row) => <Row
            key={row.username}
            title={row.name}
            lead={row.status === "tester" ? <StatedSeal state="running">Tester</StatedSeal> : row.status.startsWith("error") ? <StatedSeal state="wants">Problem</StatedSeal> : <StatedSeal state="quiet">{testerLabel(row.status)}</StatedSeal>}
          >@{row.username}{row.email ? ` · ${row.email}` : ""} · {row.status}</Row>)}</Rows> : null}
          <div className="k-seal-group" style={{ marginTop: 12 }}>
            <form action={syncNow}><Seal type="submit" compact>Sync now</Seal></form>
            <form action={forgetKey}><Seal type="submit" tone="danger" compact>Forget key</Seal></form>
          </div>
        </> : <Form action={saveTestflight}>
          <Note>Give Kimono an App Store Connect API key with the Admin role, and everyone with a Kimono account becomes a tester of the iPhone app automatically.</Note>
          <Field label="Issuer ID"><input name="issuerId" required autoComplete="off" placeholder="57246542-96fe-1a63-e053-0824d011072a" /></Field>
          <Field label="Key ID"><input name="keyId" required autoComplete="off" placeholder="2X9R4HXF34" /></Field>
          <Field label="Key file (.p8)"><input name="key" type="file" accept=".p8" required /></Field>
          <FormActions><Seal type="submit">Save and sync</Seal></FormActions>
        </Form>}
      </Compartment>
    </div>
  </AppShell>;
}

/** A tester status as a short label beside the name. */
function testerLabel(status: string) {
  if (status.startsWith("invited")) return "Invited";
  return ({ added: "Added", removed: "Removed", "no email": "No email", "no Kimono access": "No access" } as Record<string, string>)[status] ?? status;
}


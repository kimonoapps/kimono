import { Compartment, Field, Form, FormActions, Note, PageHeader, Seal, StatedSeal } from "@kimono/ui";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AdminNavigation } from "@/components/admin-navigation";
import { AppShell } from "@/components/app-shell";
import { db, driveUsage, maxFileBytes, root } from "@/lib/drive";
import { freeBytes } from "@/lib/drive/storage";
import { getPlatformSettings, saveDriveSettings } from "@/lib/settings";

export const metadata = { title: "Kimono Drive · Admin" };

async function admin() {
  const current = await auth();
  if (!current?.user || (current.user.role !== "owner" && current.user.role !== "admin")) redirect("/");
}

export default async function DriveAdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/");
  const [settings, query] = await Promise.all([getPlatformSettings(), searchParams]);
  const { drive } = settings;
  const usage = await Promise.all([Promise.resolve().then(() => driveUsage(db())), freeBytes(root)]).catch(() => null);

  async function setEnabled(form: FormData) {
    "use server";
    await admin();
    await saveDriveSettings({ enabled: form.get("enabled") === "true" });
    redirect("/admin/drive");
  }
  async function save(form: FormData) {
    "use server";
    await admin();
    const largest = String(form.get("largest") || "").trim();
    if (largest && !/^\d+$/.test(largest)) redirect(`/admin/drive?error=${encodeURIComponent("The largest file is a whole number of GB, or empty for no limit.")}`);
    await saveDriveSettings({ publicLinks: form.get("publicLinks") === "on", largestFileMb: largest ? Number(largest) * 1024 : 0 });
    redirect("/admin/drive");
  }

  return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
    <div className="page admin-page">
      <AdminNavigation active="drive" />
      <PageHeader title="Kimono Drive" description="Spaces where people in your household keep and share files, on the web, in the Kimono app, and in their phone's Files app." />
      {query.error ? <p className="admin-notice error">{query.error}</p> : null}

      <Compartment label="Status" wants={!drive.enabled}>
        <div className="k-seal-group">
          {drive.enabled ? <StatedSeal state="running">On</StatedSeal> : <StatedSeal state="quiet">Off</StatedSeal>}
          <form action={setEnabled}>
            <input type="hidden" name="enabled" value={String(!drive.enabled)} />
            <Seal type="submit" tone={drive.enabled ? "danger" : undefined} compact>{drive.enabled ? "Switch off" : "Switch on"}</Seal>
          </form>
        </div>
        <Note>{drive.enabled
          ? "Everyone with a Kimono account can use Drive. Switching it off hides it everywhere; files are kept."
          : "Drive is hidden on the web and in the apps until it is switched on."}</Note>
      </Compartment>

      {usage ? <Compartment label="Storage">
        <Note>{usage[0].files} files in {usage[0].spaces} spaces · {size(usage[0].bytes)}{usage[0].trashedBytes ? ` · ${size(usage[0].trashedBytes)} in recently deleted` : ""} · {size(usage[1])} free on the disk</Note>
      </Compartment> : null}

      <Compartment label="Settings">
        <Form action={save}>
          <Field label="Public links"><input type="checkbox" name="publicLinks" defaultChecked={drive.publicLinks} /></Field>
          <Note>Lets people share a file or a space with a link that opens without signing in. Switching it off stops every such link at once.</Note>
          <Field label="Largest file (GB)"><input name="largest" inputMode="numeric" defaultValue={drive.largestFileMb ? String(Math.round(drive.largestFileMb / 1024)) : ""} placeholder={`No limit (up to ${Math.round(maxFileBytes / 1024 ** 3)})`} autoComplete="off" /></Field>
          <FormActions><Seal type="submit">Save</Seal></FormActions>
        </Form>
      </Compartment>
    </div>
  </AppShell>;
}

function size(bytes: number) {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000, unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1; }
  return `${value >= 100 ? Math.round(value) : Number(value.toFixed(1))} ${units[unit]}`;
}

import { Compartment, Field, Form, FormActions, Note, PageHeader, Row, Rows, Seal } from "@kimono/ui";
import { auth } from "@/auth";
import { AdminNavigation } from "@/components/admin-navigation";
import { AppShell } from "@/components/app-shell";
import { getPlatformSettings } from "@/lib/settings";
import { readMesh } from "@/lib/mesh";
import { listAccounts, readMeshMembers, setMeshAccess, syncAccountsFromIdentity, type MeshMember } from "@/lib/directory";
import { publishDesiredState } from "@/lib/desired-state";
import { redirect } from "next/navigation";

export const metadata = { title: "Kimono VPN · Admin" };

export default async function AdminVpnPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/");
  /* Refreshed on load so a newly created account is grantable immediately. */
  const directory = await syncAccountsFromIdentity();
  const [settings, mesh, query, accounts] = await Promise.all([getPlatformSettings(), readMesh(), searchParams, listAccounts()]);
  const membership = await readMeshMembers().catch(() => ({} as Record<string, MeshMember>));
  /* Only accounts that do not already hold access are worth offering. */
  const candidates = accounts.filter((account) => !membership[account.username]);
  const members = Object.values(membership).sort((a, b) => a.username.localeCompare(b.username));
  const meshMember = Boolean(membership[session.user.username]);

  async function grant(form: FormData) {
    "use server";
    const current = await auth();
    if (!current?.user || (current.user.role !== "owner" && current.user.role !== "admin")) redirect("/");
    try {
      await setMeshAccess(String(form.get("username") || ""), true);
      await publishDesiredState(await getPlatformSettings());
    } catch (error) {
      redirect(`/admin/vpn?error=${encodeURIComponent(error instanceof Error ? error.message : "Access could not be granted")}`);
    }
    redirect("/admin/vpn");
  }

  async function revoke(form: FormData) {
    "use server";
    const current = await auth();
    if (!current?.user || (current.user.role !== "owner" && current.user.role !== "admin")) redirect("/");
    try {
      await setMeshAccess(String(form.get("username") || ""), false);
      await publishDesiredState(await getPlatformSettings());
    } catch (error) {
      redirect(`/admin/vpn?error=${encodeURIComponent(error instanceof Error ? error.message : "Access could not be switched off")}`);
    }
    redirect("/admin/vpn");
  }

  return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
    <div className="page admin-page">
      <AdminNavigation active="vpn" />
      <PageHeader title="Kimono VPN" description="Who may build a private mesh. Each member reaches only their own devices, and the ones they are invited to." />

      {query.error ? <p className="admin-notice error">{query.error}</p> : null}
      {!mesh.available ? <p className="admin-notice error">{mesh.reason}</p> : null}
      {"error" in directory ? <p className="admin-notice error">{directory.error}</p> : null}

      <Compartment label="Members" wants={members.length === 0}>
        {members.length
          ? <Rows>{members.map((member) => <Row
              key={member.username}
              title={member.displayName}
              action={<form action={revoke}>
                <input type="hidden" name="username" value={member.username} />
                <Seal tone="danger" type="submit">Switch off</Seal>
              </form>}
            >@{member.username} · {member.guests.length ? `${member.guests.length} ${member.guests.length === 1 ? "guest" : "guests"}` : "no guests"}</Row>)}</Rows>
          : <Note>Nobody has Kimono VPN yet.</Note>}
      </Compartment>

      <Compartment label="Switch on for someone">
        {candidates.length ? <Form action={grant}>
          <Field label="Account">
            <select name="username" required defaultValue="">
              <option value="" disabled>Choose someone</option>
              {candidates.map((account) => <option key={account.username} value={account.username}>{account.name} · @{account.username}</option>)}
            </select>
          </Field>
          <FormActions><Seal type="submit">Switch on</Seal></FormActions>
        </Form> : <Note>Everyone in your household already has Kimono VPN.</Note>}
      </Compartment>
    </div>
  </AppShell>;
}

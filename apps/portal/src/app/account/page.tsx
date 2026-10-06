import { redirect } from "next/navigation";
import { Compartment, Field, Form, FormActions, Seal, Tray } from "@kimono/ui";
import { auth, updateSession } from "@/auth";
import { changeProfile } from "@/lib/account";
import { accountContext } from "./account-frame";
import { PictureEditor } from "./picture-editor";

export const metadata = { title: "Your account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { account } = await accountContext();
  const query = await searchParams;

  async function saveDetails(form: FormData) {
    "use server";
    const current = await auth();
    if (!current?.user?.username) redirect("/login");
    try {
      const change = await changeProfile(current.user, { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? "") });
      await updateSession({ user: change });
    } catch (error) {
      redirect(`/account?error=${encodeURIComponent(error instanceof Error ? error.message : "Your details could not be saved")}`);
    }
    redirect("/account?saved=1");
  }

  return <>
    {query.saved ? <p className="admin-notice success">Saved.</p> : null}
    {query.error ? <p className="admin-notice error">{query.error}</p> : null}
    <Tray>
      <header className="account-heading"><h2>Profile</h2></header>
      <Compartment label="Picture">
        <PictureEditor name={account.name} username={account.username} picture={account.picture} />
      </Compartment>
      <Compartment label="Details">
        <Form action={saveDetails}>
          <Field label="Name"><input name="name" defaultValue={account.name} maxLength={80} autoComplete="name" required /></Field>
          <Field label="Email"><input name="email" type="email" defaultValue={account.email} maxLength={254} autoComplete="email" required /></Field>
          <div className="k-field"><span>Username</span><span className="account-fixed">@{account.username}</span></div>
          <FormActions><Seal type="submit">Save details</Seal></FormActions>
        </Form>
      </Compartment>
    </Tray>
  </>;
}

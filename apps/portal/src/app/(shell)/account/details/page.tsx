import { redirect } from "next/navigation";
import { Seal } from "@kimono/ui";
import { auth, updateSession } from "@/auth";
import { changeProfile } from "@/lib/account";
import { Crossing } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import { accountContext } from "../account-frame";
import { DetailsFields } from "../details-fields";

export const metadata = { title: "Name and email · You" };

export default async function DetailsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { account } = await accountContext();
  const { error } = await searchParams;

  async function saveDetails(form: FormData) {
    "use server";
    const current = await auth();
    if (!current?.user?.username) redirect("/login");
    try {
      const change = await changeProfile(current.user, { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), currentPassword: String(form.get("currentPassword") ?? "") });
      await updateSession({ user: change });
    } catch (failure) {
      redirect(`/account/details?error=${encodeURIComponent(failure instanceof Error ? failure.message : "Your details could not be saved")}`);
    }
    redirect("/account/settings?saved=1");
  }

  return <div className="you" style={{ maxWidth: 560 }}>
    <div className="topbar"><Crossing kind="kakejiku" className="back" href="/account/settings" aria-label="Back to Settings"><LineIcon name="back" /></Crossing><h1>Name and email</h1></div>
    <form className="stack" style={{ gap: 12 }} action={saveDetails}>
      {error ? <p className="admin-notice error" role="alert">{error}</p> : null}
      <DetailsFields name={account.name} email={account.email} username={account.username} />
      <Seal type="submit" className="full">Save</Seal>
    </form>
  </div>;
}

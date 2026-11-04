import { redirect } from "next/navigation";
import { InkBlot, InkPortraitFrame, Seal } from "@kimono/ui";
import { auth, updateSession } from "@/auth";
import { changeProfile, listSessions } from "@/lib/account";
import { signOutCompletely } from "@/lib/sign-out";
import { runningVersion } from "@/lib/kimono-release";
import { Crossing } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import { Portrait } from "@/components/portrait";
import { accountContext } from "./account-frame";
import { DetailsFields } from "./details-fields";
import { PictureEditor } from "./picture-editor";

export const metadata = { title: "You" };

/* You, as on the phone: the picture, then grouped rows that open the account's places. */
export default async function YouPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; sheet?: string }> }) {
  const { session, account } = await accountContext();
  const query = await searchParams;
  const signIns = await listSessions(session.user).then((list) => list.length, () => null);

  async function saveDetails(form: FormData) {
    "use server";
    const current = await auth();
    if (!current?.user?.username) redirect("/login");
    try {
      const change = await changeProfile(current.user, { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), currentPassword: String(form.get("currentPassword") ?? "") });
      await updateSession({ user: change });
    } catch (error) {
      redirect(`/account?sheet=details&error=${encodeURIComponent(error instanceof Error ? error.message : "Your details could not be saved")}`);
    }
    redirect("/account?saved=1");
  }

  const row = (href: string, icon: Parameters<typeof LineIcon>[0]["name"], tint: string, title: string, detail: string) =>
    <Crossing kind="kakejiku" className="row" href={href}>
      <InkBlot tint={tint} seed={title}><LineIcon name={icon} /></InkBlot>
      <span className="text"><b>{title}</b><small>{detail}</small></span><span className="go" />
    </Crossing>;

  return <div className="you">
    {query.saved ? <p className="admin-notice success" role="status">Saved.</p> : null}
    <div className="stack you-head">
      <span className="you-picture">
        <InkPortraitFrame seed={account.username} weight={3}><Portrait name={account.name} username={account.username} picture={account.picture} size={92} /></InkPortraitFrame>
        <Crossing kind="kakejiku" className="you-camera" href="/account?sheet=picture" aria-label="Change your picture"><LineIcon name="camera" /></Crossing>
      </span>
      <h1>{account.name}</h1>
      <p>@{account.username} · {account.role.charAt(0).toUpperCase() + account.role.slice(1)}</p>
    </div>

    <div className="label">Account</div>
    <div className="seg">
      {row("/account?sheet=details", "user", "#a84d63", "Name and email", account.email || "Add an email")}
      {row("/account/password", "lock", "#74565c", "Password", "Change your password")}
      {row("/account/devices", "laptop", "#5c7150", "Signed-in devices", signIns === null ? "See where you're signed in" : `${signIns} right now`)}
    </div>
    <div className="label">Your phone</div>
    <div className="seg">{row("/get-app", "phone", "#8a7c77", "Get the Kimono app", "Android and iPhone")}</div>
    <div className="label">This browser</div>
    <div className="seg">
      <form action={async () => { "use server"; await signOutCompletely(); redirect("/login"); }}>
        <button className="row danger" type="submit">
          <InkBlot tint="#a84d63" seed="sign out"><LineIcon name="door" /></InkBlot>
          <span className="text"><b>Sign out</b><small>Close this session</small></span>
        </button>
      </form>
    </div>
    <p className="you-version">Kimono {runningVersion() ?? "development build"}</p>

    {query.sheet === "details" ? <div className="scrim open"><form className="sheet" action={saveDetails}>
      <span className="handle" />
      <h3>Name and email</h3>
      {query.error ? <p className="admin-notice error" role="alert">{query.error}</p> : null}
      <DetailsFields name={account.name} email={account.email} username={account.username} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Crossing kind="kakejiku" className="k-seal k-tone-quiet" href="/account">Cancel</Crossing>
        <Seal type="submit">Save</Seal>
      </div>
    </form></div> : null}
    {query.sheet === "picture" ? <div className="scrim open"><div className="sheet">
      <span className="handle" />
      <h3>Your picture</h3>
      <PictureEditor name={account.name} username={account.username} picture={account.picture} />
      <div style={{ display: "flex", justifyContent: "flex-end" }}><Crossing kind="kakejiku" className="k-seal k-tone-quiet" href="/account">Done</Crossing></div>
    </div></div> : null}
  </div>;
}

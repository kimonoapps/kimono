import { redirect } from "next/navigation";
import { InkBlot } from "@kimono/ui";
import { listSessions } from "@/lib/account";
import { signOutCompletely } from "@/lib/sign-out";
import { runningVersion } from "@/lib/kimono-release";
import { Crossing } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import { AppearanceRow } from "@/components/appearance";
import { accountContext } from "./account-frame";
import { PictureEditor } from "./picture-editor";
import { ProfileView } from "./friends/friends-ui";
import "./friends/friends.css";

export const metadata = { title: "You" };

/* You: your profile as friends see it, changed in place. The account's own things sit behind its gear. */
export default async function YouPage({ searchParams }: { searchParams: Promise<{ saved?: string; sheet?: string }> }) {
  const { session, account } = await accountContext();
  const query = await searchParams;
  const signIns = await listSessions(session.user).then((list) => list.length, () => null);

  const row = (href: string, icon: Parameters<typeof LineIcon>[0]["name"], tint: string, title: string, detail?: string) =>
    <Crossing kind="kakejiku" className="row" href={href}>
      <InkBlot tint={tint} seed={title}><LineIcon name={icon} /></InkBlot>
      <span className="text"><b>{title}</b>{detail ? <small>{detail}</small> : null}</span><span className="go" />
    </Crossing>;

  const settings = <>
    <div className="seg you-settings">
      {row("/account/details", "user", "#a84d63", "Email", account.email || "Add an email")}
      {row("/account/password", "lock", "#74565c", "Password")}
      {row("/account/devices", "laptop", "#5c7150", "Signed-in devices", signIns === null ? undefined : `${signIns} right now`)}
      {row("/get-app", "phone", "#8a7c77", "Get the Kimono app", "Android and iPhone")}
      <AppearanceRow />
      <form action={async () => { "use server"; await signOutCompletely(); redirect("/login"); }}>
        <button className="row danger" type="submit">
          <InkBlot tint="#a84d63" seed="sign out"><LineIcon name="door" /></InkBlot>
          <span className="text"><b>Sign out</b></span>
        </button>
      </form>
    </div>
    <p className="you-version">Kimono {runningVersion() ?? "development build"}</p>
  </>;

  return <>
    {query.saved ? <p className="admin-notice success" role="status">Saved.</p> : null}
    <ProfileView username={account.username} account={settings} />
    {query.sheet === "picture" ? <div className="scrim open"><div className="sheet">
      <span className="handle" />
      <h3>Your picture</h3>
      <PictureEditor name={account.name} username={account.username} picture={account.picture} />
      <div style={{ display: "flex", justifyContent: "flex-end" }}><Crossing kind="kakejiku" className="k-seal k-tone-quiet" href="/account">Done</Crossing></div>
    </div></div> : null}
  </>;
}

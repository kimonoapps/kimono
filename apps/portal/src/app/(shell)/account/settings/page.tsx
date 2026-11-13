import { redirect } from "next/navigation";
import { InkBlot } from "@kimono/ui";
import { listSessions } from "@/lib/account";
import { signOutCompletely } from "@/lib/sign-out";
import { runningVersion } from "@/lib/kimono-release";
import { Crossing } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import { AppearanceRow } from "@/components/appearance";
import { accountContext } from "../account-frame";
import { InvisibleRow } from "../friends/friends-ui";
import "../friends/friends.css";

export const metadata = { title: "Settings · You" };

/* Settings: the account's own things, off You's gear. Your profile itself is changed on You. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { session, account } = await accountContext();
  const { saved } = await searchParams;
  const signIns = await listSessions(session.user).then((list) => list.length, () => null);

  const row = (href: string, icon: Parameters<typeof LineIcon>[0]["name"], tint: string, title: string, detail?: string) =>
    <Crossing kind="kakejiku" className="row" href={href}>
      <InkBlot tint={tint} seed={title}><LineIcon name={icon} /></InkBlot>
      <span className="text"><b>{title}</b>{detail ? <small>{detail}</small> : null}</span><span className="go" />
    </Crossing>;

  return <div className="you you-settings-page">
    <div className="topbar"><Crossing kind="kakejiku" className="back" href="/account" aria-label="Back to You"><LineIcon name="back" /></Crossing><h1>Settings</h1></div>
    {saved ? <p className="admin-notice success" role="status">Saved.</p> : null}

    <div className="label">Sign-in</div>
    <div className="seg">
      {row("/account/details", "user", "#a84d63", "Email", account.email || "Add an email")}
      {row("/account/password", "lock", "#74565c", "Password")}
      {row("/account/devices", "laptop", "#5c7150", "Signed-in devices", signIns === null ? undefined : signIns === 1 ? "1 right now" : `${signIns} right now`)}
    </div>

    <div className="label">Privacy</div>
    <div className="seg"><InvisibleRow /></div>

    <div className="label">This browser</div>
    <div className="seg"><AppearanceRow /></div>

    <div className="label">Your phone</div>
    <div className="seg">{row("/get-app", "phone", "#8a7c77", "Get the Kimono app", "Android and iPhone")}</div>

    <div className="seg you-signout">
      <form action={async () => { "use server"; await signOutCompletely(); redirect("/login"); }}>
        <button className="row danger" type="submit">
          <InkBlot tint="#a84d63" seed="sign out"><LineIcon name="door" /></InkBlot>
          <span className="text"><b>Sign out</b></span>
        </button>
      </form>
    </div>
    <p className="you-version">Kimono {runningVersion() ?? "development build"}</p>
  </div>;
}

import { redirect } from "next/navigation";
import { InkBlot, InkPortraitFrame } from "@kimono/ui";
import { listSessions } from "@/lib/account";
import { signOutCompletely } from "@/lib/sign-out";
import { runningVersion } from "@/lib/kimono-release";
import { friendsDb, friendsList } from "@/lib/friends";
import { bioOf } from "@/lib/friends/model";
import { Crossing } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import { Portrait } from "@/components/portrait";
import { accountContext } from "./account-frame";
import { PictureEditor } from "./picture-editor";
import { AppearanceRow } from "@/components/appearance";

export const metadata = { title: "You" };

/* You, as on the phone: the picture, then grouped rows that open the account's places. */
export default async function YouPage({ searchParams }: { searchParams: Promise<{ saved?: string; sheet?: string }> }) {
  const { session, account } = await accountContext();
  const query = await searchParams;
  const signIns = await listSessions(session.user).then((list) => list.length, () => null);
  const friends = await friendsList(account.username).catch(() => null);
  const bio = (() => { try { return bioOf(friendsDb(), account.username); } catch { return ""; } })();
  const friendsLine = !friends ? "Friends" : [
    friends.friends.length === 1 ? "1 friend" : `${friends.friends.length} friends`,
    friends.asked.length ? `${friends.asked.length} asking` : null,
    friends.unseen ? `${friends.unseen} new for you` : null,
  ].filter(Boolean).join(" · ");

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
      {row("/account/details", "user", "#a84d63", "Name and email", account.email || "Add an email")}
      {row("/account/password", "lock", "#74565c", "Password", "Change your password")}
      {row("/account/devices", "laptop", "#5c7150", "Signed-in devices", signIns === null ? "See where you're signed in" : `${signIns} right now`)}
    </div>
    <div className="label">Friends</div>
    <div className="seg">
      {row(`/account/people/${encodeURIComponent(account.username)}`, "user", "#a84d63", "Your profile", bio || "Add a few words about you")}
      {row("/account/friends", "people", "#5c7150", "Friends", friendsLine)}
    </div>
    <div className="label">Your phone</div>
    <div className="seg">{row("/get-app", "phone", "#8a7c77", "Get the Kimono app", "Android and iPhone")}</div>
    <div className="label">This browser</div>
    <div className="seg">
      <AppearanceRow />
      <form action={async () => { "use server"; await signOutCompletely(); redirect("/login"); }}>
        <button className="row danger" type="submit">
          <InkBlot tint="#a84d63" seed="sign out"><LineIcon name="door" /></InkBlot>
          <span className="text"><b>Sign out</b><small>Close this session</small></span>
        </button>
      </form>
    </div>
    <p className="you-version">Kimono {runningVersion() ?? "development build"}</p>

    {query.sheet === "picture" ? <div className="scrim open"><div className="sheet">
      <span className="handle" />
      <h3>Your picture</h3>
      <PictureEditor name={account.name} username={account.username} picture={account.picture} />
      <div style={{ display: "flex", justifyContent: "flex-end" }}><Crossing kind="kakejiku" className="k-seal k-tone-quiet" href="/account">Done</Crossing></div>
    </div></div> : null}
  </div>;
}

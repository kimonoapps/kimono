import { Crossing } from "@/components/crossing";
import { accountContext } from "./account-frame";
import { PictureEditor } from "./picture-editor";
import { ProfileView } from "./friends/friends-ui";
import "./friends/friends.css";

export const metadata = { title: "You" };

/* You: your profile as friends see it, changed in place. The account's own things are on Settings, off its gear. */
export default async function YouPage({ searchParams }: { searchParams: Promise<{ saved?: string; sheet?: string }> }) {
  const { account } = await accountContext();
  const query = await searchParams;

  return <>
    {query.saved ? <p className="admin-notice success" role="status">Saved.</p> : null}
    <ProfileView username={account.username} home />
    {query.sheet === "picture" ? <div className="scrim open"><div className="sheet">
      <span className="handle" />
      <h3>Your picture</h3>
      <PictureEditor name={account.name} username={account.username} picture={account.picture} />
      <div style={{ display: "flex", justifyContent: "flex-end" }}><Crossing kind="kakejiku" className="k-seal k-tone-quiet" href="/account">Done</Crossing></div>
    </div></div> : null}
  </>;
}

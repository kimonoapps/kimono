import { redirect } from "next/navigation";
import { InkBlot, Seal } from "@kimono/ui";
import { Crossing } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import { HoldSeal } from "@/components/hold-seal";
import { auth } from "@/auth";
import { endAllSessions, endSession, listSessions, type AccountSession } from "@/lib/account";
import { describeSession as describe } from "@kimono/account";
import { accountContext } from "../account-frame";

export const metadata = { title: "Signed-in devices · You" };

export default async function DevicesPage({ searchParams }: { searchParams: Promise<{ ended?: string; error?: string }> }) {
  const { session } = await accountContext();
  const query = await searchParams;
  let sessions: AccountSession[] = [];
  let unavailable: string | null = null;
  try { sessions = await listSessions(session.user); }
  catch (error) { unavailable = error instanceof Error ? error.message : "Your sign-ins could not be listed."; }

  async function endOne(form: FormData) {
    "use server";
    const current = await auth();
    if (!current?.user?.username) redirect("/login");
    let ended = false;
    try { ended = await endSession(current.user, String(form.get("id") || "")); }
    catch (error) { redirect(`/account/devices?error=${encodeURIComponent(error instanceof Error ? error.message : "That sign-in could not be ended")}`); }
    redirect(ended ? "/account/devices?ended=1" : `/account/devices?error=${encodeURIComponent("That sign-in had already ended.")}`);
  }

  async function endEverywhere() {
    "use server";
    const current = await auth();
    if (!current?.user?.username) redirect("/login");
    let count = 0;
    try { count = await endAllSessions(current.user); }
    catch (error) { redirect(`/account/devices?error=${encodeURIComponent(error instanceof Error ? error.message : "Those sign-ins could not be ended")}`); }
    redirect(`/account/devices?ended=${count}`);
  }

  return <div className="you">
    <div className="topbar"><Crossing kind="kakejiku" className="back" href="/account" aria-label="Back to You"><LineIcon name="back" /></Crossing><h1>Signed-in devices</h1></div>
    {query.ended ? <p className="admin-notice success" role="status">{query.ended === "1" ? "That device was signed out." : `${query.ended} sign-ins were ended.`}</p> : null}
    {query.error ? <p className="admin-notice error" role="alert">{query.error}</p> : null}
    <p style={{ color: "var(--on-surface-variant)", padding: "0 0 14px 12px" }}>{unavailable ?? (sessions.length ? "Sign out a device you don't use any more." : "No browser is signed in right now.")}</p>
    {sessions.length ? <div className="seg">{sessions.map((item) => {
      const text = describe(item), phone = /phone|android|ios|mobile/i.test(`${item.device} ${item.os}`);
      return <div className="row swipe" key={item.id}>
        <InkBlot tint={phone ? "#a84d63" : "#5c7150"} seed={item.id}><LineIcon name={phone ? "phone" : "laptop"} /></InkBlot>
        <span className="text"><b>{text.title}</b><small>{text.detail}</small></span>
        <form action={endOne}><input type="hidden" name="id" value={item.id} /><Seal tone="danger" compact className="reveal" type="submit">Sign out</Seal></form>
      </div>;
    })}</div> : null}
    {sessions.length ? <form action={endEverywhere} style={{ marginTop: 28 }}><HoldSeal label="Hold to sign out everywhere" /></form> : null}
    {sessions.length ? <p style={{ textAlign: "center", marginTop: 10, fontSize: 14, color: "var(--on-surface-variant)" }}>Keeps this browser signed in.</p> : null}
  </div>;
}

import { redirect } from "next/navigation";
import { Compartment, Seal, Tray } from "@kimono/ui";
import { auth, keepThisDeviceSignedIn } from "@/auth";
import { endAllSessions, endSession, listSessions, type AccountSession } from "@/lib/account";
import { accountContext } from "../account-frame";

export const metadata = { title: "Signed-in devices · Your account" };

const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function describe(session: AccountSession) {
  const on = [session.device, session.os].filter(Boolean).join(", ");
  return { title: on ? `${session.browser} on ${on}` : session.browser, detail: [session.place, session.ip, session.lastUsed ? `last used ${when.format(new Date(session.lastUsed))}` : null].filter(Boolean).join(" · ") };
}

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
    try { count = await endAllSessions(current.user); await keepThisDeviceSignedIn(); }
    catch (error) { redirect(`/account/devices?error=${encodeURIComponent(error instanceof Error ? error.message : "Those sign-ins could not be ended")}`); }
    redirect(`/account/devices?ended=${count}`);
  }

  return <>
    {query.ended ? <p className="admin-notice success">{query.ended === "1" ? "That device was signed out." : `${query.ended} sign-ins were ended.`}</p> : null}
    {query.error ? <p className="admin-notice error">{query.error}</p> : null}
    <Tray>
      <header className="account-heading"><h2>Signed-in devices</h2></header>
      <Compartment label={unavailable ? "Unavailable" : `${sessions.length} ${sessions.length === 1 ? "sign-in" : "sign-ins"}`}>
        {unavailable
          ? <p className="k-note">{unavailable}</p>
          : sessions.length
            ? <div className="k-rows">{sessions.map((item) => {
                const text = describe(item);
                return <div className="k-row" key={item.id}>
                  <div className="k-row-copy"><h3>{text.title}</h3><p>{text.detail}</p></div>
                  <form action={endOne}><input type="hidden" name="id" value={item.id} /><Seal tone="quiet" compact type="submit">Sign out</Seal></form>
                </div>;
              })}</div>
            : <p className="k-note">No browser is signed in right now.</p>}
      </Compartment>
      {sessions.length ? <Compartment label="Sign out everywhere">
        <form action={endEverywhere} className="k-form-actions"><Seal tone="danger" type="submit">Sign out {sessions.length === 1 ? "1 sign-in" : `all ${sessions.length}`}</Seal></form>
      </Compartment> : null}
    </Tray>
  </>;
}

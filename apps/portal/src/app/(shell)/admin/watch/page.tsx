import { InkPortraitFrame } from "@kimono/ui";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { Crossing } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import { PendingButton } from "@/components/pending-button";
import { Portrait } from "@/components/portrait";
import { listAccounts } from "@/lib/directory";
import { picturePathFor } from "@/lib/pictures";
import { getPlatformSettings } from "@/lib/settings";
import { decideScreens, moreScreens, screenAsks, setScreens, watchDb } from "@/lib/watch";

export const metadata = { title: "Kimono Watch · Admin" };

async function admin() {
  const current = await auth();
  if (!current?.user || (current.user.role !== "owner" && current.user.role !== "admin")) redirect("/");
  return current.user;
}

/** Runs an admin change and comes back, saying what happened or what went wrong. */
async function then(work: () => string) {
  let said = "";
  try { said = work(); } catch (error) {
    redirect(`/admin/watch?error=${encodeURIComponent(error instanceof Error ? error.message : "That didn't work.")}`);
  }
  redirect(`/admin/watch?done=${encodeURIComponent(said)}`);
}

/* Who may watch on more than two screens at once, and who's asking to. */
export default async function AdminWatchPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/");
  const db = watchDb();
  const [settings, query, accounts] = await Promise.all([getPlatformSettings(), searchParams, listAccounts()]);
  const asks = screenAsks(db);
  const more = moreScreens(db);
  const names = new Map(accounts.map((a) => [a.username.toLowerCase(), a.name]));
  const nameOf = (username: string) => names.get(username.toLowerCase()) || username;
  const pictures = new Map(await Promise.all([...new Set([...asks, ...more].map((r) => r.username))].map(async (username) => [username, await picturePathFor(username)] as const)));
  const asked = (at: number) => new Date(at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });

  async function decide(form: FormData) {
    "use server";
    await admin();
    const username = String(form.get("username") || "");
    const approve = form.get("decision") === "approve";
    await then(() => {
      const screens = decideScreens(watchDb(), username, approve);
      return screens ? `${username} can watch on ${screens} screens at once.` : `${username}'s request was declined.`;
    });
  }
  async function reset(form: FormData) {
    "use server";
    await admin();
    const username = String(form.get("username") || "");
    await then(() => { setScreens(watchDb(), username, 2); return `${username} is back to two screens.`; });
  }

  const face = (username: string) => <InkPortraitFrame seed={username} weight={5}><Portrait name={nameOf(username)} username={username} picture={pictures.get(username)} size={36} /></InkPortraitFrame>;

  return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
    <div className="page phone-app-page">
      <div className="topbar">
        <Crossing kind="kakejiku" className="back" href="/admin" aria-label="Back to Admin"><LineIcon name="back" /></Crossing>
        <span><h1>Kimono Watch</h1><p className="sub">Everyone watches on two screens at once unless you give them more.</p></span>
      </div>
      {query.error ? <p role="alert" className="app-notice is-error">{query.error}</p> : null}
      {query.done && !query.error ? <p role="status" className="app-notice">{query.done}</p> : null}

      <div className="testers-head"><div className="label">Asking for more screens</div></div>
      {asks.length ? <div className="seg">
        {asks.map((ask) => <div className="row" key={ask.username}>
          {face(ask.username)}
          <span className="text"><b>{nameOf(ask.username)}</b><small>@{ask.username} · {ask.have} → {ask.want} screens · asked {asked(ask.at)}</small></span>
          <form action={decide} className="request-decide">
            <input type="hidden" name="username" value={ask.username} />
            <input type="hidden" name="decision" value="decline" />
            <PendingButton className="txt" pending="Declining…" aria-label={`Decline ${nameOf(ask.username)}`}>Decline</PendingButton>
          </form>
          <form action={decide} className="request-decide">
            <input type="hidden" name="username" value={ask.username} />
            <input type="hidden" name="decision" value="approve" />
            <PendingButton seal compact pending="Approving…" aria-label={`Approve ${nameOf(ask.username)}`}>Approve</PendingButton>
          </form>
        </div>)}
      </div> : <p className="sub">Nobody&rsquo;s asking.</p>}

      {more.length ? <>
        <div className="testers-head"><div className="label">More than two</div></div>
        <div className="seg">
          {more.map((row) => <div className="row" key={row.username}>
            {face(row.username)}
            <span className="text"><b>{nameOf(row.username)}</b><small>@{row.username} · {row.screens} screens</small></span>
            <form action={reset} className="request-decide">
              <input type="hidden" name="username" value={row.username} />
              <PendingButton className="txt" pending="Resetting…" aria-label={`Back to two for ${nameOf(row.username)}`}>Back to two</PendingButton>
            </form>
          </div>)}
        </div>
      </> : null}
    </div>
  </AppShell>;
}

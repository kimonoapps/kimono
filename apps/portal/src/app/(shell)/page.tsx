import { AppShell, railApps } from "@/components/app-shell";
import { HomeApps } from "@/components/home-apps";
import { Crossing } from "@/components/crossing";
import { getPlatformSettings } from "@/lib/settings";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { KimonoAppOffer } from "@/components/kimono-app-offer";
import { appOffer } from "@/lib/app-offer";
import { homeLines } from "@/lib/home-lines";
import { homeGlance } from "@/lib/home-glance";
import { categorize } from "@/lib/app-categories";
import { myApps } from "@/lib/my-apps";
import { AppBloom, InkBlot } from "@kimono/ui";
import type { RailApp } from "@/components/rail";
import type { ReactNode } from "react";

/*
 * 家 Home, in three parts that don't run into each other: Your apps (the same
 * list as the rail and the phone's flower), Now (a few lines each from Kimono
 * AI, Drive and your devices, only those with something to say), and More
 * apps, every other app by what it's for.
 */
export default async function HomePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;
  const [settings, apps, offer, mine] = await Promise.all([getPlatformSettings(), railApps(user.username), appOffer(), myApps(user.username)]);
  const ids = apps.map((app) => app.id);
  const [glance, lines] = [await homeGlance(user, ids), homeLines(user.username, ids)];
  const tiles = apps.map((app) => ({ ...app, line: lines[app.id] }));
  const groups = categorize(tiles).map((group) => ({ id: group.id, label: group.label, apps: group.apps.map((app) => app.id) }));
  const displayName = user.name?.split(" ")[0] || user.username || "home";
  const byId = new Map(apps.map((app) => [app.id, app]));
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <AppShell user={user} brandColors={settings.brand.colors} active="home">
      <div className="page home-page">
        <header className="home-greeting">
          <p className="hero-kicker">{today}</p>
          <h1>Welcome home, <strong>{displayName}.</strong></h1>
        </header>
        <HomeApps apps={tiles} mine={mine} groups={groups}>
          {glance.chats || glance.files || glance.devices?.length ? <section className="home-section home-now">
          <h2 className="home-section-title">Now</h2>
          <div className="home-glances">
            {glance.chats ? <Glance app={byId.get("kimono-code")} title="Kimono AI" href="/code" note={glance.chatTotals?.working ? `${glance.chatTotals.working} working` : undefined}>
              {glance.chats.length ? glance.chats.slice(0, 3).map((chat) => <Line key={chat.id} href={`/code#w=${chat.id}`} mark={<span className={chat.working ? "home-dot is-live" : "home-dot"} />} title={chat.title} detail={[chat.project, chat.working ? "working" : ago(chat.at)].filter(Boolean).join(" · ")} />)
                : <Line href="/code" mark={<InkBlot seed="new-chat" tint="#a84d63"><span className="home-plus">+</span></InkBlot>} title="Start a chat" />}
            </Glance> : null}
            {glance.files ? <Glance app={byId.get("kimono-drive")} title="Recent in Drive" href="/drive?view=recent" note={glance.fileTotals?.today ? `${glance.fileTotals.today} today` : undefined}>
              {glance.files.length ? glance.files.slice(0, 3).map((file) => <Line key={file.id} href={`/drive?space=${encodeURIComponent(file.spaceId)}&file=${encodeURIComponent(file.id)}`} mark={<InkBlot seed={file.id} tint="#8a7c77"><span className="home-ext">{extension(file.name)}</span></InkBlot>} title={file.name} detail={[file.space, ago(file.at)].filter(Boolean).join(" · ")} />)
                : <Line href="/drive" mark={<InkBlot seed="drive-empty" tint="#a84d63"><span className="home-plus">+</span></InkBlot>} title="Add your first file" />}
            </Glance> : null}
            {glance.devices?.length ? <Glance app={byId.get("kimono-vpn")} title="Your devices" href="/vpn">
              {glance.devices.slice(0, 3).map((device) => <Line key={device.id} href="/vpn" mark={<span className={device.online ? "home-dot is-live" : "home-dot"} />} title={device.name} detail={device.online ? "Connected" : device.seen} />)}
            </Glance> : null}
          </div>
          </section> : null}
        </HomeApps>
        <KimonoAppOffer android={Boolean(offer.android)} ios={offer.ios} />
      </div>
    </AppShell>
  );
}

function Glance({ app, title, href, note, children }: { app?: RailApp; title: string; href: string; note?: string; children: ReactNode }) {
  return <section className="home-glance">
    <Crossing kind="kakejiku" href={href} className="home-glance-head">
      {app ? <AppBloom identity={{ id: app.id, name: app.name, accent: app.accent, glyph: app.glyph }} glyphHref={app.iconUrl || undefined} size="mark" /> : null}
      <h2>{title}</h2>
      {note ? <span className="home-glance-note">{note}</span> : null}
    </Crossing>
    <div className="home-glance-lines">{children}</div>
  </section>;
}

function Line({ href, mark, title, detail }: { href: string; mark: ReactNode; title: string; detail?: string }) {
  return <Crossing kind="kakejiku" href={href} className="home-line">
    <span className="home-line-mark">{mark}</span>
    <span className="home-line-text"><b>{title}</b>{detail ? <small>{detail}</small> : null}</span>
  </Crossing>;
}

const extension = (name: string) => (/\.([a-z0-9]{1,4})$/i.exec(name)?.[1] ?? "").toUpperCase() || "·";

function ago(at: number) {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  const days = Math.round(minutes / (60 * 24));
  return days < 30 ? `${days}d ago` : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(at);
}

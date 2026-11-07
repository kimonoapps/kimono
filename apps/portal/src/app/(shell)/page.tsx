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
 * 家 Home: a glance at the house, then every app. My apps first (the same
 * list as the rail and the phone's flower), what's happening in Kimono AI,
 * Drive and your devices, then the rest of the apps by what they're for.
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

  const stats: { value: string; label: string; href: string }[] = [];
  if (glance.chatTotals) {
    stats.push(glance.chatTotals.working
      ? { value: String(glance.chatTotals.working), label: glance.chatTotals.working === 1 ? "chat working" : "chats working", href: "/code" }
      : { value: String(glance.chatTotals.all), label: glance.chatTotals.all === 1 ? "chat" : "chats", href: "/code" });
    if (glance.chatTotals.apps) stats.push({ value: String(glance.chatTotals.apps), label: glance.chatTotals.apps === 1 ? "app running" : "apps running", href: "/code" });
  }
  if (glance.fileTotals) {
    stats.push({ value: String(glance.fileTotals.week), label: "files this week", href: "/drive?view=recent" });
    stats.push({ value: String(glance.fileTotals.spaces), label: glance.fileTotals.spaces === 1 ? "space" : "spaces", href: "/drive" });
  }
  if (glance.devices?.length) stats.push({ value: `${glance.devices.filter((d) => d.online).length}/${glance.devices.length}`, label: "devices online", href: "/vpn" });

  return (
    <AppShell user={user} brandColors={settings.brand.colors} active="home">
      <div className="page home-page">
        <header className="home-greeting">
          <p className="hero-kicker">{today}</p>
          <h1>Welcome home, <strong>{displayName}.</strong></h1>
        </header>
        <HomeApps apps={tiles} mine={mine} groups={groups}>
          {stats.length ? <div className="home-stats">
            {stats.map((stat) => <Crossing kind="kakejiku" key={stat.label} href={stat.href} className="home-stat"><b>{stat.value}</b><span>{stat.label}</span></Crossing>)}
          </div> : null}
          <div className="home-glances">
            {glance.chats ? <Glance app={byId.get("kimono-code")} title="Kimono AI" href="/code" note={glance.chatTotals?.working ? `${glance.chatTotals.working} working` : undefined}>
              {glance.chats.length ? glance.chats.map((chat) => <Line key={chat.id} href={`/code#w=${chat.id}`} mark={<span className={chat.working ? "home-dot is-live" : "home-dot"} />} title={chat.title} detail={[chat.project, chat.working ? "working" : ago(chat.at)].filter(Boolean).join(" · ")} />)
                : <Line href="/code" mark={<InkBlot seed="new-chat" tint="#a84d63"><span className="home-plus">+</span></InkBlot>} title="Start a chat" />}
            </Glance> : null}
            {glance.files ? <Glance app={byId.get("kimono-drive")} title="Recent in Drive" href="/drive?view=recent" note={glance.fileTotals?.today ? `${glance.fileTotals.today} today` : undefined}>
              {glance.files.length ? glance.files.map((file) => <Line key={file.id} href={`/drive?space=${encodeURIComponent(file.spaceId)}&file=${encodeURIComponent(file.id)}`} mark={<InkBlot seed={file.id} tint="#8a7c77"><span className="home-ext">{extension(file.name)}</span></InkBlot>} title={file.name} detail={[file.space, ago(file.at)].filter(Boolean).join(" · ")} />)
                : <Line href="/drive" mark={<InkBlot seed="drive-empty" tint="#a84d63"><span className="home-plus">+</span></InkBlot>} title="Add your first file" />}
            </Glance> : null}
            {glance.devices?.length ? <Glance app={byId.get("kimono-vpn")} title="Your devices" href="/vpn">
              {glance.devices.map((device) => <Line key={device.id} href="/vpn" mark={<span className={device.online ? "home-dot is-live" : "home-dot"} />} title={device.name} detail={device.online ? "Connected" : device.seen} />)}
            </Glance> : null}
          </div>
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

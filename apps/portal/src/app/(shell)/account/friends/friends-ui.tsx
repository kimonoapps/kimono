"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Glyph, InkBlot, InkPortraitFrame, Seal, type GlyphName } from "@kimono/ui";
import { Crossing, CrossingSeal } from "@/components/crossing";
import { InkSheet } from "@/components/ink-sheet";
import { JointSwitch } from "@/components/joint-switch";
import { LineIcon, type LineIconName } from "@/components/line-icon";
import { AppearanceFlip } from "@/components/appearance";
import { Portrait } from "@/components/portrait";
import { PeopleSearch } from "@/components/people-search";
import { SilkscreenBadge } from "./silkscreen";
import { underName, WidgetBoard, type LinkShow, type BooksExtras, type MusicExtras, type Widget } from "./widgets";
import { LinkMark } from "./link-marks";
import { TitleCard, TitleRow } from "@/components/title-art";
import "./recommend-sheet.css";
import { LinksEditor } from "./links-editor";
import { BannerSheet } from "./banner-sheet";
import { PictureSheet } from "./picture-sheet";

/*
 * 友 Friends, profiles and recommendations on the web (lib/friends has the
 * rules). The phone app has the same pages; Watch's title page sends
 * recommendations through RecommendSheet.
 */


/* Each app's colour and mark on a profile: moss for Books, lapis for Music, rose for Watch. */
/* Each app's own colour and mark, as the rail draws them: moss for Books, gold for Music, rose for Watch. */
const appTint = (app: string) => (app === "books" ? "#5c7150" : app === "music" ? "#946c25" : "#a84d63");
const appGlyph = (app: string): GlyphName => (app === "books" ? "book" : app === "music" ? "music" : "play");
function AppMark({ app }: { app: string }) {
  return <svg className="line-icon fr-app-glyph" viewBox="0 0 100 100" aria-hidden="true"><Glyph name={appGlyph(app)} color="currentColor" scale={1.25} /></svg>;
}

export type Person = { username: string; name: string; picture: string | null };
export type ProfileColor = "suo" | "plum" | "moss" | "ai" | "kuchiba" | "sakura" | "sumi";
export type Item = { app: string; itemId: string; title: string; subtitle: string | null; cover: string | null; href?: string | null; progress?: number | null; rating?: "love" | "up" | "down" | null };
export type Recommendation = Item & { id: string; from: Person; to: Person | null; note: string | null; at: number; seen: boolean; appName: string };
export type Section = { app: string; appName: string; kind: string; title: string; items: Item[] };
/** Private until you're friends: then only `open: false` and who they are comes back (lib/friends/model.ts profileFor). */
export type Profile = Person & { you: boolean; visitor?: boolean; link: "friends" | "asked" | "asking" | null } & (
  | { open: false }
  | { open: true; bio: string; pronouns: string; color: ProfileColor | null; banner?: string | null; links: { title: string; url: string; icon?: string; show?: LinkShow }[]; widgets?: Widget[] | null; music?: MusicExtras; books?: BooksExtras; sections: Section[]; recommendations: Recommendation[]; friends: number; friendList?: Person[] | null; hidden?: string[]; kept?: string[]; privacy?: Privacy; off?: Off[]; kimonoRead?: { since: string } | null }
);
/** What you let friends see (your own profile only): lib/friends/model.ts privacyOf. */
export type Privacy = { invisible: boolean; visibility: "friends" | "public" | "private"; friends: boolean; friendsEveryone?: boolean; apps: { app: string; name: string; shown: boolean; everyone?: boolean; rows: { kind: string; title: string; shown: boolean; everyone?: boolean }[] }[] };
type Audience = "me" | "friends" | "everyone";
/** A title you took off a row of your profile, to put back (lib/friends/model.ts offProfileList). */
export type Off = Item & { appName: string; kind: string; rowTitle: string; at: number };
type FriendsList = { friends: (Person & { bio: string })[]; asked: Person[]; asking: Person[]; unseen: number };
type Inbox = { received: Recommendation[]; sent: Recommendation[]; profile: Recommendation[] };

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : "That didn't work.");
  return json as T;
}
const message = (error: unknown) => (error instanceof Error ? error.message : "That didn't work.");
const first = (p: Person) => (p.name || p.username).split(" ")[0];
/** Where a title opens in its app. */
const hrefOf = (i: Item) => i.href ?? (i.app === "watch" ? `/watch?t=${encodeURIComponent(i.itemId)}` : null);

function Face({ person, size = 44 }: { person: Person; size?: number }) {
  return <InkPortraitFrame seed={person.username} weight={size > 60 ? 3 : 5}><Portrait name={person.name} username={person.username} picture={person.picture} size={Math.round(size * .84)} /></InkPortraitFrame>;
}

/** A title on a shelf here: the one title card every app's titles share (components/title-art). */
function Tile({ item, children }: { item: Item; children?: React.ReactNode }) {
  return <TitleCard item={item} href={hrefOf(item)} rating={item.rating ?? null} progress={item.progress ?? null}>{children}</TitleCard>;
}

/* ───── Recommending ───── */

/** Recommend a title: to friends (picked by their portraits), or onto your profile, with a note if you like. */
export function RecommendSheet({ item, onClose, onSent }: { item: Item; onClose: () => void; onSent?: (text: string) => void }) {
  const [friends, setFriends] = useState<Person[] | null>(null);
  const [to, setTo] = useState<string[]>([]);
  const [profile, setProfile] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { call<FriendsList>("/api/v1/friends").then((l) => setFriends(l.friends), (e) => setProblem(message(e))); }, []);
  const toggle = (u: string) => setTo((was) => (was.includes(u) ? was.filter((x) => x !== u) : [...was, u]));
  const send = async () => {
    setBusy(true); setProblem(null);
    try {
      const snapshot = { app: item.app, itemId: item.itemId, title: item.title, subtitle: item.subtitle, cover: item.cover, note };
      if (to.length) await call("/api/v1/recommendations", "POST", { ...snapshot, to });
      if (profile) await call("/api/v1/recommendations", "POST", { ...snapshot, to: [] });
      const names = friends?.filter((f) => to.includes(f.username)).map(first) ?? [];
      onSent?.(names.length ? `Sent to ${names.length > 2 ? `${names.length} friends` : names.join(" and ")}` : "On your profile");
      onClose();
    } catch (error) { setProblem(message(error)); }
    setBusy(false);
  };
  return <InkSheet title="Recommend" icon="send" onClose={onClose} actions={<>
    <Seal tone="quiet" compact onClick={onClose}>Cancel</Seal>
    <Seal compact busy={busy} disabled={!to.length && !profile} onClick={() => void send()}>Send</Seal>
  </>}>
    <TitleRow item={item} />
    {friends === null ? <div className="fr-pick" aria-busy="true" /> : friends.length
      ? <div className="fr-pick" role="group" aria-label="Friends">{friends.map((f) =>
        <button key={f.username} type="button" className="fr-pick-one" aria-label={f.name || f.username} aria-pressed={to.includes(f.username)} onClick={() => toggle(f.username)}>
          <Face person={f} size={56} />{to.includes(f.username) ? <span className="fr-pick-mark"><LineIcon name="check" /></span> : null}
          <span>{first(f)}</span>
        </button>)}</div>
      : <p className="fr-quiet">No friends yet. <Crossing kind="kakejiku" href="/account/friends">Find friends</Crossing></p>}
    <label className="fr-toggle"><span>On my profile</span><JointSwitch name="profile" label="On my profile" defaultChecked={false} onChange={setProfile} /></label>
    <label className="field fr-note"><small>Note</small><textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
    {problem ? <p className="fr-problem" role="alert">{problem}</p> : null}
  </InkSheet>;
}

/* ───── Friends ───── */

export function FriendsView() {
  const [list, setList] = useState<FriendsList | null>(null);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(() => {
    call<FriendsList>("/api/v1/friends").then(setList, (e) => setProblem(message(e)));
    call<Inbox>("/api/v1/recommendations").then(setInbox, () => {});
  }, []);
  useEffect(load, [load]);
  const change = (type: "ask" | "yes" | "no" | "remove", username: string) =>
    call("/api/v1/friends", "POST", { type, username }).then(load, (e) => setProblem(message(e)));
  const putAway = (r: Recommendation) => {
    setInbox((was) => was && { ...was, received: was.received.filter((x) => x.id !== r.id) });
    void call(`/api/v1/recommendations/${r.id}`, "DELETE").catch(() => load());
  };

  return <div className="you fr">
    <div className="fr-top"><Crossing kind="kakejiku" className="fr-back" href="/account" aria-label="Back"><LineIcon name="back" /></Crossing><h1>Friends</h1></div>
    {problem ? <p className="fr-problem" role="alert">{problem}</p> : null}
    {list?.asked.length ? <>
      <div className="label">Asked to be friends</div>
      <div className="seg">{list.asked.map((p) => <div key={p.username} className="row">
        <Face person={p} /><span className="text"><b>{p.name}</b><small>@{p.username}</small></span>
        <Seal tone="quiet" compact onClick={() => void change("no", p.username)}>Not now</Seal>
        <Seal compact onClick={() => void change("yes", p.username)}>Accept</Seal>
      </div>)}</div>
    </> : null}

    {inbox?.received.length ? <>
      <div className="label">For you</div>
      <div className="fr-shelf k-inkbar">{inbox.received.map((r) => <Tile key={r.id} item={r}>
        <span className="fr-from"><Portrait name={r.from.name} username={r.from.username} picture={r.from.picture} size={20} />{first(r.from)}{r.seen ? null : <i className="fr-new" aria-label="New" />}</span>
        {r.note ? <q className="fr-tile-note">{r.note}</q> : null}
        <button type="button" className="fr-away" aria-label={`Put away ${r.title}`} onClick={() => putAway(r)}><LineIcon name="check" /></button>
      </Tile>)}</div>
    </> : null}

    <div className="label">Your friends</div>
    {!list ? <div className="seg"><div className="row fr-sk" /><div className="row fr-sk" /></div>
      : list.friends.length ? <div className="seg">{list.friends.map((f) =>
        <Crossing key={f.username} kind="kakejiku" className="row" href={`/account/people/${encodeURIComponent(f.username)}`}>
          <Face person={f} /><span className="text"><b>{f.name}</b><small>{f.bio || `@${f.username}`}</small></span><span className="go" />
        </Crossing>)}</div>
        : <p className="fr-quiet fr-pad">No friends yet.</p>}

    <div className="label">Add friends</div>
    <div className="seg">
      <PeopleSearch className="fr-find" placeholder="Name" action="Ask"
        find={(q) => call<{ people: Person[] }>(`/api/v1/friends?q=${encodeURIComponent(q)}`).then((r) => r.people)}
        onPick={(p) => change("ask", p.username)} />
      {list?.asking.map((p) => <div key={p.username} className="row">
        <Face person={p} /><span className="text"><b>{p.name}</b><small>Asked</small></span>
        <Seal tone="quiet" compact onClick={() => void change("remove", p.username)}>Take back</Seal>
      </div>)}
    </div>
  </div>;
}

/* ───── A profile ───── */

/**
 * A profile as friends see it. Your own is also where you change it, in place: the portrait's camera,
 * the name and the bio are edited where they stand. `home` makes it the You page: no way back,
 * and a gear to Settings (email, password, devices, appearance, signing out).
 */
/* ── A profile ─────────────────────────────────────────────────────────── */

/** The colours a profile can wear (lib/friends/model.ts profileColors), each a pigment of the house. */
export const profileColors: { id: ProfileColor; name: string; hex: string }[] = [
  { id: "suo", name: "Suō", hex: "#a84d63" }, { id: "plum", name: "Plum", hex: "#4e2b37" }, { id: "moss", name: "Moss", hex: "#5c7150" },
  { id: "ai", name: "Indigo", hex: "#2e5e8a" }, { id: "kuchiba", name: "Kuchiba", hex: "#b8732c" }, { id: "sakura", name: "Sakura", hex: "#d77b8c" }, { id: "sumi", name: "Sumi", hex: "#3a3634" },
];
const colorOf = (id: ProfileColor | null | undefined) => profileColors.find((c) => c.id === id) ?? profileColors[0];

/* What a link is, from where it goes: a mark people recognise without any brand drawn. */
function linkMark(url: string): LineIconName {
  if (url.startsWith("mailto:")) return "send";
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  if (/instagram|flickr|vsco|500px|unsplash/.test(host)) return "camera";
  if (/youtube|youtu\.be|twitch|tiktok|vimeo|letterboxd|imdb/.test(host)) return "film";
  if (/spotify|soundcloud|bandcamp|music\.apple|last\.fm|deezer|tidal/.test(host)) return "music";
  if (/github|gitlab|codeberg|bitbucket|stackoverflow/.test(host)) return "laptop";
  if (/goodreads|storygraph|substack|medium/.test(host)) return "book";
  if (/twitter|x\.com|bsky|mastodon|threads|facebook|linkedin|discord/.test(host)) return "people";
  return "link";
}

/* What each row of a profile says, in plain words, for Who sees what. */
const rowWords: Record<string, string> = {
  "watch:watching": "What you're watching, and how far",
  "watch:watched": "What you've watched",
  "watch:listed": "Your watchlist",
  "books:reading": "Books you're reading, and how far",
  "books:want": "Books you want to read",
  "books:read": "Books you've read, and how you rated them",
  "music:playing": "Songs you've been listening to, and what's on now",
  "music:loved": "Songs you love",
  "music:playlists": "Your public playlists",
  "music:stats": "Your top artists and how much you listen",
  "watch:rated": "How you rated what you watched",
  "books:reviews": "Your reviews",
};

export function ProfileView({ username, home = false, standalone = false }: { username: string; home?: boolean; standalone?: boolean }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);
  const [removing, setRemoving] = useState(false);
  /* What the × is about to take off, waiting on a yes. */
  const [unrecommending, setUnrecommending] = useState<Recommendation | null>(null);
  const [recommending, setRecommending] = useState<Item | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(() => typeof window !== "undefined" && new URLSearchParams(location.search).get("sheet") === "privacy");
  const [editing, setEditing] = useState(false);
  const [editingLinks, setEditingLinks] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [pictureOpen, setPictureOpen] = useState(false);
  /* Your own profile as a friend sees it. */
  const [asFriend, setAsFriend] = useState(false);
  /* Arranging the home screen's widgets (the board saves when it's done). */
  const [arranging, setArranging] = useState(false);
  /* What you took off your profile, open to put back. */
  const [offOpen, setOffOpen] = useState(false);
  const load = useCallback(() => call<Profile>(`/api/v1/profiles/${encodeURIComponent(username)}`).then(setProfile, (e) => setProblem(message(e))), [username]);
  useEffect(() => { void load(); }, [load]);
  /* Live: what they're playing and watching changes under you, so the profile reads itself again while it's on screen (and the moment you come back to it). */
  useEffect(() => {
    const url = `/api/v1/profiles/${encodeURIComponent(username)}`;
    const tick = () => { if (document.visibilityState === "visible") call<Profile>(url).then(setProfile, () => {}); };
    const every = setInterval(tick, 12_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(every); document.removeEventListener("visibilitychange", tick); };
  }, [username]);
  const own = profile?.you ?? false;
  useEffect(() => { if (own) call<FriendsList>("/api/v1/friends").then((l) => setAsked(l.asked.length), () => {}); }, [own]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);
  const change = (type: "ask" | "yes" | "no" | "remove") => call("/api/v1/friends", "POST", { type, username }).then(load, (e) => setProblem(message(e)));
  const takeBack = (r: Recommendation) => call(`/api/v1/recommendations/${r.id}`, "DELETE").then(load, (e) => setProblem(message(e)));

  if (!profile) return <div className="you fr">{problem ? <p className="fr-problem" role="alert">{problem}</p> : <div className="stack you-head"><span className="fr-sk-face" /></div>}</div>;
  const p = profile;
  const action = p.visitor ? null : p.link === "friends" ? <Seal tone="quiet" compact onClick={() => setRemoving(true)}><LineIcon name="check" />Friends</Seal>
      : p.link === "asked" ? <><Seal tone="quiet" compact onClick={() => void change("no")}>Not now</Seal><Seal compact onClick={() => void change("yes")}>Accept</Seal></>
        : p.link === "asking" ? <Seal tone="quiet" compact onClick={() => void change("remove")}>Asked</Seal>
          : <Seal compact onClick={() => void change("ask")}>Ask to be friends</Seal>;

  const privacy = p.open ? p.privacy : undefined;
  const invisible = privacy?.invisible ?? false;
  /* Kept from friends: the whole app, or one row of it. */
  const appKept = (app: string) => p.open && (p.hidden?.includes(app) ?? false);
  const rowKept = (app: string, kind: string) => appKept(app) || (p.open && (p.kept?.includes(`${app}:${kind}`) ?? false));
  const friendsKept = p.open && p.you && (invisible || privacy?.friends === false);
  /* Seen as a friend: only what friends see is drawn. */
  const preview = p.you && asFriend;
  const sections = p.open ? p.sections.filter((s) => !preview || (!invisible && !rowKept(s.app, s.kind))) : [];
  const off = p.open ? p.off ?? [] : [];
  const friendList = p.open && !(preview && friendsKept) ? p.friendList ?? [] : [];
  const friendsOffBoard = p.open && (p.widgets ?? []).some((w) => w.kind === "friends" && w.config?.off);
  const color = colorOf(p.open ? p.color : null);
  /* The widgets are the profile: what each app shows, and your friends, live in them. */
  /* What you keep to yourself, row by row ("watch:watching"): a whole app kept keeps all its rows. */
  /* Warnings only where a widget is narrower than the profile: kept to you on a profile others see, or friends-only on a public one. */
  const seen = privacy && !privacy.invisible && privacy.visibility !== "private";
  const keptRows = seen ? privacy.apps.flatMap((a) => a.rows.filter((r) => !a.shown || !r.shown).map((r) => `${a.app}:${r.kind}`)) : [];
  const friendsOnlyRows = seen && privacy.visibility === "public" ? privacy.apps.flatMap((a) => a.rows.filter((r) => a.shown && r.shown && (a.everyone === false || r.everyone === false)).map((r) => `${a.app}:${r.kind}`)) : [];
  const publicProfile = privacy?.visibility === "public";
  /* Shares one row as far as asked: its app first if the whole app was kept back. */
  const shareRow = async (row: string, to: "friends" | "everyone") => {
    const [app] = row.split(":");
    const a = privacy?.apps.find((x) => x.app === app);
    try {
      if (a && (!a.shown || (to === "everyone" && a.everyone === false))) await call("/api/v1/profile", "PATCH", { audience: app, to });
      await call("/api/v1/profile", "PATCH", { audience: row, to });
      setToast(to === "everyone" ? "Everyone sees it" : "Friends see it"); await load();
    } catch (e) { setProblem(message(e)); }
  };
  const board = p.open ? { person: p, sections, links: p.links, friends: friendList, music: p.music ?? null, books: p.books ?? null, color: color.hex, own: p.you && !preview ? { asking: asked, kept: Boolean(friendsKept), keptRows, friendsOnlyRows, publicProfile, onShare: (row: string, to: "friends" | "everyone") => void shareRow(row, to) } : undefined } : null;
  /* Invisible, seen as a friend: what they get is your name and portrait. */
  const closedToFriends = preview && invisible;

  return <div className={`you fr fr-profile fr-profile-v2${p.open && !closedToFriends ? "" : " is-closed"}`} style={{ "--fr-color": color.hex } as React.CSSProperties}>
    <header className="fr-hero">
      <div className={`fr-band${p.open && p.banner ? " has-photo" : ""}`} aria-hidden="true" style={p.open && p.banner ? { backgroundImage: `url(${p.banner})` } : undefined} />
      {p.you && !preview && p.open ? <button type="button" className="fr-band-edit" onClick={() => setBannerOpen(true)}><LineIcon name="camera" />{p.banner ? "Change banner" : "Add a banner"}</button> : null}
      {home && !p.you ? null : <div className="fr-top">
        {home ? <span /> : <Crossing kind="kakejiku" className="fr-back" href={p.you ? "/account" : "/account/friends"} aria-label="Back"><LineIcon name="back" /></Crossing>}
        {standalone && !p.you ? <AppearanceFlip className="fr-back fr-look" /> : null}
        {p.you ? <span className="fr-top-end">
          {standalone ? <AppearanceFlip className="fr-back fr-look" /> : null}
          <label className="fr-asfriend"><span>View as a friend</span><JointSwitch name="as-friend" label="View your profile as a friend sees it" defaultChecked={false} onChange={setAsFriend} /></label>
          {!preview ? <Seal tone="quiet" compact className="fr-wsw-open" onClick={() => setPrivacyOpen(true)}><LineIcon name="eye" />Who sees what</Seal> : null}
          <CrossingSeal tone="quiet" compact className="fr-settings" href="/account/settings"><LineIcon name="cog" />Settings</CrossingSeal>
        </span> : null}
      </div>}
      <div className="fr-hero-body">
        {p.you && !preview ? <button type="button" className="you-picture fr-hero-face" onClick={() => setPictureOpen(true)} aria-label="Change your picture" data-named="">
          <Face person={p} size={148} /><span className="you-camera"><LineIcon name="camera" /></span></button>
          : <span className="you-picture fr-hero-face" data-named=""><Face person={p} size={148} /></span>}
        <div className="fr-hero-words">
          <h1 className="fr-name">{p.you && !preview && p.open ? <button type="button" className="fr-name-edit" onClick={() => setEditing(true)} title="Edit name, pronouns and colour">{p.name}<LineIcon name="brush" /></button> : p.name}{p.open && p.pronouns && !closedToFriends ? <small className="fr-pronouns">{p.pronouns}</small> : null}</h1>
          <p className="fr-handle">@{p.username}{p.open && !closedToFriends ? ` · ${p.friends === 1 ? "1 friend" : `${p.friends} friends`}` : ""}</p>
          {/* Friends taken off the board still show: a few faces under the name. */}
          {friendsOffBoard && friendList.length && !closedToFriends ? <span className="fr-hero-friends">
            {friendList.slice(0, 6).map((f, i) => <Crossing key={f.username} kind="kakejiku" href={`/account/people/${encodeURIComponent(f.username)}`} title={f.name || f.username} style={{ "--i": i } as React.CSSProperties}>
              <Portrait name={f.name} username={f.username} picture={f.picture} size={30} /></Crossing>)}
            {friendList.length > 6 ? (p.you ? <Crossing kind="kakejiku" href="/account/friends" className="fr-hero-friends-more">+{friendList.length - 6}</Crossing> : <b className="fr-hero-friends-more">+{friendList.length - 6}</b>) : null}
          </span> : null}
          {p.open && !closedToFriends && (p.links.some(underName) || (p.you && !preview)) ? <nav className="fr-socials" aria-label="Elsewhere">
            {/* eslint-disable-next-line no-restricted-syntax -- someone's own links leave Kimono, in a new tab */}
            {p.links.filter(underName).map((l, i) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer nofollow" title={l.title} aria-label={l.title} style={{ "--i": i } as React.CSSProperties}>
              <LinkMark url={l.url} icon={l.icon} fallback={linkMark(l.url)} />
            </a>)}
            {p.you && !preview ? <button type="button" className="fr-socials-add" onClick={() => setEditingLinks(true)} title="Add a link" aria-label="Add a link" style={{ "--i": p.links.filter(underName).length } as React.CSSProperties}><LineIcon name="plus" /></button> : null}
          </nav> : null}
        </div>
        {p.you && !(p.open && p.kimonoRead && !closedToFriends) ? null : <div className="fr-hero-end">
          {p.open && p.kimonoRead && !closedToFriends ? <SilkscreenBadge since={p.kimonoRead.since} you={p.you} name={p.name || p.username} /> : null}
          {p.you ? null : <div className="fr-actions">{action}</div>}
        </div>}
      </div>
      <div className="fr-hero-more">
        {p.you && !preview && p.open ? <BioInPlace bio={p.bio} onSaved={(bio) => { setProfile({ ...p, bio }); setToast("Saved"); }} onProblem={setProblem} />
          : p.open && p.bio && !closedToFriends ? <p className="fr-bio">{p.bio}</p> : null}
        {p.you && invisible && !preview ? <button type="button" className="fr-only fr-only-big" onClick={() => setPrivacyOpen(true)}><LineIcon name="lock" />You&rsquo;re invisible: friends only see your name and picture</button> : null}
        {closedToFriends ? <p className="fr-quiet">You&rsquo;re invisible, so this is all friends see.</p> : null}
      </div>
    </header>
    {p.open && !closedToFriends ? <WidgetBoard
      data={board!}
      widgets={p.widgets ?? null} editable={p.you && !preview} arranging={arranging && p.you && !preview} onArranging={setArranging} onEditLinks={p.you && !preview ? () => setEditingLinks(true) : undefined}
      onSave={(widgets) => call<{ widgets?: Widget[] }>("/api/v1/profile", "PATCH", { widgets }).then(() => { setProfile({ ...p, widgets }); setToast("Saved"); }, (e) => setProblem(message(e)))} /> : null}
    {problem ? <p className="fr-problem" role="alert">{problem}</p> : null}

    {p.open && !closedToFriends && p.recommendations.length ? <div className="fr-body">
      {p.recommendations.length ? <section className="fr-group fr-card">
        <div className="fr-app-head">
          <InkBlot tint="#a84d63" seed="recommends"><LineIcon name="send" /></InkBlot>
          <h2>Recommends</h2>
        </div>
        <div className="fr-shelf k-inkbar">{p.recommendations.map((r) => <Tile key={r.id} item={r}>
          {r.note ? <q className="fr-tile-note">{r.note}</q> : null}
          {p.you && !preview ? <button type="button" className="fr-away" aria-label={`Take ${r.title} off your profile`} onClick={() => setUnrecommending(r)}><LineIcon name="close" /></button>
            : p.you || p.visitor ? null : <button type="button" className="fr-away" aria-label={`Recommend ${r.title}`} onClick={() => setRecommending(r)}><LineIcon name="send" /></button>}
        </Tile>)}</div>
      </section> : null}

    </div> : null}

    {privacyOpen && privacy ? <WhoSeesWhat privacy={privacy} offCount={off.length} onClose={() => setPrivacyOpen(false)} onOff={() => { setPrivacyOpen(false); setOffOpen(true); }}
      onChanged={(r) => { if (p.open) setProfile({ ...p, privacy: r.privacy, hidden: r.hidden, kept: keptFrom(r.privacy) }); }} /> : null}
    {editing && p.open ? <EditProfileSheet profile={p} onClose={() => setEditing(false)} onSaved={(next) => { setProfile(next); setToast("Saved"); }} onLinks={() => setEditingLinks(true)} onBanner={() => setBannerOpen(true)} /> : null}
    {bannerOpen && p.open ? <BannerSheet banner={p.banner ?? null} color={color.hex} onClose={() => setBannerOpen(false)} onSaved={(banner) => { setProfile((was) => was && was.open ? { ...was, banner } : was); setToast(banner ? "Banner up" : "Banner off"); }} /> : null}
    {pictureOpen ? <PictureSheet name={p.name} username={p.username} picture={p.picture} onClose={() => setPictureOpen(false)} onSaved={(picture) => { setProfile((was) => was ? { ...was, picture } : was); setToast(picture ? "Picture up" : "Picture off"); }} /> : null}
    {editingLinks && p.open ? <LinksEditor links={p.links} onClose={() => setEditingLinks(false)}
      onSave={(links) => call<{ links: { title: string; url: string; icon?: string; show?: LinkShow }[] }>("/api/v1/profile", "PATCH", { links }).then((r) => { setProfile((was) => was && was.open ? { ...was, links: r.links } : was); return true; }, (e) => { setProblem(message(e)); return false; })} /> : null}
    {removing ? <InkSheet title={`Remove ${first(p)}?`} icon="people" onClose={() => setRemoving(false)} actions={<>
      <Seal tone="quiet" compact onClick={() => setRemoving(false)}>Keep</Seal>
      <Seal tone="danger" compact onClick={() => { setRemoving(false); void change("remove"); }}>Remove</Seal>
    </>}><p className="fr-quiet">You&rsquo;ll stop seeing each other&rsquo;s profiles and what you watch, read and listen to.</p></InkSheet> : null}
    {unrecommending ? <InkSheet title={`Take ${unrecommending.title} off your profile?`} icon="trash" onClose={() => setUnrecommending(null)} actions={<>
      <Seal tone="quiet" compact onClick={() => setUnrecommending(null)}>Keep</Seal>
      <Seal tone="danger" compact onClick={() => { const r = unrecommending; setUnrecommending(null); void takeBack(r); }}>Take off</Seal>
    </>}><p className="fr-quiet">{unrecommending.note ? "Your note goes with it." : "Friends stop seeing you recommend it."}</p></InkSheet> : null}
    {offOpen ? <OffSheet off={off} onClose={() => setOffOpen(false)}
      onBack={(r, i) => { setToast(`Back on ${i.rowTitle}`); if (!r.length) setOffOpen(false); void load(); }} onProblem={setProblem} /> : null}
    {recommending ? <RecommendSheet item={recommending} onClose={() => setRecommending(null)} onSent={setToast} /> : null}
    {toast ? <div className="fr-toast" role="status">{toast}</div> : null}
  </div>;
}

/* ── Who sees what ─────────────────────────────────────────────────────── */

/** Who sees one thing: only me, friends, and (on a public profile) everyone with the link; side by side, what's chosen filled. */
function Who({ value, everyone, label, disabled, onChange }: { value: Audience; everyone: boolean; label: string; disabled?: boolean; onChange: (to: Audience) => void }) {
  const options: [Audience, LineIconName, string][] = [["me", "lock", "Only me"], ["friends", "people", "Friends"], ...(everyone ? [["everyone", "link", "Everyone"] as [Audience, LineIconName, string]] : [])];
  const shown = !everyone && value === "everyone" ? "friends" : value;
  return <span className={`fr-who${everyone ? " is-three" : ""}`} role="radiogroup" aria-label={label}>
    {options.map(([v, icon, name]) => <button key={v} type="button" role="radio" aria-checked={shown === v} disabled={disabled} className={shown === v ? "is-on" : undefined} onClick={() => onChange(v)}><LineIcon name={icon} />{name}</button>)}
  </span>;
}
const audience = (shown: boolean, everyone?: boolean): Audience => (!shown ? "me" : everyone === false ? "friends" : "everyone");

/** Your public profile's address, to copy. */
function PublicLink() {
  const [copied, setCopied] = useState(false);
  const [href, setHref] = useState("");
  useEffect(() => { void fetch("/api/v1/me").then((r) => r.json()).then((m: { username?: string }) => { if (m.username) setHref(`${location.origin}/p/${encodeURIComponent(m.username)}`); }).catch(() => null); }, []);
  if (!href) return null;
  return <div className="fr-wsw-link">
    <LineIcon name="link" /><code>{href.replace(/^https?:\/\//, "")}</code>
    <Seal tone="quiet" compact onClick={() => { void navigator.clipboard.writeText(href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }); }}>{copied ? "Copied" : "Copy"}</Seal>
  </div>;
}

/**
 * Every privacy choice in one place, in plain words: who sees your profile at
 * all, your friends list, and each app and each of its rows (folded until you
 * open the app). On a public profile each can be Only me, Friends or Everyone.
 * Each choice saves as it's made.
 */
function WhoSeesWhat({ privacy, offCount, onClose, onOff, onChanged }: { privacy: Privacy; offCount: number; onClose: () => void; onOff: () => void; onChanged: (r: { privacy: Privacy; hidden: string[] }) => void }) {
  const [now, setNow] = useState(privacy);
  const [open, setOpen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const change = (body: Record<string, unknown>) => call<{ privacy: Privacy; hidden: string[] }>("/api/v1/profile", "PATCH", body)
    .then((r) => { setNow(r.privacy); onChanged(r); setProblem(null); }, (e) => setProblem(message(e)));
  const hidden = now.invisible;
  const pub = now.visibility === "public";
  const set = (key: string) => (to: Audience) => void change({ audience: key, to });
  /* What an app's rows come to, folded: who sees how many. */
  const summary = (a: Privacy["apps"][number]) => {
    if (!a.shown) return "Only you";
    const seen = a.rows.filter((r) => r.shown);
    if (!seen.length) return "Only you";
    const all = seen.length === a.rows.length ? "All" : `${seen.length} of ${a.rows.length}`;
    if (!pub) return `${all} shown to friends`;
    const wide = a.everyone === false ? 0 : seen.filter((r) => r.everyone !== false).length;
    return wide === seen.length ? `${all} shown to everyone` : wide ? `${all} shown · ${wide} to everyone` : `${all} shown to friends`;
  };
  return <InkSheet title="Who sees what" icon="eye" onClose={onClose} actions={<Seal compact onClick={onClose}>Done</Seal>}>
    <div className="fr-wsw">
      <div className="fr-wsw-modes is-three" role="radiogroup" aria-label="Who sees your profile">
        {([
          ["friends", "people", "Friends", "Your friends see what you choose below"],
          ["public", "link", "Public", "Anyone with the link; you choose what's for friends and what's for everyone"],
          ["private", "lock", "Only me", "Friends see your name and picture"],
        ] as const).map(([v, icon, name, says]) => <button key={v} type="button" role="radio" aria-checked={now.visibility === v} className={now.visibility === v ? "is-on" : undefined} onClick={() => void change({ visibility: v })}>
          <LineIcon name={icon} /><b>{name}</b><small>{says}</small>
        </button>)}
      </div>
      {pub ? <PublicLink /> : null}

      <div className={`fr-wsw-rows${hidden ? " is-off" : ""}`}>
        <div className="fr-wsw-row"><span><b>Your friends list</b><small>Who you&rsquo;re friends with</small></span>
          <Who value={audience(now.friends, now.friendsEveryone)} everyone={pub} label="Your friends list" disabled={hidden} onChange={set("friends")} /></div>
        {now.apps.map((a) => <section key={a.app} className={`fr-wsw-app fr-app-${a.app}${open === a.app ? " is-open" : ""}`}>
          <div className="fr-wsw-row fr-wsw-apphead">
            <button type="button" className="fr-wsw-appname" aria-expanded={open === a.app} onClick={() => setOpen(open === a.app ? null : a.app)}>
              <InkBlot tint={appTint(a.app)} seed={`app:${a.app}`}><AppMark app={a.app} /></InkBlot>
              <span><b>{a.name}</b><small>{summary(a)}</small></span>
              <LineIcon name="down" />
            </button>
            <Who value={a.rows.some((r) => r.shown) ? audience(a.shown, a.everyone !== false && a.rows.some((r) => r.shown && r.everyone !== false)) : "me"} everyone={pub} label={`${a.name} on your profile`} disabled={hidden} onChange={set(a.app)} />
          </div>
          {open === a.app ? <div className="fr-wsw-subs">{a.rows.map((r) => <div key={r.kind} className={`fr-wsw-row fr-wsw-sub${a.shown ? "" : " is-off"}`}>
            <span>{rowWords[`${a.app}:${r.kind}`] ?? r.title}</span>
            <Who value={a.shown ? audience(r.shown, r.everyone !== false && a.everyone !== false) : "me"} everyone={pub} label={`${a.name}: ${r.title}`} disabled={hidden || !a.shown} onChange={set(`${a.app}:${r.kind}`)} />
          </div>)}</div> : null}
        </section>)}
      </div>

      {offCount ? <button type="button" className="fr-wsw-off" onClick={onOff}><LineIcon name="eye" /><span>Things you took off your profile<small>{offCount === 1 ? "1 thing" : `${offCount} things`}: put them back</small></span><LineIcon name="out" /></button> : null}
      {problem ? <p className="fr-problem" role="alert">{problem}</p> : null}
    </div>
  </InkSheet>;
}

/* ── Editing your profile ──────────────────────────────────────────────── */

/** Your bio, edited where it sits: click it, type, and it saves when you leave it (Enter saves, Shift+Enter is a new line, Escape lets go). */
function BioInPlace({ bio, onSaved, onProblem }: { bio: string; onSaved: (bio: string) => void; onProblem: (p: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const done = useRef(false);
  const save = async (text: string) => {
    if (done.current) return;
    done.current = true;
    setDraft(null);
    if (text.trim() === bio) return;
    try { const r = await call<{ bio: string }>("/api/v1/profile", "PATCH", { bio: text.trim() }); onSaved(r.bio); } catch (e) { onProblem(message(e)); }
  };
  if (draft === null) return <button type="button" className={`fr-bio fr-bio-edit${bio ? "" : " fr-bio-empty"}`} onClick={() => { done.current = false; setDraft(bio); }} title="Edit">{bio || "Add a few words about you"}</button>;
  return <textarea className="fr-bio fr-bio-input" autoFocus rows={Math.max(2, draft.split("\n").length)} maxLength={280} value={draft} placeholder="A few words about you"
    onChange={(e) => setDraft(e.target.value)} onBlur={() => void save(draft)}
    onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void save(draft); } else if (e.key === "Escape") { e.stopPropagation(); done.current = true; setDraft(null); } }} />;
}

type Look = { pronouns: string; color: ProfileColor | null; links: { title: string; url: string; icon?: string; show?: LinkShow }[] };

/** Your name, pronouns, words, colour and links, in one place, saved together. */
function EditProfileSheet({ profile, onClose, onSaved, onLinks, onBanner }: { profile: Profile & { open: true }; onClose: () => void; onSaved: (p: Profile) => void; onLinks: () => void; onBanner: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  const [pronouns, setPronouns] = useState(profile.pronouns);
  const [bio, setBio] = useState(profile.bio);
  const [color, setColor] = useState<ProfileColor | null>(profile.color);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setProblem(null);
    try {
      if (name.trim() && name.trim() !== profile.name) { await call("/api/v1/me", "PATCH", { name: name.trim() }); router.refresh(); }
      const look = await call<Look & { bio: string }>("/api/v1/profile", "PATCH", { pronouns, color, bio });
      onSaved({ ...profile, name: name.trim() || profile.name, ...look });
      onClose();
    } catch (error) { setProblem(message(error)); }
    setBusy(false);
  };
  return <InkSheet title="Edit profile" icon="brush" onClose={onClose} actions={<>
    <Seal tone="quiet" compact onClick={onClose}>Cancel</Seal>
    <Seal compact busy={busy} onClick={() => void save()}>Save</Seal>
  </>}>
    <div className="fr-edit">
      <div className="fr-edit-two">
        <label className="field"><small>Name</small><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
        <label className="field"><small>Pronouns</small><input value={pronouns} maxLength={30} placeholder="they/them" onChange={(e) => setPronouns(e.target.value)} /></label>
      </div>
      <label className="field"><small>About you</small><textarea rows={3} maxLength={280} value={bio} onChange={(e) => setBio(e.target.value)} /></label>
      <div className="fr-edit-colors" role="radiogroup" aria-label="Colour">
        <small className="fr-edit-label">Colour</small>
        <div>{profileColors.map((c) => <button key={c.id} type="button" role="radio" aria-checked={(color ?? "suo") === c.id} aria-label={c.name} title={c.name}
          style={{ "--swatch": c.hex } as React.CSSProperties} className={(color ?? "suo") === c.id ? "is-on" : undefined} onClick={() => setColor(c.id)} />)}</div>
      </div>
      <button type="button" className="fr-edit-linksrow" onClick={() => { onClose(); onBanner(); }}>
        <span className="fr-link-mark fr-banner-mark" style={profile.banner ? { backgroundImage: `url(${profile.banner})` } : undefined}>{profile.banner ? null : <LineIcon name="camera" />}</span>
        <span><b>Banner</b><small>{profile.banner ? "A photo across the top" : "Your colour, or a photo of your own"}</small></span>
        <LineIcon name="out" />
      </button>
      <button type="button" className="fr-edit-linksrow" onClick={() => { onClose(); onLinks(); }}>
        <span className="fr-link-mark"><LineIcon name="link" /></span>
        <span><b>Links</b><small>{profile.links.length ? `${profile.links.length} on your profile` : "Your Instagram, your site, your playlist"}</small></span>
        <LineIcon name="out" />
      </button>
      {problem ? <p className="fr-problem" role="alert">{problem}</p> : null}
    </div>
  </InkSheet>;
}

/** What taking a title off a row means, said before it's done (lib/friends removeFromRow): only the profile forgets it. */

/** What you took off your profile, each with the row it came off; Put back returns it there. */
function OffSheet({ off, onClose, onBack, onProblem }: { off: Off[]; onClose: () => void; onBack: (left: Off[], back: Off) => void; onProblem: (problem: string) => void }) {
  const [left, setLeft] = useState(off);
  const back = (o: Off) => call<{ off: Off[] }>("/api/v1/profile", "PATCH", { restore: { app: o.app, kind: o.kind, itemId: o.itemId } })
    .then((r) => { setLeft(r.off); onBack(r.off, o); }, (e) => onProblem(message(e)));
  return <InkSheet title="Taken off" icon="eye" onClose={onClose} actions={<Seal compact onClick={onClose}>Done</Seal>}>
    <ul className="fr-off">{left.map((o) => <li key={`${o.app}:${o.kind}:${o.itemId}`}>
      <TitleRow item={o} line={<small>{o.appName} · {o.rowTitle}</small>}>
        <Seal tone="quiet" compact onClick={() => void back(o)}>Put back</Seal>
      </TitleRow>
    </li>)}</ul>
  </InkSheet>;
}

const keptFrom = (privacy: Privacy) => [
  ...(privacy.friends ? [] : ["friends"]),
  ...privacy.apps.flatMap((a) => a.rows.filter((r) => !r.shown).map((r) => `${a.app}:${r.kind}`)),
];

/** Settings' privacy row: where you stand, and the way to Who sees what (on your profile). */
export function InvisibleRow() {
  const [me, setMe] = useState<{ username: string; invisible: boolean } | null>(null);
  useEffect(() => { call<Profile>("/api/v1/profile").then((p) => setMe({ username: p.username, invisible: p.open ? p.privacy?.invisible ?? false : false }), () => {}); }, []);
  return <Crossing kind="kakejiku" className="row you-invisible" href={me ? `/account/people/${encodeURIComponent(me.username)}?sheet=privacy` : "/account"}>
    <InkBlot tint="#74565c" seed="invisible"><LineIcon name={me?.invisible ? "lock" : "eye"} /></InkBlot>
    <span className="text"><b>Who sees what</b><small>{me === null ? " " : me.invisible ? "Invisible: friends only see your name and picture" : "Friends see your profile, as you choose"}</small></span>
    <LineIcon name="out" />
  </Crossing>;
}

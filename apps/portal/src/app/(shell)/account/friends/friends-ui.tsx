"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { InkBlot, InkPortraitFrame, Seal } from "@kimono/ui";
import { Crossing, CrossingSeal, useCrossTo } from "@/components/crossing";
import { InkSheet } from "@/components/ink-sheet";
import { JointSwitch } from "@/components/joint-switch";
import { LineIcon } from "@/components/line-icon";
import { Portrait } from "@/components/portrait";
import { SilkscreenBadge } from "./silkscreen";
import { Book3D } from "../../books/book3d";

/*
 * 友 Friends, profiles and recommendations on the web (lib/friends has the
 * rules). The phone app has the same pages; Watch's title page sends
 * recommendations through RecommendSheet.
 */

export type Person = { username: string; name: string; picture: string | null };
export type Item = { app: string; itemId: string; title: string; subtitle: string | null; cover: string | null; href?: string | null; progress?: number | null; rating?: "love" | "up" | "down" | null };
export type Recommendation = Item & { id: string; from: Person; to: Person | null; note: string | null; at: number; seen: boolean; appName: string };
export type Section = { app: string; appName: string; kind: string; title: string; items: Item[] };
/** Private until you're friends: then only `open: false` and who they are comes back (lib/friends/model.ts profileFor). */
export type Profile = Person & { you: boolean; link: "friends" | "asked" | "asking" | null } & (
  | { open: false }
  | { open: true; bio: string; sections: Section[]; recommendations: Recommendation[]; friends: number; friendList?: Person[] | null; hidden?: string[]; kept?: string[]; privacy?: Privacy; off?: Off[]; kimonoRead?: { since: string } | null }
);
/** What you let friends see (your own profile only): lib/friends/model.ts privacyOf. */
export type Privacy = { invisible: boolean; friends: boolean; apps: { app: string; name: string; shown: boolean; rows: { kind: string; title: string; shown: boolean }[] }[] };
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

/* A book is drawn as Books draws it, in 3D, with a cloth binding when there's no cover; anything else by its cover. */
function Face3D({ item }: { item: Item }) {
  const author = item.subtitle?.split(" · ")[0]?.trim();
  return <Book3D book={{ key: item.itemId, title: item.title, authors: author ? [author] : [], cover: item.cover, pages: null }} />;
}

function Cover({ item }: { item: Item }) {
  return <span className="fr-cover">
    {/* eslint-disable-next-line @next/next/no-img-element -- covers come from each app */}
    {item.cover ? <img src={item.cover} alt="" loading="lazy" /> : <span className="fr-cover-none">{item.title.slice(0, 1)}</span>}
  </span>;
}

/** How they rated it, as a mark on the cover's corner. */
const rated = { love: "Loved", up: "Liked", down: "Didn't like" } as const;
function RatingMark({ rating }: { rating: "love" | "up" | "down" }) {
  return <span className={`fr-rated fr-rated-${rating}`} title={rated[rating]} aria-label={rated[rating]}>
    {rating === "love"
      ? <svg viewBox="0 0 24 24" aria-hidden><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>
      : <svg viewBox="0 0 24 24" aria-hidden style={rating === "down" ? { transform: "rotate(180deg)" } : undefined}><path d="M7 11v9H4v-9h3Zm0 0 4-7c1.7 0 2.6 1.2 2.2 2.8L12.6 10H18a2 2 0 0 1 2 2.3l-1.1 6A2 2 0 0 1 17 20H7" /></svg>}
  </span>;
}

function Tile({ item, children }: { item: Item; children?: React.ReactNode }) {
  const href = hrefOf(item);
  const face = <><span className="fr-cover-wrap">{item.app === "books" ? <Face3D item={item} /> : <Cover item={item} />}{item.rating ? <RatingMark rating={item.rating} /> : null}</span>
    {item.progress ? <span className="fr-progress" role="progressbar" aria-valuenow={Math.round(item.progress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${item.progress * 100}%` }} /></span> : null}
    <b>{item.title}</b>{item.subtitle ? <small>{item.subtitle}</small> : null}</>;
  return <div className="fr-tile">
    {href ? <Crossing kind="kakejiku" href={href}>{face}</Crossing> : <span>{face}</span>}
    {children}
  </div>;
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
    <div className="fr-rec-item"><Cover item={item} /><span><b>{item.title}</b>{item.subtitle ? <small>{item.subtitle}</small> : null}</span></div>
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
  const [typed, setTyped] = useState("");
  const [found, setFound] = useState<Person[]>([]);
  const load = useCallback(() => {
    call<FriendsList>("/api/v1/friends").then(setList, (e) => setProblem(message(e)));
    call<Inbox>("/api/v1/recommendations").then(setInbox, () => {});
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (typed.trim().length < 2) return;
    const timer = setTimeout(() => { call<{ people: Person[] }>(`/api/v1/friends?q=${encodeURIComponent(typed.trim())}`).then((r) => setFound(r.people), () => {}); }, 200);
    return () => clearTimeout(timer);
  }, [typed, list]);
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
      <label className="row fr-find"><InkBlot tint="#8a7c77" seed="find people"><LineIcon name="search" /></InkBlot>
        <input type="search" placeholder="Name" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Find people" /></label>
      {(typed.trim().length < 2 ? [] : found).map((p) => <div key={p.username} className="row">
        <Face person={p} /><span className="text"><b>{p.name}</b><small>@{p.username}</small></span>
        <Seal compact onClick={() => void change("ask", p.username).then(() => setTyped(""))}>Ask</Seal>
      </div>)}
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
export function ProfileView({ username, home = false }: { username: string; home?: boolean }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);
  const [removing, setRemoving] = useState(false);
  /* What the × is about to take off, waiting on a yes. */
  const [dropping, setDropping] = useState<{ s: Section; i: Item } | null>(null);
  const [unrecommending, setUnrecommending] = useState<Recommendation | null>(null);
  const [recommending, setRecommending] = useState<Item | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /* Which app's rows are open to choose what friends see of them. */
  const [privacyOpen, setPrivacyOpen] = useState<string | null>(null);
  /* What you took off your profile, open to put back. */
  const [offOpen, setOffOpen] = useState(false);
  const crossTo = useCrossTo();
  const load = useCallback(() => call<Profile>(`/api/v1/profiles/${encodeURIComponent(username)}`).then(setProfile, (e) => setProblem(message(e))), [username]);
  useEffect(() => { void load(); }, [load]);
  const own = profile?.you ?? false;
  useEffect(() => { if (own) call<FriendsList>("/api/v1/friends").then((l) => setAsked(l.asked.length), () => {}); }, [own]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);
  const change = (type: "ask" | "yes" | "no" | "remove") => call("/api/v1/friends", "POST", { type, username }).then(load, (e) => setProblem(message(e)));
  const takeBack = (r: Recommendation) => call(`/api/v1/recommendations/${r.id}`, "DELETE").then(load, (e) => setProblem(message(e)));

  if (!profile) return <div className="you fr">{problem ? <p className="fr-problem" role="alert">{problem}</p> : <div className="stack you-head"><span className="fr-sk-face" /></div>}</div>;
  const p = profile;
  const action = p.link === "friends" ? <Seal tone="quiet" compact onClick={() => setRemoving(true)}>Friends</Seal>
      : p.link === "asked" ? <><Seal tone="quiet" compact onClick={() => void change("no")}>Not now</Seal><Seal compact onClick={() => void change("yes")}>Accept</Seal></>
        : p.link === "asking" ? <Seal tone="quiet" compact onClick={() => void change("remove")}>Asked</Seal>
          : <Seal compact onClick={() => void change("ask")}>Ask to be friends</Seal>;

  /* An app's rows together, under its name; on your own profile, what friends see of them, which opens Who sees what. */
  const groups = p.open ? Object.values(p.sections.reduce<Record<string, Section[]>>((by, s) => { (by[s.app] ??= []).push(s); return by; }, {})) : [];
  const privacy = p.open ? p.privacy : undefined;
  const invisible = privacy?.invisible ?? false;
  /* Kept from friends: the whole app, or one row of it. */
  const appKept = (app: string) => p.open && (p.hidden?.includes(app) ?? false);
  const rowKept = (app: string, kind: string) => appKept(app) || (p.open && (p.kept?.includes(`${app}:${kind}`) ?? false));
  /* Your own: one title off one row, for good until you put it back (lib/friends removeFromRow); it leaves at once and comes back if that fails. */
  const drop = (s: Section, i: Item) => {
    if (!p.open) return;
    const left = { ...p, sections: p.sections.map((x) => (x === s ? { ...x, items: x.items.filter((y) => y.itemId !== i.itemId) } : x)).filter((x) => x.items.length > 0) };
    setProfile(left);
    return call<{ off: Off[] }>("/api/v1/profile", "PATCH", { remove: { app: s.app, kind: s.kind, itemId: i.itemId, title: i.title, subtitle: i.subtitle, cover: i.cover } })
      .then((r) => { setProfile({ ...left, off: r.off }); setToast(`Off ${s.title}`); }, (e) => { setProblem(message(e)); void load(); });
  };
  const off = p.open ? p.off ?? [] : [];
  const friendsKept = p.open && p.you && (invisible || privacy?.friends === false);
  /* What friends see of one part of you, one tag everywhere; tapping it changes that part. Invisible is Settings'. */
  const tag = (kept: boolean, some: boolean, onClick: () => void) => <button type="button" className={`fr-tag${kept ? " is-only" : ""}`}
    onClick={invisible ? () => crossTo("kakejiku", "/account/settings") : onClick}>
    <LineIcon name={kept ? "lock" : "eye"} />{kept ? "Only you" : some ? "Friends see some" : "Friends see this"}</button>;
  const savePrivacy = (body: Record<string, unknown>, said: string) => call<{ privacy: Privacy; hidden: string[] }>("/api/v1/profile", "PATCH", body)
    .then((r) => { if (p.open) setProfile({ ...p, privacy: r.privacy, hidden: r.hidden, kept: keptFrom(r.privacy) }); setToast(said); }, (e) => setProblem(message(e)));
  const friendList = p.open ? p.friendList ?? [] : [];

  return <div className={`you fr fr-profile${p.open ? "" : " is-closed"}`}>
    {home && !p.you ? null : <div className="fr-top">
      {home ? null : <Crossing kind="kakejiku" className="fr-back" href={p.you ? "/account" : "/account/friends"} aria-label="Back"><LineIcon name="back" /></Crossing>}
      {p.you ? <CrossingSeal tone="quiet" compact className="fr-settings" href="/account/settings"><LineIcon name="cog" />Settings</CrossingSeal> : null}
    </div>}
    <aside className="fr-side">
      <div className="stack you-head">
        {p.you ? <Crossing kind="kakejiku" className="you-picture" href="/account?sheet=picture" aria-label="Change your picture">
          <Face person={p} size={120} /><span className="you-camera"><LineIcon name="camera" /></span></Crossing>
          : <span className="you-picture"><Face person={p} size={120} /></span>}
        {p.you ? <NameField name={p.name} onSaved={(name) => setProfile({ ...p, name })} onProblem={setProblem} /> : <h1>{p.name}</h1>}
        <p className="fr-handle">@{p.username}{p.open ? ` · ${p.friends === 1 ? "1 friend" : `${p.friends} friends`}` : ""}</p>
        {p.open && p.kimonoRead ? <SilkscreenBadge since={p.kimonoRead.since} you={p.you} name={p.name || p.username} /> : null}
        {p.open && p.you ? <BioField bio={p.bio} onSaved={(bio) => setProfile({ ...p, bio })} onProblem={setProblem} />
          : p.open && p.bio ? <p className="fr-bio">{p.bio}</p> : null}
        {p.you ? invisible ? <Crossing kind="kakejiku" className="fr-tag is-only" href="/account/settings"><LineIcon name="lock" />Invisible</Crossing> : null
          : <div className="fr-actions">{action}</div>}
      </div>
      {problem ? <p className="fr-problem" role="alert">{problem}</p> : null}

      {p.open && (friendList.length || p.you) ? <section className={`fr-group fr-friends${friendsKept ? " is-kept" : ""}`}>
        <div className="fr-app-head">
          <InkBlot tint="#74565c" seed="friends"><LineIcon name="people" /></InkBlot>
          <h2>Friends</h2>
          {p.you ? tag(friendsKept, false, () => void savePrivacy({ keep: "friends", shown: friendsKept }, friendsKept ? "Friends see your friends" : "Only you see your friends")) : null}
        </div>
        {friendList.length ? <div className="fr-shelf fr-people k-inkbar">{friendList.slice(0, 8).map((f) =>
          <Crossing key={f.username} kind="kakejiku" className="fr-person" href={`/account/people/${encodeURIComponent(f.username)}`}>
            <Face person={f} size={64} /><span>{first(f)}</span>
          </Crossing>)}</div> : null}
        {p.you ? <div className="fr-more">
          {asked ? <CrossingSeal compact href="/account/friends"><i className="fr-new" />{asked} asking</CrossingSeal> : null}
          {friendList.length ? <CrossingSeal tone="quiet" compact href="/account/friends">All friends</CrossingSeal>
            : <CrossingSeal compact href="/account/friends"><LineIcon name="search" />Find friends</CrossingSeal>}
        </div> : null}
      </section> : null}
    </aside>

    <div className="fr-main">
      {p.open && p.recommendations.length ? <section className="fr-group">
        <div className="fr-app-head">
          <InkBlot tint="#a84d63" seed="recommends"><LineIcon name="send" /></InkBlot>
          <h2>Recommends</h2>
        </div>
        <div className="fr-shelf k-inkbar">{p.recommendations.map((r) => <Tile key={r.id} item={r}>
          {r.note ? <q className="fr-tile-note">{r.note}</q> : null}
          {p.you ? <button type="button" className="fr-away" aria-label={`Take ${r.title} off your profile`} onClick={() => setUnrecommending(r)}><LineIcon name="close" /></button>
            : <button type="button" className="fr-away" aria-label={`Recommend ${r.title}`} onClick={() => setRecommending(r)}><LineIcon name="send" /></button>}
        </Tile>)}</div>
      </section> : null}

      {p.open ? groups.map((rows) => {
        const app = rows[0].app;
        const kept = appKept(app);
        const some = (privacy?.apps.find((a) => a.app === app)?.rows ?? []).some((r) => !r.shown);
        return <section key={app} className={`fr-group fr-app-${app}${kept ? " is-kept" : ""}`}>
          <div className="fr-app-head">
            <InkBlot tint={app === "books" ? "#5c7150" : "#a84d63"} seed={`app:${app}`}><LineIcon name={app === "books" ? "book" : "film"} /></InkBlot>
            <h2>{rows[0].appName}</h2>
            {p.you ? tag(kept, some, () => setPrivacyOpen(app)) : null}
          </div>
          {rows.map((s) => {
            const only = !kept && p.you && rowKept(app, s.kind);
            return <div key={`${s.app}:${s.kind}`} className={only ? "is-kept" : undefined}>
              <div className="label fr-label">{s.title}{only ? tag(true, false, () => setPrivacyOpen(app)) : null}</div>
              <div className="fr-shelf k-inkbar">{s.items.map((i) => <Tile key={i.itemId} item={i}>
                {p.you ? <button type="button" className="fr-away" aria-label={`Take ${i.title} off ${s.title}`} onClick={() => setDropping({ s, i })}><LineIcon name="close" /></button>
                  : <button type="button" className="fr-away" aria-label={`Recommend ${i.title}`} onClick={() => setRecommending(i)}><LineIcon name="send" /></button>}
              </Tile>)}</div>
            </div>;
          })}
        </section>;
      }) : null}
      {p.you && off.length ? <div className="fr-more fr-off-open"><Seal tone="quiet" compact onClick={() => setOffOpen(true)}><LineIcon name="eye" />Taken off · {off.length}</Seal></div> : null}
    </div>

    {privacyOpen && privacy ? <AppPrivacySheet app={privacyOpen} privacy={privacy} onClose={() => setPrivacyOpen(null)}
      onChanged={(r) => { if (p.open) setProfile({ ...p, privacy: r.privacy, hidden: r.hidden, kept: keptFrom(r.privacy) }); }} /> : null}
    {removing ? <InkSheet title={`Remove ${first(p)}?`} icon="people" onClose={() => setRemoving(false)} actions={<>
      <Seal tone="quiet" compact onClick={() => setRemoving(false)}>Keep</Seal>
      <Seal tone="danger" compact onClick={() => { setRemoving(false); void change("remove"); }}>Remove</Seal>
    </>}><p className="fr-quiet">You&rsquo;ll stop seeing each other&rsquo;s profiles and what you watch.</p></InkSheet> : null}
    {dropping ? <InkSheet title={`Take ${dropping.i.title} off ${dropping.s.title}?`} icon="trash" onClose={() => setDropping(null)} actions={<>
      <Seal tone="quiet" compact onClick={() => setDropping(null)}>Keep</Seal>
      <Seal tone="danger" compact onClick={() => { const d = dropping; setDropping(null); void drop(d.s, d.i); }}>Take off</Seal>
    </>}><p className="fr-quiet">{dropLoses(dropping.s)}</p></InkSheet> : null}
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

/** What taking a title off a row means, said before it's done (lib/friends removeFromRow): only the profile forgets it. */
const dropLoses = (s: Section) =>
  s.app === "books" && s.kind === "reading" ? "Your progress stays. Put it back from Taken off."
      : `It stays in ${s.appName}. Put it back from Taken off.`;

/** What you took off your profile, each with the row it came off; Put back returns it there. */
function OffSheet({ off, onClose, onBack, onProblem }: { off: Off[]; onClose: () => void; onBack: (left: Off[], back: Off) => void; onProblem: (problem: string) => void }) {
  const [left, setLeft] = useState(off);
  const back = (o: Off) => call<{ off: Off[] }>("/api/v1/profile", "PATCH", { restore: { app: o.app, kind: o.kind, itemId: o.itemId } })
    .then((r) => { setLeft(r.off); onBack(r.off, o); }, (e) => onProblem(message(e)));
  return <InkSheet title="Taken off" icon="eye" onClose={onClose} actions={<Seal compact onClick={onClose}>Done</Seal>}>
    <ul className="fr-off">{left.map((o) => <li key={`${o.app}:${o.kind}:${o.itemId}`}>
      <Cover item={o} />
      <span className="fr-off-words"><b>{o.title}</b><small>{o.appName} · {o.rowTitle}</small></span>
      <Seal tone="quiet" compact onClick={() => void back(o)}>Put back</Seal>
    </li>)}</ul>
  </InkSheet>;
}

const keptFrom = (privacy: Privacy) => [
  ...(privacy.friends ? [] : ["friends"]),
  ...privacy.apps.flatMap((a) => a.rows.filter((r) => !r.shown).map((r) => `${a.app}:${r.kind}`)),
];

/** What friends see of one app: the app itself, then each of its rows. Every switch saves as it's flipped. */
function AppPrivacySheet({ app, privacy, onClose, onChanged }: { app: string; privacy: Privacy; onClose: () => void; onChanged: (r: { privacy: Privacy; hidden: string[] }) => void }) {
  const [now, setNow] = useState(privacy);
  const [problem, setProblem] = useState<string | null>(null);
  const change = (body: Record<string, unknown>) => call<{ privacy: Privacy; hidden: string[] }>("/api/v1/profile", "PATCH", body)
    .then((r) => { setNow(r.privacy); onChanged(r); setProblem(null); }, (e) => setProblem(message(e)));
  const a = now.apps.find((x) => x.app === app);
  if (!a) return null;
  return <InkSheet title={a.name} icon={app === "books" ? "book" : "film"} tint={app === "books" ? "#5c7150" : "#a84d63"} onClose={onClose} actions={<Seal compact onClick={onClose}>Done</Seal>}>
    <div className="fr-privacy">
      <label className="fr-toggle fr-priv-main"><span><b>Friends see your {a.name}</b></span>
        <JointSwitch name={`see-${a.app}`} label={`Friends see your ${a.name}`} defaultChecked={a.shown} onChange={(on) => void change({ app: a.app, shown: on })} /></label>
      <div className={`fr-priv-rows${a.shown ? "" : " is-off"}`}>{a.rows.map((r) =>
        <label key={r.kind} className="fr-toggle"><span>{r.title}</span>
          <JointSwitch name={`see-${a.app}-${r.kind}`} label={`Friends see your ${a.name} ${r.title}`} defaultChecked={r.shown} disabled={!a.shown}
            onChange={(on) => void change({ keep: `${a.app}:${r.kind}`, shown: on })} /></label>)}</div>
      {problem ? <p className="fr-problem" role="alert">{problem}</p> : null}
    </div>
  </InkSheet>;
}

/** Settings' Invisible: friends see only your name and portrait, and no app shows them what you do. */
export function InvisibleRow() {
  const [on, setOn] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { call<Profile>("/api/v1/profile").then((p) => setOn(p.open ? p.privacy?.invisible ?? false : false), () => setOn(false)); }, []);
  return <label className="row you-invisible">
    <InkBlot tint="#74565c" seed="invisible"><LineIcon name="lock" /></InkBlot>
    <span className="text"><b>Invisible</b><small>{problem ?? "Friends see your name and portrait"}</small></span>
    {on === null ? null : <JointSwitch name="invisible" label="Invisible to friends" defaultChecked={on}
      onChange={(next) => void call("/api/v1/profile", "PATCH", { invisible: next }).then(() => setProblem(null), (e) => setProblem(message(e)))} />}
  </label>;
}

/** Your name, written where it shows: it saves when you leave it or press Enter, and Escape puts it back. */
function NameField({ name, onSaved, onProblem }: { name: string; onSaved: (name: string) => void; onProblem: (problem: string | null) => void }) {
  const router = useRouter();
  const [text, setText] = useState(name);
  const field = useRef<HTMLInputElement>(null);
  const save = () => {
    const next = text.trim();
    if (!next) { setText(name); return; }
    if (next === name) return;
    call<{ name: string }>("/api/v1/me", "PATCH", { name: next })
      .then((r) => { onSaved(r.name); onProblem(null); router.refresh(); }, (e) => { setText(name); onProblem(message(e)); });
  };
  return <h1 className="fr-edit-name fr-editable"><input ref={field} aria-label="Your name" value={text} maxLength={80} autoComplete="name" spellCheck={false}
    size={Math.max(4, [...text].length)} onChange={(e) => setText(e.target.value)} onBlur={save}
    onKeyDown={(e) => { if (e.key === "Enter") field.current?.blur(); if (e.key === "Escape") { setText(name); requestAnimationFrame(() => field.current?.blur()); } }} />
    <LineIcon name="brush" className="fr-brush" /></h1>;
}

/** Your bio, written where friends read it; it saves when you leave it. */
function BioField({ bio, onSaved, onProblem }: { bio: string; onSaved: (bio: string) => void; onProblem: (problem: string | null) => void }) {
  const [text, setText] = useState(bio);
  const save = () => {
    if (text.trim() === bio.trim()) return;
    call<{ bio: string }>("/api/v1/profile", "PATCH", { bio: text })
      .then((r) => { onSaved(r.bio); onProblem(null); }, (e) => { setText(bio); onProblem(message(e)); });
  };
  return <span className="fr-editable fr-edit-bio-wrap"><textarea className="fr-bio fr-edit-bio" aria-label="About you" placeholder="A few words about you" rows={1} maxLength={280}
    value={text} onChange={(e) => setText(e.target.value)} onBlur={save}
    onKeyDown={(e) => { if (e.key === "Escape") { const field = e.currentTarget; setText(bio); requestAnimationFrame(() => field.blur()); } }} />
    <LineIcon name="brush" className="fr-brush" /></span>;
}

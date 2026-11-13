"use client";

import { useCallback, useEffect, useState } from "react";
import { InkBlot, InkPortraitFrame, Seal } from "@kimono/ui";
import { Crossing } from "@/components/crossing";
import { InkSheet } from "@/components/ink-sheet";
import { JointSwitch } from "@/components/joint-switch";
import { LineIcon } from "@/components/line-icon";
import { Portrait } from "@/components/portrait";
import { SilkscreenBadge } from "./silkscreen";

/*
 * 友 Friends, profiles and recommendations on the web (lib/friends has the
 * rules). The phone app has the same pages; Watch's title page sends
 * recommendations through RecommendSheet.
 */

export type Person = { username: string; name: string; picture: string | null };
export type Item = { app: string; itemId: string; title: string; subtitle: string | null; cover: string | null; href?: string | null; progress?: number | null };
export type Recommendation = Item & { id: string; from: Person; to: Person | null; note: string | null; at: number; seen: boolean; appName: string };
export type Section = { app: string; appName: string; kind: string; title: string; items: Item[] };
/** Private until you're friends: then only `open: false` and who they are comes back (lib/friends/model.ts profileFor). */
export type Profile = Person & { you: boolean; link: "friends" | "asked" | "asking" | null } & (
  | { open: false }
  | { open: true; bio: string; sections: Section[]; recommendations: Recommendation[]; friends: number; hidden?: string[]; kimonoRead?: { since: string } | null }
);
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

function Cover({ item }: { item: Item }) {
  return <span className="fr-cover">
    {/* eslint-disable-next-line @next/next/no-img-element -- covers come from each app */}
    {item.cover ? <img src={item.cover} alt="" loading="lazy" /> : <span className="fr-cover-none">{item.title.slice(0, 1)}</span>}
  </span>;
}

function Tile({ item, children }: { item: Item; children?: React.ReactNode }) {
  const href = hrefOf(item);
  const face = <><Cover item={item} />
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

export function ProfileView({ username }: { username: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [recommending, setRecommending] = useState<Item | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const load = useCallback(() => call<Profile>(`/api/v1/profiles/${encodeURIComponent(username)}`).then(setProfile, (e) => setProblem(message(e))), [username]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);
  const change = (type: "ask" | "yes" | "no" | "remove") => call("/api/v1/friends", "POST", { type, username }).then(load, (e) => setProblem(message(e)));
  const takeBack = (r: Recommendation) => call(`/api/v1/recommendations/${r.id}`, "DELETE").then(load, (e) => setProblem(message(e)));

  if (!profile) return <div className="you fr">{problem ? <p className="fr-problem" role="alert">{problem}</p> : <div className="stack you-head"><span className="fr-sk-face" /></div>}</div>;
  const p = profile;
  const action = p.you ? <Seal tone="quiet" compact onClick={() => setEditing(true)}>Edit</Seal>
    : p.link === "friends" ? <Seal tone="quiet" compact onClick={() => setRemoving(true)}>Friends</Seal>
      : p.link === "asked" ? <><Seal tone="quiet" compact onClick={() => void change("no")}>Not now</Seal><Seal compact onClick={() => void change("yes")}>Accept</Seal></>
        : p.link === "asking" ? <Seal tone="quiet" compact onClick={() => void change("remove")}>Asked</Seal>
          : <Seal compact onClick={() => void change("ask")}>Ask to be friends</Seal>;

  /* An app's rows together, under its name; on your own profile, a switch for whether friends see them. */
  const groups = p.open ? Object.values(p.sections.reduce<Record<string, Section[]>>((by, s) => { (by[s.app] ??= []).push(s); return by; }, {})) : [];
  const show = (app: string, shown: boolean) => p.open && call<{ hidden: string[] }>("/api/v1/profile", "PATCH", { app, shown })
    .then((r) => setProfile({ ...p, hidden: r.hidden }), (e) => setProblem(message(e)));

  return <div className="you fr">
    <div className="fr-top"><Crossing kind="kakejiku" className="fr-back" href={p.you ? "/account" : "/account/friends"} aria-label="Back"><LineIcon name="back" /></Crossing></div>
    <div className="stack you-head">
      <span className="you-picture"><Face person={p} size={112} /></span>
      <h1>{p.name}</h1>
      <p>@{p.username}{p.open ? ` · ${p.friends === 1 ? "1 friend" : `${p.friends} friends`}` : ""}</p>
      {p.open && p.kimonoRead ? <SilkscreenBadge since={p.kimonoRead.since} you={p.you} name={p.name || p.username} /> : null}
      {p.open && p.bio ? <p className="fr-bio">{p.bio}</p> : null}
      <div className="fr-actions">{action}</div>
    </div>
    {problem ? <p className="fr-problem" role="alert">{problem}</p> : null}

    {p.open && p.recommendations.length ? <section className="fr-group">
      <div className="label">Recommends</div>
      <div className="fr-shelf k-inkbar">{p.recommendations.map((r) => <Tile key={r.id} item={r}>
        {r.note ? <q className="fr-tile-note">{r.note}</q> : null}
        {p.you ? <button type="button" className="fr-away" aria-label={`Take ${r.title} off your profile`} onClick={() => void takeBack(r)}><LineIcon name="trash" /></button>
          : <button type="button" className="fr-away" aria-label={`Recommend ${r.title}`} onClick={() => setRecommending(r)}><LineIcon name="send" /></button>}
      </Tile>)}</div>
    </section> : null}

    {p.open ? groups.map((rows) => {
      const app = rows[0].app;
      const kept = p.hidden?.includes(app) ?? false;
      return <section key={app} className={`fr-group${kept ? " is-kept" : ""}`}>
        <div className="fr-app-head">
          <InkBlot tint={app === "books" ? "#5c7150" : "#a84d63"} seed={`app:${app}`}><LineIcon name={app === "books" ? "book" : "film"} /></InkBlot>
          <h2>{rows[0].appName}</h2>
          {p.you ? <label className="fr-see"><span>{kept ? "Only you" : "Friends see this"}</span>
            <JointSwitch name={`show-${app}`} label={`Friends see your ${rows[0].appName}`} defaultChecked={!kept} onChange={(on) => void show(app, on)} /></label> : null}
        </div>
        {rows.map((s) => <div key={`${s.app}:${s.kind}`}>
          <div className="label">{s.title}</div>
          <div className="fr-shelf k-inkbar">{s.items.map((i) => <Tile key={i.itemId} item={i}>
            <button type="button" className="fr-away" aria-label={`Recommend ${i.title}`} onClick={() => setRecommending(i)}><LineIcon name="send" /></button>
          </Tile>)}</div>
        </div>)}
      </section>;
    }) : null}

    {editing && p.open ? <BioSheet bio={p.bio} onClose={() => setEditing(false)} onSaved={(bio) => setProfile({ ...p, bio })} /> : null}
    {removing ? <InkSheet title={`Remove ${first(p)}?`} icon="people" onClose={() => setRemoving(false)} actions={<>
      <Seal tone="quiet" compact onClick={() => setRemoving(false)}>Keep</Seal>
      <Seal tone="danger" compact onClick={() => { setRemoving(false); void change("remove"); }}>Remove</Seal>
    </>}><p className="fr-quiet">You&rsquo;ll stop seeing each other&rsquo;s profiles and what you watch.</p></InkSheet> : null}
    {recommending ? <RecommendSheet item={recommending} onClose={() => setRecommending(null)} onSent={setToast} /> : null}
    {toast ? <div className="fr-toast" role="status">{toast}</div> : null}
  </div>;
}

function BioSheet({ bio, onClose, onSaved }: { bio: string; onClose: () => void; onSaved: (bio: string) => void }) {
  const [text, setText] = useState(bio);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setProblem(null);
    try { const r = await call<{ bio: string }>("/api/v1/profile", "PATCH", { bio: text }); onSaved(r.bio); onClose(); } catch (error) { setProblem(message(error)); }
    setBusy(false);
  };
  return <InkSheet title="About you" icon="user" onClose={onClose} actions={<>
    <Seal tone="quiet" compact onClick={onClose}>Cancel</Seal>
    <Seal compact busy={busy} disabled={text.trim() === bio} onClick={() => void save()}>Save</Seal>
  </>}>
    <label className="field fr-note"><small>Bio · {280 - [...text].length}</small><textarea rows={4} maxLength={280} value={text} autoFocus onChange={(e) => setText(e.target.value)} /></label>
    {problem ? <p className="fr-problem" role="alert">{problem}</p> : null}
  </InkSheet>;
}

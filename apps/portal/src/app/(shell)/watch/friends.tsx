"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { friendsApi, type Friend, type FriendHere, type FriendsPage as Page, type JoinAsk, type Person } from "./api";
import { cx, faceOf, Img, initial, useWatch } from "./bits";
import { PosterCard } from "./home";
import { Icon } from "./icons";
import { screenId, together } from "./party";

/*
 * 友 Friends on the web (lib/watch/friends.ts has the rules): what friends
 * are watching now and where they are in things, asking to join them, and
 * going invisible. The phone app has the same page.
 */

export function Face({ person, className }: { person: Person; className?: string }) {
  return <span className={cx("kw-face-s", className)} style={{ background: faceOf(person.username) }}>
    {person.picture
      // eslint-disable-next-line @next/next/no-img-element -- the Portal's own portrait
      ? <img src={person.picture} alt="" /> : initial(person)}
  </span>;
}

export function ago(at: number) {
  const min = Math.max(0, Math.floor((Date.now() - at) / 60_000));
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`;
  if (min < 48 * 60) return "yesterday";
  return `${Math.floor(min / (24 * 60))} days ago`;
}

/** Invisible: friends don't see you watching, can't ask to join, and what you watch meanwhile stays yours. */
export function InvisibleButton() {
  const watch = useWatch();
  const on = watch.prefs?.invisible === true;
  return <button className={cx("kw-btn", on ? "kw-primary" : "kw-tonal", "kw-invis")} aria-pressed={on} onClick={() => void watch.updatePrefs({ invisible: !on }).then((ok) => ok && watch.toast(on ? "Friends can see you again" : "You're invisible"))}>
    <Icon name={on ? "check" : "group"} />{on ? "Invisible" : "Go invisible"}
  </button>;
}

export function FriendsPage({ onJoin }: { onJoin: (partyId: string) => void }) {
  const watch = useWatch();
  const [page, setPage] = useState<Page | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState<JoinAsk | null>(null);
  const askingRef = useRef(asking);
  useEffect(() => { askingRef.current = asking; }, [asking]);

  const load = useCallback(() => friendsApi.page().then((p) => {
    setPage(p); setProblem(null);
    if (!askingRef.current) setAsking(p.outgoing.find((a) => a.answer === "waiting") ?? null);
  }, (error: unknown) => setProblem(error instanceof Error ? error.message : "Friends didn't load.")), []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  /* Waiting on an answer: a yes goes straight into their party. */
  useEffect(() => {
    if (!asking) return;
    const timer = setInterval(() => {
      friendsApi.asks().then((a) => {
        const now = a.outgoing.find((x) => x.id === asking.id);
        const name = (asking.name || asking.to).split(" ")[0];
        if (!now) { watch.toast(`${name} didn't answer`); setAsking(null); }
        else if (now.answer === "yes" && now.partyId) { setAsking(null); onJoin(now.partyId); }
        else if (now.answer === "no") { watch.toast(`${name} said not now`); setAsking(null); }
      }, () => {});
    }, 2500);
    return () => clearInterval(timer);
  }, [asking, onJoin, watch]);

  const change = (type: "ask" | "yes" | "no" | "remove", username: string) =>
    friendsApi.change(type, username).catch((error: unknown) => watch.toast(error instanceof Error ? error.message : "That didn't work.")).then(() => load());
  const ask = (f: Friend) => friendsApi.askToJoin(f.username).then(setAsking, (error: unknown) => watch.toast(error instanceof Error ? error.message : "That didn't send."));
  const cancel = (a: JoinAsk) => { setAsking(null); void friendsApi.cancel(a.id).catch(() => {}); };

  return <main className="kw-page kw-friends">
    <div className="kw-fr-head"><h1>Friends</h1><InvisibleButton /></div>
    {!page ? (problem ? <p className="kw-empty">{problem}</p> : <div className="kw-fr-list">{Array.from({ length: 3 }, (_, i) => <div key={i} className="kw-sk" style={{ height: 120, borderRadius: 14 }} />)}</div>)
      : <>
        {page.asked.length ? <section><h2>Asked to be friends</h2>{page.asked.map((p) => <div key={p.username} className="kw-fr-person">
          <Face person={p} /><b>{p.name || p.username}</b>
          <button className="kw-btn kw-tonal" onClick={() => void change("no", p.username)}>Not now</button>
          <button className="kw-btn kw-primary" onClick={() => void change("yes", p.username)}><Icon name="check" />Accept</button>
        </div>)}</section> : null}
        <div className="kw-fr-list">
          {page.friends.length ? page.friends.map((f) => <FriendCard key={f.username} f={f} asking={asking?.to === f.username ? asking : null} onAsk={() => void ask(f)} onCancel={cancel}
            onRemove={() => { if (confirm(`Remove ${f.name || f.username}? You'll stop seeing what each other watches.`)) void change("remove", f.username); }} />)
            : <p className="kw-empty">Add friends to see what they&rsquo;re watching.</p>}
        </div>
        {page.people.length || page.asking.length ? <section><h2>Add friends</h2>
          {page.asking.map((p) => <div key={p.username} className="kw-fr-person"><Face person={p} /><b>{p.name || p.username}</b>
            <button className="kw-btn kw-tonal" onClick={() => void change("remove", p.username)}><Icon name="check" />Asked</button></div>)}
          {page.people.map((p) => <div key={p.username} className="kw-fr-person"><Face person={p} /><b>{p.name || p.username}</b>
            <button className="kw-btn kw-tonal" onClick={() => void change("ask", p.username)}><Icon name="add" />Add</button></div>)}
        </section> : null}
      </>}
  </main>;
}

function FriendCard({ f, asking, onAsk, onCancel, onRemove }: { f: Friend; asking: JoinAsk | null; onAsk: () => void; onCancel: (a: JoinAsk) => void; onRemove: () => void }) {
  const watch = useWatch();
  const now = f.now;
  const recent = f.recent.filter((s) => s.title.id !== now?.title.id);
  return <article className="kw-fr-card">
    <div className="kw-fr-top">
      <span className={cx("kw-fr-face", now && "kw-live")}><Face person={f} /></span>
      <div className="kw-fr-who"><b>{f.name || f.username}</b>
        <span className={cx(now && "kw-on")}>{!f.sharing ? "Keeps what they watch to themselves" : now ? "Watching now" : f.recent.length ? `Watched ${ago(f.recent[0].at)}` : "Hasn't watched anything yet"}</span></div>
      {now ? (asking ? <button className="kw-btn kw-tonal" onClick={() => onCancel(asking)}>Asking…</button>
        : <button className="kw-btn kw-primary" onClick={onAsk}><Icon name="group" />Ask to join</button>) : null}
      <button className="kw-iconbtn" aria-label={`Remove ${f.name || f.username}`} title="Remove" onClick={onRemove}><Icon name="close" /></button>
    </div>
    {now ? <button className="kw-fr-now" onClick={() => watch.openTitle(now.title.id)}>
      <span className="kw-th"><Img src={now.title.backdrop ?? now.title.poster} /><span className="kw-bar"><i style={{ width: `${now.progress * 100}%` }} /></span></span>
      <span><b>{now.title.name}</b><small>{[now.label, now.partyId ? "together" : null].filter(Boolean).join(" · ") || now.title.shelf}</small></span>
    </button> : null}
    {recent.length ? <div className="kw-fr-recent">{recent.map((s) => <div key={s.title.id}>
      <div className="kw-fr-poster"><PosterCard card={s.title} plain poster />{!s.finished ? <span className="kw-bar"><i style={{ width: `${s.progress * 100}%` }} /></span> : null}</div>
      <small>{s.finished ? (s.label ? `${s.label} · done` : "Finished") : s.label ?? `${Math.round(s.progress * 100)}% in`}</small>
    </div>)}</div> : null}
  </article>;
}

/** Friends whose place is this episode (or film): their faces and "Sami is here". */
export function FriendsAt({ friends }: { friends: FriendHere[] }) {
  if (!friends.length) return null;
  const first = (friends[0].name || friends[0].username).split(" ")[0];
  const text = friends.length === 1 ? (friends[0].now ? `${first} is watching it now` : `${first} is here`)
    : friends.length === 2 ? `${first} and ${(friends[1].name || friends[1].username).split(" ")[0]} are here` : `${first} and ${friends.length - 1} others are here`;
  return <span className="kw-here"><span className="kw-here-faces">{friends.slice(0, 3).map((f) => <Face key={f.username} person={f} />)}</span>{text}</span>;
}

/** Friends' places in a title, for its page. */
export function FriendsHere({ friends, film }: { friends: FriendHere[]; film: boolean }) {
  if (!friends.length) return null;
  return <div className="kw-fr-here">{friends.slice(0, 4).map((f) => <div key={f.username}>
    <Face person={f} />
    <span><b>{(f.name || f.username).split(" ")[0]}</b> · {f.now ? ["watching now", f.label].filter(Boolean).join(", ") : f.finished && (film || !f.label) ? "watched it" : f.finished ? `finished ${f.label}` : f.label ? `on ${f.label}` : `${Math.round(f.progress * 100)}% in`}</span>
    {!f.finished ? <span className="kw-bar"><i style={{ width: `${f.progress * 100}%` }} /></span> : null}
  </div>)}{friends.length > 4 ? <small>and {friends.length - 4} more friends</small> : null}</div>;
}

/**
 * "Sami wants to join", over the player: Let in brings them into the party
 * this tab is in, or starts one from here with them invited and moves the
 * player into it. Asked every 6 s while the player is open.
 */
export function JoinAsks({ open, partyOf, where, onJoin }: { open: boolean; partyOf: () => string | null; where: () => { titleId: string; season: number; episode: number; position: number } | null; onJoin: (partyId: string) => void }) {
  const watch = useWatch();
  const [ask, setAsk] = useState<JoinAsk | null>(null);
  const [busy, setBusy] = useState(false);
  const handled = useRef(new Set<string>());
  useEffect(() => {
    if (!open) return;
    const look = () => friendsApi.asks().then((a) => setAsk(a.incoming.find((x) => !handled.current.has(x.id)) ?? null), () => {});
    void look();
    const timer = setInterval(look, 6_000);
    return () => clearInterval(timer);
  }, [open]);
  if (!ask || !open) return null;
  const answer = async (yes: boolean) => {
    if (busy) return;
    setBusy(true);
    handled.current.add(ask.id);
    try {
      if (!yes) await friendsApi.answer(ask.id, false);
      else {
        const joined = partyOf();
        if (joined) await friendsApi.answer(ask.id, true, joined);
        else {
          const here = where();
          if (!here) throw new Error("Nothing's playing.");
          const state = await together.create({ ...here, client: screenId(), invite: [ask.from] });
          await friendsApi.answer(ask.id, true, state.id);
          onJoin(state.id);
        }
      }
    } catch (error) { watch.toast(error instanceof Error ? error.message : "That didn't work."); }
    setAsk(null); setBusy(false);
  };
  const party = partyOf();
  return <div className="kw-invite kw-ask" role="status">
    <Face person={{ username: ask.from, name: ask.name, picture: ask.picture }} />
    <div><b>{(ask.name || ask.from).split(" ")[0]} wants to join</b><span>{party ? "Into this party" : "Watch together from here"}</span></div>
    <button className="kw-btn kw-tonal" onClick={() => void answer(false)}>Not now</button>
    <button className="kw-btn kw-primary" onClick={() => void answer(true)}><Icon name="group" />{busy ? "…" : "Let in"}</button>
  </div>;
}

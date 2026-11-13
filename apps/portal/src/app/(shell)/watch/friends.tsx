"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { friendsApi, type Friend, type FriendHere, type FriendsPage as Page, type JoinAsk, type Person } from "./api";
import { cx, faceOf, Img, initial, Rail, useWatch } from "./bits";
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

/** Friends' page, asked again every 15 s; an ask to join followed every 2.5 s until answered (a yes goes to [onJoin]). */
function useFriends(onJoin: (partyId: string) => void) {
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
  return { page, problem, asking, change, ask, cancel };
}

export function FriendsPage({ onJoin }: { onJoin: (partyId: string) => void }) {
  const { page, problem, asking, change, ask, cancel } = useFriends(onJoin);

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

/**
 * Friends on Home, the way a game launcher shows them: a row of round faces
 * with names, a ring and the title under whoever's watching now (they come
 * first), and a + to add friends. A face opens a card: what they're on, Ask
 * to join, Open.
 */
export function FriendsRow({ onJoin, onAll }: { onJoin: (partyId: string) => void; onAll: () => void }) {
  const watch = useWatch();
  const { page, asking, ask, cancel } = useFriends(onJoin);
  const [picked, setPicked] = useState<{ f: Friend; x: number; y: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!picked) return;
    const away = (event: PointerEvent) => { if (!card.current?.contains(event.target as Node) && !(event.target as Element).closest?.(".kw-frt")) setPicked(null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setPicked(null); };
    const gone = () => setPicked(null);
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", gone);
    document.addEventListener("scroll", gone, true);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", key); window.removeEventListener("resize", gone); document.removeEventListener("scroll", gone, true); };
  }, [picked]);
  if (!page || watch.prefs?.friendsOnHome === false) return null;
  const friends = page.friends.filter((f) => f.sharing);
  const live = friends.filter((f) => f.now).length;
  const f = picked ? friends.find((x) => x.username === picked.f.username) ?? picked.f : null;
  const now = f?.now, last = f?.recent[0];
  const mine = f && asking?.to === f.username ? asking : null;
  return <section className="kw-row kw-frrow">
    <h2>Friends{friends.length ? <span className="kw-fr-count"> ({live ? `${live} watching` : friends.length})</span> : null}<button className="kw-fr-hide" onClick={() => void watch.updatePrefs({ friendsOnHome: false }).then((ok) => ok && watch.toast("Friends hidden from Home. Settings › Friends brings them back"))}>Hide</button><button className="kw-fr-all" onClick={onAll}>See all</button></h2>
    <Rail label="Friends">
      <button className="kw-frt kw-frt-add" onClick={onAll}><span className="kw-frt-ring"><Icon name="add" /></span><b>{friends.length ? "Add" : "Add friends"}</b></button>
      {friends.map((x) => <button key={x.username} className={cx("kw-frt", x.now && "kw-live")} aria-expanded={picked?.f.username === x.username}
        onClick={(event) => {
          if (picked?.f.username === x.username) { setPicked(null); return; }
          const r = event.currentTarget.getBoundingClientRect();
          setPicked({ f: x, x: Math.min(Math.max(16, r.left + r.width / 2 - 150), window.innerWidth - 316), y: r.bottom + 8 });
        }}>
        <span className="kw-frt-ring"><Face person={x} /></span>
        <b>{(x.name || x.username).split(" ")[0]}</b>
        <small>{x.now ? x.now.title.name : x.recent[0] ? ago(x.recent[0].at) : ""}</small>
      </button>)}
    </Rail>
    {f && picked ? createPortal(<div ref={card} className="kw-frpop" style={{ left: picked.x, top: picked.y }} role="dialog" aria-label={f.name || f.username}>
      <div className="kw-frpop-who"><span className={cx("kw-frt-ring", now && "kw-live")}><Face person={f} /></span>
        <span><b>{f.name || f.username}</b><small className={cx(now && "kw-on")}>{now ? "Watching now" : last ? `Watched ${ago(last.at)}` : "Hasn't watched anything yet"}</small></span></div>
      {now || last ? <button className="kw-frpop-what" onClick={() => { setPicked(null); watch.openTitle((now ?? last)!.title.id); }}>
        <span className="kw-th"><Img src={(now ?? last)!.title.backdrop ?? (now ?? last)!.title.poster} /><span className="kw-bar"><i style={{ width: `${((now ?? last)!.progress) * 100}%` }} /></span></span>
        <span><b>{(now ?? last)!.title.name}</b><small>{(now ?? last)!.label ?? ((now ?? last)!.finished ? "Finished" : `${Math.round((now ?? last)!.progress * 100)}% in`)}</small></span>
      </button> : null}
      <div className="kw-frpop-acts">
        {now ? (mine ? <button className="kw-btn kw-tonal" onClick={() => cancel(mine)}>Asking…</button>
          : <button className="kw-btn kw-primary" onClick={() => void ask(f)}><Icon name="group" />Ask to join</button>) : null}
        {now || last ? <button className="kw-btn kw-tonal" onClick={() => { setPicked(null); watch.openTitle((now ?? last)!.title.id); }}><Icon name="info" />Open</button> : null}
      </div>
    </div>, document.querySelector(".kw") ?? document.body) : null}
  </section>;
}

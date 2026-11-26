"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx, InkPortraitFrame, Seal, SectionHeader } from "@kimono/ui";
import { Portrait } from "@/components/portrait";
import { useCrossTo } from "@/components/crossing";
import type { ChatLine, PartyView } from "@/lib/music/party";
import { byline, share, type Person, type Track } from "./api";
import { Icon } from "./icons";
import { Cover } from "./parts";
import { clientId, PartyPlayer } from "./party-client";
import { usePlayer, type Remote } from "./player";

/*
 * 共 Listening together, as you see it: the party you're in (who's here, the
 * chat, reactions floating up), starting one with friends, and joining one
 * from its link or a friend's card. While you're in one, the player's
 * controls act on the party (./player.tsx `setRemote`), so play, skip and
 * "add to queue" work as always and everyone hears it.
 */

/* The party's own marks, as Material draws them. */
const partyPaths = {
  people: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
  check: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  send: "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z",
} as const;
function PartyIcon({ name, className }: { name: keyof typeof partyPaths; className?: string }) {
  return <svg className={["km-icon", className].filter(Boolean).join(" ")} viewBox="0 0 24 24" aria-hidden="true"><path d={partyPaths[name]} /></svg>;
}

export const reactionsOffered = ["❤️", "🔥", "😂", "😮", "🕺", "👏"] as const;
type Floating = { id: number; emoji: string; who: string; x: number };

type PartyState = {
  view: PartyView | null;
  chat: ChatLine[];
  people: Map<string, Person>;
  floating: Floating[];
  open: boolean;
  setOpen(open: boolean): void;
  unread: number;
  start(invite: string[]): Promise<void>;
  join(id: string): Promise<void>;
  leave(): void;
  end(): void;
  react(emoji: string): void;
  say(text: string): void;
  invite(usernames: string[]): void;
  person(username: string): Person;
};

const PartyContext = createContext<PartyState | null>(null);
export const useParty = () => {
  const p = useContext(PartyContext);
  if (!p) throw new Error("useParty outside PartyProvider");
  return p;
};

/* Your friends, for inviting: Kimono's friends list. */
async function friendsList(): Promise<Person[]> {
  const res = await fetch("/api/v1/friends").catch(() => null);
  const body = res?.ok ? await res.json().catch(() => null) as { friends?: Person[] } | null : null;
  return body?.friends ?? [];
}

export function PartyProvider({ children }: { children: ReactNode }) {
  const p = usePlayer();
  const crossTo = useCrossTo();
  const player = useRef<PartyPlayer | null>(null);
  const [view, setView] = useState<PartyView | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const [floating, setFloating] = useState<Floating[]>([]);
  const [open, setOpenState] = useState(false);
  const [unread, setUnread] = useState(0);
  const openRef = useRef(open);
  const floated = useRef(0);

  const setOpen = useCallback((o: boolean) => { openRef.current = o; setOpenState(o); if (o) setUnread(0); }, []);

  const know = useCallback((list: Person[]) => setPeople((m) => { const n = new Map(m); for (const x of list) n.set(x.username, x); return n; }), []);

  const stop = useCallback(() => {
    const was = player.current?.view;
    player.current?.stop();
    player.current = null;
    p.setRemote(null);
    /* What the party was playing stays yours, where it was. */
    if (was?.tracks.length) p.adopt(was.tracks, was.index, { kind: "party", id: was.id, title: "Listening together" });
    setView(null); setChat([]); setFloating([]); setOpen(false);
  }, [p, setOpen]);

  const join = useCallback(async (id: string) => {
    if (player.current?.id === id) { setOpen(true); return; }
    player.current?.stop();
    const audio = p.audioElement();
    if (!audio) return;
    const pp = new PartyPlayer(id, clientId(), audio, {
      view: (v) => setView(v),
      chat: (lines, fresh) => { setChat((c) => fresh ? [...c, ...lines] : lines); if (fresh && !openRef.current) setUnread((u) => u + lines.length); },
      react: (username, emoji) => {
        const id2 = ++floated.current;
        setFloating((f) => [...f.slice(-12), { id: id2, emoji, who: username, x: 10 + Math.random() * 80 }]);
        setTimeout(() => setFloating((f) => f.filter((x) => x.id !== id2)), 2600);
      },
      people: know,
      ended: () => { stop(); p.say("The listen party ended."); },
      problem: (text) => p.say(text),
    });
    player.current = pp;
    await pp.start();
    setOpen(true);
  }, [p, know, stop, setOpen]);

  const start = useCallback(async (invite: string[]) => {
    const tracks = p.tracks.length ? p.tracks.slice(p.index) : [];
    if (!tracks.length) { p.say("Play something first."); return; }
    const res = await fetch("/api/v1/music/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keys: tracks.map((t) => t.key), index: 0, position: p.position(), invite }) }).catch(() => null);
    const body = res ? await res.json().catch(() => null) as { id?: string; error?: string } | null : null;
    if (!res?.ok || !body?.id) { p.say(body?.error ?? "The party didn't start."); return; }
    await join(body.id);
    crossTo("kakejiku", `/music/party/${body.id}`);
  }, [p, join, crossTo]);

  const leave = useCallback(() => { void player.current?.send({ type: "leave" }); stop(); }, [stop]);
  const end = useCallback(() => { void player.current?.send({ type: "end" }); stop(); }, [stop]);
  const react = useCallback((emoji: string) => void player.current?.send({ type: "react", emoji }), []);
  const say = useCallback((text: string) => void player.current?.send({ type: "chat", text }), []);
  const invite = useCallback((usernames: string[]) => void player.current?.send({ type: "invite", usernames }).then((ok) => ok && p.say("Asked along")), [p]);

  /* The player's controls act on the party: rebuilt with each state it sends, so the queue it shows is the party's. */
  const setRemote = p.setRemote;
  const tell = p.say;
  useEffect(() => {
    const pp = player.current;
    if (!pp || !view) return;
    const remote: Remote = {
      tracks: view.tracks, index: view.index, source: { kind: "party", id: view.id, title: "Listening together" },
      toggle: () => void pp.send({ type: pp.view?.playing || pp.view?.waiting ? "pause" : "play" }),
      next: () => void pp.send({ type: "next" }),
      prev: () => void pp.send({ type: "prev" }),
      seek: (s) => void pp.send({ type: "seek", position: s }),
      jump: (i) => void pp.send({ type: "jump", index: i }),
      play: (list, start) => void pp.send({ type: "replace", keys: list.slice(start).map((t) => t.key) }),
      playNext: (list) => void pp.send({ type: "add", where: "next", keys: list.map((t) => t.key) }).then((ok) => { if (ok) tell(list.length === 1 ? `“${list[0].title}” plays next for everyone` : `${list.length} songs play next`); }),
      addToQueue: (list) => void pp.send({ type: "add", where: "end", keys: list.map((t) => t.key) }).then((ok) => { if (ok) tell(list.length === 1 ? `“${list[0].title}” added for everyone` : `${list.length} songs added`); }),
      remove: (i) => void pp.send({ type: "remove", index: i }),
      move: (from, to) => void pp.send({ type: "move", from, to }),
    };
    setRemote(remote);
  }, [view, setRemote, tell]);

  /* Names and faces for everyone who shows up. */
  useEffect(() => {
    if (!view) return;
    const missing = [view.host, ...view.members.map((m) => m.username)].filter((u) => !people.has(u));
    if (!missing.length || !player.current) return;
    fetch(`/api/v1/music/party/${encodeURIComponent(player.current.id)}`).then((r) => r.json()).then((b: { people?: Person[] }) => { if (b.people) know(b.people); }).catch(() => null);
  }, [view, people, know]);

  useEffect(() => () => { player.current?.stop(); }, []);

  const person = useCallback((u: string) => people.get(u) ?? { username: u, name: u, picture: null }, [people]);
  const value = useMemo<PartyState>(() => ({ view, chat, people, floating, open, setOpen, unread, start, join, leave, end, react, say, invite, person }),
    [view, chat, people, floating, open, setOpen, unread, start, join, leave, end, react, say, invite, person]);
  return <PartyContext.Provider value={value}>{children}<PartyDock /></PartyContext.Provider>;
}

/* ── Faces ─────────────────────────────────────────────────────────────── */

export function Faces({ people, size = 28, max = 4 }: { people: Person[]; size?: number; max?: number }) {
  return <span className="km-faces">
    {people.slice(0, max).map((x) => <Portrait key={x.username} name={x.name} username={x.username} picture={x.picture} size={size} />)}
    {people.length > max ? <span className="km-faces-more">+{people.length - max}</span> : null}
  </span>;
}

/* ── Starting one ──────────────────────────────────────────────────────── */

/** "Listen together": picks friends to ask along, and starts the party from what's playing. */
export function ListenTogether({ className, labelled = true }: { className?: string; labelled?: boolean }) {
  const party = useParty();
  const p = usePlayer();
  const [asking, setAsking] = useState(false);
  if (party.view) return <Seal tone="quiet" compact className={cx("km-seal-icon km-on", className)} onClick={() => party.setOpen(true)}><PartyIcon name="people" />{labelled ? "Listening together" : null}</Seal>;
  return <>
    <Seal tone="quiet" compact className={cx("km-seal-icon", className)} disabled={!p.current} title="Listen together" onClick={() => setAsking(true)}><PartyIcon name="people" />{labelled ? "Listen together" : null}</Seal>
    {asking ? <InviteDialog title="Listen together" action="Start" onDone={async (who) => { setAsking(false); if (who) await party.start(who); }} /> : null}
  </>;
}

/** Friends to ask along, ticked. Answers who, or null when it's put away. */
function InviteDialog({ title, action, onDone, exclude = [] }: { title: string; action: string; onDone: (who: string[] | null) => void; exclude?: string[] }) {
  const box = useRef<HTMLDialogElement>(null);
  const [friends, setFriends] = useState<Person[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => { box.current?.showModal(); void friendsList().then((f) => setFriends(f.filter((x) => !exclude.includes(x.username)))); }, [exclude]);
  return createPortal(<dialog ref={box} className="km-ask km-invite" onClose={() => onDone(null)} onClick={(e) => { if (e.target === box.current) box.current?.close(); }}>
    <form method="dialog" onSubmit={(e) => { e.preventDefault(); const who = [...picked]; box.current?.close(); onDone(who); }}>
      <h2 className="km-ask-title">{title}</h2>
      {friends === null ? <p className="km-ask-text">…</p> : friends.length ? <div className="km-invite-list">
        {friends.map((f) => <label key={f.username} className={cx("km-invite-row", picked.has(f.username) && "km-on")}>
          <input type="checkbox" checked={picked.has(f.username)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(f.username); else n.delete(f.username); return n; })} />
          <Portrait name={f.name} username={f.username} picture={f.picture} size={36} /><span>{f.name}</span>
          <PartyIcon name="check" className="km-invite-tick" />
        </label>)}
      </div> : <p className="km-ask-text">Your friends can join from the link too.</p>}
      <div className="k-seal-group km-ask-actions">
        <Seal type="submit">{action}</Seal>
        <Seal type="button" tone="quiet" onClick={() => box.current?.close()}>Cancel</Seal>
      </div>
    </form>
  </dialog>, document.querySelector(".app-frame") ?? document.body);
}

/* ── The party you're in ───────────────────────────────────────────────── */

function PartyDock() {
  const party = useParty();
  const p = usePlayer();
  const [text, setText] = useState("");
  const [inviting, setInviting] = useState(false);
  const lines = useRef<HTMLDivElement>(null);
  useEffect(() => { lines.current?.scrollTo({ top: lines.current.scrollHeight }); }, [party.chat, party.open]);
  if (!party.view) return null;
  const v = party.view;
  const here = v.members.map((m) => party.person(m.username));
  const host = party.person(v.host);
  const mine = v.host === p.you.username;
  const song = v.tracks[v.index] as Track | undefined;
  const frame = document.querySelector(".app-frame") ?? document.body;
  return createPortal(<>
    <button type="button" className={cx("km-party-chip", party.open && "km-on")} onClick={() => party.setOpen(!party.open)} aria-expanded={party.open}>
      <Faces people={here} size={26} />
      <span>{v.waiting ? "Getting the next song…" : "Listening together"}</span>
      {party.unread ? <span className="km-party-unread">{party.unread}</span> : null}
    </button>
    <div className="km-party-floats" aria-hidden="true">{party.floating.map((f) => <span key={f.id} style={{ left: `${f.x}%` }}>{f.emoji}</span>)}</div>
    {party.open ? <aside className="km-party" aria-label="Listen party">
      <header>
        <div>
          <SectionHeader title="Listening together" />
          <p className="km-party-host">{mine ? "Your party" : `${host.name.split(/\s+/)[0]}'s party`}{song ? <> · {song.title}</> : null}</p>
        </div>
        <button type="button" className="km-iconbtn" aria-label="Close" onClick={() => party.setOpen(false)}><Icon name="close" /></button>
      </header>
      <div className="km-party-people">
        {here.map((x) => <span key={x.username} className={cx("km-party-person", v.members.find((m) => m.username === x.username)?.state === "loading" && "km-loading-person")} title={x.name}>
          <InkPortraitFrame seed={x.username} weight={3}><Portrait name={x.name} username={x.username} picture={x.picture} size={40} /></InkPortraitFrame>
          <small>{x.username === p.you.username ? "You" : x.name.split(/\s+/)[0]}</small>
        </span>)}
        <button type="button" className="km-party-add" onClick={() => setInviting(true)} aria-label="Ask friends along"><Icon name="add" /><small>Invite</small></button>
      </div>
      <div className="km-party-reacts" role="group" aria-label="React">
        {reactionsOffered.map((e) => <button key={e} type="button" onClick={() => party.react(e)} aria-label={`React ${e}`}>{e}</button>)}
      </div>
      <div ref={lines} className="km-party-chat">
        {party.chat.length ? party.chat.map((l) => { const who = party.person(l.username); return <p key={l.id} className={cx(l.username === p.you.username && "km-mine")}>
          <Portrait name={who.name} username={who.username} picture={who.picture} size={24} /><span><b>{who.name.split(/\s+/)[0]}</b> {l.text}</span>
        </p>; }) : <p className="km-party-quiet">Say something to everyone here.</p>}
      </div>
      <form className="km-party-say" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { party.say(text); setText(""); } }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={400} placeholder="Message" aria-label="Message the party" />
        <button type="submit" className="km-iconbtn" aria-label="Send" disabled={!text.trim()}><PartyIcon name="send" /></button>
      </form>
      <footer>
        <button type="button" className="km-pillbtn" onClick={async () => { const said = await share(`/music/party/${v.id}`, "Listen together on Kimono"); if (said) p.say(said); }}><Icon name="share" /><span>Link</span></button>
        <span className="km-grow" />
        {mine ? <button type="button" className="km-pillbtn km-danger" onClick={party.end}><span>End for everyone</span></button> : null}
        <button type="button" className="km-pillbtn" onClick={party.leave}><span>Leave</span></button>
      </footer>
    </aside> : null}
    {inviting ? <InviteDialog title="Ask friends along" action="Ask" exclude={v.members.map((m) => m.username)} onDone={(who) => { setInviting(false); if (who?.length) party.invite(who); }} /> : null}
  </>, frame);
}

/* ── A party's own page: its link opens here ───────────────────────────── */

type PartyPeek = { state: PartyView; people: Person[] };

export function PartyPageView({ id }: { id: string }) {
  const party = useParty();
  const [peek, setPeek] = useState<PartyPeek | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/v1/music/party/${encodeURIComponent(id)}`).then(async (r) => {
      const b = await r.json().catch(() => null) as (PartyPeek & { error?: string }) | null;
      if (!live) return;
      if (!r.ok || !b?.state) setProblem(b?.error ?? "This listen party has ended."); else setPeek(b);
    }).catch(() => { if (live) setProblem("This listen party couldn't be reached."); });
    return () => { live = false; };
  }, [id]);
  const inIt = party.view?.id === id;
  if (problem) return <div className="km-page"><h1 className="km-page-title">{problem}</h1></div>;
  if (!peek) return <div className="km-page" />;
  const v = inIt ? party.view! : peek.state;
  const host = peek.people.find((x) => x.username === v.host) ?? { username: v.host, name: v.host, picture: null };
  const song = v.tracks[v.index];
  const here = v.members.map((m) => peek.people.find((x) => x.username === m.username) ?? party.person(m.username));
  return <div className="km-page km-party-page">
    <header className="km-head">
      <div className="km-head-art"><Cover src={song?.album?.cover} quality="full" className="km-head-cover" /></div>
      <div className="km-head-text">
        <span className="k-label">{host.name.split(/\s+/)[0]}&rsquo;s listen party</span>
        <h1 className="km-head-title">{song?.title ?? "Listening together"}</h1>
        {song ? <p className="km-head-meta">{byline(song)}</p> : null}
        {here.length ? <p className="km-head-meta"><Faces people={here} size={28} /> {here.length === 1 ? "1 here" : `${here.length} here`}</p> : null}
        <div className="km-head-actions">
          {inIt ? <Seal tone="quiet" onClick={() => party.setOpen(true)}><PartyIcon name="people" />You&rsquo;re in</Seal>
            : <Seal onClick={() => void party.join(id)}><Icon name="play" />Join</Seal>}
        </div>
      </div>
    </header>
    {v.tracks.length > v.index + 1 ? <section>
      <SectionHeader title="Up next" />
      <ol className="km-party-next">{v.tracks.slice(v.index + 1, v.index + 21).map((t, i) => <li key={`${t.key}-${i}`}><Cover src={t.album?.cover} size={44} /><span><b>{t.title}</b><small>{byline(t)}</small></span></li>)}</ol>
    </section> : null}
  </div>;
}

/* ── On a friend's card ────────────────────────────────────────────────── */

export type FriendParty = { id: string; host: Person; invited: boolean; members: Person[]; song: Track | null };

/** The parties you could join now (yours, ones you're asked to, friends' open ones). */
export function useFriendParties() {
  const [parties, setParties] = useState<FriendParty[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/v1/music/party").then((r) => r.json()).then((b: { parties?: FriendParty[] }) => { if (live) setParties(b.parties ?? []); }).catch(() => null);
    void load();
    const t = setInterval(load, 30_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return parties;
}

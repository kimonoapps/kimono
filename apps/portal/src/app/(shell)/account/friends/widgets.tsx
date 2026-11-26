"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { InkPortraitFrame, Seal, InkMeter, InkWave } from "@kimono/ui";
import { Crossing } from "@/components/crossing";
import { InkSheet } from "@/components/ink-sheet";
import { LineIcon, type LineIconName } from "@/components/line-icon";
import { Portrait } from "@/components/portrait";
import { Book3D } from "../../books/book3d";
import { LinkMark } from "./link-marks";

/*
 * 庭 A profile's home screen: widgets someone arranges and sizes as they
 * like (small, wide, large, the full row), drawn from what they do in
 * Kimono: the record on the turntable, the book on the go, their favourite
 * song, a note, their time of day. What friends can't see (Who sees what)
 * never reaches a widget: the server leaves it out of the profile.
 */

export type WidgetKind = "listening" | "song" | "album" | "artists" | "playlist" | "loved" | "onrepeat"
  | "reading" | "book" | "review" | "bookshelf" | "yearbooks"
  | "watching" | "show" | "watched"
  | "stats" | "note" | "status" | "clock" | "links" | "friends" | "countdown" | "quote";
export type WidgetSize = "s" | "m" | "l" | "xl";
export type Widget = { id: string; kind: WidgetKind; size: WidgetSize; config?: Record<string, string> };

type Person = { username: string; name: string; picture: string | null };
type Item = { app: string; itemId: string; title: string; subtitle: string | null; cover: string | null; href?: string | null; progress?: number | null; at?: number | null; wide?: string | null; spot?: { part: number; episode?: number; of?: number; screen?: "phone" | "computer" | "tv"; live?: boolean } | null };
type Section = { app: string; kind: string; title: string; items: Item[] };
type Track = { key: string; title: string; artists: { key: string; name: string }[]; album: { key: string; title: string; cover: string | null } | null };
export type MusicExtras = { listening: { track: Track; at: string; live: boolean } | null; plays: number; minutes: number; artists: { key: string; name: string; picture: string | null; plays?: number }[]; counts?: Record<string, number>; onRepeat?: { track: Track; plays: number } | null } | null;
type ReadBook = { key: string; title: string; author: string; cover: string | null; rating: "down" | "up" | "love" | null; at: number };
export type BooksExtras = { reviews: (ReadBook & { review: string })[]; read: ReadBook[] } | null;

export type BoardData = {
  person: Person;
  sections: Section[];
  links: { title: string; url: string; icon?: string; show?: LinkShow }[];
  friends: Person[];
  music: MusicExtras;
  books?: BooksExtras;
  color: string;
  /** Your own profile, not seen as a friend: friend requests waiting, whether friends see your friends, the rows you keep to yourself ("watch:watching") and how to share one. */
  own?: { asking: number; kept: boolean; keptRows?: string[]; friendsOnlyRows?: string[]; publicProfile?: boolean; onShare?: (row: string, to: "friends" | "everyone") => void };
};

const kinds: { kind: WidgetKind; name: string; says: string; icon: LineIconName; sizes: WidgetSize[]; size: WidgetSize }[] = [
  { kind: "listening", name: "Now playing", says: "What you're playing, the record sliding out of its sleeve while you listen", icon: "music", sizes: ["s", "m", "l", "xl"], size: "l" },
  { kind: "song", name: "Favourite song", says: "One song to sum you up", icon: "music", sizes: ["s", "m", "l"], size: "m" },
  { kind: "album", name: "Favourite album", says: "The record you'd take to an island", icon: "archive", sizes: ["s", "m", "l"], size: "l" },
  { kind: "onrepeat", name: "On repeat", says: "The song you can't stop playing this month", icon: "restore", sizes: ["s", "m"], size: "m" },
  { kind: "playlist", name: "A playlist", says: "One of yours, for friends to play", icon: "music", sizes: ["s", "m", "l"], size: "m" },
  { kind: "loved", name: "Loved songs", says: "The songs you've loved, stacked", icon: "music", sizes: ["m", "l"], size: "m" },
  { kind: "artists", name: "Top artists", says: "Who you've played most this month", icon: "people", sizes: ["m", "l", "xl"], size: "m" },
  { kind: "reading", name: "Reading", says: "The book you're in, and how far", icon: "book", sizes: ["s", "m", "l"], size: "m" },
  { kind: "review", name: "Your review", says: "What you said about a book you read", icon: "book", sizes: ["m", "l", "xl"], size: "l" },
  { kind: "bookshelf", name: "Bookshelf", says: "What you've read, spine by spine", icon: "book", sizes: ["m", "l", "xl"], size: "xl" },
  { kind: "book", name: "Favourite book", says: "The one you press on everyone", icon: "book", sizes: ["s", "m", "l"], size: "m" },
  { kind: "yearbooks", name: "Year in books", says: "How many you've read this year", icon: "book", sizes: ["s", "m"], size: "s" },
  { kind: "watching", name: "Watching", says: "What's on, and how far", icon: "film", sizes: ["m", "l"], size: "m" },
  { kind: "watched", name: "Watched lately", says: "What you've seen, fanned out", icon: "film", sizes: ["m", "l", "xl"], size: "m" },
  { kind: "show", name: "Favourite film or show", says: "The one you'd watch again tonight", icon: "film", sizes: ["m", "l"], size: "l" },
  { kind: "stats", name: "Your month", says: "Songs, hours and books", icon: "clock", sizes: ["s", "m"], size: "s" },
  { kind: "note", name: "A note", says: "A few words, on paper", icon: "brush", sizes: ["s", "m", "l"], size: "s" },
  { kind: "quote", name: "A quote", says: "Words you live by", icon: "brush", sizes: ["m", "l", "xl"], size: "m" },
  { kind: "status", name: "Status", says: "How you are, in an emoji and a few words", icon: "bell", sizes: ["s", "m"], size: "s" },
  { kind: "countdown", name: "Countdown", says: "The days until something", icon: "clock", sizes: ["s", "m"], size: "s" },
  { kind: "clock", name: "Your time", says: "What time it is where you are", icon: "clock", sizes: ["s", "m"], size: "s" },
  { kind: "links", name: "Links", says: "Your links, at hand", icon: "link", sizes: ["m", "l", "xl"], size: "m" },
  { kind: "friends", name: "Friends", says: "Your friends' faces", icon: "people", sizes: ["m", "l"], size: "m" },
];
const kindOf = (k: WidgetKind) => kinds.find((x) => x.kind === k)!;
const sizeName: Record<WidgetSize, string> = { s: "Small", m: "Wide", l: "Large", xl: "Full" };

let made = 0;
const newId = () => `w${Date.now().toString(36)}${(made++).toString(36)}`;

/** A home screen for someone who hasn't arranged one: what they have, at sensible sizes. */
/** Friends are on every board unless taken off (kept as an `off` mark); never for a visitor when there are none. */
export function withFriends(ws: Widget[], d: BoardData): Widget[] {
  if (ws.some((w) => w.kind === "friends") || (!d.friends.length && !d.own)) return ws;
  return [...ws, { id: "friends", kind: "friends", size: "m" }];
}

/** The row of someone's activity a widget shows (lib/friends/model.ts rowsOf): kept to themselves, only they see it. */
const widgetRow: Partial<Record<WidgetKind, string>> = {
  listening: "music:playing", onrepeat: "music:stats", artists: "music:stats", stats: "music:stats", loved: "music:loved",
  reading: "books:reading", review: "books:reviews", bookshelf: "books:read", yearbooks: "books:read",
  watching: "watch:watching", watched: "watch:watched",
};

/** Whether a widget of their activity has anything in it for whoever's looking; those that don't aren't drawn for others. */
function hasData(w: Widget, d: BoardData): boolean {
  const has = (app: string, kind: string) => d.sections.some((s) => s.app === app && s.kind === kind && s.items.length);
  switch (w.kind) {
    case "listening": return Boolean(d.music?.listening);
    case "onrepeat": return Boolean(d.music?.onRepeat);
    case "artists": return Boolean(d.music?.artists.length);
    case "stats": return Boolean(d.music?.plays);
    case "loved": return has("music", "loved");
    case "reading": return has("books", "reading");
    case "review": return Boolean(d.books?.reviews.length);
    case "bookshelf": return Boolean(d.books?.read.length);
    case "watching": return has("watch", "watching");
    case "watched": return has("watch", "watched");
    case "links": return d.links.some(inLinks);
    default: return true;
  }
}

export function defaultWidgets(d: BoardData): Widget[] {
  const has = (app: string, kind: string) => d.sections.some((s) => s.app === app && s.kind === kind && s.items.length);
  const out: Widget[] = [];
  if (d.music?.listening) out.push({ id: "d-listening", kind: "listening", size: "l" });
  if (has("books", "reading")) out.push({ id: "d-reading", kind: "reading", size: "m" });
  if (has("watch", "watching")) out.push({ id: "d-watching", kind: "watching", size: "m" });
  if (d.music?.artists.length) out.push({ id: "d-artists", kind: "artists", size: "m" });
  if (d.links.length) out.push({ id: "d-links", kind: "links", size: d.links.length > 2 ? "l" : "m" });
  if (d.music?.plays) out.push({ id: "d-stats", kind: "stats", size: "s" });
  return out;
}

/* ── The board ─────────────────────────────────────────────────────────── */

export function WidgetBoard({ data, widgets, editable, arranging, onArranging, onEditLinks, onSave }: {
  data: BoardData; widgets: Widget[] | null; editable: boolean;
  /** Arranging is the profile's to turn on (its Arrange seal): Done there saves. */
  arranging: boolean; onArranging: (on: boolean) => void;
  /** Your own profile: the Links widget opens the links editor. */
  onEditLinks?: () => void;
  onSave: (w: Widget[]) => Promise<void>;
}) {
  /* A widget saved at a size its kind no longer comes in is shown at the nearest it does. */
  const shown = useMemo(() => withFriends(widgets ?? defaultWidgets(data), data).map((w) => (kindOf(w.kind).sizes.includes(w.size) ? w : { ...w, size: kindOf(w.kind).sizes[0] })), [widgets, data]);
  const [draft, setDraft] = useState<Widget[]>(shown);
  /* Arranging starts from what's shown (set while drawing, as React has it for a change from outside)… */
  const [was, setWas] = useState(arranging);
  if (was !== arranging) { setWas(arranging); if (arranging) setDraft(shown); }
  /* …and ends by saving what was arranged, once. */
  const saved = useRef({ arranging, draft, shown, onSave });
  useEffect(() => {
    const before = saved.current;
    if (before.arranging && !arranging && JSON.stringify(before.draft) !== JSON.stringify(before.shown)) {
      /* A clock is your time: one without a zone takes the one you're in. */
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      void before.onSave(before.draft.map((x) => (x.kind === "clock" && !x.config?.zone ? { ...x, config: { zone } } : x)));
    }
    saved.current = { arranging, draft, shown, onSave };
  }, [arranging, draft, shown, onSave]);
  const setArranging = onArranging;
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const list = (arranging ? draft : shown).filter((w) => !(w.kind === "friends" && w.config?.off) && (editable || hasData(w, data)));
  const keptRows = data.own?.keptRows ?? [];
  const friendsOnlyRows = data.own?.friendsOnlyRows ?? [];

  const start = () => setArranging(true);
  const resize = (id: string, size: WidgetSize) => setDraft((ws) => ws.map((w) => (w.id === id ? { ...w, size } : w)));
  const drop = (id: string) => setDraft((ws) => ws.flatMap((w) => (w.id !== id ? [w] : w.kind === "friends" ? [{ ...w, config: { off: "1" } }] : [])));
  const moveTo = (from: string, to: string) => setDraft((ws) => {
    const a = ws.findIndex((w) => w.id === from), b = ws.findIndex((w) => w.id === to);
    if (a < 0 || b < 0 || a === b) return ws;
    const out = [...ws]; const [w] = out.splice(a, 1); out.splice(b, 0, w); return out;
  });

  if (!list.length && !editable) return null;
  return <section className={`wg${arranging ? " is-arranging" : ""}`} aria-label="Home screen">
    <div className="wg-grid">
      {list.map((w, n) => <div key={w.id} className={`wg-cell wg-${w.size} wg-k-${w.kind}${dragging === w.id ? " is-dragging" : ""}`} style={{ "--n": n } as React.CSSProperties}
        draggable={arranging} onDragStart={(e) => { setDragging(w.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(e) => { if (arranging && dragging) { e.preventDefault(); moveTo(dragging, w.id); } }}
        onDragEnd={() => setDragging(null)}>
        <WidgetView w={w} d={data} onEditLinks={onEditLinks} />
        {/* Kept to yourself: said on the widget, with the way to share it right there. */}
        {!arranging && widgetRow[w.kind] && keptRows.includes(widgetRow[w.kind]!) ? <span className="wg-kept" title="Your privacy settings keep this to you">
          <LineIcon name="lock" /><span>{data.own?.publicProfile ? "Nobody else sees this" : "Friends don't see this"}</span>
          {data.own?.onShare ? <button type="button" onClick={() => data.own!.onShare!(widgetRow[w.kind]!, data.own?.publicProfile ? "everyone" : "friends")}>Share</button> : null}
        </span> : !arranging && widgetRow[w.kind] && friendsOnlyRows.includes(widgetRow[w.kind]!) ? <span className="wg-kept" title="Your privacy settings keep this to friends">
          <LineIcon name="lock" /><span>Public doesn&rsquo;t see this</span>
          {data.own?.onShare ? <button type="button" onClick={() => data.own!.onShare!(widgetRow[w.kind]!, "everyone")}>Share</button> : null}
        </span> : null}
        {arranging ? <div className="wg-edit">
          <button type="button" className="wg-x" aria-label={`Remove ${kindOf(w.kind).name}`} onClick={() => drop(w.id)}><LineIcon name="close" /></button>
          <span className="wg-sizes" role="group" aria-label="Size">
            {kindOf(w.kind).sizes.map((s) => <button key={s} type="button" aria-pressed={w.size === s} title={sizeName[s]} onClick={() => resize(w.id, s)}><i className={`wg-size-glyph wg-glyph-${s}`} /></button>)}
          </span>
        </div> : editable ? <button type="button" className="wg-arrange" onClick={start} title="Arrange" aria-label="Arrange your widgets"><LineIcon name="brush" /></button> : null}
      </div>)}
      {arranging || (editable && list.length) ? <button type="button" className="wg-cell wg-s wg-add wg-add-dashed" onClick={() => { if (!arranging) start(); setAdding(true); }} aria-label="Add a widget"><LineIcon name="plus" /></button> : null}
      {!list.length && editable && !arranging ? <button type="button" className="wg-cell wg-m wg-add" onClick={() => { start(); setAdding(true); }}><LineIcon name="plus" /><span>Make this yours: add widgets</span></button> : null}
    </div>
    {arranging ? <div className="wg-done"><span>Drag to move · pick a size · × to take off</span><Seal compact onClick={() => setArranging(false)}><LineIcon name="check" />Done</Seal></div> : null}
    {adding ? <Gallery data={data} hidden={list.some((x) => x.kind === "friends") ? ["friends"] : []} onClose={() => setAdding(false)} onPick={(w) => { setDraft((ws) => [...ws.filter((x) => !(w.kind === "friends" && x.kind === "friends")), w].slice(0, 16)); setAdding(false); if (!arranging) setArranging(true); }} /> : null}
  </section>;
}

/* ── Each widget ───────────────────────────────────────────────────────── */

const first = (name: string) => name.split(/\s+/)[0];
const itemOf = (d: BoardData, app: string, kind: string) => d.sections.find((s) => s.app === app && s.kind === kind)?.items[0] ?? null;
const songHref = (key: string) => `/music/song/${key.startsWith("yt:") ? `yt-${key.slice(3)}` : key.replace(/^dz:/, "")}`;
const albumHref = (key: string) => `/music/album/${key.replace(/^dz:/, "")}`;

function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  if (s < 2 * 86400) return "yesterday";
  return `${Math.round(s / 86400)} days ago`;
}

function Empty({ icon, text }: { icon: LineIconName; text: string }) {
  return <div className="wg-empty"><LineIcon name={icon} /><span>{text}</span></div>;
}

function WidgetView({ w, d, onEditLinks }: { w: Widget; d: BoardData; onEditLinks?: () => void }) {
  switch (w.kind) {
    case "listening": return <Turntable w={w} d={d} />;
    case "song": case "album": return <Favourite w={w} />;
    case "reading": return <Reading w={w} d={d} />;
    case "watching": return <Watching d={d} />;
    case "artists": return <Artists w={w} d={d} />;
    case "stats": return <Stats w={w} d={d} />;
    case "note": return <Note w={w} />;
    case "status": return <Status w={w} />;
    case "clock": return <Clock w={w} d={d} />;
    case "links": return <Links w={w} d={d} onEdit={onEditLinks} />;
    case "friends": return <Friends w={w} d={d} />;
    case "book": return <FavouriteBook w={w} />;
    case "show": return <FavouriteShow w={w} />;
    case "playlist": return <PlaylistWidget w={w} />;
    case "loved": return <Loved w={w} d={d} />;
    case "onrepeat": return <OnRepeat w={w} d={d} />;
    case "review": return <Review w={w} d={d} />;
    case "bookshelf": return <Bookshelf w={w} d={d} />;
    case "yearbooks": return <YearInBooks w={w} d={d} />;
    case "watched": return <Watched w={w} d={d} />;
    case "countdown": return <Countdown w={w} />;
    case "quote": return <Quote w={w} />;
  }
}

/** What's playing: the album's sleeve on a wash of its own colours; while they listen the record slides out of it and turns. */
function Turntable({ w, d }: { w: Widget; d: BoardData }) {
  const next = d.music?.listening ?? null;
  /* A new song doesn't just appear: the one that was on is held a moment while it's taken off (widgets.css, is-changing). */
  const [held, setHeld] = useState(next);
  const changing = Boolean(next && held && next.track.key !== held.track.key);
  if (!changing && held !== next) setHeld(next);
  useEffect(() => { if (!changing) return; const t = setTimeout(() => setHeld(next), 420); return () => clearTimeout(t); }, [changing, next]);
  const l = changing ? held : next;
  if (!l) return <div className="wg-card wg-np is-empty"><Empty icon="music" text="Nothing played yet" /></div>;
  const by = l.track.artists.map((a) => a.name).join(", ");
  const cover = l.track.album?.cover ? l.track.album.cover.replace(/\/(\d{2,4})x\1-/, "/500x500-") : null;
  return <Crossing kind="kakejiku" href={songHref(l.track.key)} className={`wg-card wg-np${l.live ? " is-live" : ""}${changing ? " is-changing" : ""}`} title={`${l.track.title} · ${by}`}>
    {cover ? <span key={l.track.key} className="wg-np-wash" style={{ backgroundImage: `url(${cover})` }} aria-hidden="true" /> : null}
    <span key={`s${l.track.key}`} className="wg-np-sleeve" aria-hidden="true">
      <span className="wg-np-record"><span className="wg-np-label" style={cover ? { backgroundImage: `url(${cover})` } : undefined} /></span>
      {/* eslint-disable-next-line @next/next/no-img-element -- the album's own cover */}
      <span className="wg-np-cover">{cover ? <img src={cover} alt="" /> : <LineIcon name="music" />}</span>
    </span>
    {w.size !== "s" ? <span key={`w${l.track.key}`} className="wg-np-words">
      <small className="wg-np-state">{l.live ? <><span className="wg-np-bars" aria-hidden="true"><i /><i /><i /><i /></span>Now</> : ago(l.at)}</small>
      <b>{l.track.title}</b><em>{by}</em>
      {w.size === "xl" && l.track.album ? <em className="wg-album">{l.track.album.title}</em> : null}
    </span> : null}
  </Crossing>;
}

function Favourite({ w }: { w: Widget }) {
  const c = w.config ?? {};
  const album = w.kind === "album";
  return <Crossing kind="kakejiku" href={album ? albumHref(c.key) : songHref(c.key)} className={`wg-card wg-fav${album ? " wg-sleeve" : ""}`}>
    {c.cover ? <span className="wg-fav-wash" style={{ backgroundImage: `url(${c.cover})` }} aria-hidden="true" /> : null}
    <span className="wg-fav-art">
      {album ? <span className="wg-fav-disc" aria-hidden="true" /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- the cover from Music */}
      {c.cover ? <img src={c.cover} alt="" /> : <LineIcon name="music" />}
    </span>
    {w.size !== "s" ? <span className="wg-words"><small className="wg-kicker">{album ? "Favourite album" : "Favourite song"}</small><b>{c.title}</b><em>{c.subtitle}</em></span> : null}
  </Crossing>;
}

function Reading({ w, d }: { w: Widget; d: BoardData }) {
  const b = itemOf(d, "books", "reading");
  if (!b) return <div className="wg-card"><Empty icon="book" text="Not reading anything right now" /></div>;
  const author = b.subtitle?.split(" · ")[0]?.trim();
  /* The book leans toward the pointer, as if held up to look at. */
  const tilt = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--rx", `${((e.clientY - r.top) / r.height - .5) * -14}deg`);
    e.currentTarget.style.setProperty("--ry", `${((e.clientX - r.left) / r.width - .5) * 26}deg`);
  };
  const rest = (e: React.PointerEvent<HTMLElement>) => { e.currentTarget.style.removeProperty("--rx"); e.currentTarget.style.removeProperty("--ry"); };
  return <Crossing kind="kakejiku" href={b.href ?? "/books"} className="wg-card wg-reading" onPointerMove={tilt} onPointerLeave={rest}>
    <span className="wg-book">
      <span className="wg-book-float"><Book3D book={{ key: b.itemId, title: b.title, authors: author ? [author] : [], cover: b.cover, pages: null }} progress={b.progress ?? undefined} /></span>
    </span>
    {w.size !== "s" ? <span className="wg-words"><small className="wg-kicker">Reading</small><b>{b.title}</b>{author ? <em>{author}</em> : null}
      {b.progress ? <span className="wg-progress"><InkMeter className="wg-wave" value={b.progress} label="Read" /><small>{Math.round(b.progress * 100)}%</small></span> : null}</span> : null}
  </Crossing>;
}

/** What's on: the screen it's on (a phone, a laptop or a TV, whichever they put it on), stopped where they are with the player's own scrubber; beside it the title, the episode, and the season as a mark an episode. */
function Watching({ d }: { d: BoardData }) {
  const t = itemOf(d, "watch", "watching");
  if (!t) return <div className="wg-card"><Empty icon="film" text="Nothing on right now" /></div>;
  const tilt = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--rx", `${((e.clientY - r.top) / r.height - .5) * -10}deg`);
    e.currentTarget.style.setProperty("--ry", `${((e.clientX - r.left) / r.width - .5) * 18}deg`);
  };
  const rest = (e: React.PointerEvent<HTMLElement>) => { e.currentTarget.style.removeProperty("--rx"); e.currentTarget.style.removeProperty("--ry"); };
  /* How far into this film or episode; without that, how far through it all. */
  const part = t.spot?.part ?? t.progress ?? 0;
  const se = /^S(\d+)\s*:\s*E(\d+)$/.exec(t.subtitle ?? "");
  /* Watch labels a one-season show "E7". */
  const e = /^E(\d+)$/.exec(t.subtitle ?? "");
  const where = se ? `Season ${se[1]} · Episode ${se[2]}` : e ? `Episode ${e[1]}` : t.subtitle?.replace(/\s*:\s*/g, " · ");
  const { episode, of, screen, live } = t.spot ?? {};
  const on = screen === "tv" ? " on the TV" : screen === "computer" ? " on a computer" : screen === "phone" ? " on a phone" : "";
  /* A season short enough to count is drawn; a long one is said. */
  const marks = episode && of && of <= 26 ? of : 0;
  return <Crossing kind="kakejiku" href={t.href ?? `/watch?t=${encodeURIComponent(t.itemId)}`} className="wg-card wg-watch" title={t.title} onPointerMove={tilt} onPointerLeave={rest}>
    {/* Drawn as what it was put on: a phone held sideways, a laptop, a TV on its foot; a plain screen when that isn't known. */}
    <span className={`wg-screen-wrap${screen ? ` is-${screen}` : ""}`} aria-hidden="true"><span className="wg-device">
      <span className={`wg-screen${t.wide ? "" : " is-poster"}${live ? " is-live" : " is-paused"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the still from Watch */}
        {t.wide || t.cover ? <img src={(t.wide || t.cover)!} alt="" /> : <LineIcon name="film" />}
        {/* Not on right now: the picture dims, paused. */}
        {live ? null : <span className="wg-screen-pause"><i /><i /></span>}
      </span>
      {screen === "tv" || screen === "computer" ? <i className="wg-device-foot" /> : null}
    </span></span>
    <span className="wg-words"><small className={`wg-kicker${live ? " wg-on-now" : ""}`}>{live ? <><span className="wg-live-bars" aria-hidden="true"><i /><i /><i /></span>Watching now{on}</> : t.at ? `Last watched ${ago(new Date(t.at).toISOString())}` : "Last watched"}</small><b>{t.title}</b>
      {where ? <em>{where}{episode && of && !marks ? ` of ${of}` : ""}</em> : null}
      {/* Kimono's own ink line for how far into it: flat until it's on, then it runs. */}
      {part ? <span className="wg-progress"><InkWave className="wg-wave" value={part} label="Watched" still={!live} pace={.5} /><small>{Math.round(part * 100)}%</small></span> : null}
      {marks ? <span className="wg-eps" role="img" aria-label={`Episode ${episode} of ${of}`}>{Array.from({ length: marks }, (_, i) => <i key={i} className={i + 1 < episode! ? "is-done" : i + 1 === episode ? "is-now" : undefined} style={i + 1 === episode ? { "--part": part } as React.CSSProperties : undefined} />)}</span> : null}
    </span>
  </Crossing>;
}

function Artists({ w, d }: { w: Widget; d: BoardData }) {
  const list = d.music?.artists ?? [];
  if (!list.length) return <div className="wg-card"><Empty icon="people" text="Top artists show up after some listening" /></div>;
  const n = w.size === "m" ? 3 : 6;
  return <div className="wg-card wg-artists">
    <small className="wg-kicker">Top artists</small>
    <span className="wg-artist-row">{list.slice(0, n).map((a, i) => <Crossing key={a.key} kind="kakejiku" href={`/music/artist/${a.key.replace(/^dz:/, "")}`} className="wg-artist" title={a.name}>
      <span className="wg-artist-face">
        {/* eslint-disable-next-line @next/next/no-img-element -- the artist's picture from Music */}
        {a.picture ? <img src={a.picture.replace(/\/(\d{2,4})x\1-/, "/250x250-")} alt="" /> : <b>{a.name.slice(0, 1)}</b>}
        <i>{i + 1}</i>
      </span>
      <small>{a.name}</small>
      {a.plays ? <em className="wg-artist-plays">{a.plays} {a.plays === 1 ? "play" : "plays"}</em> : null}
    </Crossing>)}</span>
  </div>;
}

function Stats({ w, d }: { w: Widget; d: BoardData }) {
  const year = new Date().getFullYear();
  const read = d.sections.find((s) => s.app === "books" && s.kind === "read")?.items.filter((i) => i.at && new Date(i.at).getFullYear() === year).length ?? 0;
  const hours = Math.round((d.music?.minutes ?? 0) / 6) / 10;
  const facts = [
    d.music?.plays ? { n: String(d.music.plays), unit: d.music.plays === 1 ? "song" : "songs" } : null,
    hours ? { n: hours >= 10 ? String(Math.round(hours)) : String(hours), unit: hours === 1 ? "hour" : "hours" } : null,
    read ? { n: String(read), unit: read === 1 ? `book in ${year}` : `books in ${year}` } : null,
  ].filter(Boolean) as { n: string; unit: string }[];
  if (!facts.length) return <div className="wg-card"><Empty icon="clock" text="A quiet month so far" /></div>;
  return <div className="wg-card wg-stats">
    <small className="wg-kicker">This month</small>
    <span className="wg-facts">{facts.slice(0, w.size === "s" ? 2 : 3).map((f) => <span key={f.unit}><b><CountUp to={f.n} /></b><small>{f.unit}</small></span>)}</span>
  </div>;
}

/** A number that counts up to itself when it arrives; a later change rolls on from where it was, not from 0. */
function CountUp({ to }: { to: string }) {
  const target = Number(to);
  const decimals = to.includes(".") ? 1 : 0;
  const [shown, setShown] = useState(0);
  const was = useRef(0);
  useEffect(() => { was.current = shown; }, [shown]);
  useEffect(() => {
    const from = was.current;
    if (!Number.isFinite(target) || matchMedia("(prefers-reduced-motion: reduce)").matches) { const t = setTimeout(() => setShown(target), 0); return () => clearTimeout(t); }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      setShown(from + (target - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return <>{Number.isFinite(target) ? shown.toFixed(decimals) : to}</>;
}

const tints: Record<string, string> = { suo: "#a84d63", plum: "#4e2b37", moss: "#5c7150", ai: "#2e5e8a", kuchiba: "#b8732c", sakura: "#d77b8c", sumi: "#3a3634" };
function Note({ w }: { w: Widget }) {
  const tint = tints[w.config?.tint ?? ""] ?? "#d77b8c";
  return <div className="wg-card wg-note" style={{ "--wg-tint": tint } as React.CSSProperties}>
    <span className="wg-tape" aria-hidden="true" />
    <p>{w.config?.text || "…"}</p>
  </div>;
}

function Status({ w }: { w: Widget }) {
  return <div className="wg-card wg-status">
    <span className="wg-emoji">{w.config?.emoji || "🌸"}</span>
    {w.config?.text ? <p>{w.config.text}</p> : null}
  </div>;
}

/** Minutes a zone is ahead of UTC at `when` ("GMT+5:30" → 330). */
function zoneOffset(zone: string | undefined, when: Date): number {
  if (!zone) return -when.getTimezoneOffset();
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(when).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

/** How their time sits against yours: "5h ahead of you", "2h 30m behind you", "Same time as you". */
export function apart(zone: string | undefined, when = new Date()): string {
  const diff = zoneOffset(zone, when) - (-when.getTimezoneOffset());
  if (!diff) return "Same time as you";
  const h = Math.floor(Math.abs(diff) / 60), m = Math.abs(diff) % 60;
  return `${h ? `${h}h` : ""}${h && m ? " " : ""}${m ? `${m}m` : ""} ${diff > 0 ? "ahead of" : "behind"} you`;
}

/** Their time of day: an ink clock face, the hour in words, and how far it is from yours. */
function Clock({ w, d }: { w: Widget; d: BoardData }) {
  const zone = w.config?.zone || undefined;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 20_000); return () => clearInterval(t); }, []);
  const parts = new Intl.DateTimeFormat("en", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: false }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24, m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const said = new Intl.DateTimeFormat("en", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(now).toLowerCase();
  const night = h < 6 || h >= 20;
  return <div className={`wg-card wg-clock${night ? " is-night" : ""}`}>
    <svg className="wg-face" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="44" className="wg-face-ring" />
      {Array.from({ length: 12 }, (_, i) => <line key={i} x1="50" y1="10" x2="50" y2={i % 3 ? "14" : "18"} transform={`rotate(${i * 30} 50 50)`} className="wg-tick" />)}
      <line x1="50" y1="50" x2="50" y2="28" className="wg-hour" transform={`rotate(${(h % 12) * 30 + m / 2} 50 50)`} />
      <line x1="50" y1="50" x2="50" y2="18" className="wg-minute" transform={`rotate(${m * 6} 50 50)`} />
      {/* The second hand sweeps on its own, started where the seconds are now. */}
      <line x1="50" y1="56" x2="50" y2="14" className="wg-sec" style={{ "--sec": `-${now.getSeconds()}s` } as React.CSSProperties} />
      <circle cx="50" cy="50" r="3" className="wg-pin" />
    </svg>
    {w.size !== "s" ? <span className="wg-words"><small className="wg-kicker">{night ? "Night" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening"} for {first(d.person.name)}</small><b>{said}</b>
      <em className="wg-apart">{apart(zone, now)}{zone ? ` · ${zone.split("/").pop()?.replace(/_/g, " ")}` : ""}</em></span>
      : <span className="wg-clock-says"><b>{said}</b><small className="wg-apart">{apart(zone, now)}</small></span>}
  </div>;
}

/* The sites people link to that are a profile somewhere else: shown as round marks under the name, not buttons. */
const socialHosts = /(^|\.)(instagram|twitter|x|bsky|threads|mastodon\.social|tiktok|youtube|youtu\.be|twitch|github|gitlab|linkedin|facebook|spotify|soundcloud|bandcamp|letterboxd|goodreads|discord|reddit|pinterest|behance|dribbble|vimeo|last\.fm|steamcommunity)\.[a-z.]+$/;
export const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
export const isSocial = (url: string) => socialHosts.test(hostOf(url));
export type LinkShow = "name" | "links" | "both";
/** Where a link shows, as chosen; unchosen, a social site is in both places and the rest are buttons. */
export const showOf = (l: { url: string; show?: LinkShow }): LinkShow => l.show ?? (isSocial(l.url) ? "both" : "links");
export const underName = (l: { url: string; show?: LinkShow }) => showOf(l) !== "links";
export const inLinks = (l: { url: string; show?: LinkShow }) => showOf(l) !== "name";

/** A link's own icon, from its site, or a mark when there isn't one. */
export function Favicon({ url, fallback }: { url: string; fallback: LineIconName }) {
  const [broken, setBroken] = useState(false);
  const host = hostOf(url);
  if (!host || broken || url.startsWith("mailto:")) return <LineIcon name={fallback} />;
  // eslint-disable-next-line @next/next/no-img-element -- the linked site's own icon, asked of that site
  return <img className="wg-favicon" src={`https://${host}/favicon.ico`} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} />;
}

function Links({ w, d, onEdit }: { w: Widget; d: BoardData; onEdit?: () => void }) {
  /* Each link says where it shows; this is the ones that show here. */
  const list = d.links.filter(inLinks);
  if (!list.length) return onEdit
    ? <button type="button" className="wg-card wg-links-empty" onClick={onEdit}><Empty icon="link" text="Add your links" /></button>
    : <div className="wg-card"><Empty icon="link" text="No links yet" /></div>;
  const n = w.size === "m" ? 2 : w.size === "l" ? 5 : 8;
  return <div className="wg-card wg-links">
    {list.slice(0, n).map((l, i) =>
      /* eslint-disable-next-line no-restricted-syntax -- someone's own links leave Kimono, in a new tab */
      <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer nofollow" className={i === 0 && list.length > 1 && w.size !== "m" ? "is-first" : undefined} style={{ "--i": i } as React.CSSProperties}>
        <span className="wg-link-mark"><LinkMark url={l.url} icon={l.icon} /></span>
        <span className="wg-link-words"><b>{l.title}</b><small>{hostOf(l.url) || l.url.replace(/^mailto:/, "")}</small></span>
        <LineIcon name="out" className="wg-link-go" />
      </a>)}
    {onEdit ? <button type="button" className="wg-links-edit" onClick={onEdit}><LineIcon name="brush" />Edit links</button> : null}
  </div>;
}

function Friends({ w, d }: { w: Widget; d: BoardData }) {
  const own = d.own;
  const more = own ? <span className="wg-friends-more">
    {own.asking ? <Crossing kind="kakejiku" href="/account/friends" className="wg-chip is-new"><i />{own.asking} asking</Crossing> : null}
    <Crossing kind="kakejiku" href="/account/friends" className="wg-chip">{d.friends.length ? "All friends" : <><LineIcon name="search" />Find friends</>}</Crossing>
  </span> : null;
  const kicker = <small className="wg-kicker">{d.friends.length === 1 ? "1 friend" : d.friends.length ? `${d.friends.length} friends` : "Friends"}{own?.kept ? <span className="wg-only"><LineIcon name="lock" />Only you</span> : null}</small>;
  if (!d.friends.length) return <div className="wg-card wg-friends">{kicker}<Empty icon="people" text={own ? "Your friends show up here" : "No friends to show"} />{more}</div>;
  const n = w.size === "s" ? 4 : w.size === "m" ? 6 : 12;
  return <div className="wg-card wg-friends">
    {kicker}
    <span className="wg-faces">{d.friends.slice(0, n).map((f) => <Crossing key={f.username} kind="kakejiku" href={`/account/people/${encodeURIComponent(f.username)}`} title={f.name || f.username} className="wg-friend">
      <InkPortraitFrame seed={f.username} weight={3}><Portrait name={f.name} username={f.username} picture={f.picture} size={40} /></InkPortraitFrame>
      {w.size !== "s" ? <small>{first(f.name || f.username)}</small> : null}
    </Crossing>)}{d.friends.length > n ? <Crossing kind="kakejiku" href="/account/friends" className="wg-friend wg-friend-more"><b>+{d.friends.length - n}</b></Crossing> : null}</span>
    {more}
  </div>;
}

/* ── More of you ───────────────────────────────────────────────────────── */

const ratingWord = { love: "Loved it", up: "Liked it", down: "Not for me" } as const;
function RatingMark({ rating }: { rating: "down" | "up" | "love" }) {
  return <span className={`wg-rated wg-rated-${rating}`} title={ratingWord[rating]}>
    {rating === "love" ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>
      : <svg viewBox="0 0 24 24" aria-hidden="true" style={rating === "down" ? { transform: "rotate(180deg)" } : undefined}><path d="M7 11v9H4v-9h3Zm0 0 4-7c1.7 0 2.6 1.2 2.2 2.8L12.6 10H18a2 2 0 0 1 2 2.3l-1.1 6A2 2 0 0 1 17 20H7" /></svg>}
    <span>{ratingWord[rating]}</span>
  </span>;
}

const book3d = (b: { key: string; title: string; author: string; cover: string | null }) => <Book3D book={{ key: b.key, title: b.title, authors: b.author ? [b.author] : [], cover: b.cover, pages: null }} />;

/** A review they wrote: the book, how they rated it, and their words. */
function Review({ w, d }: { w: Widget; d: BoardData }) {
  const r = d.books?.reviews[0];
  if (!r) return <div className="wg-card"><Empty icon="book" text="Reviews you write in Books show here" /></div>;
  return <Crossing kind="kakejiku" href={`/books?b=${encodeURIComponent(r.key)}`} className="wg-card wg-review">
    <span className="wg-book">{book3d(r)}</span>
    <span className="wg-words">
      <small className="wg-kicker">{first(d.person.name)}&rsquo;s review</small>
      <b>{r.title}</b>{r.author ? <em>{r.author}</em> : null}
      {r.rating ? <RatingMark rating={r.rating} /> : null}
      <q className="wg-review-words" style={{ WebkitLineClamp: w.size === "m" ? 2 : w.size === "l" ? 6 : 5 } as React.CSSProperties}>{r.review}</q>
    </span>
  </Crossing>;
}

/** The books they've read, as spines on a shelf: heights vary as real books do; a loved one has a heart. */
function Bookshelf({ w, d }: { w: Widget; d: BoardData }) {
  const read = d.books?.read ?? [];
  if (!read.length) return <div className="wg-card"><Empty icon="book" text="Books you finish go on the shelf" /></div>;
  const n = w.size === "m" ? 9 : w.size === "l" ? 12 : 22;
  return <div className="wg-card wg-shelfcard">
    <small className="wg-kicker">{read.length === 1 ? "1 book read" : `${read.length} books read`}</small>
    <span className="wg-shelf-books">
      {read.slice(0, n).map((b, i) => { let h = 0; for (const c of b.key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        return <Crossing key={b.key} kind="kakejiku" href={`/books?b=${encodeURIComponent(b.key)}`} className="wg-spine" title={`${b.title}${b.author ? ` · ${b.author}` : ""}`}
          style={{ "--h": `${72 + (h % 28)}%`, "--hue": h % 360, "--i": i, ...(b.cover ? { "--cover": `url("${b.cover}")` } : {}) } as React.CSSProperties}>
          <span>{b.title}</span>{b.rating === "love" ? <i aria-label="Loved">♥</i> : null}
        </Crossing>; })}
    </span>
    <span className="wg-plank" aria-hidden="true" />
  </div>;
}

/** This year's count, round a ring towards a goal. */
function YearInBooks({ w, d }: { w: Widget; d: BoardData }) {
  const year = new Date().getFullYear();
  const n = (d.books?.read ?? []).filter((b) => new Date(b.at).getFullYear() === year).length;
  const goal = Number(w.config?.goal) || 0;
  const frac = goal ? Math.min(1, n / goal) : Math.min(1, n / 12);
  return <div className="wg-card wg-year">
    <svg className="wg-ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="40" className="wg-ring-track" />
      <circle cx="50" cy="50" r="40" className="wg-ring-fill" style={{ strokeDasharray: `${frac * 251.3} 251.3` }} />
    </svg>
    <span className="wg-year-n"><b><CountUp to={String(n)} /></b><small>{goal ? `of ${goal}` : "books"}</small></span>
    {w.size !== "s" ? <span className="wg-words"><small className="wg-kicker">{year} in books</small><b>{goal ? (n >= goal ? "Goal met" : `${goal - n} to go`) : n === 1 ? "One book so far" : `${n} books so far`}</b></span> : null}
  </div>;
}

function FavouriteBook({ w }: { w: Widget }) {
  const c = w.config ?? {};
  return <Crossing kind="kakejiku" href={`/books?b=${encodeURIComponent(c.key ?? "")}`} className="wg-card wg-favbook">
    <span className="wg-book">{book3d({ key: c.key ?? "", title: c.title ?? "", author: c.subtitle ?? "", cover: c.cover || null })}</span>
    {w.size !== "s" ? <span className="wg-words"><small className="wg-kicker">Favourite book</small><b>{c.title}</b>{c.subtitle ? <em>{c.subtitle}</em> : null}</span> : null}
  </Crossing>;
}

/** Their favourite film or show, as a ticket: the poster on the stub, the title on the ticket, a line to tear along. */
function FavouriteShow({ w }: { w: Widget }) {
  const c = w.config ?? {};
  return <Crossing kind="kakejiku" href={`/watch?t=${encodeURIComponent(c.key ?? "")}`} className="wg-card wg-ticket-card" title={c.title}>
    <span className="wg-ticket">
      <span className="wg-ticket-stub">
        {/* eslint-disable-next-line @next/next/no-img-element -- the poster from Watch */}
        {c.cover ? <img src={c.cover} alt="" /> : null}
      </span>
      <span className="wg-ticket-main">
        <small className="wg-ticket-admit">Favourite</small>
        <b>{c.title}</b>
        {c.subtitle ? <em>{c.subtitle}</em> : null}
      </span>
      {/* The stub that tears off. */}
      <span className="wg-ticket-end" aria-hidden="true"><i className="wg-ticket-bars" /></span>
    </span>
  </Crossing>;
}

/** What they've watched lately, posters fanned like cards in a hand. */
function Watched({ w, d }: { w: Widget; d: BoardData }) {
  const list = (d.sections.find((s) => s.app === "watch" && s.kind === "watched")?.items ?? []).filter((i) => i.cover);
  if (!list.length) return <div className="wg-card"><Empty icon="film" text="What you watch shows here" /></div>;
  const n = w.size === "m" ? 4 : w.size === "l" ? 5 : 8;
  const shown = list.slice(0, n);
  return <div className="wg-card wg-fan">
    <small className="wg-kicker">Watched lately</small>
    <span className="wg-fan-cards">{shown.map((t, i) => <Crossing key={t.itemId} kind="kakejiku" href={t.href ?? `/watch?t=${encodeURIComponent(t.itemId)}`} className="wg-fan-card" title={t.title}
      style={{ "--i": i, "--n": shown.length } as React.CSSProperties}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the poster from Watch */}
      <img src={t.cover!} alt="" />
    </Crossing>)}</span>
  </div>;
}

function PlaylistWidget({ w }: { w: Widget }) {
  const c = w.config ?? {};
  return <Crossing kind="kakejiku" href={`/music/playlist/${encodeURIComponent(c.key ?? "")}`} className="wg-card wg-fav">
    <span className="wg-fav-art wg-playlist-art">
      {/* eslint-disable-next-line @next/next/no-img-element -- a cover from the playlist */}
      {c.cover ? <img src={c.cover} alt="" /> : <LineIcon name="music" />}
      <span className="wg-play-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.9-6.86a1 1 0 0 0 0-1.7L9.52 4.3A1 1 0 0 0 8 5.14z" /></svg></span>
    </span>
    {w.size !== "s" ? <span className="wg-words"><small className="wg-kicker">Playlist</small><b>{c.title}</b>{c.subtitle ? <em>{c.subtitle}</em> : null}</span> : null}
  </Crossing>;
}

/** Loved songs as a little stack of sleeves, the newest on top. */
function Loved({ w, d }: { w: Widget; d: BoardData }) {
  const list = d.sections.find((s) => s.app === "music" && s.kind === "loved")?.items ?? [];
  if (!list.length) return <div className="wg-card"><Empty icon="music" text="Songs you love show here" /></div>;
  const n = w.size === "m" ? 3 : 6;
  return <div className="wg-card wg-loved">
    <span className="wg-loved-stack">{list.slice(0, 3).map((t, i) => <span key={t.itemId} className="wg-loved-sleeve" style={{ "--i": i } as React.CSSProperties}>
      {/* eslint-disable-next-line @next/next/no-img-element -- covers from Music */}
      {t.cover ? <img src={t.cover} alt="" /> : null}
    </span>)}</span>
    <span className="wg-words"><small className="wg-kicker">♥ Loved songs</small>
      {list.slice(0, n).map((t) => <Crossing key={t.itemId} kind="kakejiku" href={songHref(t.itemId)} className="wg-loved-line"><b>{t.title}</b>{t.subtitle ? <em> · {t.subtitle}</em> : null}</Crossing>)}
    </span>
  </div>;
}

function OnRepeat({ w, d }: { w: Widget; d: BoardData }) {
  const r = d.music?.onRepeat;
  if (!r) return <div className="wg-card"><Empty icon="restore" text="Play a song twice and it's on repeat" /></div>;
  return <Crossing kind="kakejiku" href={songHref(r.track.key)} className="wg-card wg-fav wg-onrepeat">
    <span className="wg-fav-art">
      {/* eslint-disable-next-line @next/next/no-img-element -- the cover from Music */}
      {r.track.album?.cover ? <img src={r.track.album.cover.replace(/\/(\d{2,4})x\1-/, "/250x250-")} alt="" /> : <LineIcon name="music" />}
      <span className="wg-repeat-badge"><LineIcon name="restore" /></span>
    </span>
    {w.size !== "s" ? <span className="wg-words"><small className="wg-kicker">On repeat · {r.plays} plays</small><b>{r.track.title}</b><em>{r.track.artists.map((a) => a.name).join(", ")}</em></span> : null}
  </Crossing>;
}

function Countdown({ w }: { w: Widget }) {
  const date = w.config?.date ?? "";
  /* Today, read once when it's drawn (it changes once a day). */
  const [today] = useState(() => Date.now());
  const days = Math.ceil((Date.parse(`${date}T00:00:00`) - today) / 86400_000);
  const label = w.config?.label || "The day";
  return <div className="wg-card wg-countdown">
    <span className="wg-count"><b><CountUp to={String(Math.max(0, days))} /></b><small>{days === 1 ? "day" : "days"}</small></span>
    <span className="wg-words"><small className="wg-kicker">{days > 0 ? "Until" : days === 0 ? "It's today" : "It was"}</small><b>{label}</b>{w.size !== "s" ? <em>{new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</em> : null}</span>
  </div>;
}

function Quote({ w }: { w: Widget }) {
  return <figure className="wg-card wg-quote">
    <span className="wg-quote-mark" aria-hidden="true">“</span>
    <blockquote>{w.config?.text}</blockquote>
    {w.config?.by ? <figcaption>{w.config.by}</figcaption> : null}
  </figure>;
}

/* ── Adding one ────────────────────────────────────────────────────────── */

type Found = { key: string; title: string; subtitle: string; cover: string | null };

/* The gallery's shelves: each app's widgets together, then the ones about you. */
const shelves: { title: string; tint: string; kinds: WidgetKind[] }[] = [
  { title: "Music", tint: "#946c25", kinds: ["listening", "song", "album", "onrepeat", "playlist", "loved", "artists"] },
  { title: "Books", tint: "#5c7150", kinds: ["reading", "review", "bookshelf", "book", "yearbooks"] },
  { title: "Watch", tint: "#a84d63", kinds: ["watching", "watched", "show"] },
  { title: "About you", tint: "#74565c", kinds: ["friends", "status", "note", "quote", "countdown", "clock", "stats", "links"] },
];

/* What a preview shows for a widget that's made from your choices. */
const samples: Partial<Record<WidgetKind, Record<string, string>>> = {
  book: { key: "ol:0", title: "Your book", subtitle: "Any author", cover: "" },
  show: { key: "x", title: "Your film or show", subtitle: "", cover: "" },
  playlist: { key: "xxxxxxxx", title: "Your playlist", subtitle: "", cover: "" },
  countdown: { date: new Date(Date.now() + 12 * 86400_000).toISOString().slice(0, 10), label: "Holidays" },
  quote: { text: "Not all those who wander are lost.", by: "Tolkien" },
  yearbooks: { goal: "24" },
  song: { key: "dz:0", title: "Your song", subtitle: "Any artist", cover: "" },
  album: { key: "dz:0", title: "Your album", subtitle: "Any artist", cover: "" },
  note: { text: "ask me about city pop", tint: "sakura" },
  status: { emoji: "🎧", text: "In a city pop phase" },
  clock: { zone: "" },
};

const needsChoosing: WidgetKind[] = ["song", "album", "note", "status", "clock", "book", "show", "playlist", "countdown", "quote", "yearbooks"];
/* A preview shows a widget at its own shape: the wide ones wide. */
const previewSize = (kd: WidgetKind): WidgetSize => (kindOf(kd).size === "s" ? "s" : "m");

/* For previews only: where someone has nothing yet (no books read, nothing watched), a few made-up things show what a widget looks like. */
function previewData(d: BoardData): BoardData {
  const titles: [string, string][] = [["The Remains of the Day", "Kazuo Ishiguro"], ["Piranesi", "Susanna Clarke"], ["Kitchen", "Banana Yoshimoto"], ["Dune", "Frank Herbert"], ["Norwegian Wood", "Haruki Murakami"], ["Circe", "Madeline Miller"], ["The Hobbit", "J.R.R. Tolkien"], ["Beloved", "Toni Morrison"], ["Stoner", "John Williams"], ["Normal People", "Sally Rooney"]];
  const now = Date.now();
  const read = titles.map(([title, author], i) => ({ key: `demo:${i}`, title, author, cover: null, rating: i % 3 === 0 ? "love" as const : null, at: now - i * 86400_000 * 9 }));
  const posters = d.sections.flatMap((s) => (s.app === "watch" ? s.items : [])).filter((i) => i.cover);
  const watched = d.sections.some((s) => s.app === "watch" && s.kind === "watched" && s.items.length) ? [] : [{ app: "watch", kind: "watched", title: "Watched", items: posters.length ? Array.from({ length: 4 }, (_, i) => ({ ...posters[i % posters.length], itemId: `demo${i}` })) : [] }];
  /* Something on, so the screen is seen. */
  const watching = d.sections.some((s) => s.app === "watch" && s.kind === "watching" && s.items.length) ? [] : [{ app: "watch", kind: "watching", title: "Watching", items: [{ ...(posters[0] ?? {}), itemId: "demo-on", title: posters[0]?.title ?? "Your show", subtitle: "S1:E3", cover: posters[0]?.cover ?? null, progress: .3, spot: { part: .4, episode: 3, of: 10 } }] }];
  return {
    ...d,
    sections: [...d.sections, ...watched, ...watching],
    books: d.books?.read.length ? d.books : { read, reviews: [{ ...read[0], review: "Quiet, restrained and devastating: a whole life told in what's left unsaid." }] },
  };
}

function Gallery({ data: real, hidden, onClose, onPick }: { data: BoardData; hidden: WidgetKind[]; onClose: () => void; onPick: (w: Widget) => void }) {
  const [data] = useState(() => previewData(real));
  const [kind, setKind] = useState<WidgetKind | null>(null);
  const k = kind ? kindOf(kind) : null;
  const plain = (kd: WidgetKind) => onPick({ id: newId(), kind: kd, size: kindOf(kd).size });
  return <InkSheet title={k ? k.name : "Add a widget"} icon="plus" onClose={onClose} actions={<Seal tone="quiet" compact onClick={k ? () => setKind(null) : onClose}>{k ? "Back" : "Cancel"}</Seal>}>
    {!k ? <div className="wg-gallery">{shelves.map((shelf) => <section key={shelf.title} className="wg-shelf" style={{ "--wg-shelf": shelf.tint } as React.CSSProperties}>
      <h3>{shelf.title}</h3>
      <div className="wg-shelf-row">{shelf.kinds.filter((kd) => !hidden.includes(kd)).map((kd) => { const x = kindOf(kd); return <button key={kd} type="button" className="wg-pick"
        onClick={() => (needsChoosing.includes(kd) ? setKind(kd) : plain(kd))}>
        {/* The widget itself, small, made from your own things. */}
        <span className="wg-preview" aria-hidden="true" inert><span className={`wg-cell wg-${previewSize(kd)} wg-k-${kd}`}><WidgetView w={{ id: "p", kind: kd, size: previewSize(kd), config: samples[kd] }} d={data} /></span></span>
        <b>{x.name}</b><small>{x.says}</small>
      </button>; })}</div>
    </section>)}</div>
      : kind === "song" || kind === "album" ? <MusicPicker album={kind === "album"} onPick={(f) => onPick({ id: newId(), kind, size: k.size, config: { key: f.key, title: f.title, subtitle: f.subtitle, cover: f.cover ?? "" } })} />
        : kind === "note" ? <NoteMaker onPick={(text, tint) => onPick({ id: newId(), kind: "note", size: "s", config: { text, tint } })} />
          : kind === "status" ? <StatusMaker onPick={(emoji, text) => onPick({ id: newId(), kind: "status", size: "s", config: { emoji, text } })} />
            : kind === "clock" ? <ClockMaker onPick={(zone) => onPick({ id: newId(), kind: "clock", size: "s", config: { zone } })} />
              : kind === "book" ? <TitlePicker what="book" onPick={(f) => onPick({ id: newId(), kind, size: k.size, config: f })} />
                : kind === "show" ? <TitlePicker what="show" onPick={(f) => onPick({ id: newId(), kind, size: k.size, config: f })} />
                  : kind === "playlist" ? <PlaylistPicker onPick={(f) => onPick({ id: newId(), kind, size: k.size, config: f })} />
                    : kind === "countdown" ? <CountdownMaker onPick={(c) => onPick({ id: newId(), kind, size: "s", config: c })} />
                      : kind === "quote" ? <QuoteMaker onPick={(c) => onPick({ id: newId(), kind, size: "m", config: c })} />
                        : <GoalMaker onPick={(c) => onPick({ id: newId(), kind: "yearbooks", size: "s", config: c })} />}
  </InkSheet>;
}

function MusicPicker({ album, onPick }: { album: boolean; onPick: (f: Found) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      fetch(`/api/v1/music/search?q=${encodeURIComponent(q.trim())}`).then(async (r) => {
        if (!r.ok) { setProblem("Music isn't there to search."); return; }
        const b = await r.json() as { tracks: { key: string; title: string; artists: { name: string }[]; album: { cover: string | null } | null }[]; albums: { key: string; title: string; artist: { name: string } | null; cover: string | null }[] };
        setProblem(null);
        setFound(album ? b.albums.slice(0, 8).map((a) => ({ key: a.key, title: a.title, subtitle: a.artist?.name ?? "", cover: a.cover }))
          : b.tracks.slice(0, 8).map((t) => ({ key: t.key, title: t.title, subtitle: t.artists.map((a) => a.name).join(", "), cover: t.album?.cover ?? null })));
      }).catch(() => setProblem("Music didn't answer."));
    }, 250);
    return () => clearTimeout(t);
  }, [q, album]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return <div className="wg-picker">
    <label className="field"><small>{album ? "Find an album" : "Find a song"}</small><input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={album ? "Random Access Memories" : "Plastic Love"} /></label>
    {problem ? <p className="fr-problem">{problem}</p> : null}
    <div className="wg-found">{(q.trim().length >= 2 ? found ?? [] : []).map((f) => <button key={f.key} type="button" onClick={() => onPick(f)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- covers from Music */}
      {f.cover ? <img src={f.cover} alt="" /> : <span className="wg-found-none" />}
      <span><b>{f.title}</b><small>{f.subtitle}</small></span>
    </button>)}</div>
  </div>;
}

function NoteMaker({ onPick }: { onPick: (text: string, tint: string) => void }) {
  const [text, setText] = useState("");
  const [tint, setTint] = useState("sakura");
  return <div className="wg-maker">
    <label className="field"><small>Your note</small><textarea rows={3} maxLength={160} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask me about city pop" /></label>
    <div className="fr-edit-colors"><div>{Object.entries(tints).map(([id, hex]) => <button key={id} type="button" aria-label={id} aria-pressed={tint === id} className={tint === id ? "is-on" : undefined} style={{ "--swatch": hex } as React.CSSProperties} onClick={() => setTint(id)} />)}</div></div>
    <Seal compact disabled={!text.trim()} onClick={() => onPick(text.trim(), tint)}>Add</Seal>
  </div>;
}

const statusEmoji = ["🌸", "🎧", "📚", "🍿", "☕", "😴", "🔥", "🌧️", "✈️", "💻", "🎮", "🍜"];
function StatusMaker({ onPick }: { onPick: (emoji: string, text: string) => void }) {
  const [emoji, setEmoji] = useState("🎧");
  const [text, setText] = useState("");
  return <div className="wg-maker">
    <div className="wg-emoji-pick">{statusEmoji.map((e) => <button key={e} type="button" aria-pressed={emoji === e} onClick={() => setEmoji(e)}>{e}</button>)}</div>
    <label className="field"><small>Status</small><input maxLength={60} value={text} onChange={(e) => setText(e.target.value)} placeholder="In a city pop phase" /></label>
    <Seal compact onClick={() => onPick(emoji, text.trim())}>Add</Seal>
  </div>;
}

type Picked = { key: string; title: string; subtitle: string; cover: string };

/** A book from Books, or a film or show from Watch, by search. */
function TitlePicker({ what, onPick }: { what: "book" | "show"; onPick: (f: Picked) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Picked[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      const url = what === "book" ? `/api/v1/books/search?q=${encodeURIComponent(q.trim())}` : `/api/v1/watch/search?q=${encodeURIComponent(q.trim())}`;
      fetch(url).then(async (r) => {
        if (!r.ok) { setProblem(what === "book" ? "Books isn't there to search." : "Watch isn't there to search."); return; }
        setProblem(null);
        const local = (u: string | null) => (u && u.startsWith(location.origin) ? u.slice(location.origin.length) : u ?? "");
        if (what === "book") {
          const b = await r.json() as { books: { key: string; title: string; authors: string[]; cover: string | null }[] };
          setFound(b.books.slice(0, 8).map((x) => ({ key: x.key, title: x.title, subtitle: x.authors[0] ?? "", cover: x.cover ?? "" })));
        } else {
          const b = await r.json() as { results: { id: string; name: string; year: number | null; poster: string | null }[] };
          setFound(b.results.slice(0, 8).map((x) => ({ key: x.id, title: x.name, subtitle: x.year ? String(x.year) : "", cover: local(x.poster) })));
        }
      }).catch(() => setProblem("Nothing answered."));
    }, 300);
    return () => clearTimeout(t);
  }, [q, what]);
  return <div className="wg-picker">
    <label className="field"><small>{what === "book" ? "Find a book" : "Find a film or a show"}</small><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={what === "book" ? "The Left Hand of Darkness" : "Spirited Away"} /></label>
    {problem ? <p className="fr-problem">{problem}</p> : null}
    <div className="wg-found">{(q.trim().length >= 2 ? found ?? [] : []).map((f) => <button key={f.key} type="button" onClick={() => onPick(f)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- covers from Books and Watch */}
      {f.cover ? <img src={f.cover} alt="" /> : <span className="wg-found-none" />}
      <span><b>{f.title}</b><small>{f.subtitle}</small></span>
    </button>)}</div>
  </div>;
}

function PlaylistPicker({ onPick }: { onPick: (f: Picked) => void }) {
  const [lists, setLists] = useState<{ id: string; name: string; count: number; covers: string[] }[] | null>(null);
  useEffect(() => { fetch("/api/v1/music/playlists").then((r) => r.json()).then((b: { playlists?: { id: string; name: string; count: number; covers: string[] }[] }) => setLists(b.playlists ?? [])).catch(() => setLists([])); }, []);
  if (lists === null) return <p className="fr-quiet">…</p>;
  if (!lists.length) return <p className="fr-quiet">Make a playlist in Music first.</p>;
  return <div className="wg-found">{lists.map((l) => <button key={l.id} type="button" onClick={() => onPick({ key: l.id, title: l.name, subtitle: `${l.count} ${l.count === 1 ? "song" : "songs"}`, cover: l.covers[0] ?? "" })}>
    {/* eslint-disable-next-line @next/next/no-img-element -- a cover from the playlist */}
    {l.covers[0] ? <img src={l.covers[0]} alt="" /> : <span className="wg-found-none" />}
    <span><b>{l.name}</b><small>{l.count} {l.count === 1 ? "song" : "songs"}</small></span>
  </button>)}</div>;
}

function CountdownMaker({ onPick }: { onPick: (c: Record<string, string>) => void }) {
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  return <div className="wg-maker">
    <label className="field"><small>What&rsquo;s coming</small><input maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Japan trip" /></label>
    <label className="field"><small>When</small><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
    <Seal compact disabled={!date} onClick={() => onPick({ label: label.trim(), date })}>Add</Seal>
  </div>;
}

function QuoteMaker({ onPick }: { onPick: (c: Record<string, string>) => void }) {
  const [text, setText] = useState("");
  const [by, setBy] = useState("");
  return <div className="wg-maker">
    <label className="field"><small>The words</small><textarea rows={3} maxLength={200} value={text} onChange={(e) => setText(e.target.value)} /></label>
    <label className="field"><small>Who said it</small><input maxLength={60} value={by} onChange={(e) => setBy(e.target.value)} /></label>
    <Seal compact disabled={!text.trim()} onClick={() => onPick({ text: text.trim(), by: by.trim() })}>Add</Seal>
  </div>;
}

function GoalMaker({ onPick }: { onPick: (c: Record<string, string>) => void }) {
  const [goal, setGoal] = useState("12");
  return <div className="wg-maker">
    <label className="field"><small>Books you mean to read this year</small><input type="number" min={1} max={365} value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
    <Seal compact onClick={() => onPick({ goal: String(Math.max(0, Math.min(999, Math.round(Number(goal) || 0)))) })}>Add</Seal>
  </div>;
}

/* Every time zone the browser knows, or at least this one. */
function allZones(here: string): string[] {
  try { return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [here]; } catch { return [here]; }
}

function ClockMaker({ onPick }: { onPick: (zone: string) => void }) {
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [zones] = useState(() => allZones(here));
  const [zone, setZone] = useState(here);
  return <div className="wg-maker">
    <label className="field"><small>Where you are</small>
      <select value={zone} onChange={(e) => setZone(e.target.value)}>{zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</select></label>
    <Seal compact onClick={() => onPick(zone)}>Add</Seal>
  </div>;
}

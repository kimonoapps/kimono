"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { watchApi, type Card, type Home, type Prefs, type Rating, type Shelf, type TitleView } from "./api";
import { AppLockup } from "@kimono/ui";
import { Crossing } from "@/components/crossing";
import { cx, Toast, watchId, WatchBloom, WatchContext, type Marks, type Watch } from "./bits";
import { HomePage } from "./home";
import { InkLoader } from "@kimono/ui";
import { Icon } from "./icons";
import { HotPage, ListPage, SearchPage } from "./pages";
import { Player, type PlayerHandle } from "./player";
import { SettingsPage } from "./settings";
import { TitleSheet } from "./title";
import { screenId, together, type Invite } from "./party";

/*
 * Kimono Watch on the web (design/mockups/watch is the reference): who's
 * watching, then Home, New & hot and My list, with a title's page, search and
 * the player over them. Which page and which title are in the address, so a
 * reload or a link opens the same place.
 */

export type Person = { username: string; name: string; picture: string | null };
type Page = "home" | "hot" | "list" | "settings";

const faces = ["#7E3448", "#3E5236", "#5B3F45", "#8A5A2B", "#3F4A5B", "#5A4A2B"];
const faceOf = (username: string) => faces[[...username].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % faces.length];
const initial = (p: Person) => (p.name.trim() || p.username).charAt(0).toUpperCase();
const chosenKey = "kw.profile";
/** The "who's watching" picker. Off for now: Watch opens on whoever is signed in. The picker stays for when it comes back. */
export const PROFILE_PICKER = false;

/** The watch party in the address while this screen is in one, so a reload or the link rejoins it. */
let partyInUrl: string | null = null;
const readParty = () => { try { return new URLSearchParams(window.location.search).get("party"); } catch { return null; } };

function readPlace(): { page: Page; title: string | null } {
  const q = new URLSearchParams(window.location.search);
  const page = q.get("p");
  return { page: page === "hot" || page === "list" || page === "settings" ? page : "home", title: q.get("t") };
}
function writePlace(page: Page, title: string | null, push: boolean) {
  const q = new URLSearchParams();
  if (page !== "home") q.set("p", page);
  if (title) q.set("t", title);
  if (partyInUrl) q.set("party", partyInUrl);
  const url = `/watch${q.size ? `?${q}` : ""}`;
  if (`${window.location.pathname}${window.location.search}` === url) return;
  if (push) window.history.pushState(null, "", url); else window.history.replaceState(null, "", url);
}

export function WatchApp({ me, household, accent, signOut }: { me: Person; household: Person[]; accent: string; signOut: () => Promise<void> }) {
  /* Arriving by a party's link goes straight in: it can only be you. */
  const [profile, setProfile] = useState<Person | null>(() => { try { return !PROFILE_PICKER || readParty() || sessionStorage.getItem(chosenKey) === me.username ? me : null; } catch { return null; } });
  const [people, setPeople] = useState<Person[]>(household);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [asking, setAsking] = useState<{ titleId: string; season: number; episode: number; position: number } | null>(null);
  const [arriving, setArriving] = useState<string | null>(() => readParty());
  const [picking, setPicking] = useState<string | null>(null);
  const [page, setPage] = useState<Page>(() => readPlace().page);
  const [filter, setFilter] = useState<Shelf | null>(null);
  const [home, setHome] = useState<Home | null>(null);
  const [all, setAll] = useState<Home | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(() => readPlace().title);
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);
  const [marks, setMarks] = useState<Record<string, Marks>>({});
  const [scrolled, setScrolled] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  /* This person's settings: the player reads its subtitle look from here, Settings writes them. */
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const prefsRef = useRef(prefs);
  useLayoutEffect(() => { prefsRef.current = prefs; }, [prefs]);
  const root = useRef<HTMLDivElement>(null);
  const player = useRef<PlayerHandle>(null);
  const known = useRef(new Map<string, Card>());

  /* ───── Who's watching ───── */
  const say = useCallback((text: string) => setToast({ text, at: Date.now() }), []);
  useEffect(() => {
    const back = () => { const p = readPlace(); setPage(p.page); setSheetId(p.title); };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  const pick = (p: Person) => {
    if (p.username !== me.username) { say(`Only ${p.name.split(" ")[0] || p.username} can open their profile`); return; }
    setPicking(p.username);
    setTimeout(() => {
      setPicking(null); setProfile(p);
      try { sessionStorage.setItem(chosenKey, p.username); } catch { /* fine */ }
    }, 650);
  };

  /* ───── Home, and everything else built from it ───── */
  const filterRef = useRef<Shelf | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const moreBusy = useRef(false);
  const homeRef = useRef(home);
  useLayoutEffect(() => { homeRef.current = home; }, [home]);
  const remember = useCallback((h: Home) => {
    for (const row of h.rows) for (const card of row.items) known.current.set(card.id, { ...known.current.get(card.id), ...card });
  }, []);
  /* My list and New & hot read Home's own rows; they page until those have come. */
  const loadAll = useCallback(() => watchApi.homeUntil(["continue", "list"]).then((h) => { remember(h); setAll(h); }, () => {}), [remember]);
  /* Home again after a change elsewhere: the first page fresh, the pages already scrolled through kept after it. */
  const loadHome = useCallback(async (shelf: Shelf | null) => {
    try {
      const h = await watchApi.home(shelf);
      remember(h);
      setHome((now) => {
        if (shelf !== filterRef.current) return now;
        if (!now) return h;
        const fresh = new Set(h.rows.map((r) => r.id));
        return { ...h, rows: [...h.rows, ...now.rows.filter((r) => !fresh.has(r.id))], next: now.rows.length > h.rows.length ? now.next : h.next };
      });
      void loadAll();
    } catch { say("Watch isn't answering. Try again in a moment."); }
  }, [remember, say, loadAll]);
  const chooseShelf = (shelf: Shelf | null) => { filterRef.current = shelf; setHome(null); setMoreLoading(false); setFilter(shelf); };
  useEffect(() => {
    if (!profile) return;
    watchApi.home(filter).then((h) => { remember(h); if (filterRef.current === filter) setHome(h); }, () => say("Watch isn't answering. Try again in a moment."));
    void loadAll();
  }, [profile, filter, remember, say, loadAll]);
  /* Home goes on as long as you scroll: the next page when its last rows come near. */
  const loadMore = useCallback(() => {
    const now = homeRef.current, shelf = filterRef.current;
    if (!now?.next || moreBusy.current) return;
    moreBusy.current = true; setMoreLoading(true);
    watchApi.home(shelf, now.next).then((page) => {
      remember(page);
      setHome((h) => {
        if (!h || shelf !== filterRef.current || h.next !== now.next) return h;
        const have = new Set(h.rows.map((r) => r.id));
        return { ...h, rows: [...h.rows, ...page.rows.filter((r) => !have.has(r.id))], next: page.next ?? null };
      });
    }, () => {}).finally(() => { moreBusy.current = false; setMoreLoading(false); });
  }, [remember]);

  /* ───── The bar turns solid once the page moves ───── */
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const on = () => setScrolled(el.scrollTop > 40);
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, [profile]);
  const go = (to: Page) => {
    setPage(to); setSheetId(null); writePlace(to, null, true); root.current?.scrollTo(0, 0);
    /* Lists and what's coming change from other devices too: ask again. */
    if (to === "hot" || to === "list") void loadAll();
  };
  const goRef = useRef(go);
  useLayoutEffect(() => { goRef.current = go; });
  const switchProfile = () => { setProfile(null); try { sessionStorage.removeItem(chosenKey); } catch { /* fine */ } };
  useEffect(() => {
    if (!profile) return;
    watchApi.prefs().then(setPrefs, () => {});
  }, [profile]);

  /* ───── What every part can ask for ───── */
  const marksRef = useRef(marks);
  useLayoutEffect(() => { marksRef.current = marks; }, [marks]);
  const setMark = useCallback((id: string, change: Partial<Marks>) => setMarks((m) => ({ ...m, [id]: { ...(m[id] ?? { inList: false, rating: null, reminding: false }), ...change } })), []);
  const listIds = useMemo(() => new Set((all?.rows.find((r) => r.id === "list")?.items ?? []).map((c) => c.id)), [all]);

  const watch = useMemo<Watch>(() => ({
    firstName: (me.name.trim() || me.username).split(" ")[0],
    accent,
    toast: say,
    openTitle: (id) => { setSheetId(id); writePlace(readPlace().page, id, true); },
    prefs,
    updatePrefs: async (change) => {
      const before = prefsRef.current;
      setPrefs((p) => (p ? { ...p, ...change } : p));
      try { setPrefs(await watchApi.setPrefs(change)); if ("animeEpisodes" in change) setRefreshKey(Date.now()); return true; }
      catch { setPrefs(before); say("That didn't work."); return false; }
    },
    openSettings: () => goRef.current("settings"),
    play: (id, at) => { setPlaying(true); player.current?.start(id, at); },
    marksOf: (id) => marksRef.current[id] ?? { inList: listIds.has(id), rating: null, reminding: false },
    noteView: (view: TitleView) => setMark(view.title.id, { inList: view.inList, rating: view.rating, reminding: view.reminding }),
    setListed: (id, on) => {
      setMark(id, { inList: on });
      say(on ? "Added to My list" : "Removed from My list");
      watchApi.mark(id, { inList: on }).then(() => loadHome(filterRef.current))
        .catch(() => { setMark(id, { inList: !on }); say("That didn't work."); });
    },
    rate: (id, rating: Rating | null) => {
      setMark(id, { rating });
      say(rating ? { down: "Got it. We’ll show you less like this.", up: "Thanks. Rated.", love: "Love it. We’ll find more." }[rating] : "Rating removed");
      watchApi.mark(id, { rating }).catch(() => say("That didn't work."));
    },
    remind: (id, on, name) => {
      setMark(id, { reminding: on });
      say(on ? `We’ll let you know when ${name} arrives` : "Reminder off");
      watchApi.mark(id, { reminding: on }).catch(() => { setMark(id, { reminding: !on }); say("That didn't work."); });
    },
    known: () => [...known.current.values()],
    together: (id, at) => setAsking({ titleId: id, season: at?.season ?? 0, episode: at?.episode ?? 0, position: at?.position ?? 0 }),
  }), [me, accent, prefs, say, listIds, setMark, loadHome]);

  /* ───── Watch together: who's asked you, and starting one ───── */
  useEffect(() => {
    if (!profile) return;
    let stop = false;
    const look = () => together.list().then((l) => { if (stop) return; setPeople(l.people.length ? l.people : household); setInvites(l.parties.filter((p) => p.invited)); }, () => {});
    look();
    const timer = setInterval(() => { if (!document.hidden) look(); }, 15_000);
    return () => { stop = true; clearInterval(timer); };
  }, [profile, household]);
  const joinParty = useCallback((id: string) => {
    setArriving(null); setSheetId(null); setPlaying(true);
    player.current?.join(id);
  }, []);
  const onParty = useCallback((id: string | null) => {
    partyInUrl = id;
    /* In a party the player is the page: no title sheet under it. */
    writePlace(readPlace().page, id ? null : readPlace().title, false);
  }, []);
  const startParty = async (invite: string[]) => {
    const what = asking;
    if (!what) return;
    setAsking(null);
    try {
      const state = await together.create({ ...what, client: screenId(), invite });
      if (invite.length) say(invite.length === 1 ? `Invited ${(people.find((p) => p.username.toLowerCase() === invite[0])?.name ?? invite[0]).split(" ")[0]}` : `Invited ${invite.length} people`);
      joinParty(state.id);
    } catch (error) { say(error instanceof Error ? error.message : "That didn't work."); }
  };
  const fromPlayer = useCallback(() => {
    const here = player.current?.where();
    if (here) setAsking(here);
  }, []);
  const invite = invites.find((p) => !dismissed.includes(p.id));

  const exitPlayer = useCallback((changed: boolean) => {
    setPlaying(false);
    if (changed) { void loadHome(filterRef.current); setRefreshKey(Date.now()); }
  }, [loadHome]);

  const closeSheet = () => { setSheetId(null); writePlace(readPlace().page, null, false); };
  const locked = Boolean(sheetId || searching || playing);

  const hotIds = all ? [...new Set(all.rows.filter((r) => r.id === "continue" || r.id === "list").flatMap((r) => r.items.filter((c) => c.kind === "series").map((c) => c.id)))] : null;
  const listCards = all ? all.rows.find((r) => r.id === "list")?.items ?? [] : null;

  return <WatchContext.Provider value={watch}>
    {/* Shippori Mincho's heavy cut, for titles; the Portal carries only the 600. */}
    {/* eslint-disable-next-line @next/next/no-page-custom-font -- an App Router page, loaded with it */}
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@600;800&display=swap" precedence="default" />
    <div ref={root} className={cx("kw", locked && "kw-locked")}>
      {!profile ? <section className="kw-profiles" aria-label="Choose a profile">
        <div>
          <WatchBloom accent={accent} className="kw-bloom-lg" />
          <h1>Who’s watching?</h1>
          <div className={cx("kw-who", picking && "kw-busy")}>
            {household.map((p) => <button key={p.username} className={cx(picking === p.username && "kw-loading", p.username !== me.username && "kw-other")} onClick={() => pick(p)}>
              <span className="kw-face" style={{ background: faceOf(p.username) }}>
                {picking === p.username ? <InkLoader tone="plain" label="Opening" className="kw-face-wait" />
                  : p.picture
                    // eslint-disable-next-line @next/next/no-img-element -- the Portal's own portrait
                    ? <img src={p.picture} alt="" /> : initial(p)}
              </span>
              <span className="kw-name">{p.name.split(" ")[0] || p.username}</span>
            </button>)}
          </div>
        </div>
      </section> : <div>
        <header className={cx("kw-topbar", (scrolled || page !== "home") && "kw-solid")}>
          <button className="kw-brand" onClick={() => go("home")} aria-label="Kimono Watch home"><AppLockup identity={{ id: watchId, name: "Watch", accent, glyph: "play" }} /></button>
          <nav className="kw-topnav" aria-label="Sections">
            <button aria-current={page === "home" ? "page" : undefined} onClick={() => go("home")}>Home</button>
            <button aria-current={page === "hot" ? "page" : undefined} onClick={() => go("hot")}>New &amp; hot</button>
            <button aria-current={page === "list" ? "page" : undefined} onClick={() => go("list")}>My list</button>
          </nav>
          <div className="kw-spacer" />
          <button className="kw-iconbtn" aria-label="Search" onClick={() => setSearching(true)}><Icon name="search" /></button>
          <button className="kw-iconbtn" aria-label="Settings" aria-current={page === "settings" ? "page" : undefined} onClick={() => go("settings")}><Icon name="gear" /></button>
          <AccountMenu profile={profile} onSettings={() => go("settings")} onSwitch={switchProfile} />
        </header>
        {page === "home" ? <HomePage home={home} filter={filter} setFilter={chooseShelf} chipsAway={scrolled} more={moreLoading} onMore={loadMore} />
          : page === "settings" ? <SettingsPage me={me} onSwitch={switchProfile} signOut={signOut} />
          : page === "hot" ? <HotPage ids={hotIds} />
            : <ListPage cards={listCards} />}
        <nav className="kw-bnav" aria-label="Sections">
          {([["home", "home", "Home"], ["hot", "hot", "New & hot"], ["list", "bookmark", "My list"]] as const).map(([to, icon, label]) => <button key={to} aria-current={page === to ? "page" : undefined} onClick={() => go(to)}>
            <span className="kw-pill"><Icon name={icon} /></span>{label}
          </button>)}
        </nav>
      </div>}
      {searching ? <SearchPage onClose={() => setSearching(false)} /> : null}
      {sheetId && profile ? <TitleSheet key={sheetId} id={sheetId} onClose={closeSheet} refreshKey={refreshKey} /> : null}
      <Player ref={player} onExit={exitPlayer} me={me.username} people={people} onTogether={fromPlayer} onParty={onParty} />
      {asking ? <TogetherDialog people={people.filter((p) => p.username.toLowerCase() !== me.username.toLowerCase())} onStart={(list) => void startParty(list)} onClose={() => setAsking(null)} /> : null}
      {arriving && profile && !playing ? <Arriving id={arriving} people={people} onJoin={() => joinParty(arriving)} onClose={() => { setArriving(null); partyInUrl = null; writePlace(readPlace().page, readPlace().title, false); }} /> : null}
      {invite && profile && !playing && !arriving ? <div className="kw-invite" role="status">
        <InviteFace person={people.find((x) => x.username.toLowerCase() === invite.host) ?? { username: invite.host, name: invite.hostName, picture: null }} />
        <div><b>{invite.hostName.split(" ")[0]} is watching {invite.title?.name ?? "something"}</b><span>{invite.season ? `S${invite.season}:E${invite.episode} · ` : ""}Watch together?</span></div>
        <button className="kw-btn kw-tonal" onClick={() => { setDismissed((d) => [...d, invite.id]); void together.decline(invite.id); }}>Not now</button>
        <button className="kw-btn kw-primary" onClick={() => joinParty(invite.id)}><Icon name="play" />Join</button>
      </div> : null}
      <Toast message={toast} />
    </div>
  </WatchContext.Provider>;
}

/* ───── The avatar's menu: this device's quality, and switching profile ───── */
function AccountMenu({ profile, onSwitch, onSettings }: { profile: Person; onSwitch: () => void; onSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => setShown(true));
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) { setOpen(false); setShown(false); } };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); setShown(false); } };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", key); };
  }, [open]);
  const close = () => { setOpen(false); setShown(false); };
  /* About the person only: switching, settings, and the Kimono account. */
  return <div className="kw-sdrop kw-account" ref={box}>
    <button className="kw-avatar" aria-label="Account" aria-haspopup="menu" aria-expanded={open} style={{ background: faceOf(profile.username), overflow: "hidden", padding: 0 }} onClick={() => { setOpen(!open); setShown(false); }}>
      {profile.picture
        // eslint-disable-next-line @next/next/no-img-element -- the Portal's own portrait
        ? <img src={profile.picture} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initial(profile)}
    </button>
    {open ? <div className={cx("kw-smenu", shown && "kw-on")} role="menu">
      <p className="kw-menu-h">{profile.name}</p>
      {PROFILE_PICKER ? <button role="menuitem" onClick={() => { close(); onSwitch(); }}><span /><b>Switch profile</b><span /></button> : null}
      <button role="menuitem" onClick={() => { close(); onSettings(); }}><span /><b>Settings</b><span /></button>
      <Crossing kind="shoji" role="menuitem" className="kw-menu-link" href="/account" onClick={close}><span /><b>Kimono account</b><span /></Crossing>
    </div> : null}
  </div>;
}

/* ───── Watch together: who to ask, and arriving by a link ───── */
function InviteFace({ person }: { person: Person }) {
  return <span className="kw-face-s" style={{ background: faceOf(person.username) }}>
    {person.picture
      // eslint-disable-next-line @next/next/no-img-element -- the Portal's own portrait
      ? <img src={person.picture} alt="" /> : initial(person)}
  </span>;
}

function TogetherDialog({ people, onStart, onClose }: { people: Person[]; onStart: (usernames: string[]) => void; onClose: () => void }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", key, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", key, true); };
  }, [onClose]);
  const flip = (u: string) => setChosen((c) => (c.includes(u) ? c.filter((x) => x !== u) : [...c, u]));
  return <div className={cx("kw-dialog", shown && "kw-on")} role="dialog" aria-modal="true" aria-label="Watch together" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="kw-dialog-box">
      <h3>Watch together</h3>
      {people.length ? <div className="kw-who kw-who-s">
        {people.map((p) => <button key={p.username} aria-pressed={chosen.includes(p.username.toLowerCase())} onClick={() => flip(p.username.toLowerCase())}>
          <span className="kw-face" style={{ background: faceOf(p.username) }}>
            {p.picture
              // eslint-disable-next-line @next/next/no-img-element -- the Portal's own portrait
              ? <img src={p.picture} alt="" /> : initial(p)}
            <span className="kw-tick"><Icon name="check" /></span>
          </span>
          <span className="kw-name">{p.name.split(" ")[0] || p.username}</span>
        </button>)}
      </div> : <p>Share the link from the player once it starts.</p>}
      <div className="kw-btns">
        <button className="kw-btn kw-tonal" onClick={onClose}>Cancel</button>
        <button className="kw-btn kw-primary" onClick={() => onStart(chosen)}><Icon name="play" />{chosen.length ? "Start and invite" : "Start"}</button>
      </div>
    </div>
  </div>;
}

function Arriving({ id, people, onJoin, onClose }: { id: string; people: Person[]; onJoin: () => void; onClose: () => void }) {
  const [what, setWhat] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => {
    together.peek(id).then(({ state, title }) => {
      const host = people.find((p) => p.username.toLowerCase() === state.host)?.name.split(" ")[0] ?? state.host;
      setWhat({ text: title ? `${host} is watching ${title.name}` : `${host} is watching`, ok: true });
    }, (error) => setWhat({ text: error instanceof Error ? error.message : "That didn't work.", ok: false }));
  }, [id, people]);
  return <div className="kw-dialog kw-on" role="dialog" aria-modal="true" aria-label="Join the watch party">
    <div className="kw-dialog-box">
      <h3>{what ? what.text : "Watch together"}</h3>
      <div className="kw-btns">
        <button className="kw-btn kw-tonal" onClick={onClose}>{what?.ok === false ? "Close" : "Not now"}</button>
        {what?.ok !== false ? <button className="kw-btn kw-primary" disabled={!what} onClick={onJoin}><Icon name="play" />Join</button> : null}
      </div>
    </div>
  </div>;
}

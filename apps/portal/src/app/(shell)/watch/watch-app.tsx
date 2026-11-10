"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { qualities, saveQuality, savedQuality, watchApi, type Card, type Home, type Rating, type Shelf, type TitleView } from "./api";
import { AppLockup } from "@kimono/ui";
import { cx, Toast, watchId, WatchBloom, WatchContext, type Marks, type Watch } from "./bits";
import { HomePage } from "./home";
import { InkLoader } from "@kimono/ui";
import { Icon } from "./icons";
import { HotPage, ListPage, SearchPage } from "./pages";
import { Player, type PlayerHandle } from "./player";
import { TitleSheet } from "./title";

/*
 * 観 Kimono Watch on the web (design/mockups/watch is the reference): who's
 * watching, then Home, New & hot and My list, with a title's page, search and
 * the player over them. Which page and which title are in the address, so a
 * reload or a link opens the same place.
 */

export type Person = { username: string; name: string; picture: string | null };
type Page = "home" | "hot" | "list";

const faces = ["#7E3448", "#3E5236", "#5B3F45", "#8A5A2B", "#3F4A5B", "#5A4A2B"];
const faceOf = (username: string) => faces[[...username].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % faces.length];
const initial = (p: Person) => (p.name.trim() || p.username).charAt(0).toUpperCase();
const chosenKey = "kw.profile";

function readPlace(): { page: Page; title: string | null } {
  const q = new URLSearchParams(window.location.search);
  const page = q.get("p");
  return { page: page === "hot" || page === "list" ? page : "home", title: q.get("t") };
}
function writePlace(page: Page, title: string | null, push: boolean) {
  const q = new URLSearchParams();
  if (page !== "home") q.set("p", page);
  if (title) q.set("t", title);
  const url = `/watch${q.size ? `?${q}` : ""}`;
  if (`${window.location.pathname}${window.location.search}` === url) return;
  if (push) window.history.pushState(null, "", url); else window.history.replaceState(null, "", url);
}

export function WatchApp({ me, household, accent }: { me: Person; household: Person[]; accent: string }) {
  const [profile, setProfile] = useState<Person | null>(() => { try { return sessionStorage.getItem(chosenKey) === me.username ? me : null; } catch { return null; } });
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
  const remember = useCallback((h: Home) => {
    for (const row of h.rows) for (const card of row.items) known.current.set(card.id, { ...known.current.get(card.id), ...card });
  }, []);
  const loadHome = useCallback(async (shelf: Shelf | null) => {
    try {
      const h = await watchApi.home(shelf);
      remember(h);
      if (!shelf) setAll(h);
      setHome((now) => (shelf === filterRef.current ? h : now));
    } catch { say("Watch isn't answering. Try again in a moment."); }
  }, [remember, say]);
  const chooseShelf = (shelf: Shelf | null) => { filterRef.current = shelf; setHome(null); setFilter(shelf); };
  useEffect(() => {
    if (!profile) return;
    watchApi.home(filter).then((h) => { remember(h); if (!filter) setAll(h); if (filterRef.current === filter) setHome(h); }, () => say("Watch isn't answering. Try again in a moment."));
    if (filter) watchApi.home(null).then((h) => { remember(h); setAll(h); }, () => {});
  }, [profile, filter, remember, say]);

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
    if (to !== "home") watchApi.home(null).then((h) => { remember(h); setAll(h); }, () => {});
  };

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
    play: (id, at) => { setPlaying(true); player.current?.start(id, at); },
    marksOf: (id) => marksRef.current[id] ?? { inList: listIds.has(id), rating: null, reminding: false },
    noteView: (view: TitleView) => setMark(view.title.id, { inList: view.inList, rating: view.rating, reminding: view.reminding }),
    setListed: (id, on) => {
      setMark(id, { inList: on });
      say(on ? "Added to My list" : "Removed from My list");
      watchApi.mark(id, { inList: on }).then(() => loadHome(filterRef.current)).then(() => (filterRef.current ? watchApi.home(null).then((h) => { remember(h); setAll(h); }) : undefined))
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
  }), [me, accent, say, listIds, setMark, loadHome, remember]);

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
          <AccountMenu profile={profile} onSwitch={() => { setProfile(null); try { sessionStorage.removeItem(chosenKey); } catch { /* fine */ } }} />
        </header>
        {page === "home" ? <HomePage home={home} filter={filter} setFilter={chooseShelf} chipsAway={scrolled} />
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
      <Player ref={player} onExit={exitPlayer} />
      <Toast message={toast} />
    </div>
  </WatchContext.Provider>;
}

/* ───── The avatar's menu: this device's quality, and switching profile ───── */
function AccountMenu({ profile, onSwitch }: { profile: Person; onSwitch: () => void }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [quality, setQuality] = useState(savedQuality);
  const [say, setSay] = useState<{ text: string; at: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  /* The server keeps this device's choice; the copy here only saves a flash of the old one. */
  useEffect(() => {
    watchApi.deviceQuality().then((q) => { const v = q ?? "auto"; setQuality(v); saveQuality(v); }, () => {});
  }, []);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => setShown(true));
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) { setOpen(false); setShown(false); } };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); setShown(false); } };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", key); };
  }, [open]);
  const pick = (value: string) => {
    const before = quality;
    setQuality(value); saveQuality(value);
    watchApi.setDeviceQuality(value).then(() => setSay({ text: "Saved for this device", at: Date.now() }), () => { setQuality(before); saveQuality(before); setSay({ text: "That didn't work.", at: Date.now() }); });
  };
  return <div className="kw-sdrop kw-account" ref={box}>
    <button className="kw-avatar" aria-label="Account" aria-haspopup="menu" aria-expanded={open} style={{ background: faceOf(profile.username), overflow: "hidden", padding: 0 }} onClick={() => { setOpen(!open); setShown(false); }}>
      {profile.picture
        // eslint-disable-next-line @next/next/no-img-element -- the Portal's own portrait
        ? <img src={profile.picture} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initial(profile)}
    </button>
    {open ? <div className={cx("kw-smenu", shown && "kw-on")} role="menu">
      <p className="kw-menu-h">Quality on this device</p>
      {qualities.map((q) => <button key={q.value} role="menuitemradio" aria-checked={quality === q.value} onClick={() => pick(q.value)}><Icon name="check" /><b>{q.label}</b><span /></button>)}
      <div className="kw-menu-rule" />
      <button role="menuitem" onClick={() => { setOpen(false); onSwitch(); }}><span /><b>Switch profile</b><span /></button>
    </div> : null}
    <Toast message={say} />
  </div>;
}

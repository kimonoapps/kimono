"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { watchApi, type Card, type Home, type Prefs, type Rating, type Shelf, type TitleView } from "./api";
import { AppLockup, KimonoBranch } from "@kimono/ui";
import { Crossing, useCrossTo } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import { circleSettled, placeReady } from "@/components/immersive";
import { cx, faceOf, initial, Spinner, Toast, watchId, WatchBloom, WatchContext, type Marks, type Watch } from "./bits";
import { FriendsPage, FriendsRow, JoinAsks } from "./friends";
import { HomePage } from "./home";
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
type Page = "home" | "hot" | "list" | "friends" | "settings";

const chosenKey = "kw.profile";
/** The "who's watching" picker. Off for now: Watch opens on whoever is signed in. The picker stays for when it comes back. */
export const PROFILE_PICKER = false;

/** The watch party in the address while this screen is in one, so a reload or the link rejoins it. */
let partyInUrl: string | null = null;
const readParty = () => { try { return new URLSearchParams(window.location.search).get("party"); } catch { return null; } };

function readPlace(): { page: Page; title: string | null } {
  const q = new URLSearchParams(window.location.search);
  const page = q.get("p");
  return { page: page === "hot" || page === "list" || page === "friends" || page === "settings" ? page : "home", title: q.get("t") };
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

export function WatchApp({ me, household, accent, signOut, phoneApp = false }: { me: Person; household: Person[]; accent: string; signOut: () => Promise<void>; phoneApp?: boolean }) {
  /* Arriving by a party's link goes straight in: it can only be you. */
  const [profile, setProfile] = useState<Person | null>(() => { try { return !PROFILE_PICKER || readParty() || sessionStorage.getItem(chosenKey) === me.username ? me : null; } catch { return null; } });
  const [people, setPeople] = useState<Person[]>(household);
  /* Their friends, the ones watched with lately first: what Watch together suggests. */
  const [friends, setFriends] = useState<string[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [parties, setParties] = useState<Invite[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [asking, setAsking] = useState<{ titleId: string; season: number; episode: number; position: number } | null>(null);
  const [arriving, setArriving] = useState<string | null>(() => readParty());
  const [picking, setPicking] = useState<string | null>(null);
  const [page, setPage] = useState<Page>(() => readPlace().page);
  const [sheetLeaving, setSheetLeaving] = useState(false);
  const [filter, setFilter] = useState<Shelf | null>(null);
  const [home, setHome] = useState<Home | null>(null);
  const [all, setAll] = useState<Home | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(() => readPlace().title);
  const sheetIdRef = useRef(sheetId);
  useLayoutEffect(() => { sheetIdRef.current = sheetId; }, [sheetId]);
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
    const back = () => {
      const p = readPlace();
      setPage(p.page);
      /* Back from a title's page: it closes the way its × does, then goes. */
      if (sheetIdRef.current && !p.title) setSheetLeaving(true);
      else { setSheetLeaving(false); setSheetId(p.title); }
    };
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
  const loadAll = useCallback(() => watchApi.homeUntil(["continue", "list"]).then(async (h) => { remember(h); await circleSettled(); setAll(h); }, () => {}), [remember]);
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

  /* Opening Watch, the circle waits until this first screen is drawn
     (components/immersive): the profiles, or home with its rows. */
  useEffect(() => { if (!profile || home) placeReady(); }, [profile, home]);
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
    watchApi.prefs().then(async (p) => { await circleSettled(); setPrefs(p); }, () => {});
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
    openTitle: (id) => { setSheetLeaving(false); setSheetId(id); writePlace(readPlace().page, id, true); },
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
    forget: async (id) => {
      try { await watchApi.forget(id); } catch { say("That didn't work."); return false; }
      /* Off Continue watching at once; the rows come again behind it. */
      setHome((now) => now ? { ...now, rows: now.rows.map((r) => r.id === "continue" ? { ...r, items: r.items.filter((c) => c.id !== id) } : r).filter((r) => r.items.length) } : now);
      say("Removed from history");
      void loadHome(filterRef.current);
      return true;
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
    const look = () => together.list().then(async (l) => { await circleSettled(); if (stop) return; setPeople(l.people.length ? l.people : household); setFriends(l.friends ?? []); setInvites(l.parties.filter((p) => p.invited)); setParties(l.parties); }, () => {});
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
  const startParty = async (invite: string[], copy: boolean) => {
    const what = asking;
    if (!what) return;
    setAsking(null);
    const made = together.create({ ...what, client: screenId(), invite });
    /* Copied while the click still counts: the clipboard waits on the party's link. */
    const link = made.then((state) => `${location.origin}/watch?party=${state.id}`);
    const copied = copy ? copyLater(link) : null;
    try {
      const state = await made;
      const invited = invite.length === 1 ? `Invited ${(people.find((p) => p.username.toLowerCase() === invite[0])?.name ?? invite[0]).split(" ")[0]}` : invite.length ? `Invited ${invite.length} people` : "";
      const ok = copied ? await copied.then(() => true, () => false) : false;
      const said = [invited, ok ? "Link copied" : ""].filter(Boolean).join(" · ");
      if (said) say(said);
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

  const closeSheet = () => { setSheetLeaving(false); setSheetId(null); writePlace(readPlace().page, null, false); };
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
                {picking === p.username ? <Spinner color="currentColor" label="Opening" className="kw-face-wait" />
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
            <button aria-current={page === "friends" ? "page" : undefined} onClick={() => go("friends")}>Friends</button>
            <button aria-current={page === "list" ? "page" : undefined} onClick={() => go("list")}>My list</button>
          </nav>
          <div className="kw-spacer" />
          <button className="kw-iconbtn" aria-label="Search" onClick={() => setSearching(true)}><Icon name="search" /></button>
          <button className="kw-iconbtn" aria-label="Settings" aria-current={page === "settings" ? "page" : undefined} onClick={() => go("settings")}><Icon name="gear" /></button>
          <AccountMenu profile={profile} people={people} parties={parties} onJoin={joinParty} onSwitch={switchProfile} phoneApp={phoneApp} />
          <Crossing kind="shoji" href="/" className="kw-tokimono" aria-label="Back to Kimono" title="Back to Kimono"><KimonoBranch /></Crossing>
        </header>
        {page === "home" ? <HomePage home={home} filter={filter} setFilter={chooseShelf} chipsAway={scrolled} more={moreLoading} onMore={loadMore} friends={<FriendsRow onJoin={joinParty} onAll={() => go("friends")} />} />
          : page === "settings" ? <SettingsPage me={me} onSwitch={switchProfile} signOut={signOut} />
          : page === "hot" ? <HotPage ids={hotIds} />
          : page === "friends" ? <FriendsPage onJoin={joinParty} />
            : <ListPage cards={listCards} />}
        <nav className="kw-bnav" aria-label="Sections">
          {([["home", "home", "Home"], ["friends", "group", "Friends"], ["list", "bookmark", "My list"]] as const).map(([to, icon, label]) => <button key={to} aria-current={page === to ? "page" : undefined} onClick={() => go(to)}>
            <span className="kw-pill"><Icon name={icon} /></span>{label}
          </button>)}
        </nav>
      </div>}
      {searching ? <SearchPage onClose={() => setSearching(false)} /> : null}
      {sheetId && profile ? <TitleSheet key={sheetId} id={sheetId} onClose={closeSheet} refreshKey={refreshKey} leaving={sheetLeaving} /> : null}
      <Player ref={player} onExit={exitPlayer} me={me.username} people={people} onTogether={fromPlayer} onParty={onParty} />
      <JoinAsks open={playing} partyOf={() => player.current?.party() ?? null} where={() => player.current?.where() ?? null} onJoin={joinParty} />
      {asking ? <TogetherDialog people={people.filter((p) => p.username.toLowerCase() !== me.username.toLowerCase())} friends={friends} onStart={(list, copy) => void startParty(list, copy)} onClose={() => setAsking(null)} /> : null}
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

/* ───── The avatar's menu: you, who you watch with, the phone app, and your Kimono account ───── */
function AccountMenu({ profile, people, parties, onJoin, onSwitch, phoneApp }: { profile: Person; people: Person[]; parties: Invite[]; onJoin: (id: string) => void; onSwitch: () => void; phoneApp: boolean }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const crossTo = useCrossTo();
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => setShown(true));
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", key); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  /* The menu folds away first, then Watch closes over wherever you're going. */
  const close = () => { setShown(false); setTimeout(() => setOpen(false), 160); };
  const leave = (href: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    close();
    setTimeout(() => crossTo("shoji", href), 140);
  };
  const me = profile.username.toLowerCase();
  const others = people.filter((p) => p.username.toLowerCase() !== me);
  const live = parties.filter((p) => p.host !== me || p.watching.length > 1);
  const watching = new Set(parties.flatMap((p) => p.watching.map((u) => u.toLowerCase())));
  const personOf = (u: string) => people.find((x) => x.username.toLowerCase() === u.toLowerCase());
  return <div className="kw-sdrop kw-account" ref={box}>
    <button className="kw-avatar" aria-label="Account" aria-haspopup="menu" aria-expanded={open} style={{ background: faceOf(profile.username), overflow: "hidden", padding: 0 }} onClick={() => (open ? close() : setOpen(true))}>
      {profile.picture
        // eslint-disable-next-line @next/next/no-img-element -- the Portal's own portrait
        ? <img src={profile.picture} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initial(profile)}
    </button>
    {live.length ? <i className="kw-live-dot" aria-hidden="true" /> : null}
    {open ? <div className={cx("kw-smenu kw-amenu", shown && "kw-on")} role="menu">
      <div className="kw-am-me"><InviteFace person={profile} /><span><b>{profile.name}</b><small>{profile.username}</small></span></div>
      {live.length ? <>
        <div className="kw-menu-rule" />
        <p className="kw-menu-h">Watching now</p>
        {live.map((p) => {
          const host = personOf(p.host) ?? { username: p.host, name: p.hostName, picture: null };
          const with_ = p.watching.filter((u) => u.toLowerCase() !== p.host);
          return <div key={p.id} className="kw-am-party">
            <span className="kw-am-faces"><InviteFace person={host} />{with_.slice(0, 2).map((u) => <InviteFace key={u} person={personOf(u) ?? { username: u, name: u, picture: null }} />)}</span>
            <span><b>{p.host === me ? "Your party" : `${(p.hostName || p.host).split(" ")[0]}${with_.length ? ` +${with_.length}` : ""}`}</b><small>{p.title?.name ?? "Picking something"}{p.season ? ` · S${p.season}:E${p.episode}` : ""}</small></span>
            <button className="kw-btn kw-tonal" onClick={() => { close(); onJoin(p.id); }}>{p.watching.some((u) => u.toLowerCase() === me) ? "Back in" : "Join"}</button>
          </div>;
        })}
      </> : null}
      {others.length ? <>
        <div className="kw-menu-rule" />
        <p className="kw-menu-h">Watch together with</p>
        <div className="kw-am-people">{others.slice(0, 10).map((p) => <span key={p.username} title={watching.has(p.username.toLowerCase()) ? `${p.name} is watching` : p.name} className={cx(watching.has(p.username.toLowerCase()) && "kw-on")}>
          <InviteFace person={p} /><small>{(p.name || p.username).split(" ")[0]}</small>
        </span>)}</div>
      </> : null}
      <div className="kw-menu-rule" />
      {PROFILE_PICKER ? <button role="menuitem" onClick={() => { close(); onSwitch(); }}><Icon name="group" /><b>Switch profile</b><span /></button> : null}
      {phoneApp ? <a role="menuitem" className="kw-menu-link" href="/get-app" onClick={leave("/get-app")}><LineIcon name="phone" /><b>Get the Kimono app</b><span /></a> : null}
      <a role="menuitem" className="kw-menu-link" href="/account" onClick={leave("/account")}><LineIcon name="user" /><b>Kimono account</b><span /></a>
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

/** Writes [text] to the clipboard once it's known, starting now so the click still counts (Safari asks that). */
function copyLater(text: Promise<string>): Promise<void> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      return navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) })]);
    }
  } catch { /* falls through */ }
  return text.then((t) => navigator.clipboard.writeText(t));
}

/* Start a party: a link to share, and anyone you look up by name. */
function TogetherDialog({ people, friends, onStart, onClose }: { people: Person[]; friends: string[]; onStart: (usernames: string[], copy: boolean) => void; onClose: () => void }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", key, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", key, true); };
  }, [onClose]);
  const q = query.trim().toLowerCase();
  /* Before anything is typed, their friends are suggested (the ones watched with lately first); typing finds anyone. */
  const found = q ? people.filter((p) => !chosen.includes(p.username.toLowerCase()) && (p.name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q))).slice(0, 5)
    : friends.filter((u) => !chosen.includes(u.toLowerCase())).map((u) => people.find((p) => p.username.toLowerCase() === u.toLowerCase())).filter((p): p is Person => Boolean(p)).slice(0, 5);
  const picked = chosen.map((u) => people.find((p) => p.username.toLowerCase() === u)).filter((p): p is Person => Boolean(p));
  const field = useRef<HTMLInputElement>(null);
  const add = (u: string) => { setChosen((c) => [...c, u]); setQuery(""); field.current?.focus(); };
  return <div className={cx("kw-dialog", shown && "kw-on")} role="dialog" aria-modal="true" aria-label="Watch together" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="kw-dialog-box kw-together">
      <h3>Watch together</h3>
      {people.length ? <div className="kw-tg">
        <label className="kw-tg-field">
          <Icon name="search" />
          <input ref={field} autoFocus value={query} placeholder="Invite someone" aria-label="Invite someone" onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && found[0]) { event.preventDefault(); add(found[0].username.toLowerCase()); } if (event.key === "Backspace" && !query && chosen.length) setChosen((c) => c.slice(0, -1)); }} />
        </label>
        {found.length ? <div className="kw-tg-found" role="listbox">
          {found.map((p) => <button key={p.username} role="option" aria-selected={false} onClick={() => add(p.username.toLowerCase())}>
            <InviteFace person={p} /><b>{p.name || p.username}</b><span>{p.username}</span>
          </button>)}
        </div> : q ? <p className="kw-tg-none">No one by that name</p> : null}
        {picked.length ? <div className="kw-tg-chips">
          {picked.map((p) => <button key={p.username} aria-label={`Remove ${p.name || p.username}`} onClick={() => setChosen((c) => c.filter((u) => u !== p.username.toLowerCase()))}>
            <InviteFace person={p} />{(p.name || p.username).split(" ")[0]}<Icon name="close" />
          </button>)}
        </div> : null}
      </div> : null}
      <div className="kw-btns">
        <button className="kw-btn kw-tonal" onClick={onClose}>Cancel</button>
        <button className="kw-btn kw-tonal" onClick={() => onStart(chosen, true)}><Icon name="link" />Copy link</button>
        <button className="kw-btn kw-primary" onClick={() => onStart(chosen, false)}><Icon name="play" />Start</button>
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

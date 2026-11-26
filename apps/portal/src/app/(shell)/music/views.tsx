"use client";

import { Crossing, useCrossTo } from "@/components/crossing";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppLockup, cx, InkPortraitFrame, Seal, type AppIdentity, BackButton, Carousel, PageHeader, SearchField, SectionHeader } from "@kimono/ui";
import { useTabTitle } from "@/components/tab-title";
import { ago, byline, clock, forget, hrefOf, length, musicApi, share, songKeyOf, useMusic, type Album, type FriendListening, type Person, type PlaylistPage, type Track } from "./api";
import { InkSheet } from "@/components/ink-sheet";
import { ImportSheet } from "./import-ui";
import { askName, askSure } from "./ask";
import { Icon } from "./icons";
import { Portrait } from "@/components/portrait";
import { AddToPlaylist, AlbumCard, ArtistCard, Bars, Cover, Head, Loading, MoreButton, Mosaic, PlayActions, playlistItems, Problem, RateMarks, SetCard, Shelf, Songs } from "./parts";
import { RecommendSheet } from "../account/friends/friends-ui";
import { Faces, useFriendParties, useParty } from "./party-ui";
import { usePlayer } from "./player";

/* ── Along the top of every page: search, and where you are ────────────── */

export function TopBar({ app }: { app: AppIdentity }) {
  const router = useRouter();
  const path = usePathname();
  const home = path === "/music";
  /* Pages opened inside Music this visit: back goes to the last of them, else up to Music's home. */
  const steps = useRef(-1);
  useEffect(() => { steps.current += 1; }, [path]);
  const params = useSearchParams();
  const onSearch = path === "/music/search";
  const crossTo = useCrossTo();
  const [text, setText] = useState(onSearch ? params.get("q") ?? "" : "");
  /* Leaving search empties the field (set while drawing, as React has it for a change from outside). */
  const [wasSearch, setWasSearch] = useState(onSearch);
  if (wasSearch !== onSearch) { setWasSearch(onSearch); if (!onSearch) setText(""); }
  useEffect(() => {
    const slash = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (e.key === "/" && el?.tagName !== "INPUT" && el?.tagName !== "TEXTAREA") { e.preventDefault(); document.querySelector<HTMLInputElement>(".km-search input")?.focus(); }
    };
    addEventListener("keydown", slash);
    return () => removeEventListener("keydown", slash);
  }, []);
  /*
   * Typing searches as you go. The first letter elsewhere opens the results at once, without a page's
   * crossing; after that only the address changes (no reload, no animation), so back still returns to them.
   */
  useEffect(() => {
    if (!onSearch && !text.trim()) return;
    const url = text.trim() ? `/music/search?q=${encodeURIComponent(text.trim())}` : "/music/search";
    if (!onSearch) {
      // eslint-disable-next-line no-restricted-syntax -- opening search from the field itself: the field stays put, so there's no crossing
      router.push(url, { scroll: false });
      return;
    }
    const t = setTimeout(() => { window.history.replaceState(null, "", url); }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on what's typed
  }, [text]);
  return <div className="km-top">
    <div className="km-top-start">
      {home ? null : <BackButton className="km-back" onClick={() => { if (steps.current > 0) { steps.current -= 2; history.back(); } else crossTo("kakejiku", "/music"); }} />}
      <Crossing kind="kakejiku" href="/music" className="km-brand" aria-label="Kimono Music, home"><AppLockup identity={app} /></Crossing>
      <nav className="km-tabs" aria-label="Music">
        <Crossing kind="kakejiku" href="/music" aria-current={path === "/music" ? "page" : undefined}>Home</Crossing>
        <Crossing kind="kakejiku" href="/music/you" aria-current={path === "/music/you" ? "page" : undefined}>You</Crossing>
      </nav>
    </div>
    <SearchField className="km-search" value={text} onChange={setText} placeholder="Songs, albums, artists" label="Search Music"
      onKeyDown={(e) => { if (e.key === "Escape") { setText(""); e.currentTarget.blur(); } }} />
  </div>;
}

/* ── Home ──────────────────────────────────────────────────────────────── */

const greeting = () => { const h = new Date().getHours(); return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

export function HomeView() {
  useTabTitle(undefined, "Kimono Music");
  const p = usePlayer();
  const { data: home, error, retry } = useMusic("home", musicApi.home);
  const { data: friends } = useMusic("friends", () => musicApi.friends().then((r) => r.friends));
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!home) return <Loading />;
  const first = p.you.name.split(/\s+/)[0];
  const personal = home.listenAgain.length >= 6;
  const chart = <section className="km-chart">
    <SectionHeader title={personal ? "Popular right now" : home.charts.title}><Crossing kind="kakejiku" className="k-see-all" href={hrefOf.mix("chart")}>See all</Crossing></SectionHeader>
    <Songs tracks={home.charts.items.slice(0, 10)} source={{ kind: "mix", id: "chart", title: home.charts.title }} numbered className="km-chart-songs" />
  </section>;
  return <div className="km-page km-home">
    <header className="km-hello">
      <Crossing kind="kakejiku" href="/music/you" className="km-hello-you" aria-label="Your music">
        <InkPortraitFrame seed={p.you.username} weight={4}><Portrait name={p.you.name} username={p.you.username} picture={p.you.picture} size={56} /></InkPortraitFrame>
      </Crossing>
      <h1 className="km-hello-title">{greeting()}, {first}</h1>
    </header>

    <div className="km-quick">
      <Crossing kind="kakejiku" href="/music/liked" className="km-quick-tile km-quick-liked"><span className="km-quick-art"><Icon name="love" /></span><span>Liked songs</span></Crossing>
      {home.playlists.slice(0, 5).map((pl) => <Crossing kind="kakejiku" key={pl.id} href={hrefOf.playlist(pl.id)} className="km-quick-tile"><Mosaic covers={pl.covers} className="km-quick-art" /><span>{pl.name}</span></Crossing>)}
      {home.jumpBack.slice(0, Math.max(0, 7 - home.playlists.length)).map((t, i) => <button key={t.key} type="button" className={cx("km-quick-tile", p.current?.key === t.key && "km-now")}
        onClick={() => p.play(home.jumpBack, i, { kind: "history", id: "recent", title: "Recently played" })}>
        <Cover src={t.album?.cover} className="km-quick-art" /><span>{t.title}</span>{p.current?.key === t.key && p.playing ? <Bars /> : null}
      </button>)}
    </div>

    <PartyInvites />
    {home.listenAgain.length >= 6 ? <ListenAgain tracks={home.listenAgain} /> : null}
    {friends?.length ? <FriendsListening friends={friends} /> : null}
    <SentToYou />

    {home.yourArtists.length ? <Shelf title="Your artists">
      {home.yourArtists.map((a) => <ArtistCard key={a.key} artist={a} />)}
    </Shelf> : null}

    {/* Someone new starts from the chart, beside a mix or two; once you've a history, it waits further down. */}
    {personal ? <>
      {home.mixes.length ? <Shelf title="Made for you">
        {home.mixes.map((m) => <SetCard key={m.id} title={m.title} sub={`${m.items.length} songs`} covers={[...new Set(m.items.map((t) => t.album?.cover).filter((c): c is string => Boolean(c)))]}
          href={hrefOf.mix(m.id)} onPlay={() => p.play(m.items, 0, { kind: "mix", id: m.id, title: m.title })} />)}
      </Shelf> : null}
      {home.artists.length ? <Shelf title="Artists for you">{home.artists.map((a) => <ArtistCard key={a.key} artist={a} />)}</Shelf> : null}
      {chart}
    </> : <>
      <div className={home.mixes.length && home.mixes.length <= 2 ? "km-duo" : "km-duo is-single"}>
        {home.mixes.length ? <Shelf title="Made for you">
          {home.mixes.map((m) => <SetCard key={m.id} title={m.title} sub={`${m.items.length} songs`} covers={[...new Set(m.items.map((t) => t.album?.cover).filter((c): c is string => Boolean(c)))]}
            href={hrefOf.mix(m.id)} onPlay={() => p.play(m.items, 0, { kind: "mix", id: m.id, title: m.title })} />)}
        </Shelf> : null}
        {chart}
      </div>
      {home.artists.length ? <Shelf title={home.greeting === "back" ? "Artists for you" : "Popular artists"}>{home.artists.map((a) => <ArtistCard key={a.key} artist={a} />)}</Shelf> : null}
    </>}

    {home.albums.length ? <Shelf title="Popular albums">
      {home.albums.map((a) => <AlbumCard key={a.key} album={a} />)}
    </Shelf> : null}

    {home.genres.length ? <section className="km-genres">
      <SectionHeader title="Genres" />
      <div className="km-genre-grid">
        {home.genres.map((g) => <Crossing kind="kakejiku" key={g.id} href={hrefOf.genre(g.id)} className="km-genre"><span>{g.name}</span>{g.picture ? <Cover src={g.picture} className="km-genre-art" /> : null}</Crossing>)}
      </div>
    </section> : null}
  </div>;
}

/**
 * Listen again: the songs you play most, nine to a page (three by three), and
 * swiped sideways for the next nine. The first page is your top nine.
 */
function ListenAgain({ tracks: all }: { tracks: Track[] }) {
  const p = usePlayer();
  /* Thumbed down here: gone from the grid at once, not on the next visit. */
  const tracks = all.filter((t) => p.ratingOf("track", t.key) !== "down");
  const row = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const pages: Track[][] = [];
  for (let i = 0; i < tracks.length; i += 9) pages.push(tracks.slice(i, i + 9));
  const source = { kind: "history", id: "most", title: "Listen again" } as const;
  const turn = (by: number) => {
    const el = row.current;
    const target = el?.children[Math.max(0, Math.min(pages.length - 1, page + by))] as HTMLElement | undefined;
    if (el && target) el.scrollTo({ left: target.offsetLeft - el.offsetLeft - parseFloat(getComputedStyle(el).scrollPaddingLeft || "0"), behavior: "smooth" });
  };
  const onScroll = () => {
    const el = row.current;
    if (!el) return;
    const first = el.children[0] as HTMLElement | undefined;
    const w = first ? first.offsetWidth + parseFloat(getComputedStyle(el).columnGap || "0") : el.clientWidth;
    setPage(Math.round(el.scrollLeft / w));
  };
  return <section className="km-again">
    <header>
      <span className="km-again-who">
        <Portrait name={p.you.name} username={p.you.username} picture={p.you.picture} size={36} />
        <span><small>{p.you.name.split(/\s+/)[0]}</small><h2 className="k-heading">Listen again</h2></span>
      </span>
      {pages.length > 1 ? <span className="km-again-turn">
        <button type="button" className="km-iconbtn" aria-label="Back" disabled={page === 0} onClick={() => turn(-1)}><Icon name="back" /></button>
        <button type="button" className="km-iconbtn km-again-next" aria-label="More" disabled={page >= pages.length - 1} onClick={() => turn(1)}><Icon name="back" /></button>
      </span> : null}
    </header>
    <div className="km-again-row" ref={row} onScroll={onScroll}>
      {pages.map((list, n) => <div key={n} className="km-again-page">
        {list.map((t) => {
          const i = tracks.indexOf(t);
          const now = p.current?.key === t.key;
          return <button key={t.key} type="button" className={cx("km-again-tile", now && "km-now")} onClick={() => now ? p.toggle() : p.play(tracks, i, source)} aria-label={`Play ${t.title}`}>
            <span className="km-again-art">
              <Cover src={t.album?.cover} className="km-again-cover" />
              {i < 3 ? <span className="km-again-rank" aria-hidden="true">{i + 1}</span> : null}
              {now && p.playing ? <span className="km-again-on"><Bars /></span> : null}
            </span>
            <span className="km-again-title">{t.title}</span>
            <span className="km-again-sub">{t.artists.map((a) => a.name).join(", ")}</span>
          </button>;
        })}
      </div>)}
    </div>
    {pages.length > 1 ? <span className="km-again-dots" aria-hidden="true">{pages.map((_, n) => <i key={n} className={cx(n === page && "is-on")} />)}</span> : null}
  </section>;
}

/** What friends are on: live first, each with the song (press it to play it) and when. */
function FriendsListening({ friends }: { friends: FriendListening[] }) {
  const p = usePlayer();
  const parties = useFriendParties();
  const party = useParty();
  /* The party a friend is in (or hosts), if you can join it. */
  const partyOf = (u: string) => parties.find((x) => x.host.username === u || x.members.some((m) => m.username === u));
  return <section className="km-friends">
    <SectionHeader title="Friends" />
    <Carousel label="Friends listening" className="km-friends-row">
      {friends.map((f) => <div key={f.username} className={cx("km-friend", f.live && "km-live")}>
        <Crossing kind="kakejiku" href={`/account/people/${encodeURIComponent(f.username)}`} className="km-friend-who">
          <InkPortraitFrame seed={f.username} weight={3}><Portrait name={f.name} username={f.username} picture={f.picture} size={44} /></InkPortraitFrame>
          <span className="km-friend-name"><b>{f.name.split(/\s+/)[0]}</b><small>{f.live ? <><span className="km-live-dot" />Listening now</> : ago(f.at)}</small></span>
        </Crossing>
        <button type="button" className="km-friend-song" onClick={() => p.play([f.track], 0, { kind: "friend", id: f.username, title: `${f.name.split(/\s+/)[0]}'s pick` })} aria-label={`Play ${f.track.title}`}>
          <Cover src={f.track.album?.cover} size={44} />
          <span><b>{f.track.title}</b><small>{byline(f.track)}</small></span>
        </button>
        {partyOf(f.username) && party.view?.id !== partyOf(f.username)!.id
          ? <Crossing kind="kakejiku" href={`/music/party/${partyOf(f.username)!.id}`} className="km-friend-join"><Icon name="play" />Listen along</Crossing> : null}
      </div>)}
    </Carousel>
  </section>;
}

/** Parties someone asked you to: a line to join each, at the top of Home. */
function PartyInvites() {
  const parties = useFriendParties();
  const party = useParty();
  const asked = parties.filter((x) => x.invited && x.id !== party.view?.id);
  if (!asked.length) return null;
  return <section className="km-invites">
    {asked.map((x) => <Crossing key={x.id} kind="kakejiku" href={`/music/party/${x.id}`} className="km-invite-banner">
      <Faces people={[x.host, ...x.members.filter((m) => m.username !== x.host.username)]} size={32} />
      <span><b>{x.host.name.split(/\s+/)[0]} asked you to listen together</b>{x.song ? <small>{x.song.title} · {byline(x.song)}</small> : null}</span>
      <span className="km-invite-go"><Icon name="play" />Join</span>
    </Crossing>)}
  </section>;
}

type Sent = { id: string; itemId: string; title: string; subtitle: string | null; cover: string | null; note: string | null; from: Person; at: number };

/** Songs friends sent you, with their note: Kimono's recommendations, Music's own. */
function SentToYou() {
  const { data } = useMusic("sent", () => fetch("/api/v1/recommendations?app=music").then((r) => r.json()).then((b: { received?: Sent[] }) => b.received ?? []));
  if (!data?.length) return null;
  return <Shelf title="Sent to you">
    {data.map((r) => <Crossing key={r.id} kind="kakejiku" href={hrefOf.song(r.itemId)} className="km-card km-card-link km-sent">
      <span className="km-card-pic"><Cover src={r.cover} className="km-card-art" /><span className="km-sent-from"><Portrait name={r.from.name} username={r.from.username} picture={r.from.picture} size={30} /></span></span>
      <span className="km-card-title">{r.title}</span>
      <span className="km-card-sub">from {r.from.name.split(/\s+/)[0]}</span>
      {r.note ? <q className="km-sent-note">{r.note}</q> : null}
    </Crossing>)}
  </Shelf>;
}

/* ── Search ────────────────────────────────────────────────────────────── */

export function SearchView() {
  const q = useSearchParams().get("q")?.trim() ?? "";
  useTabTitle(q ? `“${q}”` : "Search", "Kimono Music");
  /* As you type, the last results stay until the new ones come, rather than blanking for each letter. */
  const { data, error, retry, stale } = useMusic(q ? `search:${q.toLowerCase()}` : null, () => musicApi.search(q), true);
  if (!q) return <div className="km-page"><p className="km-quiet">Find any song, album, artist or genre.</p></div>;
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  if (!data.tracks.length && !data.albums.length && !data.artists.length && !data.genre) return <div className="km-page"><p className="km-quiet">Nothing found for “{q}”.</p></div>;
  /* A genre typed ("city pop", "90s"): the genre first, its songs and artists, then what's named that. */
  const g = data.genre;
  if (g) {
    const gs = { kind: "genre", id: `tag:${g.tag}`, title: g.title };
    return <div className={cx("km-page km-results", stale && "is-stale")} aria-busy={stale || undefined}>
      <div className="km-results-top">
        <section className="km-best">
          <SectionHeader title="Genre" />
          <div className="km-best-card">
            <span className="km-best-name">{g.title}</span>
            <span className="km-card-sub">{g.artists.slice(0, 3).map((a) => a.name).join(", ") || `${g.tracks.length} songs`}</span>
            <div className="km-head-actions"><PlayActions tracks={g.tracks} source={gs} /></div>
          </div>
        </section>
        <section className="km-results-songs">
          <SectionHeader title="Songs" />
          <Songs tracks={g.tracks.slice(0, 6)} source={gs} album={false} />
        </section>
      </div>
      {g.artists.length ? <Shelf title="Artists">{g.artists.map((a) => <ArtistCard key={a.key} artist={a} />)}</Shelf> : null}
      {g.tracks.length > 6 ? <section><SectionHeader title={<>More {g.title}</>} /><Songs tracks={g.tracks.slice(6)} source={gs} /></section> : null}
      {data.albums.length ? <Shelf title="Albums">{data.albums.map((a) => <AlbumCard key={a.key} album={a} />)}</Shelf> : null}
      {data.tracks.length ? <section><SectionHeader title={<>Named “{q}”</>} /><Songs tracks={data.tracks.slice(0, 10)} source={{ kind: "search", id: q, title: `“${q}”` }} /></section> : null}
    </div>;
  }
  const top = data.artists[0];
  return <div className={cx("km-page km-results", stale && "is-stale")} aria-busy={stale || undefined}>
    <div className="km-results-top">
      {top ? <section className="km-best">
        <SectionHeader title="Top result" />
        <Crossing kind="kakejiku" href={hrefOf.artist(top.key)} className="km-best-card">
          <Cover src={top.picture} round size={112} />
          <span className="km-best-name">{top.name}</span>
          <span className="km-card-sub">Artist</span>
        </Crossing>
      </section> : null}
      {data.tracks.length ? <section className="km-results-songs">
        <SectionHeader title="Songs" />
        <Songs tracks={data.tracks.slice(0, 6)} source={{ kind: "search", id: q, title: `“${q}”` }} album={false} />
      </section> : null}
    </div>
    {data.artists.length > 1 ? <Shelf title="Artists">{data.artists.map((a) => <ArtistCard key={a.key} artist={a} />)}</Shelf> : null}
    {data.albums.length ? <Shelf title="Albums">{data.albums.map((a) => <AlbumCard key={a.key} album={a} />)}</Shelf> : null}
    {data.tracks.length > 6 ? <section><SectionHeader title="More songs" /><Songs tracks={data.tracks.slice(6)} source={{ kind: "search", id: q, title: `“${q}”` }} /></section> : null}
  </div>;
}

/* ── An artist ─────────────────────────────────────────────────────────── */

const kindOrder: Album["kind"][] = ["album", "ep", "single", "compile"];

export function ArtistView({ id }: { id: string }) {
  const key = songKeyOf(id);
  const p = usePlayer();
  const { data, error, retry } = useMusic(`artist:${key}`, () => musicApi.artist(key));
  const [more, setMore] = useState(false);
  useTabTitle(data?.artist.name, "Kimono Music");
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  const { artist, top, albums, related } = data;
  const source = { kind: "artist", id: key, title: artist.name };
  const albumsOnly = albums.filter((a) => a.kind === "album");
  const rest = albums.filter((a) => a.kind !== "album").sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || (b.year ?? 0) - (a.year ?? 0));
  return <div className="km-page">
    <Head kind="Artist" title={artist.name}
      art={<InkPortraitFrame seed={key} weight={4}><Cover src={artist.picture} quality="full" round className="km-head-portrait" /></InkPortraitFrame>}
      meta={<>{artist.fans ? `${artist.fans.toLocaleString()} fans` : null}{artist.tags.length ? <span className="km-tags">{artist.tags.slice(0, 4).map((t) => <span key={t} className="km-tag">{t}</span>)}</span> : null}</>}>
      <PlayActions tracks={top} source={source} />
      <Seal tone="quiet" onClick={() => musicApi.radio(top[0]?.key ?? "", []).then(({ tracks }) => p.play([...top.slice(0, 3), ...tracks], 0, { kind: "radio", id: key, title: `${artist.name} radio` })).catch(() => p.say("No radio for them right now."))} disabled={!top.length}>
        <Icon name="radio" />Radio
      </Seal>
      <RateMarks kind="artist" keyOf={key} />
    </Head>
    {top.length ? <section>
      <SectionHeader title="Popular" />
      <Songs tracks={more ? top : top.slice(0, 5)} source={source} numbered album={false} />
      {top.length > 5 ? <button type="button" className="km-textbtn" onClick={() => setMore(!more)}>{more ? "Show less" : "Show more"}</button> : null}
    </section> : null}
    {albumsOnly.length ? <Shelf title="Albums">{albumsOnly.map((a) => <AlbumCard key={a.key} album={a} sub={String(a.year ?? "")} />)}</Shelf> : null}
    {rest.length ? <Shelf title="Singles and EPs">{rest.map((a) => <AlbumCard key={a.key} album={a} sub={[a.kind === "ep" ? "EP" : a.kind === "single" ? "Single" : "Compilation", a.year].filter(Boolean).join(" · ")} />)}</Shelf> : null}
    {related.length ? <Shelf title="Fans also like">{related.map((a) => <ArtistCard key={a.key} artist={a} />)}</Shelf> : null}
  </div>;
}

/* ── An album ──────────────────────────────────────────────────────────── */

export function AlbumView({ id }: { id: string }) {
  const key = `dz:${id}`;
  const p = usePlayer();
  const { data, error, retry } = useMusic(`album:${key}`, () => musicApi.album(key));
  useTabTitle(data?.album.title, "Kimono Music");
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  const { album } = data;
  const source = { kind: "album", id: key, title: album.title };
  const kind = album.kind === "ep" ? "EP" : album.kind === "single" ? "Single" : album.kind === "compile" ? "Compilation" : "Album";
  return <div className="km-page">
    <Head kind={kind} title={album.title} art={<Cover src={album.cover} quality="full" className="km-head-cover" alt="" />}
      meta={<>{album.artist ? <Crossing kind="kakejiku" href={hrefOf.artist(album.artist.key)}>{album.artist.name}</Crossing> : null}{album.year ? ` · ${album.year}` : ""} · {album.tracks.length} {album.tracks.length === 1 ? "song" : "songs"}, {length(album.tracks)}</>}>
      <PlayActions tracks={album.tracks} source={source} />
      <RateMarks kind="album" keyOf={key} />
      <MoreButton label="More for this album" items={() => [
        { label: "Add to queue", icon: "queue", run: () => p.addToQueue(album.tracks) },
        { label: "Add to playlist", icon: "playlist", sub: playlistItems(album.tracks.map((t) => t.key), p.say) },
      ]} />
    </Head>
    <Songs tracks={album.tracks} source={source} numbered art={false} album={false} />
  </div>;
}

/* ── A song: its own address, to send ───────────────────────────────────── */

export function SongView({ id }: { id: string }) {
  const key = `dz:${id}`;
  const p = usePlayer();
  const { data, error, retry } = useMusic(`song:${key}`, () => musicApi.track(key));
  const t = data?.track ?? null;
  const { data: album } = useMusic(t?.album?.key ? `album:${t.album.key}` : null, () => musicApi.album(t!.album!.key));
  const { data: artist } = useMusic(t?.artists[0]?.key ? `artist:${t.artists[0].key}` : null, () => musicApi.artist(t!.artists[0].key));
  const { data: lyrics } = useMusic(t ? `lyrics:${key}` : null, () => musicApi.lyrics(key).then((r) => r.lyrics));
  const [allWords, setAllWords] = useState(false);
  const [sending, setSending] = useState(false);
  const { data: friendsOn } = useMusic(t ? `song-friends:${key}` : null, () => fetch(`/api/v1/music/song-friends?key=${encodeURIComponent(key)}`).then((r) => r.json()).then((b: { friends?: (Person & { loved: boolean })[] }) => b.friends ?? []));
  useTabTitle(t ? `${t.title} · ${byline(t)}` : undefined, "Kimono Music");
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!t) return <Loading />;
  const here = p.current?.key === t.key;
  const words = lyrics ? (lyrics.synced ? lyrics.synced.map((l) => l.line) : (lyrics.plain ?? "").split(/\n/)) : [];
  const more = (artist?.top ?? []).filter((x) => x.key !== t.key).slice(0, 5);
  return <div className="km-page">
    <Head kind={t.album && album?.album.year ? `Song · ${album.album.year}` : "Song"} title={t.title} art={<Cover src={t.album?.cover} quality="full" className="km-head-cover" />}
      meta={<><ArtistLinksBold artists={t.artists} />{t.album?.key ? <> · <Crossing kind="kakejiku" href={hrefOf.album(t.album.key)}>{t.album.title}</Crossing></> : t.album?.title ? <> · {t.album.title}</> : null} · {clock(t.duration)}</>}>
      <Seal onClick={() => (here ? p.toggle() : p.play([t], 0, { kind: "song", id: t.key, title: t.title }))}>
        <Icon name={here && p.playing ? "pause" : "play"} />{here && p.playing ? "Pause" : "Play"}
      </Seal>
      <AddToPlaylist keys={[t.key]} compact={false} />
      <Seal tone="quiet" className="km-seal-icon" onClick={() => setSending(true)}><Icon name="send" />Send to a friend</Seal>
      <Seal tone="quiet" className="km-seal-icon" onClick={async () => { const said = await share(hrefOf.song(t.key), `${t.title} · ${byline(t)}`); if (said) p.say(said); }}><Icon name="share" />Share</Seal>
      {/* The marks apart from the actions: how you feel, not what to do. */}
      <RateMarks kind="track" keyOf={t.key} size="md" className="km-head-rates" />
    </Head>

    {friendsOn?.length ? <p className="km-song-friends">
      <Faces people={friendsOn} size={28} />
      <span>{friendsOn.slice(0, 3).map((f) => f.name.split(/\s+/)[0]).join(", ")}{friendsOn.length > 3 ? ` and ${friendsOn.length - 3} more` : ""}
        {friendsOn.every((f) => f.loved) ? " love this" : friendsOn.some((f) => f.loved) ? " played or love this" : " played this"}</span>
    </p> : null}
    {sending ? <RecommendSheet item={{ app: "music", itemId: t.key, title: t.title, subtitle: byline(t), cover: t.album?.cover ?? null }} onClose={() => setSending(false)} onSent={p.say} /> : null}

    {words.some((w) => w.trim()) ? <section className="km-song-words">
      <SectionHeader title="Lyrics" />
      <div className={cx("km-words", !allWords && "km-words-short")}>{(allWords ? words : words.slice(0, 12)).map((w, i) => <p key={i}>{w || "\u00a0"}</p>)}</div>
      {words.length > 12 ? <button type="button" className="km-textbtn" onClick={() => setAllWords(!allWords)}>{allWords ? "Show less" : "Show all"}</button> : null}
    </section> : null}

    {album && album.album.tracks.length > 1 ? <section>
      <SectionHeader title={<>From {album.album.title}</>}><Crossing kind="kakejiku" className="k-see-all" href={hrefOf.album(album.album.key)}>See album</Crossing></SectionHeader>
      <Songs tracks={album.album.tracks} source={{ kind: "album", id: album.album.key, title: album.album.title }} numbered art={false} album={false} />
    </section> : null}

    {more.length && t.artists[0] ? <section>
      <SectionHeader title={<>More by {t.artists[0].name}</>}><Crossing kind="kakejiku" className="k-see-all" href={hrefOf.artist(t.artists[0].key)}>See artist</Crossing></SectionHeader>
      <Songs tracks={more} source={{ kind: "artist", id: t.artists[0].key, title: t.artists[0].name }} album={false} />
    </section> : null}
  </div>;
}

function ArtistLinksBold({ artists }: { artists: Track["artists"] }) {
  return <span>{artists.filter((a, i, all) => all.findIndex((b) => b.key === a.key && b.name === a.name) === i).map((a, i) => <span key={a.key || a.name}>{i ? ", " : ""}{a.key ? <Crossing kind="kakejiku" href={hrefOf.artist(a.key)}>{a.name}</Crossing> : a.name}</span>)}</span>;
}

/* ── A playlist ────────────────────────────────────────────────────────── */

export function PlaylistView({ id }: { id: string }) {
  const p = usePlayer();
  const crossTo = useCrossTo();
  const { data, error, retry, replace } = useMusic(`playlist:${id}`, () => musicApi.playlist(id).then((r) => r.playlist));
  const [sharing, setSharing] = useState(false);
  useTabTitle(data?.name, "Kimono Music");
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  const source = { kind: "playlist", id, title: data.name };
  const role = data.role ?? (data.mine === false ? "listener" : "owner");
  const owner = role === "owner";
  const edits = owner || role === "member";
  const joined = (data.members ?? []).filter((m) => m.joined);
  const covers = [...new Set(data.tracks.map((t) => t.album?.cover).filter((c): c is string => Boolean(c)))];
  const changed = () => { forget("playlists"); forget("home"); forget("me"); };
  const change = (body: Record<string, unknown>, failed: string) => musicApi.playlistChange(id, body).then((r) => { replace(r.playlist); changed(); }).catch(() => p.say(failed));
  const set = (keys: string[]) => change({ keys }, "That change didn't save.");
  const leave = () => musicApi.leavePlaylist(id).then(() => { changed(); crossTo("kakejiku", "/music/you"); }).catch(() => p.say("That didn't go through."));
  return <div className="km-page">
    <Head kind={data.public ? "Public playlist" : joined.length ? "Shared playlist" : "Playlist"} title={data.name} art={<Mosaic covers={covers} className="km-head-cover" />}
      meta={<>{!owner && data.owner ? <Crossing kind="kakejiku" href={`/account/people/${encodeURIComponent(data.owner.username)}`} className="km-owner"><Portrait name={data.owner.name} username={data.owner.username} picture={data.owner.picture} size={24} />{data.owner.name}</Crossing> : null}
        {joined.length ? <span className="km-pl-with"><Faces people={owner ? joined : [...(data.owner ? [data.owner] : []), ...joined]} />{owner ? `with ${joined.map((m) => m.name.split(" ")[0]).join(", ")}` : null}</span> : null}
        {data.tracks.length ? `${data.tracks.length} ${data.tracks.length === 1 ? "song" : "songs"}, ${length(data.tracks)}` : "No songs yet"}</>}>
      <PlayActions tracks={data.tracks} source={source} />
      {owner ? <Seal tone="quiet" compact onClick={() => setSharing(true)}><Icon name="person" />Share</Seal> : null}
      {edits ? <MoreButton label="More for this playlist" items={() => [
        { label: "Rename", icon: "edit", run: async () => {
          const name = await askName("Rename the playlist", "Rename", data.name);
          if (name && name !== data.name) change({ name }, "That name didn't save.");
        } },
        { label: "Add to queue", icon: "queue", run: () => p.addToQueue(data.tracks) },
        ...(owner ? [{ label: "Delete playlist", icon: "trash" as const, danger: true, run: async () => {
          if (!await askSure(`Delete “${data.name}”?`, joined.length ? "It goes for everyone it's shared with. The songs stay in Music." : "The songs in it stay in Music.", "Delete")) return;
          musicApi.deletePlaylist(id).then(() => { changed(); crossTo("kakejiku", "/music/you"); }).catch(() => p.say("It wasn't deleted."));
        } }] : [{ label: "Leave playlist", icon: "trash" as const, danger: true, run: async () => {
          if (await askSure(`Leave “${data.name}”?`, "You can be asked back in.", "Leave")) void leave();
        } }]),
      ]} /> : null}
    </Head>
    {role === "invited" ? <div className="km-pl-invite">
      {data.owner ? <InkPortraitFrame seed={data.owner.username} weight={3}><Portrait name={data.owner.name} username={data.owner.username} picture={data.owner.picture} size={40} /></InkPortraitFrame> : null}
      <p><b>{data.owner?.name.split(" ")[0] ?? "A friend"}</b> asked you onto this playlist: add, move and take out songs together.</p>
      <Seal tone="quiet" compact onClick={() => void leave()}>No thanks</Seal>
      <Seal compact onClick={() => void change({ join: true }, "That didn't go through.")}>Join</Seal>
    </div> : null}
    {data.tracks.length
      ? <Songs tracks={data.tracks} source={source} numbered rowExtra={(_t, i) => !edits ? [] : [{ label: "Remove from this playlist", icon: "trash", danger: true, run: () => set(data.tracks.filter((_, j) => j !== i).map((x) => x.key)) }]} />
      : <p className="km-quiet">{edits ? "Add songs from any song’s menu." : "Nothing in it yet."}</p>}
    {sharing ? <ShareSheet data={data} onClose={() => setSharing(false)} onChange={(body, failed) => change(body, failed)} /> : null}
  </div>;
}

/** Who a playlist is for: public (friends see it on your profile) or private, and the friends you've asked onto it. */
function ShareSheet({ data, onClose, onChange }: { data: PlaylistPage; onClose: () => void; onChange: (body: Record<string, unknown>, failed: string) => Promise<void> }) {
  const [friends, setFriends] = useState<Person[] | null>(null);
  useEffect(() => { fetch("/api/v1/friends").then((r) => r.json()).then((b: { friends?: Person[] }) => setFriends(b.friends ?? [])).catch(() => setFriends([])); }, []);
  const members = new Map((data.members ?? []).map((m) => [m.username, m]));
  return <InkSheet title="Share this playlist" icon="people" tint="#946c25" onClose={onClose} actions={<Seal compact onClick={onClose}>Done</Seal>}>
    <div className="km-share">
      <div className="km-share-modes" role="radiogroup" aria-label="Who sees it">
        <button type="button" role="radio" aria-checked={!data.public} className={!data.public ? "is-on" : undefined} onClick={() => void onChange({ public: false }, "That didn't save.")}>
          <b>Private</b><small>You, and who you ask on</small>
        </button>
        <button type="button" role="radio" aria-checked={Boolean(data.public)} className={data.public ? "is-on" : undefined} onClick={() => void onChange({ public: true }, "That didn't save.")}>
          <b>Public</b><small>Friends see it on your profile and can play it</small>
        </button>
      </div>
      <p className="km-share-head">Make it together</p>
      {friends === null ? <p className="km-quiet">…</p> : !friends.length ? <p className="km-quiet">Add friends to make playlists together.</p>
        : <ul className="km-share-list">{friends.map((f) => {
          const m = members.get(f.username);
          return <li key={f.username}>
            <InkPortraitFrame seed={f.username} weight={3}><Portrait name={f.name} username={f.username} picture={f.picture} size={36} /></InkPortraitFrame>
            <span><b>{f.name}</b><small>{m ? (m.joined ? "On it with you" : "Asked") : `@${f.username}`}</small></span>
            {m ? <Seal tone="quiet" compact onClick={() => void onChange({ drop: f.username }, "That didn't go through.")}>{m.joined ? "Remove" : "Take back"}</Seal>
              : <Seal compact onClick={() => void onChange({ invite: f.username }, "They weren't asked.")}>Ask</Seal>}
          </li>;
        })}</ul>}
    </div>
  </InkSheet>;
}

/* ── A genre, and a mix ────────────────────────────────────────────────── */

export function GenreView({ id }: { id: number }) {
  const { data, error, retry } = useMusic(`genre:${id}`, () => musicApi.genre(id));
  useTabTitle(data?.genre.name, "Kimono Music");
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  const source = { kind: "genre", id: String(id), title: data.genre.name };
  return <div className="km-page">
    <Head kind="Genre" title={data.genre.name} art={<Cover src={data.genre.picture} className="km-head-cover" />}>
      <PlayActions tracks={data.tracks} source={source} />
    </Head>
    <section><SectionHeader title="Top songs" /><Songs tracks={data.tracks.slice(0, 20)} source={source} numbered /></section>
    {data.artists.length ? <Shelf title="Artists">{data.artists.map((a) => <ArtistCard key={a.key} artist={a} />)}</Shelf> : null}
    {data.albums.length ? <Shelf title="Albums">{data.albums.map((a) => <AlbumCard key={a.key} album={a} />)}</Shelf> : null}
  </div>;
}

export function MixView() {
  const id = useSearchParams().get("id") ?? "";
  const { data, error, retry } = useMusic(id ? `mix:${id}` : null, () => musicApi.mix(id));
  useTabTitle(data?.mix.title, "Kimono Music");
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  const { mix } = data;
  const source = { kind: "mix", id, title: mix.title };
  const covers = [...new Set(mix.items.map((t) => t.album?.cover).filter((c): c is string => Boolean(c)))];
  return <div className="km-page">
    <Head kind={id === "chart" ? "Chart" : "Mix"} title={mix.title} art={<Mosaic covers={covers} className="km-head-cover" />} meta={`${mix.items.length} songs, ${length(mix.items)}`}>
      <PlayActions tracks={mix.items} source={source} />
    </Head>
    <Songs tracks={mix.items} source={source} numbered />
  </div>;
}

/* ── Your space ─────────────────────────────────────────────────────────── */

export function YouView() {
  useTabTitle("Your music", "Kimono Music");
  const p = usePlayer();
  const crossTo = useCrossTo();
  const { data: me, error, retry } = useMusic("me", musicApi.me);
  const { data: friends } = useMusic("friends", () => musicApi.friends().then((r) => r.friends));
  /* Back from signing in to a service: the import sheet opens on it. */
  const params = useSearchParams();
  const back = params.get("bring");
  const [bringing, setBringing] = useState(back === "spotify" || back === "youtube" || back === "apple");
  const opened = back === "spotify" || back === "youtube" || back === "apple" ? { service: back as "spotify" | "youtube" | "apple", problem: params.get("problem") } : undefined;
  const newPlaylist = async () => {
    const name = await askName("New playlist", "Make it");
    if (!name) return;
    musicApi.createPlaylist(name).then(({ playlist }) => { forget("me"); forget("playlists"); forget("home"); crossTo("kakejiku", hrefOf.playlist(playlist.id)); }).catch(() => p.say("That playlist wasn't made."));
  };
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!me) return <Loading />;
  const hours = me.minutes >= 90 ? `${Math.round(me.minutes / 60)} hours` : `${me.minutes} minutes`;
  return <div className="km-page km-you">
    {bringing ? <ImportSheet open={opened} onClose={() => { setBringing(false); if (back) window.history.replaceState(null, "", "/music/you"); }} /> : null}
    <header className="km-head km-you-head">
      <div className="km-head-art km-you-portrait"><InkPortraitFrame seed={p.you.username} weight={5}><Portrait name={p.you.name} username={p.you.username} picture={p.you.picture} size={180} /></InkPortraitFrame></div>
      <div className="km-head-text">
        <span className="k-label">Your music</span>
        <h1 className="km-head-title">{p.you.name}</h1>
        <p className="km-head-meta">{me.plays ? `${me.plays} ${me.plays === 1 ? "song" : "songs"} and ${hours} this month` : "Play something and it starts here."}</p>
        {me.tags.length ? <span className="km-tags">{me.tags.map((t) => <span key={t} className="km-tag">{t}</span>)}</span> : null}
        <div className="km-head-actions">
          <Seal onClick={newPlaylist}><Icon name="add" />New playlist</Seal>
          <Seal tone="quiet" onClick={() => setBringing(true)}><Icon name="bring" />Bring one in</Seal>
          <Crossing kind="kakejiku" href={`/account/people/${encodeURIComponent(p.you.username)}`} className="km-textbtn km-you-profile">Your profile</Crossing>
        </div>
      </div>
    </header>

    <section>
      <SectionHeader title="Playlists" />
      <div className="km-grid km-you-lists">
        <Crossing kind="kakejiku" href="/music/liked" className="km-card km-card-link km-liked-card">
          <span className="km-card-pic km-liked-art"><Icon name="love" /></span>
          <span className="km-card-title">Liked songs</span>
          <span className="km-card-sub">{me.liked} {me.liked === 1 ? "song" : "songs"}</span>
        </Crossing>
        {me.playlists.map((pl) => <SetCard key={pl.id} title={pl.name} sub={pl.invited ? "You're asked on" : [`${pl.count} ${pl.count === 1 ? "song" : "songs"}`, pl.owner ? `with ${pl.owner}` : pl.shared ? `shared with ${pl.shared}` : pl.public ? "public" : null].filter(Boolean).join(" · ")} covers={pl.covers} href={hrefOf.playlist(pl.id)} />)}
        <button type="button" className="km-card km-new-card" onClick={newPlaylist}>
          <span className="km-card-pic km-new-art"><Icon name="add" /></span>
          <span className="km-card-title">New playlist</span>
        </button>
        <button type="button" className="km-card km-new-card" onClick={() => setBringing(true)}>
          <span className="km-card-pic km-new-art"><Icon name="bring" /></span>
          <span className="km-card-title">Bring one in</span>
          <span className="km-card-sub">From Spotify, Apple Music or YouTube</span>
        </button>
      </div>
    </section>

    {me.onRepeat.length ? <section>
      <SectionHeader title="On repeat" />
      <Songs tracks={me.onRepeat.slice(0, 6)} source={{ kind: "repeat", id: "me", title: "On repeat" }} numbered album={false} className="km-chart-songs" />
    </section> : null}

    {me.artists.length ? <Shelf title="Your top artists">{me.artists.map((a) => <ArtistCard key={a.key} artist={a} />)}</Shelf> : null}

    {me.recent.length ? <section>
      <SectionHeader title="Recently played"><Crossing kind="kakejiku" className="k-see-all" href="/music/history">See all</Crossing></SectionHeader>
      <Songs tracks={me.recent.slice(0, 6)} source={{ kind: "history", id: "recent", title: "Recently played" }} />
    </section> : null}

    {friends?.length ? <FriendsListening friends={friends} /> : <section className="km-friends-none">
      <SectionHeader title="Friends" />
      <p className="km-quiet">See what your friends are listening to.</p>
      <Crossing kind="kakejiku" href="/account/friends" className="km-textbtn">Find friends</Crossing>
    </section>}
  </div>;
}

export function LikedView() {
  useTabTitle("Liked songs", "Kimono Music");
  const { data, error, retry } = useMusic("liked", () => musicApi.liked().then((r) => r.tracks));
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  const source = { kind: "liked", id: "liked", title: "Liked songs" };
  return <div className="km-page">
    <Head kind="Playlist" title="Liked songs" art={<span className="km-head-cover km-liked-art"><Icon name="love" /></span>}
      meta={data.length ? `${data.length} ${data.length === 1 ? "song" : "songs"}, ${length(data)}` : "Songs you like or love land here."}>
      <PlayActions tracks={data} source={source} />
    </Head>
    {data.length ? <Songs tracks={data} source={source} numbered /> : null}
  </div>;
}

export function HistoryView() {
  useTabTitle("Recently played", "Kimono Music");
  const { data, error, retry } = useMusic("history", () => musicApi.history().then((r) => r.tracks));
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  return <div className="km-page">
    <PageHeader title="Recently played" />
    {data.length ? <Songs tracks={data as Track[]} source={{ kind: "history", id: "recent", title: "Recently played" }} /> : <p className="km-quiet">What you play will be here.</p>}
  </div>;
}

export { clock };

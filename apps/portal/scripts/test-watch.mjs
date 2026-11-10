import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as model from '../src/lib/watch/model.ts';
import * as labels from '../src/lib/watch/labels.ts';
import * as releases from '../src/lib/watch/releases.ts';
import * as token from '../src/lib/watch/token.ts';
import * as tmdb from '../src/lib/watch/tmdb.ts';
import * as anime from '../src/lib/watch/anime.ts';
import * as streams from '../src/lib/watch/streams.ts';
import * as hls from '../src/lib/watch/hls.ts';
import * as party from '../src/lib/watch/together.ts';

const day = 24 * 60 * 60 * 1000;
function fresh() {
  const db = new DatabaseSync(':memory:');
  model.migrate(db);
  return db;
}
const title = (over = {}) => ({
  id: 'tv-1', kind: 'series', tmdbId: 1, imdbId: 'tt1', anilistId: null, malId: null, name: 'Kotori', overview: '', year: 2026, age: '16+',
  genres: [], moods: [], shelf: 'Anime', poster: null, backdrop: null, logo: null, runtime: 24, popularity: 1, status: 'Returning Series',
  nextAirDate: null, seasonCount: 1, cast: [], fetchedAt: Date.now(), ...over,
});
const ep = (season, number, over = {}) => ({ titleId: 'tv-1', season, number, name: `E${number}`, overview: '', still: null, runtime: 24, airDate: '2026-01-01', filler: false, recap: false, ...over });
const kotori = () => [1, 2, 3, 4].map((n) => ep(1, n)).concat([ep(1, 5, { filler: true }), ep(1, 6, { filler: true }), ep(1, 7), ep(1, 8)]);
const at = (season, episode, position, duration, updatedAt) => ({ titleId: 'tv-1', season, episode, position, duration, updatedAt });

/* ───── Releases ───── */

const tv = { client: 'android-tv', maxHeight: 2160, hdr: ['hdr10', 'dv'], dvProfiles: [5, 8], codecs: ['h264', 'hevc'], passthrough: ['eac3', 'truehd'] };
const sdrTv = { ...tv, hdr: [], dvProfiles: [] };
const hdrTv = { ...tv, hdr: ['hdr10'], dvProfiles: [] };
const phone = { client: 'android', maxHeight: 2400, hdr: ['hdr10'], dvProfiles: [], codecs: ['h264', 'hevc'], passthrough: [] };
const R = (name, extra = {}) => releases.parseRelease({ url: `https://up/${encodeURIComponent(name)}`, name, ...extra });

test('release names are read the way people write them', () => {
  const web = R('Show.S01E02.2160p.WEB-DL.DV.HDR10.DDP5.1.Atmos.H.265-GRP ⚡', { bytes: 9 * 1024 ** 3 });
  assert.equal(web.height, 2160);
  assert.equal(web.source, 'web-dl');
  assert.equal(web.codec, 'hevc');
  assert.deepEqual(web.hdr, ['hdr10', 'dv']);
  assert.equal(web.dvProfile, 8, 'DV with HDR10 from the web is a profile 8 hybrid');
  assert.equal(web.audio, 'eac3');
  assert.equal(web.atmos, true);
  assert.equal(web.channels, '5.1');
  assert.equal(web.cached, true);
  assert.equal(R('Film.2024.2160p.WEB-DL.DV.H.265').dvProfile, 5, 'DV alone from the web is profile 5');
  const disc = R('Film.2024.2160p.UHD.BluRay.REMUX.DV.TrueHD.7.1.Atmos-GRP');
  assert.equal(disc.source, 'remux');
  assert.equal(disc.dvProfile, 7);
  assert.ok(disc.hdr.includes('hdr10'), 'profile 7 always has HDR10 under it');
  assert.equal(disc.audio, 'truehd');
  assert.equal(R('Film 2024 HDCAM x264').junk, true);
  assert.equal(R('Film 1080p WEB-DL', { description: '💾 4.2 GB' }).bytes, Math.round(4.2 * 1024 ** 3));
  assert.equal(R('Film 1080p [RD download]').cached, false);
  assert.equal(R('Film 1080p usenet').service, 'usenet');
});

test('profile 5 never reaches a screen that would show it purple and green', () => {
  const p5 = R('Film.2160p.WEB-DL.DV.H.265 ⚡');
  assert.equal(releases.unplayable(p5, tv, 120), null);
  assert.match(releases.unplayable(p5, hdrTv, 120), /Dolby Vision/);
  assert.match(releases.unplayable(p5, phone, 120), /Dolby Vision/);
});

test('full-size remuxes only at home; nothing bigger than the connection; no codec the device lacks', () => {
  const remux = R('Film.2160p.BluRay.REMUX.HEVC ⚡', { bytes: 60 * 1024 ** 3 });
  assert.match(releases.unplayable(remux, tv, 120), /at home/);
  assert.equal(releases.unplayable(remux, { ...tv, lan: true }, 120), null);
  const web = R('Film.2160p.WEB-DL.HEVC ⚡', { bytes: 20 * 1024 ** 3 });
  assert.match(releases.unplayable(web, { ...tv, mbps: 15 }, 120), /connection/);
  assert.match(releases.unplayable(R('Film.1080p.WEB-DL.AV1 ⚡'), phone, 120), /AV1/);
  assert.match(releases.unplayable(R('Film.1080p.WEB-DL [RD download]'), phone, 120), /not ready/);
});

test('a phone gets 1080p, a 4K TV gets 4K with the best HDR it shows', () => {
  const all = [
    R('Film.2160p.WEB-DL.DV.HDR10.DDP5.1.Atmos.H.265 ⚡', { bytes: 18 * 1024 ** 3 }),
    R('Film.2160p.WEB-DL.HDR10.DDP5.1.H.265 ⚡', { bytes: 16 * 1024 ** 3 }),
    R('Film.2160p.WEB-DL.DV.H.265 ⚡', { bytes: 15 * 1024 ** 3 }),
    R('Film.1080p.WEB-DL.DDP5.1.H.264 ⚡', { bytes: 5 * 1024 ** 3 }),
    R('Film.720p.WEB-DL.AAC.H.264 ⚡', { bytes: 1.5 * 1024 ** 3 }),
  ];
  assert.equal(releases.rank(all, phone, 'auto', 120)[0].height, 1080);
  const onTv = releases.rank(all, tv, 'auto', 120)[0];
  assert.equal(onTv.height, 2160);
  assert.ok(onTv.hdr.includes('dv') && onTv.atmos);
  const onHdr = releases.rank(all, hdrTv, 'auto', 120);
  assert.ok(onHdr.every((r) => r.dvProfile !== 5));
  assert.ok(onHdr[0].hdr.includes('hdr10') && onHdr[0].height === 2160);
  assert.equal(releases.rank(all, sdrTv, 'auto', 120)[0].height, 2160, 'SDR 4K TV still gets 4K, tone-mapped');
  assert.equal(releases.rank(all, tv, 'saver', 120)[0].height, 720);
  assert.equal(releases.describe(onTv), '4K · Dolby Vision · Atmos · 18 GB');
  assert.deepEqual(releases.badges(onTv), ['4K', 'Dolby Vision', 'Dolby Atmos']);
});

test('a device the API knows nothing about is a 1080p SDR phone', () => {
  const d = releases.cleanDevice({ client: 'bogus', codecs: ['vp9'], hdr: ['dv', 'nope'], dvProfiles: [5, 9] });
  assert.equal(d.client, 'android');
  assert.equal(d.maxHeight, 1080);
  assert.deepEqual(d.codecs, ['h264', 'hevc']);
  assert.deepEqual(d.hdr, ['dv']);
  assert.deepEqual(d.dvProfiles, [5]);
  assert.equal(releases.cleanDevice({ client: 'android-tv' }).maxHeight, 2160);
});

/* ───── Stream tokens ───── */

test('a stream token opens only with its key, unaltered and in time', () => {
  const key = randomBytes(32);
  const grant = { url: 'https://debrid.example/file.mkv', username: 'akram', expiresAt: Date.now() + 1000 };
  const sealed = token.sealStream(key, grant);
  assert.ok(!sealed.includes('debrid'), 'the upstream address is unreadable');
  assert.deepEqual(token.openStream(key, sealed), grant);
  assert.equal(token.openStream(randomBytes(32), sealed), null);
  const [iv, body, tag] = sealed.split('.');
  assert.equal(token.openStream(key, `${iv}.${body.slice(0, -2)}AA.${tag}`), null);
  assert.equal(token.openStream(key, sealed, Date.now() + 5000), null);
});

/* ───── Where someone is ───── */

test('the next episode steps over filler only for people who skip it', () => {
  const eps = kotori();
  assert.deepEqual(labels.nextEpisode(eps, { season: 1, episode: 4 }, 'ask'), { season: 1, episode: 5, skipped: 0 });
  assert.deepEqual(labels.nextEpisode(eps, { season: 1, episode: 4 }, 'skip'), { season: 1, episode: 7, skipped: 2 });
  assert.equal(labels.nextEpisode(eps, { season: 1, episode: 8 }, 'ask'), null);
  const unaired = eps.concat([ep(1, 9, { airDate: '2099-01-01' })]);
  assert.equal(labels.nextEpisode(unaired, { season: 1, episode: 8 }, 'ask'), null, 'not before it airs');
});

test('filler ahead is named once, with where canon picks up', () => {
  assert.deepEqual(labels.fillerAhead(kotori(), { season: 1, episode: 4 }), { first: { season: 1, episode: 5 }, count: 2, canon: { season: 1, episode: 7 } });
  assert.equal(labels.fillerAhead(kotori(), { season: 1, episode: 2 }), null);
});

test('resume goes to the half-watched episode, else the one after the last finished', () => {
  const eps = kotori();
  assert.deepEqual(labels.resumePoint(eps, [], 'ask'), { season: 1, episode: 1, position: 0, started: false });
  assert.deepEqual(labels.resumePoint(eps, [at(1, 3, 600, 1440, 2)], 'ask'), { season: 1, episode: 3, position: 600, started: true });
  assert.deepEqual(labels.resumePoint(eps, [at(1, 3, 1430, 1440, 1), at(1, 4, 1400, 1440, 2)], 'skip'), { season: 1, episode: 7, position: 0, started: true });
  assert.equal(labels.resumePoint(eps, [at(1, 8, 1440, 1440, 3)], 'ask').episode, 8, 'caught up: the last one');
});

test('the season tracker counts what is left, leaving out skipped filler', () => {
  const eps = kotori();
  const progress = [1, 2, 3].map((n) => at(1, n, 1440, 1440, n)).concat([at(1, 4, 720, 1440, 4)]);
  const t = labels.seasonTracker(eps, progress, { season: 1, episode: 4 }, 'skip');
  assert.equal(t.left, 3, 'E4, E7, E8');
  assert.deepEqual(t.marks.map((m) => m.state), ['done', 'done', 'done', 'open', 'skip', 'skip', 'open', 'open']);
  assert.equal(t.marks[3].fraction, 0.5);
  assert.equal(labels.seasonTracker(eps, progress, { season: 1, episode: 4 }, 'watch').left, 5);
});

test('"New episode" only for people watching; "New season" for everyone', () => {
  const now = Date.parse('2026-03-10');
  const week = [ep(1, 1, { airDate: '2026-01-01' }), ep(1, 2, { airDate: '2026-03-08' })];
  assert.equal(labels.badge(title(), week, true, now), 'New episode');
  assert.equal(labels.badge(title(), week, false, now), null);
  assert.equal(labels.badge(title(), [ep(2, 1, { airDate: '2026-03-05' })], false, now), 'New season');
  assert.equal(labels.badge(title({ kind: 'movie' }), week, true, now), null);
});

/* ───── The database ───── */

test('progress is kept per person, and recent titles come one each, newest first', () => {
  const db = fresh();
  model.saveProgress(db, 'akram', { titleId: 'tv-1', season: 1, episode: 1, position: 100, duration: 1440 }, 1);
  model.saveProgress(db, 'akram', { titleId: 'tv-1', season: 1, episode: 2, position: 50, duration: 1440 }, 3);
  model.saveProgress(db, 'akram', { titleId: 'movie-2', season: 0, episode: 0, position: 10, duration: 6000 }, 2);
  model.saveProgress(db, 'sam', { titleId: 'tv-9', season: 1, episode: 1, position: 10, duration: 1440 }, 5);
  assert.deepEqual(model.recentTitles(db, 'akram').map((p) => [p.titleId, p.episode]), [['tv-1', 2], ['movie-2', 0]]);
  model.saveProgress(db, 'akram', { titleId: 'tv-1', season: 1, episode: 2, position: 9999, duration: 1440 }, 4);
  assert.equal(model.progressOf(db, 'akram', 'tv-1')[1].position, 1440, 'never past the end');
  assert.throws(() => model.saveProgress(db, 'akram', { titleId: 'tv-1', season: 1, episode: 1, position: 1, duration: 0 }), /duration/);
  assert.equal(model.finished({ position: 1330, duration: 1440 }), true, 'inside the last two minutes');
});

test('a refresh keeps filler flags, and MyAnimeList numbering lands across seasons', () => {
  const db = fresh();
  model.putTitle(db, title());
  model.putSeasons(db, 'tv-1', [{ number: 1, name: 'S1', episodeCount: 2, airDate: null, poster: null }, { number: 2, name: 'S2', episodeCount: 2, airDate: null, poster: null }]);
  model.putEpisodes(db, 'tv-1', 1, [ep(1, 1), ep(1, 2)]);
  model.putEpisodes(db, 'tv-1', 2, [ep(2, 1), ep(2, 2)]);
  model.markFillers(db, 'tv-1', [{ absolute: 3, filler: true, recap: false }, { absolute: 4, filler: false, recap: true }]);
  assert.deepEqual(model.episodesOf(db, 'tv-1', 2).map((e) => [e.filler, e.recap]), [[true, false], [false, true]]);
  model.putEpisodes(db, 'tv-1', 2, [ep(2, 1), ep(2, 2)]);
  assert.equal(model.episodesOf(db, 'tv-1', 2)[0].filler, true, 'kept through a refresh');
  assert.ok(model.seasonsOf(db, 'tv-1')[1].fetchedAt > 0);
});

test('stubs from lists never overwrite a full title, and staleness follows airing', () => {
  assert.equal(model.isStale(title({ fetchedAt: Date.now() - 2 * day })), true, 'airing: a day');
  assert.equal(model.isStale(title({ status: 'Ended', fetchedAt: Date.now() - 2 * day })), false, 'ended: a week');
  assert.equal(model.isStale(title({ kind: 'movie', fetchedAt: Date.now() - 20 * day })), false, 'films: a month');
  assert.throws(() => model.parseTitleId('tv-x'), /isn't a title/);
  assert.deepEqual(model.parseTitleId('movie-603'), { kind: 'movie', tmdbId: 603 });
});

test('settings are cleaned, keeping what was not sent', () => {
  const db = fresh();
  assert.equal(model.prefsOf(db, 'a').fillers, 'ask');
  model.savePrefs(db, 'a', { fillers: 'skip', quality: '4k', audioLanguage: 'ja', autoplayNext: 'yes' });
  const p = model.prefsOf(db, 'a');
  assert.equal(p.fillers, 'skip');
  assert.equal(p.quality, 'auto', 'unknown quality ignored');
  assert.equal(p.audioLanguage, 'ja');
  assert.equal(p.autoplayNext, true);
  model.savePrefs(db, 'a', { quality: '1080' });
  assert.equal(model.prefsOf(db, 'a').fillers, 'skip');
});

test('the cache forgets on time', () => {
  const db = fresh();
  model.keep(db, 'k', [1, 2], 1000, 0);
  assert.deepEqual(model.cached(db, 'k', 500), [1, 2]);
  assert.equal(model.cached(db, 'k', 1500), null);
});

/* ───── Sources ───── */

test('age ratings from any country land on one scale', () => {
  assert.equal(tmdb.kimonoAge('TV-MA'), '18+');
  assert.equal(tmdb.kimonoAge('PG-13'), '13+');
  assert.equal(tmdb.kimonoAge('R'), '16+');
  assert.equal(tmdb.kimonoAge('TV-Y7'), '7+');
  assert.equal(tmdb.kimonoAge('FSK 16'), '16+');
  assert.equal(tmdb.kimonoAge(''), '');
});

test("TMDB's details become a title, anime spotted by genre and country", () => {
  const t = tmdb.titleFromTmdb({
    id: 95479, name: 'Jujutsu Kaisen', overview: 'Curses.', first_air_date: '2020-10-03', genres: [{ id: 16, name: 'Animation' }], origin_country: ['JP'],
    content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] }, external_ids: { imdb_id: 'tt12343534' },
    images: { logos: [{ iso_639_1: 'ja', file_path: '/ja.png' }, { iso_639_1: 'en', file_path: '/en.png' }] },
    aggregate_credits: { cast: [{ name: 'A' }, { name: 'B' }] }, number_of_seasons: 2, status: 'Returning Series', next_episode_to_air: { air_date: '2026-12-01' },
  }, 'series', 'US', 5);
  assert.equal(t.id, 'tv-95479');
  assert.equal(t.shelf, 'Anime');
  assert.equal(t.age, '18+');
  assert.equal(t.logo, '/en.png');
  assert.equal(t.imdbId, 'tt12343534');
  assert.equal(t.nextAirDate, '2026-12-01');
  assert.equal(tmdb.stubFromTmdb({ media_type: 'person', id: 1 }), null);
  assert.equal(tmdb.stubFromTmdb({ media_type: 'movie', id: 2, title: 'X' }).fetchedAt, 0, 'a stub is stale at once');
});

test('the anime map finds a show by TMDB, TVDB or IMDb, seasons in order, films apart', () => {
  const map = anime.indexAnimeMap([
    { anilist_id: 20, mal_id: 20, themoviedb_id: 46260, type: 'TV' },
    { anilist_id: 113415, mal_id: 40748, thetvdb_id: 377543, type: 'TV', season: { tvdb: 1 } },
    { anilist_id: 145064, mal_id: 51009, thetvdb_id: 377543, type: 'TV', season: { tvdb: 2 } },
    { anilist_id: 131573, mal_id: 48561, thetvdb_id: 377543, type: 'MOVIE' },
    { anilist_id: 1, mal_id: 1, imdb_id: 'tt0213338', type: 'TV' },
    { kitsu_id: 5 },
  ]);
  assert.deepEqual(anime.animeEntriesFor(map, { kind: 'series', tmdbId: 46260 }).map((e) => e.malId), [20]);
  assert.deepEqual(anime.animeEntriesFor(map, { kind: 'series', tmdbId: 1, tvdbId: 377543 }).map((e) => [e.season, e.malId]), [[1, 40748], [2, 51009]]);
  assert.deepEqual(anime.animeEntriesFor(map, { kind: 'series', tmdbId: 1, imdbId: 'tt0213338' }).map((e) => e.malId), [1]);
  assert.deepEqual(anime.animeEntriesFor(map, { kind: 'series', tmdbId: 999 }), []);
  assert.deepEqual(anime.moodsFrom([{ name: 'Tragedy', rank: 90 }, { name: 'Twist', rank: 95, isMediaSpoiler: true }, { name: 'Iyashikei', rank: 40 }]), ['Tragedy']);
  assert.deepEqual(anime.fillerFlags([{ mal_id: 1 }, { mal_id: 26, filler: true }, { mal_id: 27, recap: true }]), [{ number: 26, filler: true, recap: false }, { number: 27, filler: false, recap: true }]);
});

test("an addon's answer becomes releases; torrent hashes and links out are left out", () => {
  assert.equal(streams.addonBase('http://aiostreams:3000/stremio/u/p/manifest.json'), 'http://aiostreams:3000/stremio/u/p');
  assert.equal(streams.stremioId('tt1', 1, 2), 'tt1:1:2');
  assert.equal(streams.stremioId('tt1'), 'tt1');
  const found = streams.releasesFrom({ streams: [
    { name: '[RD+] 4K', description: 'Show S01E02 2160p WEB-DL HDR10 HEVC', url: 'https://rd.example/1', behaviorHints: { filename: 'Show.S01E02.2160p.mkv', videoSize: 8e9 } },
    { name: 'P2P', infoHash: 'abc' },
    { name: 'web', externalUrl: 'https://example.com' },
  ] });
  assert.equal(found.length, 1);
  assert.equal(found[0].cached, true);
  assert.equal(found[0].bytes, 8e9);
  assert.equal(found[0].height, 2160);
});

/* ───── Setting up the services ───── */

import * as provision from '../src/lib/watch/provision.ts';

const accounts = (over = {}) => ({
  usenet: { host: 'news.example.com', port: 563, ssl: true, username: 'u', password: 'p', connections: 30 },
  indexer: { url: 'https://api.indexer.example', key: 'idx' },
  debrid: { service: 'realdebrid', key: 'rd' },
  ...over,
});
const access = { key: 'nzb-key', webdavPassword: 'dav' };

test('nzbdav gets the provider as one pooled server; none when there is no provider', () => {
  assert.deepEqual(JSON.parse(provision.nzbdavProviders(accounts().usenet)), { Providers: [{ Type: 1, Host: 'news.example.com', Port: 563, UseSsl: true, User: 'u', Pass: 'p', MaxConnections: 30 }] });
  assert.deepEqual(JSON.parse(provision.nzbdavProviders({ ...accounts().usenet, host: '' })), { Providers: [] });
  assert.equal(provision.indexerApi('https://api.nzbgeek.info/'), 'https://api.nzbgeek.info/api');
  assert.equal(provision.indexerApi('https://x.example/api'), 'https://x.example/api');
});

test("AIOStreams' configuration follows the accounts: Usenet through nzbdav, torrents through the debrid service", () => {
  const both = provision.aiostreamsConfig(accounts(), access, 'http://nzbdav:3000');
  assert.deepEqual(both.services.map((s) => s.id), ['realdebrid', 'nzbdav']);
  const nzb = both.services[1].credentials;
  assert.equal(nzb.url, 'http://nzbdav:3000');
  assert.equal(nzb.apiKey, 'nzb-key');
  assert.equal(nzb.username, 'kimono');
  assert.deepEqual(both.presets.map((p) => p.type), ['newznab', 'torrentio', 'comet']);
  assert.deepEqual(both.presets[0].options.api, { url: 'https://api.indexer.example/api', apiKey: 'idx' });
  assert.equal(both.presets[0].options.searchMode, 'query');
  assert.deepEqual(both.presets[1].options.services, ['realdebrid']);
  const usenetOnly = provision.aiostreamsConfig(accounts({ debrid: { service: '', key: '' } }), access, 'http://nzbdav:3000');
  assert.deepEqual(usenetOnly.presets.map((p) => p.type), ['newznab']);
  const debridOnly = provision.aiostreamsConfig(accounts({ usenet: { ...accounts().usenet, host: '' } }), access, 'x');
  assert.deepEqual(debridOnly.services.map((s) => s.id), ['realdebrid']);
  assert.equal(provision.hasSources(accounts({ usenet: { ...accounts().usenet, host: '' }, debrid: { service: '', key: '' } })), false);
});

test('a changed account sets things up again; the same accounts do not', () => {
  const a = provision.fingerprint(accounts(), 'http://nzbdav:3000');
  assert.equal(provision.fingerprint(accounts(), 'http://nzbdav:3000'), a);
  assert.notEqual(provision.fingerprint(accounts({ debrid: { service: 'torbox', key: 'tb' } }), 'http://nzbdav:3000'), a);
  assert.ok(!a.includes('rd'), 'no secret in the clear');
});

test("a login in a stream's address moves into a header", () => {
  assert.deepEqual(streams.upstreamRequest('http://kimono:s%40cret@nzbdav:3000/content/a.mkv'), { url: 'http://nzbdav:3000/content/a.mkv', authorization: `Basic ${Buffer.from('kimono:s@cret').toString('base64')}` });
  assert.deepEqual(streams.upstreamRequest('https://rd.example/x'), { url: 'https://rd.example/x', authorization: null });
});

/* ───── Ahead of play ───── */

import * as ahead from '../src/lib/watch/ahead.ts';

test('a search already under way is joined, not started twice, and forgotten when done', async () => {
  const running = new Map();
  let searches = 0;
  let finish;
  const search = () => { searches++; return new Promise((resolve) => { finish = resolve; }); };
  const first = ahead.shared(running, 'streams:tv-1:1:2', search);
  const second = ahead.shared(running, 'streams:tv-1:1:2', search);
  assert.equal(first, second);
  assert.equal(searches, 1);
  finish(['found']);
  assert.deepEqual(await second, ['found']);
  assert.equal(running.size, 0);
  await assert.rejects(ahead.shared(running, 'k', async () => { throw new Error('down'); }), /down/);
  assert.equal(running.size, 0, 'a failed search is forgotten too, so the next one tries again');
  assert.equal(ahead.streamsKey('movie-603', 0, 0), 'streams2:movie-603:0:0');
});

test('found streams wait in the same cache play reads, for twenty minutes', () => {
  const db = fresh();
  model.keep(db, ahead.streamsKey('tv-1', 1, 3), [{ url: 'https://up/x' }], ahead.streamTtl, 0);
  assert.ok(model.cached(db, ahead.streamsKey('tv-1', 1, 3), ahead.streamTtl - 1));
  assert.equal(model.cached(db, ahead.streamsKey('tv-1', 1, 3), ahead.streamTtl + 1), null);
});

/* ───── Skip intro and credits ───── */

import * as markers from '../src/lib/watch/markers.ts';

test("AniSkip's episode is the season's own number, or counted from the first for one long entry", () => {
  const eps = [ep(1, 1), ep(1, 2), ep(1, 3), ep(2, 1), ep(2, 2), ep(0, 1)];
  const perSeason = [{ malId: 40748, season: 1 }, { malId: 51009, season: 2 }];
  assert.deepEqual(markers.aniskipEpisode(perSeason, eps, { season: 2, episode: 2 }), { malId: 51009, episode: 2 });
  assert.deepEqual(markers.aniskipEpisode([{ malId: 21, season: null }], eps, { season: 2, episode: 2 }), { malId: 21, episode: 5 }, 'specials not counted');
  assert.equal(markers.aniskipEpisode([{ malId: 1, season: 1 }, { malId: 2, season: null }], eps, { season: 2, episode: 1 }), null, 'unclear: no guess');
  assert.deepEqual(markers.aniskipEpisode([], [], { season: 0, episode: 0 }, 199), { malId: 199, episode: 1 }, 'a film is episode 1');
  assert.equal(markers.aniskipUrl('https://api.aniskip.com/v2', 21, 5), 'https://api.aniskip.com/v2/skip-times/21/5?types=op&types=ed&types=recap&episodeLength=0');
});

test("AniSkip's times become intro, recap and credits", () => {
  const m = markers.markersFrom({ found: true, results: [
    { skipType: 'op', interval: { startTime: 89.95, endTime: 179.12 } },
    { skipType: 'op', interval: { startTime: 1, endTime: 2 } },
    { skipType: 'recap', interval: { startTime: 0, endTime: 60 } },
    { skipType: 'ed', interval: { startTime: 1320.4, endTime: 1410 } },
  ] });
  assert.deepEqual(m, { intro: [90, 179.1], recap: [0, 60], credits: 1320.4 });
  assert.equal(markers.markersFrom({ found: false, results: [] }), null);
  assert.equal(markers.markersFrom({ found: true, results: [{ skipType: 'op', interval: { startTime: 5, endTime: 5 } }] }), null);
});

/* ───── Plays or not ───── */

test('the playability check goes two at a time, and gives up when the search is down', async () => {
  let now = 0, most = 0;
  const seen = [];
  const checked = await ahead.pool([1, 2, 3, 4, 5], 2, async (n) => {
    now++; most = Math.max(most, now);
    await new Promise((resolve) => setTimeout(resolve, 5));
    now--; seen.push(n);
    return true;
  });
  assert.equal(checked, 5);
  assert.equal(most, 2, 'never more than two at once');
  assert.deepEqual(seen.sort(), [1, 2, 3, 4, 5]);
  let tried = 0;
  const down = await ahead.pool([1, 2, 3, 4, 5, 6, 7, 8], 1, async () => { tried++; throw new Error('502'); });
  assert.equal(tried, 3, 'three failures in a row and the rest wait for the next run');
  assert.equal(down, 3);
});

test('a title checked within the day is not checked again; Home hides only what is known not to play', () => {
  const db = fresh();
  ahead.notePlayable(db, 'tv-1', true, 0);
  ahead.notePlayable(db, 'movie-2', false, 0);
  const verdict = (id) => ahead.playableOf(db, id, 1000);
  assert.equal(verdict('tv-1'), true);
  assert.equal(verdict('tv-3'), null);
  assert.deepEqual(ahead.toCheck(['tv-1', 'tv-3', 'movie-2', 'tv-3', 'tv-4', 'tv-5'], verdict, 2), ['tv-3', 'tv-4']);
  assert.deepEqual(ahead.visible([{ id: 'tv-1' }, { id: 'movie-2' }, { id: 'tv-3' }], verdict).map((t) => t.id), ['tv-1', 'tv-3']);
  assert.equal(ahead.playableOf(db, 'movie-2', ahead.playableTtl + 1), null, 'a day later it is checked again');
  assert.equal(ahead.anyPlayable([{ junk: true }]), false);
  assert.equal(ahead.anyPlayable([{ junk: true }, { junk: false }]), true);
});

/* ───── Images ───── */

import * as images from '../src/lib/watch/images.ts';

test("images are Kimono's addresses, and only TMDB-shaped requests are fetched", () => {
  assert.equal(images.imageUrl('https://home.example', '/abc.jpg', 'w500'), 'https://home.example/api/v1/watch/image/w500/abc.jpg');
  assert.equal(images.imageUrl('https://home.example', null), null);
  assert.deepEqual(images.imageRequest('w500', ['abc_D-1.jpg']), { size: 'w500', file: 'abc_D-1.jpg', type: 'image/jpeg' });
  assert.equal(images.imageRequest('original', ['logo.svg']).type, 'image/svg+xml');
  assert.equal(images.imageRequest('w9999', ['abc.jpg']), null, 'unknown size');
  assert.equal(images.imageRequest('w500', ['..', 'etc.jpg']), null, 'one file only');
  assert.equal(images.imageRequest('w500', ['abc.html']), null);
  assert.equal(images.imageRequest('w500', ['a b.jpg']), null);
  const h = images.imageHeaders('image/svg+xml', 10);
  assert.match(h.get('cache-control'), /immutable/);
  assert.match(h.get('content-security-policy'), /sandbox/);
});

test('the image cache forgets the least recently used once past its cap, down to 90%', () => {
  const files = [
    { path: 'a', bytes: 40, usedAt: 3 },
    { path: 'b', bytes: 40, usedAt: 1 },
    { path: 'c', bytes: 40, usedAt: 2 },
  ];
  assert.deepEqual(images.evictions(files, 200), []);
  assert.deepEqual(images.evictions(files, 100).map((f) => f.path), ['b'], '120 → 80, under 90');
  assert.deepEqual(images.evictions(files, 50).map((f) => f.path), ['b', 'c'], '120 → 40, under 45');
  assert.equal(images.evictions(files, 10).length, 3);
});

/* ───── Status ───── */

import * as status from '../src/lib/watch/status.ts';

test('a service that answers anything below 500 is up; silence or a 5xx is down', () => {
  assert.deepEqual(status.probeOf(404, 12, 'nzbdav isn\'t answering'), { ok: true, ms: 12, problem: null });
  assert.deepEqual(status.probeOf(null, null, 'nzbdav isn\'t answering'), { ok: false, ms: null, problem: 'nzbdav isn\'t answering' });
  assert.match(status.probeOf(502, 3, 'AIOStreams isn\'t answering').problem, /answered 502/);
});

test('setup and the last error are kept for the status page; a later success clears the setup error', async () => {
  const db = fresh();
  assert.deepEqual(provision.provisioningOf(db), { ok: null, at: null, setupAt: null, error: null });
  const none = { ...accounts({ usenet: { ...accounts().usenet, host: '' }, debrid: { service: '', key: '' } }), nzbdavStreamUrl: 'http://nzbdav:3000' };
  await assert.rejects(provision.ensureProvisioned(db, none, access), /nowhere to stream/);
  const failed = provision.provisioningOf(db);
  assert.equal(failed.ok, false);
  assert.match(failed.error, /nowhere to stream/);
  provision.noteProvisioning(db, null, 5);
  assert.deepEqual(provision.provisioningOf(db), { ok: true, at: 5, setupAt: null, error: null });
  assert.equal(status.lastError(db), null);
  status.noteError(db, 'The stream search didn\'t answer.', 7);
  assert.deepEqual(status.lastError(db), { message: 'The stream search didn\'t answer.', at: 7 });
});

/* ───── Sub, dub and languages ───── */

import * as languages from '../src/lib/watch/languages.ts';

/* As AIOStreams lists them for Frieren episode 1. */
const multi = releases.parseRelease({ url: 'u1', name: '[ND⚡] Usenet 1080p', description: '🎥 WEB-DL 🎞️ AVC 🏷️ OldT 📡 Crunchyroll\n🎧 AAC\n📦 61.1 GB (11.6 Mbps)📅 149d 🔍 NZBgeek\n🌎 English | French | German | Japanese | Spanish📝 German | English | Latino | Arabic\n📁 Frieren.Beyond.Journeys.End.2023.S01.1080p.CR.WEB-DL.MULTI.AAC2.0.H.264-OldT', bytes: 61.1 * 1024 ** 3 });
const subsplease = releases.parseRelease({ url: 'u2', name: '[RD⚡] Torrentio 1080p', description: '🏷️ SubsPlease\n📦 1.59 GB (8.48 Mbps)👥 106 🔍 NyaaSi\n📁 [SubsPlease] Sousou no Frieren - 01v3 (1080p) [9F4DAB7F].mkv', filename: '[SubsPlease] Sousou no Frieren - 01v3 (1080p) [9F4DAB7F].mkv' });
const erai = releases.parseRelease({ url: 'u3', name: '[RD⚡] Torrentio 1080p', description: '🏷️ Erai-raws\n📦 1.59 GB (8.48 Mbps)\n🌎 English | Russian | Arabic📝 English | Russian | Arabic\n📁 [Erai-raws] Sousou no Frieren - 01 [1080p][Multiple Subtitle][141638CC].mkv' });
const extra = releases.parseRelease({ url: 'u4', name: '[RD⏳] Torrentio 1080p', description: '🎥 BluRay 🎞️ HEVC 🏷️ Beatrice-Raws\n📦 30.8 MB (164 Kbps)\n📁 [Beatrice-Raws] Sousou no Frieren (OO Magic Episode 01) [BDRip 1920x1080 HEVC TrueHD].mkv' });
const mini = releases.parseRelease({ url: 'u5', name: '[RD⚡] Torrentio 1080p', description: '📦 10.7 MB\n📁 [Piyoko] Sousou no Frieren - Marumaru no Mahou (Mini Anime) - 01 [WEB 1080p YT VP9 AAC 2.0].mkv' });

test("AIOStreams' language lists become audio and subtitles; fansub groups are Japanese audio", () => {
  assert.deepEqual(multi.languages, ['en', 'fr', 'de', 'ja', 'es']);
  assert.deepEqual(multi.subtitles, ['de', 'en', 'es', 'ar']);
  assert.deepEqual(subsplease.languages, ['ja']);
  assert.deepEqual(subsplease.subtitles, ['en']);
  assert.deepEqual(erai.languages, ['ja'], "Erai-raws' listed languages are its subtitles");
  assert.ok(erai.subtitles.includes('en') && erai.subtitles.includes('ru'));
  assert.deepEqual(releases.parseRelease({ url: 'x', name: 'Show S01E01 1080p Dual Audio WEB-DL' }).languages, ['ja', 'en']);
});

test("a season pack's listed bitrate is used, not its size; extras and shorts are not the episode", () => {
  assert.equal(multi.mbps, 11.6);
  assert.equal(releases.bitrate(multi, 26), 11.6);
  assert.equal(releases.unplayable(multi, tv, 26), null, 'a 61 GB pack still plays');
  assert.equal(extra.junk, true, 'a 164 Kbps extra');
  assert.equal(mini.junk, true, 'the mini anime');
});

test('anime defaults to the original with full subtitles; a dub gets signs only', () => {
  const anime = { shelf: 'Anime', originalLanguage: 'ja' };
  const prefs = { ...model.defaultPrefs };
  assert.deepEqual(languages.trackPlan(anime, prefs), { audio: 'ja', subtitles: { language: 'en', kind: 'full' } });
  assert.deepEqual(languages.trackPlan(anime, { ...prefs, animeAudio: 'dub' }), { audio: 'en', subtitles: { language: 'en', kind: 'signs' } });
  assert.deepEqual(languages.trackPlan({ shelf: 'Anime', originalLanguage: '' }, prefs).audio, 'ja', 'anime with no language on record is Japanese');
  const french = { shelf: 'Film', originalLanguage: 'fr' };
  assert.deepEqual(languages.trackPlan(french, prefs), { audio: 'fr', subtitles: { language: 'en', kind: 'full' } });
  assert.deepEqual(languages.trackPlan(french, { ...prefs, filmAudio: 'mine' }).audio, 'en');
  assert.equal(languages.trackPlan(french, { ...prefs, subtitles: 'off' }).subtitles, null);
  assert.deepEqual(languages.trackPlan(anime, prefs, { audio: 'en', subtitles: 'off' }), { audio: 'en', subtitles: null }, "the show's own choice wins");
  const told = languages.playerTracks(languages.trackPlan(anime, prefs));
  assert.deepEqual(told.audio.tags, ['ja', 'jpn']);
  assert.deepEqual(told.subtitles.tags, ['en', 'eng']);
});

test('someone who wants the dub never gets a Japanese-only release when a dubbed one exists', () => {
  const anime = { shelf: 'Anime', originalLanguage: 'ja' };
  const sub = languages.wantFor(languages.trackPlan(anime, model.defaultPrefs), 'ja');
  const dub = languages.wantFor(languages.trackPlan(anime, { ...model.defaultPrefs, animeAudio: 'dub' }), 'ja');
  assert.ok(releases.languageScore(subsplease, dub) < -100);
  assert.ok(releases.languageScore(multi, dub) > 0);
  assert.ok(releases.languageScore(subsplease, sub) > 0);
  const device = { ...phone, codecs: ['h264', 'hevc'] };
  assert.equal(releases.rank([subsplease, multi], device, 'auto', 26, dub)[0], multi);
});

test('a show remembers the tracks picked in the player; settings take the new choices', () => {
  const db = fresh();
  assert.equal(model.tracksOf(db, 'a', 'tv-1'), null);
  model.setTracks(db, 'a', 'tv-1', { audio: 'en', subtitles: 'signs' });
  assert.deepEqual(model.tracksOf(db, 'a', 'tv-1'), { audio: 'en', subtitles: 'signs' });
  assert.throws(() => model.setTracks(db, 'a', 'tv-1', { audio: 'english', subtitles: 'x' }), /audio language/);
  model.setTracks(db, 'a', 'tv-1', null);
  assert.equal(model.tracksOf(db, 'a', 'tv-1'), null);
  model.savePrefs(db, 'a', { animeAudio: 'dub', filmAudio: 'nope', subtitles: 'always' });
  const p = model.prefsOf(db, 'a');
  assert.equal(p.animeAudio, 'dub');
  assert.equal(p.filmAudio, 'original');
  assert.equal(p.subtitles, 'always');
});

test("the relay follows AIOStreams' redirect to nzbdav, with the login as that hop's header only", async () => {
  const seen = [];
  const fake = async (url, init) => {
    seen.push([url, init.headers.get('authorization'), init.redirect]);
    if (url.startsWith('http://aiostreams')) return new Response(null, { status: 307, headers: { location: 'http://kimono:s3cret@nzbdav:3000/content/a.mkv' } });
    return new Response('bytes', { status: 206, headers: { 'content-range': 'bytes 0-4/10' } });
  };
  const r = await streams.fetchUpstream('http://aiostreams:3000/api/v1/debrid/playback/x', { method: 'GET', headers: new Headers({ range: 'bytes=0-4', authorization: 'Bearer leak' }) }, fake);
  assert.equal(r.status, 206);
  assert.deepEqual(seen, [
    ['http://aiostreams:3000/api/v1/debrid/playback/x', null, 'manual'],
    ['http://nzbdav:3000/content/a.mkv', `Basic ${Buffer.from('kimono:s3cret').toString('base64')}`, 'manual'],
  ]);
  const loop = async () => new Response(null, { status: 302, headers: { location: '/again' } });
  assert.equal(await streams.fetchUpstream('http://x/a', { method: 'GET', headers: new Headers() }, loop), null, 'gives up on a redirect loop');
});

test('a "download this" type becomes the video type from the file name', () => {
  assert.equal(streams.videoType('application/force-download', 'https://rd.example/d/abc/Show.S01E01.mkv'), 'video/x-matroska');
  assert.equal(streams.videoType('application/octet-stream', 'http://nzbdav/content/x.mp4'), 'video/mp4');
  assert.equal(streams.videoType('video/webm', 'http://x/y.mkv'), 'video/webm');
});

/* ───── Picking the faster source ───── */

import * as speed from '../src/lib/watch/speed.ts';

test("each source's speed is a running figure from the opening bursts it delivered", () => {
  assert.equal(speed.sampleOf(1024 * 1024, 100, 500), null, 'too little to say');
  const s1 = speed.sampleOf(8 * 1024 * 1024, 600, 10_000);
  assert.ok(Math.abs(s1.mbps - 6.71) < 0.01);
  let fig = speed.nextSpeed(undefined, s1, 0);
  assert.equal(fig.samples, 1);
  fig = speed.nextSpeed(fig, { mbps: 30, firstByteMs: 500 }, 1000);
  assert.ok(fig.mbps > 6.7 && fig.mbps < 30, 'moves toward the new figure without jumping');
  const aged = speed.nextSpeed({ mbps: 5, firstByteMs: 500, samples: 9, at: 0 }, { mbps: 30, firstByteMs: 500 }, 5 * 3_600_000);
  assert.ok(aged.mbps > 15, 'an old figure gives way faster');
});

test('a source that cannot keep up sinks its versions below ones that will play; unknown sources are tried', () => {
  const slow = { mbps: 5, firstByteMs: 3000, samples: 3, at: Date.now() };
  const fast = { mbps: 25, firstByteMs: 600, samples: 3, at: Date.now() };
  assert.ok(speed.speedScore(slow, speed.needed({ height: 1080 }, 11)) < -200);
  assert.equal(speed.speedScore(fast, speed.needed({ height: 1080 }, 11)), 0);
  assert.equal(speed.speedScore(undefined, 20), 0);
  assert.equal(speed.speedScore({ ...slow, at: Date.now() - 2 * 86_400_000 }, 20), 0, 'a day-old figure is forgotten');
  const usenet = releases.parseRelease({ url: 'n', name: '[ND⚡] Usenet 1080p', description: '📦 2.1 GB (10.9 Mbps)' });
  const rd = releases.parseRelease({ url: 'r', name: '[RD⚡] Torrentio 1080p', description: '📦 2.0 GB (10.2 Mbps)' });
  assert.equal(releases.rank([usenet, rd], phone, 'auto', 26)[0], usenet, 'Usenet first while nothing is known');
  assert.equal(releases.rank([usenet, rd], phone, 'auto', 26, 'en', { usenet: slow, debrid: fast })[0], rd, 'debrid once Usenet proves slow');
  assert.equal(releases.rank([usenet, rd], phone, 'auto', 26, 'en', { usenet: fast, debrid: fast })[0], usenet, 'Usenet again when it keeps up');
});

test('the meter passes every byte through and reports the opening burst once', async () => {
  let t = 0;
  const chunks = [new Uint8Array(4 * 1024 * 1024), new Uint8Array(4 * 1024 * 1024), new Uint8Array(1024)];
  const source = new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } });
  const seen = [];
  const metered = speed.meter(source, 0, (...args) => seen.push(args), () => (t += 100));
  let total = 0;
  for await (const chunk of metered) total += chunk.byteLength;
  assert.equal(total, 8 * 1024 * 1024 + 1024);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], 8 * 1024 * 1024);
});

test('stream tokens carry their source', () => {
  const key = randomBytes(32);
  assert.equal(token.openStream(key, token.sealStream(key, { url: 'u', username: 'a', expiresAt: Date.now() + 1000, source: 'usenet' })).source, 'usenet');
});

/* ───── HLS ───── */

const vstream = (over = {}) => ({ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', level: 41, width: 1920, height: 1080, pix_fmt: 'yuv420p', avg_frame_rate: '24000/1001', ...over });
const astream = (index, language, over = {}) => ({ index, codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language }, ...over });
const sstream = (index, language, title, codec = 'ass') => ({ index, codec_type: 'subtitle', codec_name: codec, tags: { language, title } });
const probeOf = (streams, over = {}) => ({ format: { duration: '1440.5', bit_rate: '4000000' }, streams, keyframes: Array.from({ length: 300 }, (_, i) => i * 4.8), hardware: { kind: 'software', tonemapx: true }, ...over });
const browser = { codecs: ['h264'], hdr: [], dvProfiles: [], maxHeight: 1080, passthrough: [] };
const appleTv = hls.screenFor(releases.cleanDevice({ client: 'ios' }), 'airplay');
const grantFor = (screen, over = {}) => ({ screen, audio: ['ja', 'jpn'], subtitles: { tags: ['en', 'eng'], kind: 'full', signsTitles: ['signs', 'songs', 'forced'] }, burn: false, ...over });
const dualAudio = () => probeOf([vstream(), astream(1, 'jpn'), astream(2, 'eng', { codec_name: 'eac3', channels: 6 }), sstream(3, 'eng', 'Signs & Songs'), sstream(4, 'eng', 'Full Subtitles'), sstream(5, 'eng', 'PGS', 'hdmv_pgs_subtitle')]);

test('casting picks for the receiver, and the web keeps what it says it can do', () => {
  assert.equal(hls.castOf('chromecast'), 'chromecast');
  assert.equal(hls.castOf('roku'), null);
  const cc = hls.screenFor(phone, 'chromecast');
  assert.deepEqual([cc.codecs, cc.maxHeight, cc.hdr, cc.passthrough], [['h264'], 1080, [], []]);
  assert.ok(appleTv.codecs.includes('hevc') && appleTv.hdr.includes('hdr10') && appleTv.passthrough.includes('eac3'));
  assert.equal(hls.screenFor(phone, null), phone);
  assert.ok(hls.anything(cc).codecs.includes('av1'));
});

test('HLS copies what the screen decodes and transcodes only what it cannot', () => {
  const copied = hls.planHls(dualAudio(), grantFor(browser));
  assert.equal(copied.video.mode, 'copy');
  assert.equal(copied.video.codecs, 'avc1.640029');
  assert.equal(copied.audio.index, 1, 'the Japanese audio, as wanted');
  assert.equal(copied.audio.mode, 'copy', 'AAC stays as it is');
  assert.deepEqual(copied.subtitles.map((s) => [s.index, s.default, s.forced]), [[3, false, true], [4, true, false]], 'text subtitles only; full dialogue on');
  assert.equal(copied.burn, null);

  const dub = hls.planHls(dualAudio(), grantFor(appleTv, { audio: ['en', 'eng'], subtitles: { tags: ['en', 'eng'], kind: 'signs', signsTitles: ['signs'] } }));
  assert.equal(dub.audio.index, 2);
  assert.equal(dub.audio.mode, 'copy', 'E-AC3 passes through to an Apple TV');
  assert.equal(dub.subtitles.find((s) => s.default).index, 3, 'signs only with a dub');
  assert.equal(hls.planHls(dualAudio(), grantFor(browser, { audio: ['en', 'eng'] })).audio.mode, 'aac', 'E-AC3 becomes AAC for a browser');

  const hevc = probeOf([vstream({ codec_name: 'hevc', profile: 'Main 10', level: 150, pix_fmt: 'yuv420p10le', height: 2160, width: 3840, color_transfer: 'smpte2084' }), astream(1, 'eng')]);
  const toBrowser = hls.planHls(hevc, grantFor(browser));
  assert.equal(toBrowser.video.mode, 'transcode');
  assert.equal(toBrowser.video.tonemap, true, 'HDR is tone-mapped for an SDR screen');
  assert.deepEqual(toBrowser.video.rungs.map((r) => r.height), [1080, 720], 'software keeps to two sizes');
  const apple = hls.planHls(hevc, grantFor(appleTv));
  assert.equal(apple.video.mode, 'copy', 'HDR10 HEVC plays as it is on an Apple TV');
  assert.equal(apple.video.range, 'PQ');
  assert.equal(apple.video.codecs, 'hvc1.2.4.L150.B0');
  const gpu = hls.planHls({ ...hevc, hardware: { kind: 'vaapi', tonemapx: true } }, grantFor({ ...appleTv, codecs: ['h264'] }));
  assert.deepEqual(gpu.video.rungs.map((r) => [r.width, r.height]), [[3840, 2160], [1920, 1080], [1280, 720], [854, 480]], 'a GPU does the whole ladder');

  assert.equal(hls.planHls(probeOf([vstream({ pix_fmt: 'yuv420p10le' })]), grantFor(browser)).video.mode, 'transcode', '10-bit H.264 never plays in a browser');
  assert.equal(hls.planHls(probeOf([vstream({ color_transfer: 'smpte2084', codec_name: 'hevc', side_data_list: [{ side_data_type: 'DOVI configuration record', dv_profile: 5 }] })]), grantFor(appleTv)).video.mode, 'transcode', 'profile 5 is tone-mapped');
  assert.equal(hls.planHls(probeOf([vstream()], { keyframes: null }), grantFor(browser)).video.mode, 'transcode', 'without an index there is nowhere to cut a copy');
  assert.equal(hls.planHls(probeOf([vstream({ height: 2160, width: 3840 })]), grantFor(browser)).video.mode, 'transcode', 'too tall is scaled down');

  const pgsOnly = probeOf([vstream(), astream(1, 'jpn'), sstream(2, 'eng', 'Full', 'hdmv_pgs_subtitle')]);
  assert.deepEqual(hls.planHls(pgsOnly, grantFor(browser)).burn, { index: 2, bitmap: true }, 'PGS that is wanted is burned in');
  const burned = hls.planHls(dualAudio(), grantFor(browser, { burn: true }));
  assert.deepEqual([burned.video.mode, burned.burn.index, burned.burn.bitmap], ['transcode', 4, false]);
});

test('segments start on keyframes when copying and every six seconds when transcoding', () => {
  assert.deepEqual(hls.segmentTimes(20, null), [0, 6, 12, 18]);
  assert.deepEqual(hls.segmentTimes(30, [0, 2, 4, 6.006, 8, 10, 13, 15, 20, 26, 29.5]), [0, 6.006, 13, 20, 26]);
  const plan = hls.planHls(dualAudio(), grantFor(browser));
  assert.equal(plan.segments[1], 9.6);
});

test('ffmpeg arguments: copy keeps the picture, transcoding forces keyframes on the segment grid', () => {
  const copy = hls.ffmpegArgs(hls.planHls(dualAudio(), grantFor(browser)), { kind: 'software' });
  assert.deepEqual(copy.outputs, [{ name: 'v0', kind: 'fmp4' }, { name: 's0', kind: 'vtt' }, { name: 's1', kind: 'vtt' }]);
  assert.equal(copy.seekPad, 0.25);
  const a = copy.args.join(' ');
  assert.match(a, /-ss \{start\} -i \{input\} -copyts/);
  assert.match(a, /-map 0:0 -c:v copy -map 0:1 -c:a copy -f mp4 -movflags \S*frag_discont\S* -use_editlist 0 pipe:3/);
  assert.match(a, /-map 0:3 -c:s webvtt -f webvtt pipe:4 -map 0:4 -c:s webvtt -f webvtt pipe:5$/);
  assert.equal(copy.fallback, undefined);

  const hdr = probeOf([vstream({ codec_name: 'hevc', profile: 'Main 10', pix_fmt: 'yuv420p10le', color_transfer: 'smpte2084', height: 2160, width: 3840 }), astream(1, 'eng', { codec_name: 'truehd' })]);
  const soft = hls.ffmpegArgs(hls.planHls(hdr, grantFor(browser)), { kind: 'software', tonemapx: true });
  const s = soft.args.join(' ');
  assert.match(s, /-filter_complex \[0:0\]tonemapx=\S+,split=2\[s0\]\[s1\];\[s0\]scale=1920:1080:flags=bicubic\[v0\];\[s1\]scale=1280:720/);
  assert.match(s, /-map \[v0\] -c:v libx264 .* -force_key_frames:v expr:gte\(t,n_forced\*6\) -map 0:1 -c:a aac -ac 2/);
  assert.equal(soft.seekPad, 0);

  const vaapi = hls.ffmpegArgs(hls.planHls({ ...hdr, hardware: { kind: 'vaapi', device: '/dev/dri/renderD128' } }, grantFor(browser)), { kind: 'vaapi', device: '/dev/dri/renderD128', tonemapx: true });
  const v = vaapi.args.join(' ');
  assert.match(v, /-init_hw_device vaapi=va:\/dev\/dri\/renderD128 -filter_hw_device va -hwaccel vaapi/);
  assert.match(v, /hwdownload,format=p010le,tonemapx=\S+format=nv12,hwupload,split=3/);
  assert.match(v, /scale_vaapi=w=1920:h=1080:format=nv12\[v0\]/);
  assert.ok(vaapi.fallback.join(' ').includes('libx264'), 'software to fall back on');

  const pgs = hls.ffmpegArgs(hls.planHls(probeOf([vstream(), astream(1, 'jpn'), sstream(2, 'eng', 'Full', 'hdmv_pgs_subtitle')]), grantFor(browser)), { kind: 'nvenc' });
  assert.match(pgs.args.join(' '), /\[0:0\]format=yuv420p\[pic\];\[pic\]\[0:2\]overlay,split=2/, 'burning is done in software');
  const ass = hls.ffmpegArgs(hls.planHls(dualAudio(), grantFor(browser, { burn: true })), { kind: 'software' });
  assert.match(ass.args.join(' '), /subtitles=filename=\{dir\}\/burn\.ass:fontsdir=\{dir\}/);
  assert.ok(ass.prepare[0].includes('-dump_attachment:t'));
});

test('playlists list every segment, relative to the sealed address, and nothing else is served', () => {
  const plan = hls.planHls(dualAudio(), grantFor(browser));
  const master = hls.masterPlaylist(plan);
  assert.match(master, /#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Full Subtitles",LANGUAGE="eng",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,URI="s1.m3u8"/);
  assert.match(master, /#EXT-X-STREAM-INF:BANDWIDTH=5000000,CODECS="avc1.640029,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=23.976,VIDEO-RANGE=SDR,SUBTITLES="subs",CLOSED-CAPTIONS=NONE\nv0.m3u8\n/);
  const media = hls.mediaPlaylist(plan, 0);
  assert.match(media, /#EXT-X-TARGETDURATION:11\n/);
  assert.match(media, /#EXT-X-PLAYLIST-TYPE:VOD/);
  assert.match(media, /#EXT-X-MAP:URI="v0\/init.mp4"\n#EXTINF:9.600,\nv0\/0.m4s\n/);
  assert.ok(media.trimEnd().endsWith('#EXT-X-ENDLIST'));
  assert.equal(media.match(/#EXTINF/g).length, plan.segments.length);
  assert.match(hls.subtitlePlaylist(plan, 1), /\ns1\/0.vtt\n/);

  assert.deepEqual(hls.hlsPath(['main.m3u8'], plan), { kind: 'master' });
  assert.deepEqual(hls.hlsPath(['v0.m3u8'], plan), { kind: 'playlist', output: 'v0' });
  assert.deepEqual(hls.hlsPath(['v0', '12.m4s'], plan), { kind: 'file', output: 'v0', file: '12.m4s' });
  assert.deepEqual(hls.hlsPath(['s1', '3.vtt'], plan), { kind: 'file', output: 's1', file: '3.vtt' });
  for (const bad of [['v1.m3u8'], ['s2', '0.vtt'], ['v0', '0.vtt'], ['s0', 'init.mp4'], ['v0', '..', 'x'], ['v0', `${plan.segments.length}.m4s`], ['v0', '-1.m4s']]) {
    assert.equal(hls.hlsPath(bad, plan), null, bad.join('/'));
  }
});

test('HLS addresses are sealed like stream addresses, and the two never open as each other', () => {
  const key = randomBytes(32);
  const grant = { stream: 'abc.def.ghi', username: 'akram', expiresAt: Date.now() + 60_000, ...grantFor(browser) };
  const sealed = hls.sealHls(key, grant);
  assert.deepEqual(hls.openHls(key, sealed), grant);
  assert.equal(hls.openHls(randomBytes(32), sealed), null);
  assert.equal(hls.openHls(key, sealed, Date.now() + 120_000), null, 'runs out');
  assert.equal(token.openStream(key, sealed), null, 'not a stream token');
  assert.equal(hls.openHls(key, token.sealStream(key, { url: 'u', username: 'a', expiresAt: Date.now() + 1000 })), null, 'nor the other way');
  assert.equal(hls.sessionOf(sealed), hls.sessionOf(sealed));
  assert.match(hls.sessionOf(sealed), /^[a-f0-9]{32}$/);
});

/* ───── Quality per device ───── */

test('quality: chosen just now, else the device, else the person', () => {
  const db = fresh();
  const prefs = { ...model.defaultPrefs, quality: '1080' };
  assert.equal(model.qualityFor(null, null, prefs), '1080');
  model.setDeviceQuality(db, 'a', 'tv-living', '2160');
  assert.equal(model.deviceQualityOf(db, 'a', 'tv-living'), '2160');
  assert.equal(model.deviceQualityOf(db, 'b', 'tv-living'), null, 'per person');
  assert.equal(model.deviceQualityOf(db, 'a', 'phone'), null);
  assert.equal(model.qualityFor(null, model.deviceQualityOf(db, 'a', 'tv-living'), prefs), '2160');
  assert.equal(model.qualityFor('saver', '2160', prefs), 'saver', 'the player\'s pick wins for that play');
  model.setDeviceQuality(db, 'a', 'tv-living', '720');
  assert.equal(model.deviceQualityOf(db, 'a', 'tv-living'), '720');
  const merged = model.devicePrefsOf(db, 'a', 'tv-living');
  assert.deepEqual([merged.quality, merged.device], ['720', { id: 'tv-living', quality: '720' }]);
  model.setDeviceQuality(db, 'a', 'tv-living', null);
  assert.deepEqual(model.devicePrefsOf(db, 'a', 'tv-living').device, { id: 'tv-living', quality: null });
  assert.equal(model.devicePrefsOf(db, 'a', null).device, null);
  assert.equal(model.cleanQuality('4k'), null);
  assert.equal(model.cleanDeviceId('web:3f2a-91'), 'web:3f2a-91');
  assert.equal(model.cleanDeviceId('a b'), null);
  assert.equal(model.cleanDeviceId('x'.repeat(200)), null);
});

test('the Quality menu offers only sizes that play here', () => {
  const sizes = (...hs) => hs.map((height) => ({ height }));
  const values = (o) => o.map((x) => x.value);
  assert.deepEqual(values(releases.qualityOptions(sizes(2160, 1080), tv)), ['auto', '2160', '1080', 'saver']);
  assert.deepEqual(values(releases.qualityOptions(sizes(2160, 1080), { ...tv, maxHeight: 1080 })), ['auto', '1080', 'saver'], '4K only on a screen that shows it');
  assert.deepEqual(values(releases.qualityOptions(sizes(1080), tv)), ['auto', '1080', 'saver']);
  assert.deepEqual(values(releases.qualityOptions(sizes(1080), tv, true)), ['auto', '1080', '720', 'saver'], 'HLS scales down');
  assert.deepEqual(values(releases.qualityOptions([], tv)), ['auto']);
  assert.deepEqual(releases.qualityOptions(sizes(2160), tv, true).map((x) => x.label), ['Auto', '4K', '1080p', '720p', 'Data saver']);
});

/* ───── Watch Together ───── */

const T = party.together;
const start = (now = 1_000_000, over = {}) => party.newParty('p-abcdefgh', { username: 'Akram', client: 'akram-tab1' }, { titleId: 'tv-1', season: 1, episode: 3, position: 120, ...over }, ['Sami', 'akram', 'mo'], now);
/** A tick with every screen still connected (the live channel keeps them seen). */
const live = (p, now) => party.tick(party.seen(p, p.members.map((m) => m.client), now), now);
/** A party with akram and sami both ready and playing from 120 s at `now`. */
function playing(now = 1_000_000) {
  let p = start(now - 5000);
  p = party.report(p, { client: 'sami-tab1', username: 'sami' }, 'loading', now - 4000);
  p = party.report(p, { client: 'akram-tab1', username: 'akram' }, 'ready', now - 3000);
  p = party.tick(p, now - 3000).party;
  p = party.report(p, { client: 'sami-tab1', username: 'sami' }, 'ready', now - 2000);
  p = party.tick(p, now - 2000).party;
  const cmd = party.command(p, { username: 'akram' }, { type: 'seek', position: 120 }, p.seq, now);
  assert.ok(cmd.ok);
  return party.command(cmd.party, { username: 'akram' }, { type: 'play' }, cmd.party.seq, now).party;
}

test('the timeline says where everyone should be', () => {
  const t = { playing: true, position: 100, rate: 1, at: 10_000 };
  assert.equal(party.positionAt(t, 10_000), 100);
  assert.equal(party.positionAt(t, 12_500), 102.5);
  assert.equal(party.positionAt({ ...t, rate: 1.5 }, 12_000), 103);
  assert.equal(party.positionAt({ ...t, playing: false }, 99_000), 100, 'paused stays put');
  assert.equal(party.positionAt(t, 9_000), 100, 'a start set ahead holds until then');
});

test('drift is nudged out by the rate, and seeked out past 2 s', () => {
  assert.deepEqual(party.correction(50.1, 50, false), { seek: null, rate: 1, correcting: false }, 'within 150 ms is left alone');
  const ahead = party.correction(50.5, 50, false);
  assert.equal(ahead.seek, null);
  assert.ok(ahead.rate < 1 && ahead.rate >= 0.95, `ahead slows down (${ahead.rate})`);
  const behind = party.correction(49.5, 50, false);
  assert.ok(behind.rate > 1 && behind.rate <= 1.05, `behind speeds up (${behind.rate})`);
  assert.equal(party.correction(51.9, 50, false).rate, 0.95, 'never more than 5%');
  assert.equal(party.correction(48.1, 50, false).rate, 1.05);
  assert.equal(party.correction(52.5, 50, false).seek, 50, 'over 2 s seeks');
  assert.equal(party.correction(47, 50, true).seek, 50);
  assert.equal(party.correction(50.1, 50, true).correcting, true, 'once correcting, keeps on to within 40 ms');
  assert.equal(party.correction(50.03, 50, true).correcting, false);
  assert.ok(Math.abs(party.correction(50.5, 50, false, 1.5).rate - 1.5 * ahead.rate) < 1e-9, 'relative to the party rate');
  /* Played out: a screen 1 s behind, nudged every 250 ms, is back within 40 ms inside 30 s and never overshoots by more than that. */
  let local = 49, expected = 50, correcting = false, worst = 0;
  for (let i = 0; i < 120; i++) {
    const c = party.correction(local, expected, correcting);
    correcting = c.correcting;
    local += 0.25 * c.rate; expected += 0.25;
    if (i > 20) worst = Math.max(worst, local - expected);
  }
  assert.ok(Math.abs(local - expected) < 0.15, `caught up (${(local - expected).toFixed(3)})`);
  assert.ok(worst < 0.05, 'no overshoot');
});

test('the server clock is read from the quickest pings', () => {
  /* Server 5 s ahead; one slow ping with a lopsided leg. */
  const samples = [
    { sent: 1000, received: 1040, server: 6020 },
    { sent: 2000, received: 2030, server: 7015 },
    { sent: 3000, received: 3400, server: 8350 },
    { sent: 4000, received: 4036, server: 9018 },
    { sent: 5000, received: 5900, server: 10_100 },
    { sent: 6000, received: 6032, server: 11_016 },
  ];
  const c = party.clockOffset(samples);
  assert.equal(c.rtt, 30);
  assert.ok(Math.abs(c.offset - 5000) <= 2, `offset ${c.offset}`);
  assert.equal(party.clockOffset([]), null);
  assert.equal(party.clockOffset([{ sent: 10, received: 5, server: 0 }]), null, 'a clock that went backwards is no sample');
  assert.equal(party.clockOffset([{ sent: 0, received: 100, server: 1050 }]).offset, 1000);
});

test('a new party waits for its host to load, then plays', () => {
  let p = start(1000);
  assert.equal(p.host, 'akram');
  assert.deepEqual(p.invited, ['sami', 'mo'], 'invites without the host, lower case');
  assert.equal(p.hold.reason, 'loading');
  assert.equal(party.tick(p, 1500).party.hold?.reason, 'loading');
  p = party.report(p, { client: 'akram-tab1', username: 'akram' }, 'ready', 2000);
  p = party.tick(p, 2000).party;
  assert.equal(p.hold, null);
  assert.equal(p.timeline.playing, true);
  assert.equal(p.timeline.at, 2000 + T.lead, 'starts a moment ahead');
  assert.equal(party.positionAt(p.timeline, 2000 + T.lead + 1000), 121);
});

test('stale seeks lose; play and pause always land; screens ignore old news', () => {
  let p = playing();
  const seen = p.seq;
  const a = party.command(p, { username: 'akram' }, { type: 'seek', position: 300 }, seen, 1_001_000);
  assert.ok(a.ok);
  const b = party.command(a.party, { username: 'sami' }, { type: 'seek', position: 50 }, seen, 1_001_100);
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'stale', 'sami seeked a timeline that had already moved');
  assert.equal(party.positionAt(b.party.timeline, 1_001_000), 300);
  const pause = party.command(a.party, { username: 'sami' }, { type: 'pause' }, seen, 1_001_200);
  assert.ok(pause.ok, 'a pause from an older view still pauses');
  assert.equal(pause.party.timeline.playing, false);
  assert.ok(Math.abs(pause.party.timeline.position - 300.2) < 1e-9);
  const again = party.command(pause.party, { username: 'akram' }, { type: 'pause' }, pause.party.seq, 1_001_300);
  assert.equal(again.changed, false, 'pausing what is paused changes nothing');
  /* Someone arriving or buffering isn't a timeline change: a seek made since still lands. */
  let q = party.report(pause.party, { client: 'mo-phone1', username: 'mo' }, 'loading', 1_001_400);
  assert.ok(q.seq > pause.party.seq, 'presence is news');
  assert.ok(party.command(q, { username: 'akram' }, { type: 'seek', position: 10 }, pause.party.seq, 1_001_500).ok);
  assert.equal(party.newer(5, 5), false);
  assert.equal(party.newer(5, 6), true);
  q = party.report(q, { client: 'mo-phone1', username: 'mo' }, 'loading', 1_001_600);
  assert.equal(q.seq, party.report(pause.party, { client: 'mo-phone1', username: 'mo' }, 'loading', 1_001_400).seq, 'the same report twice is not news');
});

test('a pause keeps the frame the presser saw, within reason', () => {
  const p = playing(1_000_000);
  const own = party.command(p, { username: 'sami' }, { type: 'pause', position: 129.6 }, p.seq, 1_010_000);
  assert.equal(own.party.timeline.position, 129.6);
  const wild = party.command(p, { username: 'sami' }, { type: 'pause', position: 5 }, p.seq, 1_010_000);
  assert.equal(wild.party.timeline.position, 130, 'a position far from the party\'s is not trusted');
});

test('someone buffering past 1.5 s pauses everyone, and everyone starts again together', () => {
  let p = playing(1_000_000);
  p = party.report(p, { client: 'sami-tab1', username: 'sami' }, 'buffering', 1_010_000);
  assert.equal(party.tick(p, 1_011_000).party.hold, null, 'a blip under 1.5 s holds nobody');
  const held = party.tick(p, 1_011_600).party;
  assert.equal(held.hold.reason, 'buffering');
  assert.deepEqual(held.hold.waitingFor, ['sami-tab1']);
  assert.equal(held.timeline.playing, false);
  assert.ok(Math.abs(held.timeline.position - (120 + 11.6 - 1.5)) < 1e-6, 'back to about where sami stopped');
  assert.ok(held.moved === held.seq, 'a hold moves the timeline');
  /* Paused during the wait: stays paused after it. */
  const paused = party.command(held, { username: 'akram' }, { type: 'pause' }, held.seq, 1_012_000).party;
  assert.equal(paused.hold.resume, false);
  const replay = party.command(paused, { username: 'akram' }, { type: 'play' }, paused.seq, 1_012_100).party;
  assert.equal(replay.hold.resume, true, 'play during a wait plays once it\'s over');
  let back = party.report(replay, { client: 'sami-tab1', username: 'sami' }, 'ready', 1_014_000);
  back = party.tick(back, 1_014_000).party;
  assert.equal(back.hold, null);
  assert.equal(back.timeline.playing, true);
  assert.equal(back.timeline.at, 1_014_000 + T.lead);
  assert.equal(back.timeline.position, held.timeline.position, 'from where it held');
  const staysPaused = party.tick(party.report(paused, { client: 'sami-tab1', username: 'sami' }, 'ready', 1_014_000), 1_014_000).party;
  assert.equal(staysPaused.hold, null);
  assert.equal(staysPaused.timeline.playing, false);
});

test('a screen that keeps buffering or drops off stops holding the rest', () => {
  let p = playing(1_000_000);
  p = party.report(p, { client: 'sami-tab1', username: 'sami' }, 'buffering', 1_010_000);
  p = live(p, 1_012_000).party;
  assert.ok(p.hold);
  assert.ok(live(p, 1_029_000).party.hold, 'still waiting at 19 s');
  const gaveUp = live(p, 1_030_500).party;
  assert.equal(gaveUp.hold, null, 'after 20 s the rest carry on');
  assert.equal(gaveUp.timeline.playing, true);
  assert.equal(live(gaveUp, 1_031_000).party.hold, null, 'and the same stall doesn\'t hold them again');
  /* Dropped: no word for 15 s, so not waited for. */
  let q = playing(2_000_000);
  q = party.report(q, { client: 'sami-tab1', username: 'sami' }, 'buffering', 2_001_000);
  q = party.tick(q, 2_003_000).party;
  assert.ok(q.hold);
  q = party.seen(q, ['akram-tab1'], 2_016_500);
  const left = party.tick(q, 2_016_500).party;
  assert.equal(left.hold, null, 'sami went quiet');
  assert.equal(left.members.find((m) => m.client === 'sami-tab1').state, 'buffering');
  const dropped = party.tick(party.seen(left, ['akram-tab1'], 2_062_000), 2_062_000).party;
  assert.deepEqual(dropped.members.map((m) => m.client), ['akram-tab1'], 'off the list after a minute');
});

test('someone joining late lands where the party is without holding it', () => {
  let p = playing(1_000_000);
  p = party.report(p, { client: 'mo-phone1', username: 'mo' }, 'loading', 1_005_000);
  p = party.tick(p, 1_009_000).party;
  assert.equal(p.hold, null, 'loading late holds nobody');
  assert.equal(p.timeline.playing, true);
  assert.ok(Math.abs(party.positionAt(p.timeline, 1_009_000) - 129) < 1e-9);
  /* Once they're in, a real stall of theirs is everyone's. */
  p = party.report(p, { client: 'mo-phone1', username: 'mo' }, 'ready', 1_010_000);
  p = party.report(p, { client: 'mo-phone1', username: 'mo' }, 'buffering', 1_020_000);
  assert.equal(party.tick(p, 1_022_000).party.hold?.waitingFor[0], 'mo-phone1');
});

test('the next episode: one countdown, then everyone together', () => {
  let p = playing(1_000_000);
  const to = { season: 1, episode: 4, skipped: 0 };
  const c = party.command(p, { username: 'sami' }, { type: 'countdown', to }, p.seq, 1_100_000);
  assert.equal(c.party.countdown.endsAt, 1_100_000 + T.countdown);
  const twice = party.command(c.party, { username: 'akram' }, { type: 'countdown', to: { season: 9, episode: 9, skipped: 0 } }, c.party.seq, 1_100_100);
  assert.equal(twice.changed, false, 'the first countdown stands');
  assert.equal(live(c.party, 1_105_000).party.timeline.episode, 3);
  p = live(c.party, 1_110_000).party;
  assert.deepEqual([p.timeline.season, p.timeline.episode, p.timeline.position, p.countdown], [1, 4, 0, null]);
  assert.equal(p.hold.reason, 'loading');
  assert.deepEqual(p.hold.waitingFor.sort(), ['akram-tab1', 'sami-tab1']);
  assert.ok(p.members.every((m) => m.state === 'loading'), 'nobody counts as ready on the old episode');
  p = party.tick(party.report(p, { client: 'akram-tab1', username: 'akram' }, 'ready', 1_112_000), 1_112_000).party;
  assert.deepEqual(p.hold.waitingFor, ['sami-tab1'], 'waiting for the slower one');
  p = party.tick(party.report(p, { client: 'sami-tab1', username: 'sami' }, 'ready', 1_113_000), 1_113_000).party;
  assert.equal(p.hold, null);
  assert.equal(p.timeline.at, 1_113_000 + T.lead);
  /* Watch credits, for everyone. */
  const cancel = party.command(c.party, { username: 'akram' }, { type: 'cancel-countdown' }, c.party.seq, 1_101_000);
  assert.equal(cancel.party.countdown, null);
  assert.equal(live(cancel.party, 1_120_000).party.timeline.episode, 3);
  /* A slow screen doesn't keep a new episode waiting for ever. */
  const slow = party.tick(party.report(p, { client: 'akram-tab1', username: 'akram' }, 'ready', 1_113_000), 1_113_000).party;
  const ep5 = party.command(party.seen(slow, ['akram-tab1', 'sami-tab1'], 1_200_000), { username: 'akram' }, { type: 'episode', season: 1, episode: 5 }, slow.seq, 1_200_000).party;
  const ready = party.tick(party.report(ep5, { client: 'akram-tab1', username: 'akram' }, 'ready', 1_201_000), 1_201_000).party;
  assert.ok(ready.hold);
  const stillSlow = party.seen(ready, ['akram-tab1', 'sami-tab1'], 1_230_500);
  assert.equal(party.tick(stillSlow, 1_230_500).party.hold, null, 'after 30 s the rest start');
});

test('host-only, host hand-over, and the party ending', () => {
  let p = playing(1_000_000);
  assert.equal(party.command(p, { username: 'sami' }, { type: 'host-only', on: true }, p.seq, 1_001_000).reason, 'host-only', 'only the host sets it');
  p = party.command(p, { username: 'akram' }, { type: 'host-only', on: true }, p.seq, 1_001_000).party;
  for (const cmd of [{ type: 'pause' }, { type: 'seek', position: 3 }, { type: 'episode', season: 1, episode: 1 }, { type: 'skip-wait' }]) {
    assert.equal(party.command(p, { username: 'sami' }, cmd, p.seq, 1_002_000).reason, 'host-only', cmd.type);
  }
  assert.ok(party.command(p, { username: 'AKRAM' }, { type: 'pause' }, p.seq, 1_002_000).ok);
  const gone = party.leave(p, 'akram-tab1', 1_003_000);
  assert.equal(gone.host, 'sami', 'the host left: the next person takes over');
  assert.ok(gone.seq > p.seq);
  /* Everyone gone: ends after five minutes, not before. */
  let empty = party.leave(gone, 'sami-tab1', 1_004_000);
  empty = party.tick(empty, 1_004_000).party;
  assert.equal(empty.ended, false);
  assert.equal(party.tick(empty, 1_004_000 + T.endAfter - 1).party.ended, false);
  const back = party.report(empty, { client: 'sami-tab2', username: 'sami' }, 'loading', 1_100_000);
  assert.equal(party.tick(back, 1_004_000 + T.endAfter).party.ended, false, 'someone came back');
  const ended = party.tick(empty, 1_004_000 + T.endAfter).party;
  assert.equal(ended.ended, true);
  assert.equal(party.command(ended, { username: 'sami' }, { type: 'play' }, ended.seq, 1_500_000).ok, false);
});

test('commands are read carefully from the wire', () => {
  assert.deepEqual(party.parseCommand({ type: 'seek', position: 12.5 }), { type: 'seek', position: 12.5 });
  assert.equal(party.parseCommand({ type: 'seek', position: '12' }), null);
  assert.equal(party.parseCommand({ type: 'explode' }), null);
  assert.deepEqual(party.parseCommand({ type: 'pause', position: Infinity }), { type: 'pause' });
  assert.equal(party.parseCommand({ type: 'countdown' }), null, 'the server works out the next episode itself');
  const p = playing();
  assert.equal(party.command(p, { username: 'akram' }, { type: 'seek', position: -4 }, p.seq, 1_000_100).reason, 'invalid');
  assert.equal(party.command(p, { username: 'akram' }, { type: 'rate', rate: 9 }, p.seq, 1_000_100).reason, 'invalid');
  assert.equal(party.command(p, { username: 'akram' }, party.parseCommand({ type: 'episode', season: 'x', episode: 2 }), p.seq, 1_000_100).reason, 'invalid');
  assert.equal(party.cleanClient('abc'), null);
  assert.equal(party.cleanClient('web-1234567'), 'web-1234567');
  assert.equal(party.cleanPartyId('../../etc'), null);
});

test('chat keeps the last 50 lines; invites and declines', () => {
  let p = start();
  for (let i = 0; i < 60; i++) p = party.addChat(p, 'Sami', `  line   ${i} `, `c${i}`, 1_000_000 + i).party;
  assert.equal(p.chat.length, 50);
  assert.equal(p.chat[49].text, 'line 59');
  assert.equal(p.chat[0].username, 'sami');
  assert.equal(party.addChat(p, 'sami', '   ', 'x', 1), null);
  assert.equal(party.addChat(p, 'sami', 'x'.repeat(900), 'y', 1).line.text.length, 300);
  p = party.invite(p, ['Lea', 'sami', 'akram'], 2_000_000);
  assert.deepEqual(p.invited, ['sami', 'mo', 'lea']);
  p = party.decline(p, 'MO', 2_000_001);
  assert.deepEqual(p.invited, ['sami', 'lea']);
});

test('parties are kept in the database and found by who is in them', () => {
  const db = fresh();
  party.migrateTogether(db);
  const p = start(Date.now());
  party.saveParty(db, p);
  assert.deepEqual(party.loadParty(db, p.id), p);
  assert.equal(party.partiesFor(db, 'Sami', Date.now()).length, 1, 'invited');
  assert.equal(party.partiesFor(db, 'akram', Date.now()).length, 1, 'host');
  assert.equal(party.partiesFor(db, 'lea', Date.now()).length, 0);
  party.saveParty(db, { ...p, ended: true });
  assert.equal(party.partiesFor(db, 'sami', Date.now()).length, 0, 'ended parties are gone');
  party.saveParty(db, { ...p, id: 'p-old000000', updatedAt: Date.now() - 13 * 60 * 60 * 1000 });
  party.endForgotten(db, Date.now());
  assert.equal(party.loadParty(db, 'p-old000000').ended, false, 'the body is kept as it was; the row is marked');
  assert.equal(db.prepare("SELECT ended FROM parties WHERE id = 'p-old000000'").get().ended, 1);
  const view = party.viewOf(party.report(p, { client: 'sami-tab1', username: 'sami' }, 'ready', p.createdAt + 10_000), p.createdAt + 16_000);
  assert.deepEqual(view.members.map((m) => [m.client, m.present]), [['akram-tab1', false], ['sami-tab1', true]]);
  assert.equal('chat' in view, false);
});

test('a change says who made it; the party\'s own moves say nobody', () => {
  const p = playing(1_000_000);
  const paused = party.command(p, { username: 'Sami', client: 'sami-tab1' }, { type: 'pause' }, p.seq, 1_001_000).party;
  assert.deepEqual(paused.by, { username: 'sami', client: 'sami-tab1', type: 'pause' });
  const noop = party.command(paused, { username: 'akram', client: 'akram-tab1' }, { type: 'pause' }, paused.seq, 1_001_100).party;
  assert.equal(noop.by.username, 'sami', 'nothing changed, nothing claimed');
  const hostOnly = party.command(paused, { username: 'akram', client: 'akram-tab1' }, { type: 'host-only', on: true }, paused.seq, 1_001_200).party;
  assert.equal(hostOnly.by.type, 'pause', 'the host switch isn\'t a timeline change');
  let stall = party.report(p, { client: 'sami-tab1', username: 'sami' }, 'buffering', 1_002_000);
  stall = party.tick(stall, 1_003_600).party;
  assert.equal(stall.by, null);
});

test('with nobody ready, nobody is given up on', () => {
  /* The host's stream takes 40 s to start: the party waits rather than running ahead of everyone. */
  let p = start(1_000_000);
  p = live(p, 1_040_000).party;
  assert.equal(p.hold?.reason, 'loading');
  p = live(party.report(p, { client: 'akram-tab1', username: 'akram' }, 'ready', 1_041_000), 1_041_000).party;
  assert.equal(p.hold, null);
  /* Everyone stalls at once: hold for as long as it takes. */
  p = party.report(playing(2_000_000), { client: 'sami-tab1', username: 'sami' }, 'buffering', 2_001_000);
  p = party.report(p, { client: 'akram-tab1', username: 'akram' }, 'buffering', 2_001_000);
  p = live(p, 2_003_000).party;
  assert.ok(p.hold);
  assert.ok(live(p, 2_060_000).party.hold, 'still holding a minute later');
  p = live(party.report(p, { client: 'akram-tab1', username: 'akram' }, 'ready', 2_061_000), 2_061_000).party;
  assert.equal(p.hold, null, 'akram is ready, and sami has been stuck 60 s: carry on');
});

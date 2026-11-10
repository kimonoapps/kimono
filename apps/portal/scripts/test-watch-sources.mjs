import test from 'node:test';
import assert from 'node:assert/strict';
import * as releases from '../src/lib/watch/releases.ts';
import * as dead from '../src/lib/watch/dead.ts';
import * as streams from '../src/lib/watch/streams.ts';

const phone = { client: 'android', maxHeight: 1080, hdr: [], dvProfiles: [], codecs: ['h264', 'hevc'], passthrough: [] };
const R = (name, extra = {}) => releases.parseRelease({ url: `https://up/${encodeURIComponent(name)}`, name, ...extra });

test("a resolver's stand-in clip is a failure, and that copy is skipped for a while", async () => {
  dead.forgetDead();
  assert.equal(dead.isStandIn('https://torrentio.example/videos/failed_unexpected_v2.mp4', null, null), true);
  assert.equal(dead.isStandIn('https://cdn.example/d/abc/Show.S01E01.mkv', 3 * 1024 * 1024, null), true, 'a 3 MB "episode"');
  assert.equal(dead.isStandIn('https://cdn.example/d/abc/Show.S01E01.mkv', 900 * 1024 * 1024, null), false);
  const fake = async (url) => url.includes('resolve')
    ? new Response(null, { status: 302, headers: { location: 'https://static.example/videos/provider_unavailable.mp4' } })
    : new Response('x', { status: 206, headers: { 'content-range': 'bytes 0-0/2500000' } });
  const copy = R('Resident Evil 2002 1080p BluRay x264 ⚡');
  copy.url = 'https://comet.example/resolve/abc';
  assert.equal(await streams.fetchUpstream(copy.url, { method: 'GET', headers: new Headers() }, fake), null);
  assert.equal(dead.isDead(copy.url), true);
  assert.match(releases.unplayable(copy, phone, 100), /failed to play/);
  assert.equal(dead.isDead(copy.url, Date.now() + 7 * 3_600_000), false, 'forgotten after a few hours');
  dead.forgetDead();
});

test('10-bit H.264 only where something decodes it; 10-bit HEVC unless the device says it cannot', () => {
  const hi10p = R('[Group] Show - 01 [1080p Hi10P x264 10bit FLAC] ⚡');
  const hevc10 = R('Show S01E01 1080p WEB-DL x265 10bit ⚡');
  assert.match(releases.unplayable(hi10p, phone, 24), /10-bit H.264/);
  assert.equal(releases.unplayable(hi10p, { ...phone, hi10p: true }, 24), null);
  assert.equal(releases.unplayable(hevc10, phone, 24), null);
  assert.match(releases.unplayable(hevc10, { ...phone, tenBit: false }, 24), /10-bit video/);
  assert.equal(releases.cleanDevice({ tenBit: false, hi10p: true }).tenBit, false);
  assert.equal(releases.cleanDevice({}).tenBit, undefined);
});

test('the same file listed twice by one service is offered once; Usenet and debrid copies both stay', () => {
  const a = R('[RD⚡] Torrentio 1080p', { filename: 'Show.S01E01.1080p.WEB-DL.mkv', bytes: 2e9 });
  const b = R('[RD⚡] Comet 1080p', { filename: 'Show.S01E01.1080p.WEB-DL.mkv', bytes: 2.01e9 });
  const c = R('[ND⚡] Usenet 1080p', { filename: 'Show.S01E01.1080p.WEB-DL.mkv', bytes: 2e9 });
  b.url = 'https://up/b';
  const ranked = releases.rank([a, b, c], phone, 'auto', 24);
  assert.equal(ranked.length, 2);
  assert.deepEqual(ranked.map((r) => r.service).sort(), ['debrid', 'usenet']);
});

import * as labels from '../src/lib/watch/labels.ts';
import * as model from '../src/lib/watch/model.ts';
import { DatabaseSync } from 'node:sqlite';

test('one season shows no season; anime can be one numbered run; everything else by season', () => {
  assert.equal(labels.episodeLayout('Series', 1, 'seasons'), 'single');
  assert.equal(labels.episodeLayout('Anime', 1, 'continuous'), 'single');
  assert.equal(labels.episodeLayout('Anime', 3, 'continuous'), 'continuous');
  assert.equal(labels.episodeLayout('Anime', 3, 'seasons'), 'seasons');
  assert.equal(labels.episodeLayout('Series', 3, 'continuous'), 'seasons', 'only anime is counted in one run');
  const eps = [{ season: 2, number: 1 }, { season: 1, number: 1 }, { season: 0, number: 1 }, { season: 1, number: 2 }];
  const abs = labels.absoluteNumbers(eps);
  assert.equal(abs.get('2:1'), 3);
  assert.equal(abs.has('0:1'), false, 'specials are left out');
  assert.equal(labels.episodeLabel('seasons', 2, 1, 3), 'S2:E1');
  assert.equal(labels.episodeLabel('continuous', 2, 1, 3), 'E3');
  assert.equal(labels.episodeLabel('single', 1, 4), 'E4');
});

test('the anime episode layout is a setting, seasons until changed', () => {
  const db = new DatabaseSync(':memory:');
  model.migrate(db);
  assert.equal(model.prefsOf(db, 'a').animeEpisodes, 'seasons');
  model.savePrefs(db, 'a', { animeEpisodes: 'continuous' });
  assert.equal(model.prefsOf(db, 'a').animeEpisodes, 'continuous');
  model.savePrefs(db, 'a', { animeEpisodes: 'sideways' });
  assert.equal(model.prefsOf(db, 'a').animeEpisodes, 'continuous');
});

import * as rows from '../src/lib/watch/rows.ts';

test("Home's rows follow taste without losing what's new, and a shelf keeps only its own", () => {
  const plain = rows.orderRows(rows.rowCatalog, new Map());
  assert.equal(plain[0].id, 'new-episodes');
  const horrorFan = rows.orderRows(rows.rowCatalog, rows.genreTaste([{ genres: ['Horror'] }, { genres: ['Horror', 'Thriller'] }]));
  assert.ok(horrorFan.findIndex((r) => r.id === 'horror') < plain.findIndex((r) => r.id === 'horror') - 5, 'Horror moves well up');
  assert.deepEqual(horrorFan.slice(0, 2).map((r) => r.id), plain.slice(0, 2).map((r) => r.id), 'the first two stay');
  assert.ok(rows.orderRows(rows.rowCatalog, new Map(), 'Anime').every((r) => r.shelves.includes('Anime')));
  assert.ok(rows.rowCatalog.length >= 20);
  assert.equal(new Set(rows.rowCatalog.map((r) => r.id)).size, rows.rowCatalog.length, 'ids are unique');
});

test("a row's dates are filled in for today", () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  assert.deepEqual(rows.fillParams({ a: '{today}', b: '{daysAgo:10}', c: '16' }, now), { a: '2026-11-10', b: '2026-10-31', c: '16' });
});

test('settings keep subtitle look, previews and download quality, refusing nonsense', () => {
  const db = new DatabaseSync(':memory:');
  model.migrate(db);
  const d = model.prefsOf(db, 'a');
  assert.deepEqual([d.subtitleSize, d.subtitleBackground, d.previews, d.downloadQuality], ['medium', 'shadow', true, 'standard']);
  model.savePrefs(db, 'a', { subtitleSize: 'large', subtitleBackground: 'box', previews: false, downloadQuality: 'huge' });
  const p = model.prefsOf(db, 'a');
  assert.deepEqual([p.subtitleSize, p.subtitleBackground, p.previews, p.downloadQuality], ['large', 'box', false, 'standard']);
});

test("someone's taste comes from what they watch a lot, and their plan follows it for many rows", () => {
  const watched = [
    { genres: ['Horror', 'Mystery'], keywords: [{ id: 1, name: 'haunted house' }], shelf: 'Film', kind: 'movie' },
    { genres: ['Horror'], keywords: [{ id: 1, name: 'haunted house' }, { id: 2, name: 'time loop' }], shelf: 'Film', kind: 'movie' },
    { genres: ['Fantasy', 'Adventure'], keywords: [{ id: 3, name: 'magic' }], shelf: 'Anime', kind: 'series' },
  ];
  const taste = rows.tasteOf(watched);
  assert.ok(taste.genres.get('Horror') > taste.genres.get('Fantasy'));
  assert.equal(taste.keywords.get(1).weight > taste.keywords.get(3).weight, true);
  const plan = rows.planRows(taste, 3);
  assert.ok(plan.length >= 250, `a long plan (${plan.length})`);
  assert.ok(plan.some((r) => r.title === 'Even more horror films'));
  assert.ok(rows.planRows(rows.tasteOf([]), 0).length >= 250, 'endless even before anything is watched');
  const firstHorror = plan.findIndex((r) => r.id === 'genre-film-horror-1');
  const firstComedy = plan.findIndex((r) => r.id === 'comedy-films');
  assert.ok(firstHorror >= 0 && firstHorror < firstComedy, 'horror films come before comedies for a horror fan');
  assert.ok(plan.some((r) => r.id === 'theme-film-1' && /^Haunted house films$/.test(r.title)));
  assert.ok(plan.some((r) => r.id === 'genre-film-horror-2' && r.title === 'More horror films'));
  assert.equal(plan.filter((r) => 'similar' in r).length, 3);
  for (let i = 1; i < plan.length; i++) {
    const a = plan[i - 1], b = plan[i];
    if ('genres' in a && 'genres' in b && a.genres[0] && plan.length > 5) assert.ok(a.genres[0] !== b.genres[0] || plan.slice(i).every((r) => 'genres' in r && r.genres[0] === b.genres[0]), `rows ${i - 1} and ${i} repeat ${a.genres[0]}`);
  }
  assert.ok(rows.planRows(taste, 0, 'Anime').every((r) => !('shelves' in r) || r.shelves.includes('Anime')));
  assert.equal(rows.genreName('Sci-Fi & Fantasy'), 'Sci-fi and fantasy');
  const names = plan.filter((r) => r.title).map((r) => r.title.toLowerCase());
  assert.equal(new Set(names).size, names.length, 'no two rows share a name');
});

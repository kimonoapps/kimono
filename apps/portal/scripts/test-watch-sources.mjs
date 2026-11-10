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

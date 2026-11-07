/*
 * The frame an artifact is shown in, the same on the website and in the phone
 * app (docs/kimono-ai.md, "Artifacts"). It is embedded as a sandboxed frame
 * with scripts only, so it runs with no origin of its own: no cookies, no
 * Kimono API. Its policy lets it load nothing but the engine, and reach
 * nothing at all.
 *
 * Whoever shows it posts the artifact's text as it arrives ({ kimono:
 * "artifact", type: "render", content, final, media }, media being where the
 * files its page names as media/<file> are served, once it's kept); it writes the new part into
 * its own page, which renders as it is written, the way a browser renders a page
 * still loading, and hands each scene its script as it grows. It answers with
 * { type: "ready" }, { type: "size", height }, { type: "error", message } and, for animations,
 * { type: "scene", t, end, playing, complete, count, params, voiced, muted,
 * blocked, volume }; the shower drives it with { type: "scene-control", action: play |
 * pause | replay | seek (t) | set (name, value) | sound-on | sound-off | volume (value) }, and
 * draws the controls, sliders and sound switch itself.
 */

export const frameHtml = (origin: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;background:transparent}</style>
</head><body>
<script>
(() => {
  /*
   * The artifact is written into this very page: a sandboxed frame has no
   * origin, so it can't reach a frame inside it. document.open() clears the
   * page and its listeners but keeps this script's state (and the kit, once
   * loaded), so the listener is added again after every open.
   */
  const LIB = ${JSON.stringify(`${origin}/ai/lib/`)};
  const HEAD = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="' + LIB + 'kit.css"><script src="' + LIB + 'kit.js"><\\/script></head><body>';
  window.KIMONO_FRAME = 1;
  window.KIMONO_REPORT_ERROR = (message) => tell({ type: "error", message: String(message).slice(0, 500) });
  let opened = false, written = "", closed = false, sized = 0, watcher = null;
  const tell = (message) => parent.postMessage(Object.assign({ kimono: "artifact" }, message), "*");
  /* the scenes' time, summed up for the card's controls: the longest one sets the length */
  const sceneState = new Map();
  window.KIMONO_REPORT = (state) => {
    sceneState.set(state.index, state);
    const all = [...sceneState.values()];
    const params = []; for (const s of all) for (const p of s.params || []) if (!params.some((q) => q.name === p.name)) params.push(p);
    const voiced = all.filter((s) => s.voiced);
    tell({ type: "scene", t: Math.max(...all.map((s) => s.t)), end: Math.max(...all.map((s) => s.end)), playing: all.some((s) => s.playing), complete: all.every((s) => s.complete), count: all.length, params,
      voiced: voiced.length > 0, muted: voiced.length > 0 && voiced.every((s) => s.muted), blocked: voiced.some((s) => s.blocked), volume: voiced.length ? voiced[0].volume : 1 });
  };
  function pointMedia() { try { if (window.K && window.K.pointMedia) window.K.pointMedia(); } catch (e) {} }
  function reset() {
    if (watcher) watcher.disconnect();
    watcher = null;
    sceneState.clear();
    document.open();
    document.write(HEAD);
    addEventListener("message", hear);
    document.addEventListener("DOMContentLoaded", pointMedia);
    listenForErrors();
    opened = true; written = ""; closed = false;
  }
  function size() {
    /* the page's own box, not its scroll height: that is never less than the frame, so it could only grow */
    const root = document.documentElement; if (!root) return;
    if (!watcher) { watcher = new ResizeObserver(size); watcher.observe(root); }
    const h = Math.ceil(root.getBoundingClientRect().height);
    if (h !== sized) { sized = h; tell({ type: "size", height: h }); }
  }
  /* each scene's script, read from the raw text so it doesn't wait for the parser */
  function scenes(content, final) {
    const found = [...content.matchAll(/<k-scene\\b[^>]*>[\\s\\S]*?<script[^>]*type=["']?text\\/kimono-scene["']?[^>]*>([\\s\\S]*?)(<\\/script>|$)/gi)];
    const elements = document.querySelectorAll("k-scene");
    found.forEach((m, i) => { const el = elements[i]; if (el && el.feed) el.feed(m[1], final || m[2].length > 0); });
  }
  /* A page seen being written plays its scenes as they come; one that arrives finished (a chat
     opened later, a link) holds them still until Play. Once written here, it's never still. */
  let streamed = false;
  function render(content, final) {
    /* the same finished page again (the shower re-posts when it hears a load): leave it be */
    if (closed && content === written) return;
    if (!final) streamed = true;
    window.KIMONO_STILL = !streamed;
    if (!opened || closed || !content.startsWith(written)) reset();
    const delta = content.slice(written.length);
    if (delta) document.write(delta);
    written = content;
    if (final) { document.close(); closed = true; }
    try { scenes(content, final); } catch (e) {}
    /* what the page names as media/<file> plays from where Kimono keeps it; the parser may still be
       waiting on the kit, so again once the page is built */
    pointMedia();
    if (final) setTimeout(pointMedia, 300);
    size();
    if (final) setTimeout(size, 300);
  }
  function hear(event) {
    if (event.source !== parent) return;
    const m = event.data;
    if (!m || m.kimono !== "artifact") return;
    if (m.type === "render" && typeof m.content === "string") {
      /* where media/<file> is served; the kit points the page's sounds, videos and pictures there */
      if (typeof m.media === "string" && /^\\/ai\\/media\\/[0-9a-f]{32}\\/$/.test(m.media) && window.KIMONO_MEDIA !== m.media) {
        window.KIMONO_MEDIA = m.media;
        pointMedia();
      }
      try { render(m.content, !!m.final); } catch (error) { tell({ type: "error", message: String(error && error.message || error) }); }
    }
    if (m.type === "scene-control") document.querySelectorAll("k-scene").forEach((s) => {
      if (m.action === "play" && s.play) s.play();
      if (m.action === "pause" && s.pause) s.pause();
      if (m.action === "replay" && s.replay) s.replay();
      if (m.action === "seek" && s.seek) s.seek(m.t);
      if (m.action === "set" && s.setParam) s.setParam(m.name, m.value);
      if ((m.action === "sound-on" || m.action === "sound-off") && s.setSound) s.setSound(m.action === "sound-on");
      if (m.action === "volume" && typeof m.value === "number" && s.setVolume) s.setVolume(m.value);
    });
  }
  /* what goes wrong inside goes to Kimono, so a broken artifact says so instead of staying blank */
  function listenForErrors() {
    addEventListener("error", (event) => tell({ type: "error", message: String(event.message || (event.target && event.target.src ? "Couldn't load " + event.target.src : "error")) }), true);
    addEventListener("unhandledrejection", (event) => tell({ type: "error", message: String(event.reason && event.reason.message || event.reason) }));
  }
  addEventListener("message", hear);
  listenForErrors();
  tell({ type: "ready" });
})();
</script></body></html>`;

/** The frame's policy: scripts and styles from the engine's folder (and inline), its own media from Kimono, nothing else, no network. */
export function frameHeaders(origin: string): Record<string, string> {
  const lib = `${origin}/ai/lib/`;
  const media = `${origin}/ai/media/`;
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": [
      "default-src 'none'",
      `script-src 'unsafe-inline' 'unsafe-eval' ${lib}`,
      `style-src 'unsafe-inline' ${lib}`,
      `img-src data: blob: ${media}`,
      `media-src data: blob: ${media}`,
      `font-src data: ${lib}`,
      "connect-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      "frame-ancestors 'self'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

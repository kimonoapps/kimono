/*
 * The frame an artifact is shown in, the same on the website and in the phone
 * app (docs/kimono-ai.md, "Artifacts"). It is embedded as a sandboxed frame
 * with scripts only, so it runs with no origin of its own: no cookies, no
 * Kimono API. Its policy lets it load nothing but the engine, and reach
 * nothing at all.
 *
 * Whoever shows it posts the artifact's text as it arrives ({ kimono:
 * "artifact", type: "render", content, final }); it writes the new part into a
 * document that renders as it is written, the way a browser renders a page
 * still loading, and hands each scene its script as it grows. It answers with
 * { type: "ready" }, { type: "size", height } and, for animations,
 * { type: "scene", t, end, playing, complete, count, params }; the shower
 * drives it with { type: "scene-control", action: play | pause | replay | seek
 * (t) | set (name, value) }, and draws the controls and sliders itself.
 */

export const frameHtml = (origin: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style>
</head><body><iframe id="page" title="Artifact"></iframe>
<script>
(() => {
  const LIB = ${JSON.stringify(`${origin}/ai/lib/`)};
  const HEAD = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="' + LIB + 'kit.css"><script>window.KIMONO_FRAME = 1<\\/script><script src="' + LIB + 'kit.js"><\\/script></head><body>';
  const frame = document.getElementById("page");
  let doc = null, written = "", closed = false, sized = 0, watcher = null;
  const tell = (message) => parent.postMessage(Object.assign({ kimono: "artifact" }, message), "*");
  function reset() {
    watcher?.disconnect();
    sceneState.clear();
    doc = frame.contentDocument;
    doc.open();
    doc.write(HEAD);
    written = ""; closed = false;
    watcher = new ResizeObserver(size);
    watcher.observe(doc.documentElement);
  }
  function size() {
    if (!doc?.documentElement) return;
    const h = Math.ceil(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0));
    if (h !== sized) { sized = h; tell({ type: "size", height: h }); }
  }
  /* each scene's script, read from the raw text so it doesn't wait for the parser */
  function scenes(content, final) {
    const found = [...content.matchAll(/<k-scene\\b[^>]*>[\\s\\S]*?<script[^>]*type=["']?text\\/kimono-scene["']?[^>]*>([\\s\\S]*?)(<\\/script>|$)/gi)];
    const elements = doc.querySelectorAll("k-scene");
    found.forEach((m, i) => { const el = elements[i]; if (el && el.feed) el.feed(m[1], final || m[2].length > 0); });
  }
  function render(content, final) {
    if (!doc || closed || !content.startsWith(written)) reset();
    const delta = content.slice(written.length);
    if (delta) doc.write(delta);
    written = content;
    if (final) { doc.close(); closed = true; }
    try { scenes(content, final); } catch {}
    size();
    if (final) setTimeout(size, 300);
  }
  /* the scenes' time, summed up for the card's controls: the longest one sets the length */
  const sceneState = new Map();
  addEventListener("message", (event) => {
    if (event.source === frame.contentWindow && event.data && event.data.kimono === "scene") {
      sceneState.set(event.data.index, event.data);
      const all = [...sceneState.values()];
      const params = []; for (const s of all) for (const p of s.params || []) if (!params.some((q) => q.name === p.name)) params.push(p);
      tell({ type: "scene", t: Math.max(...all.map((s) => s.t)), end: Math.max(...all.map((s) => s.end)), playing: all.some((s) => s.playing), complete: all.every((s) => s.complete), count: all.length, params });
      return;
    }
    if (event.source !== parent) return;
    const m = event.data;
    if (!m || m.kimono !== "artifact") return;
    if (m.type === "render" && typeof m.content === "string") render(m.content, !!m.final);
    if (m.type === "scene-control") doc?.querySelectorAll("k-scene").forEach((s) => {
      if (m.action === "play" && s.play) s.play();
      if (m.action === "pause" && s.pause) s.pause();
      if (m.action === "replay" && s.replay) s.replay();
      if (m.action === "seek" && s.seek) s.seek(m.t);
      if (m.action === "set" && s.setParam) s.setParam(m.name, m.value);
    });
  });
  tell({ type: "ready" });
})();
</script></body></html>`;

/** The frame's policy: scripts and styles from the engine's folder (and inline), nothing else, no network. */
export function frameHeaders(origin: string): Record<string, string> {
  const lib = `${origin}/ai/lib/`;
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": [
      "default-src 'none'",
      `script-src 'unsafe-inline' 'unsafe-eval' ${lib}`,
      `style-src 'unsafe-inline' ${lib}`,
      "img-src data: blob:",
      "media-src data: blob:",
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

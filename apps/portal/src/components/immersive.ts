/*
 * 観 Crossing into a place that takes the whole screen (Kimono Watch), and
 * back. It is not a page beside the rail, so it doesn't move like one:
 *
 *   going in   the rail folds away and its column closes while the page you
 *              leave dissolves; the cinema then opens as a dark iris from
 *              where you pressed.
 *   coming out the iris closes on the button you pressed while the rail
 *              unfolds; Kimono surfaces in place, no sideways slide.
 *
 * The full-screen layer is position:fixed inside .main-content, so nothing
 * here ever transforms .main-content while that layer is in it: a transform
 * would pin the layer to the page's box beside the rail.
 */

const PLACES = ["/watch"];
export const immersiveAt = (path: string) => PLACES.some((place) => path === place || path.startsWith(`${place}/`));

/** The full-screen layer standing in the page, if this page is one. */
export const immersiveLayer = (page: Element | null = document.querySelector(".main-content")) =>
  page?.querySelector<HTMLElement>(".kw") ?? null;

const still = () => typeof window === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches;
const OUT = "cubic-bezier(.3, 0, .8, .15)";
const IN = "cubic-bezier(.05, .7, .1, 1)";

/* Where the last press landed, so the iris opens from (and closes on) it. */
let pressed: { x: number; y: number; at: number } | null = null;
if (typeof window !== "undefined") addEventListener("pointerdown", (event) => { pressed = { x: event.clientX, y: event.clientY, at: performance.now() }; }, true);
function origin() {
  if (pressed && performance.now() - pressed.at < 4000) return pressed;
  return { x: innerWidth / 2, y: innerHeight / 2 };
}
const reach = ({ x, y }: { x: number; y: number }) => Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 8;

/** Fold the rail away (or bring it back) now, ahead of the page changing hands. */
export function foldRail(away: boolean) {
  const frame = document.querySelector<HTMLElement>(".app-frame");
  if (!frame) return;
  if (away) frame.dataset.immersive = ""; else delete frame.dataset.immersive;
}

/** The cinema opening as an iris from where you pressed. */
export function openIris(layer: HTMLElement) {
  if (still()) return;
  const at = origin();
  const r = reach(at);
  const opening = layer.animate([
    { clipPath: `circle(24px at ${at.x}px ${at.y}px)`, opacity: .6 },
    { clipPath: `circle(${r}px at ${at.x}px ${at.y}px)`, opacity: 1 },
  ], { duration: 560, easing: IN, fill: "backwards" });
  opening.pause();
  requestAnimationFrame(() => opening.play());
  /* What's on it arrives a beat after the dark, as a room's lights settling.
     Opacity only: a transform here would pin its fixed bars to the child. */
  [...layer.children].forEach((child) => child.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, delay: 160, easing: IN, fill: "backwards" }));
}

/** The cinema closing on the button you pressed. Resolves once it's shut. */
export function closeIris(layer: HTMLElement): Promise<void> {
  if (still()) return Promise.resolve();
  const at = origin();
  const r = reach(at);
  const closing = layer.animate([
    { clipPath: `circle(${r}px at ${at.x}px ${at.y}px)`, opacity: 1 },
    { clipPath: `circle(20px at ${at.x}px ${at.y}px)`, opacity: 0 },
  ], { duration: 340, easing: OUT, fill: "forwards" });
  return closing.finished.then(() => {}, () => {});
}

/** Kimono surfacing where it stands: a fade and a slight settle, no sideways slide. */
export function surface(page: HTMLElement) {
  if (still()) return;
  const arriving = page.animate([{ opacity: 0, scale: ".97" }, { opacity: 1, scale: "1" }], { duration: 420, delay: 60, easing: IN, fill: "backwards" });
  arriving.pause();
  requestAnimationFrame(() => arriving.play());
}

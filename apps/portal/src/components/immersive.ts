/*
 * 観 Crossing into a place that takes the whole screen (Kimono Watch), and
 * back. It is not a page beside the rail, so it doesn't move like one:
 *
 *   going in   Watch opens on top of everything as a circle from where you
 *              pressed, over the page you leave, which holds still.
 *   coming out Watch closes as a circle back into its flower in the rail,
 *              over Kimono already standing beneath.
 *
 * The circle is the only thing that moves: nothing fades or slides.
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

/* While the iris moves it is drawn on the browser's top layer, above every
   element on the page whatever its z-index, and the cinema's frosted glass
   goes plain (watch.css): a blur behind every chip and bar would be redrawn
   on every frame. Both are undone once it stops. */
function quiet(layer: HTMLElement, moving: Animation) {
  layer.dataset.iris = "";
  let lifted = false;
  if (typeof layer.showPopover === "function") {
    try { layer.popover = "manual"; layer.showPopover(); lifted = true; } catch { layer.removeAttribute("popover"); }
  }
  void moving.finished.finally(() => {
    delete layer.dataset.iris;
    if (lifted) { try { layer.hidePopover(); } catch { /* already gone */ } layer.removeAttribute("popover"); }
  });
}

/**
 * A still copy of what's on screen, standing where it stands, so the page
 * underneath can change hands unseen while the iris moves over or off it.
 */
export function stillCopy(element: HTMLElement) {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  copy.classList.remove("main-content");
  if (getComputedStyle(element).position !== "fixed") {
    const box = element.getBoundingClientRect();
    Object.assign(copy.style, { position: "fixed", left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, margin: "0", zIndex: "5", overflow: "hidden" });
  }
  Object.assign(copy.style, { pointerEvents: "none", viewTransitionName: "none" });
  document.body.appendChild(copy);
  /* A copy starts scrolled to the top; put it where the original was. */
  const from = [element, ...element.querySelectorAll("*")], to = [copy, ...copy.querySelectorAll("*")];
  from.forEach((node, index) => { if (node.scrollTop || node.scrollLeft) to[index]?.scrollTo(node.scrollLeft, node.scrollTop); });
  return copy;
}

/** The cinema opening as an iris from where you pressed, and nothing else moving. Resolves once it's open. */
export function openIris(layer: HTMLElement): Promise<void> {
  if (still()) return Promise.resolve();
  const at = origin();
  const r = reach(at);
  const opening = layer.animate([
    { clipPath: `circle(0px at ${at.x}px ${at.y}px)` },
    { clipPath: `circle(${r}px at ${at.x}px ${at.y}px)` },
  ], { duration: 560, easing: IN, fill: "backwards" });
  quiet(layer, opening);
  opening.pause();
  requestAnimationFrame(() => opening.play());
  return opening.finished.then(() => {}, () => {});
}

/* Where the place lives in the rail: its flower, if it's on screen. */
function flower() {
  const place = PLACES.find((path) => immersiveAt(location.pathname) && (location.pathname === path || location.pathname.startsWith(`${path}/`))) ?? PLACES[0];
  const pill = document.querySelector<HTMLElement>(`.rail a.rail-dest[href="${place}"] .rail-pill`);
  const box = pill?.getBoundingClientRect();
  if (!box || !box.width || box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) return null;
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** The cinema closing back into its flower in the rail (or onto the press, if the flower's out of sight). Resolves once it's shut. */
export function closeIris(layer: HTMLElement): Promise<void> {
  if (still()) return Promise.resolve();
  const at = flower() ?? origin();
  const r = reach(at);
  const closing = layer.animate([
    { clipPath: `circle(${r}px at ${at.x}px ${at.y}px)` },
    { clipPath: `circle(0px at ${at.x}px ${at.y}px)` },
  ], { duration: 380, easing: OUT, fill: "forwards" });
  quiet(layer, closing);
  return closing.finished.then(() => {}, () => {});
}

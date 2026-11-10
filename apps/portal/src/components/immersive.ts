/*
 * 観 Crossing into a place that takes the whole screen (Kimono Watch), and
 * back. It is not a page beside the rail, so it doesn't move like one:
 *
 *   going in   Watch opens on top of everything as a circle from where you
 *              pressed, over the page you leave, which holds still.
 *   coming out Watch closes as a circle onto the button you pressed, over
 *              Kimono already standing beneath.
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
/* An even ease in and out, both ways. The circle's radius runs to the far
   corner, so a curve that rushes early covers the screen before you see it
   grow from your press, and one that rushes late hides where it lands. */
const IRIS = "cubic-bezier(.37, 0, .63, 1)"; /* ease-in-out sine */

/* Where the last press landed. */
let pressed: { x: number; y: number; at: number } | null = null;
if (typeof window !== "undefined") addEventListener("pointerdown", (event) => { pressed = { x: event.clientX, y: event.clientY, at: performance.now() }; }, true);

export type Point = { x: number; y: number };
/**
 * Where this move began, read at the moment it begins: the press that set it
 * off, or the focused link if it came from the keyboard, else the middle of
 * the screen. Read once and carried through, however long the page takes.
 */
export function pressPoint(): Point {
  if (pressed && performance.now() - pressed.at < 1000) return { x: pressed.x, y: pressed.y };
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused !== document.body) {
    const box = focused.getBoundingClientRect();
    if (box.width) return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }
  return { x: innerWidth / 2, y: innerHeight / 2 };
}
const reach = ({ x, y }: Point) => Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 8;

/* While the iris moves it is drawn on the browser's top layer, above every
   element on the page whatever its z-index, and the cinema's frosted glass
   goes plain (watch.css): a blur behind every chip and bar would be redrawn
   on every frame. Both are undone once it stops. */
let moving: Promise<void> = Promise.resolve();
/**
 * Resolves once no circle is moving. The circle is drawn on the main thread,
 * so a place holds its heavy first draw until then: a long render mid-circle
 * would freeze it and then make it jump.
 */
export const circleSettled = () => moving;

/*
 * The place says when its first screen is drawn (Watch: its home rows), and
 * the circle waits for that before it opens, so nothing is drawn while it
 * moves and nothing pops in after. Never longer than READY_AT_MOST.
 */
const READY_AT_MOST = 700;
let ready: { promise: Promise<void>; resolve: () => void } | null = null;
/** A crossing into a place is starting: from now, its first screen is awaited. */
export function expectPlace() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  ready = { promise, resolve };
}
/** Called by the place once its first screen is drawn. */
export function placeReady() { ready?.resolve(); }
function whenPlaceReady() {
  const waiting = ready;
  ready = null;
  if (!waiting) return Promise.resolve();
  return Promise.race([waiting.promise, new Promise<void>((resolve) => setTimeout(resolve, READY_AT_MOST))]);
}

function quiet(layer: HTMLElement, animation: Animation) {
  const done = animation.finished.then(() => {}, () => {});
  /* Never held longer than the circle takes: a tab sent to the background pauses it. */
  const ceiling = Number(animation.effect?.getTiming().duration) || 0;
  moving = Promise.race([done, new Promise<void>((resolve) => setTimeout(resolve, ceiling + 250))]);
  layer.dataset.iris = "";
  let lifted = false;
  if (typeof layer.showPopover === "function") {
    try { layer.popover = "manual"; layer.showPopover(); lifted = true; } catch { layer.removeAttribute("popover"); }
  }
  void done.finally(() => {
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
  /* A dialog or menu that was open is going, and a copy of one isn't on the top layer anyway. */
  copy.querySelectorAll("dialog, [popover]").forEach((node) => node.remove());
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
export async function openIris(layer: HTMLElement, at: Point): Promise<void> {
  if (still()) { placeReady(); ready = null; return; }
  /* Shut, and drawing its first screen unseen, until it's ready to open. */
  layer.style.clipPath = `circle(0px at ${at.x}px ${at.y}px)`;
  await whenPlaceReady();
  layer.style.clipPath = "";
  const r = reach(at);
  const opening = layer.animate([
    { clipPath: `circle(0px at ${at.x}px ${at.y}px)` },
    { clipPath: `circle(${r}px at ${at.x}px ${at.y}px)` },
  ], { duration: 640, easing: IRIS, fill: "backwards" });
  quiet(layer, opening);
  opening.pause();
  requestAnimationFrame(() => opening.play());
  return opening.finished.then(() => {}, () => {});
}

/** The cinema closing onto the button you pressed. Resolves once it's shut. */
export function closeIris(layer: HTMLElement, at: Point): Promise<void> {
  if (still()) return Promise.resolve();
  const r = reach(at);
  const closing = layer.animate([
    { clipPath: `circle(${r}px at ${at.x}px ${at.y}px)` },
    { clipPath: `circle(0px at ${at.x}px ${at.y}px)` },
  ], { duration: 520, easing: IRIS, fill: "forwards" });
  quiet(layer, closing);
  return closing.finished.then(() => {}, () => {});
}

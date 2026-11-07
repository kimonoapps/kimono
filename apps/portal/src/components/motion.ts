/*
 * The page settling in: what you can see rises into place one piece after
 * another, top to bottom, so a new page reads as arriving rather than
 * appearing. Only what's on screen moves, and never more than a handful, so it
 * stays quick on a long list. Someone who asked for less motion gets the page.
 */

const PIECES = [
  ".page > *", ".seg > *", ".app-tiles > *", ".cards > *", ".grid > *",
  ".dv-sheet > *", ".dv-list > *", ".dv-grid > *", ".dv-feed > *", ".dv-folders > *", ".tl-list > *", ".rail-rooms > *",
  ".cd-list > *", ".cd-tasks > *", ".cd-timeline > *", ".cd-start > *",
].join(", ");

/*
 * Building a new page can hold the main thread for a few hundred
 * milliseconds, and an animation's clock runs through that: started straight
 * away, an arrival is mostly over before anything paints, so the page seems
 * to jump in. Each arrival is therefore held at its first frame, hidden, and
 * only set going once the new page has actually been painted.
 */
export function afterPaint(animations: Animation[]) {
  animations.forEach((animation) => animation.pause());
  requestAnimationFrame(() => animations.forEach((animation) => animation.play()));
}

const still = () => typeof window === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches;

export function rise(root: Element | null, { step = 20, limit = 12, distance = 14 } = {}) {
  if (!root || still()) return;
  const bottom = window.innerHeight;
  const pieces = [...root.querySelectorAll<HTMLElement>(PIECES)].filter((element) => {
    if (getComputedStyle(element).position === "fixed") return false;
    const box = element.getBoundingClientRect();
    /* Already rising (the page arriving and a list landing can both ask): once is enough. */
    if (element.getAnimations().some((animation) => animation.id === "rise" && animation.playState !== "finished")) return false;
    return box.height > 0 && box.top < bottom && box.bottom > 0;
  });
  // A piece whose parent is already rising moves with it; only nest when the parent is big.
  const chosen = pieces.filter((element) => {
    const parent = element.parentElement?.closest<HTMLElement>(PIECES);
    return !parent || !pieces.includes(parent) || parent.getBoundingClientRect().height > bottom * .4;
  }).slice(0, limit);
  chosen.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  afterPaint(chosen.map((element, index) => element.animate(
    [{ opacity: 0, translate: `0 ${distance}px` }, { opacity: 1, translate: "0 0" }],
    { id: "rise", duration: 340, delay: index * step, easing: "cubic-bezier(.05, .7, .1, 1)", fill: "backwards" },
  )));
}

/** A view swapping in place, like a tab: a short fade and lift, no stagger. */
export function swap(element: Element | null) {
  if (!element || still()) return;
  afterPaint([element.animate([{ opacity: 0, translate: "0 10px" }, { opacity: 1, translate: "0 0" }], { duration: 280, easing: "cubic-bezier(.05, .7, .1, 1)", fill: "backwards" })]);
}

/** Rise once any skeleton inside has given way to what it stood for. Returns a cleanup. */
export function riseWhenReady(root: Element | null, options?: Parameters<typeof rise>[1]) {
  if (!root) return () => {};
  if (!root.querySelector(".skel-wait")) { rise(root, options); return () => {}; }
  const watch = new MutationObserver(() => { if (!root.querySelector(".skel-wait")) { watch.disconnect(); rise(root, options); } });
  watch.observe(root, { childList: true, subtree: true });
  const giveUp = setTimeout(() => watch.disconnect(), 15000);
  return () => { watch.disconnect(); clearTimeout(giveUp); };
}

/** Moving sideways between views of one app: the new view slides in from the side it came from. */
export function slide(element: Element | null, from: 1 | -1 = 1) {
  if (!element || still()) return;
  afterPaint([element.animate([{ opacity: 0, translate: `${from * 28}px 0` }, { opacity: 1, translate: "0 0" }], { duration: 380, easing: "cubic-bezier(.05, .7, .1, 1)", fill: "backwards" })]);
}

/**
 * Call back with the page once it stands: its shell is in the document and the
 * route's loading page has gone. Returns a cleanup. A page that never
 * stands is let go after a while, with anything still holding it hidden cleared.
 */
export function whenPageStands(ready: (page: HTMLElement) => void) {
  const standing = () => {
    const page = document.querySelector<HTMLElement>(".main-content");
    // The route's own loading page stands outside the shell; a skeleton inside
    // the page is the page's business, and its pieces rise when it gives way.
    return page && !document.querySelector(".skel-page") ? page : null;
  };
  const now = standing();
  if (now) { ready(now); return () => {}; }
  const watch = new MutationObserver(() => {
    const page = standing();
    if (page) { stop(); ready(page); }
  });
  const giveUp = setTimeout(() => {
    stop();
    document.querySelector<HTMLElement>(".main-content")?.getAnimations().forEach((animation) => animation.cancel());
  }, 15000);
  function stop() { watch.disconnect(); clearTimeout(giveUp); }
  watch.observe(document.body, { childList: true, subtree: true });
  return stop;
}

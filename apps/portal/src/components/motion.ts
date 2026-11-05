/*
 * The page settling in: what you can see rises into place one piece after
 * another, top to bottom, so a new page reads as arriving rather than
 * appearing. Only what's on screen moves, and never more than a handful, so it
 * stays quick on a long list. Someone who asked for less motion gets the page.
 */

const PIECES = [
  ".page > *", ".seg > *", ".app-tiles > *", ".cards > *", ".grid > *",
  ".dv-list > *", ".dv-grid > *", ".tl-list > *", ".rail-rooms > *",
  ".cd-list > *", ".cd-tasks > *", ".cd-timeline > *", ".cd-start > *",
].join(", ");

const still = () => typeof window === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches;

export function rise(root: Element | null, { step = 32, limit = 14, distance = 18 } = {}) {
  if (!root || still()) return;
  const bottom = window.innerHeight;
  const pieces = [...root.querySelectorAll<HTMLElement>(PIECES)].filter((element) => {
    if (getComputedStyle(element).position === "fixed") return false;
    const box = element.getBoundingClientRect();
    return box.height > 0 && box.top < bottom && box.bottom > 0;
  });
  // A piece whose parent is already rising moves with it; only nest when the parent is big.
  const chosen = pieces.filter((element) => {
    const parent = element.parentElement?.closest<HTMLElement>(PIECES);
    return !parent || !pieces.includes(parent) || parent.getBoundingClientRect().height > bottom * .4;
  }).slice(0, limit);
  chosen.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  chosen.forEach((element, index) => {
    element.animate(
      [{ opacity: 0, translate: `0 ${distance}px` }, { opacity: 1, translate: "0 0" }],
      { duration: 460, delay: index * step, easing: "cubic-bezier(.05, .7, .1, 1)", fill: "backwards" },
    );
  });
}

/** A view swapping in place, like a tab: a short fade and lift, no stagger. */
export function swap(element: Element | null) {
  if (!element || still()) return;
  element.animate([{ opacity: 0, translate: "0 10px" }, { opacity: 1, translate: "0 0" }], { duration: 280, easing: "cubic-bezier(.05, .7, .1, 1)", fill: "backwards" });
}

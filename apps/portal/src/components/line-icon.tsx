/*
 * The line icons (24px, 1.7 stroke, round), brushed: the filter sits on the
 * paths, never on the <svg>, because Safari draws an <svg> blank when CSS
 * gives it an SVG filter. The filter itself is InkIconDefs, once per page.
 */
const PATHS = {
  home: "M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-5h4v5",
  user: "M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5",
  lock: "M5 10.5h14v9.5H5zM8 10.5V8a4 4 0 0 1 8 0v2.5",
  moon: "M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z",
  laptop: "M5 5.5h14v10H5zM3 18.5h18",
  phone: "M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM10.5 18.5h3",
  door: "M14 4H6v16h8M11 12h10M17 8l4 4-4 4",
  back: "M19 12H5M11 6l-6 6 6 6",
  camera: "M4 8h3.5L9 5.5h6L16.5 8H20v11H4zM15.5 13.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z",
  check: "m5 12.5 4.5 4.5L19 7.5",
  out: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  plus: "M12 5v14M5 12h14",
  folder: "M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9a1.5 1.5 0 0 0-1.5-1.5H11L9 5H4.5A1.5 1.5 0 0 0 3 6.5z",
  archive: "M3.5 4.5h17v4.5h-17zM5 9v10.5h14V9M10 13h4",
  cloud: "M7 18.5a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 10.5a4 4 0 0 1-1 8z",
  key: "M12 15a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM11 12l8.5-8.5M16.5 6.5l2 2M14 9l2 2",
  bell: "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 21h4",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  shield: "M12 3.5 19 6.5v5.5c0 4-3 7-7 8.5-4-1.5-7-4.5-7-8.5V6.5z",
  gear: "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1",
  restore: "M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5",
  download: "M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  search: "M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0zM16 16l4 4",
  clock: "M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0zM12 7.5V12l3 2",
  trash: "M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10 11v6M14 11v6",
  people: "M12.5 8.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM2.5 19.5c.8-3.3 3.4-5 6.5-5s5.7 1.7 6.5 5M19.6 9.5a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0zM16.5 14.6c2.5.1 4.3 1.6 5 4.4",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  pin: "M9 3.5h6l-1 5.5 3.5 3.5h-11L10 9zM12 12.5V21",
  unpin: "M9 3.5h6l-1 5.5 3.5 3.5h-11L10 9zM12 12.5V21M4 4l16 16",
  book: "M4 5.5c2.5-1 5.5-1 8 .5v13c-2.5-1.5-5.5-1.5-8-.5zM20 5.5c-2.5-1-5.5-1-8 .5v13c2.5-1.5 5.5-1.5 8-.5z",
} as const;
export type LineIconName = keyof typeof PATHS;

export function LineIcon({ name, className }: { name: LineIconName; className?: string }) {
  return <svg className={["line-icon", className].filter(Boolean).join(" ")} viewBox="0 0 24 24" aria-hidden="true">
    <path d={PATHS[name]} filter="url(#k-ink-icon)" />
  </svg>;
}

/** The icons' brush, defined once in the root layout. */
export function InkIconDefs() {
  return <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
    <defs><filter id="k-ink-icon" x="-15%" y="-15%" width="130%" height="130%"><feTurbulence type="fractalNoise" baseFrequency=".22" numOctaves="2" seed="13" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="2" /></filter></defs>
  </svg>;
}

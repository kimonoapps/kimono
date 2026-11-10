/* Notes' line icons: 24×24, drawn in the current colour, the same set Drive and Kimono AI draw from. */
export const icons = {
  note: '<path d="M6.5 3.5h8l3.5 3.5v13.5h-11.5z"/><path d="M14.5 3.5V7H18M9.5 11.5h5M9.5 15h5"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  move: '<path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9a1.5 1.5 0 0 0-1.5-1.5H11L9 5H4.5A1.5 1.5 0 0 0 3 6.5z"/><path d="M10 13.5h6M13.5 11l2.5 2.5-2.5 2.5"/>',
  section: '<path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9a1.5 1.5 0 0 0-1.5-1.5H11L9 5H4.5A1.5 1.5 0 0 0 3 6.5z"/>',
  people: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c.8-3.3 3.4-5 6.5-5s5.7 1.7 6.5 5"/><circle cx="17" cy="9.5" r="2.6"/><path d="M16.5 14.6c2.5.1 4.3 1.6 5 4.4"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  door: '<path d="M14 4H6v16h8"/><path d="M11 12h10M17 8l4 4-4 4"/>',
  crest: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5c1.2 1.6 1.2 3 0 4.5-1.2-1.5-1.2-2.9 0-4.5Z"/><path d="M12 12c1.9-.5 3.2.1 4 1.8-1.9.5-3.2-.1-4-1.8Z"/><path d="M12 12c-1.9-.5-3.2.1-4 1.8 1.9.5 3.2-.1 4-1.8Z"/>',
  rename: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  book: '<path d="M4 5.5c2.5-1 5.5-1 8 .5v13c-2.5-1.5-5.5-1.5-8-.5zM20 5.5c-2.5-1-5.5-1-8 .5v13c2.5-1.5 5.5-1.5 8-.5z"/>',
  bold: '<path d="M7 4.5h6a3.6 3.6 0 0 1 0 7.2H7zM7 11.7h7a3.9 3.9 0 0 1 0 7.8H7z"/>',
  italic: '<path d="M10.5 4.5h7M6.5 19.5h7M14 4.5l-4 15"/>',
  heading: '<path d="M5.5 5v14M14.5 5v14M5.5 12h9"/><path d="M17.5 11.5l2-1.5v9"/>',
  bullets: '<circle cx="5" cy="7" r="1.2" fill="currentColor"/><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="5" cy="17" r="1.2" fill="currentColor"/><path d="M9.5 7H20M9.5 12H20M9.5 17H20"/>',
  check: '<circle cx="6" cy="7.5" r="2.6"/><path d="m4.9 7.6.9.9 1.6-1.8"/><circle cx="6" cy="16.5" r="2.6"/><path d="M11 7.5h9M11 16.5h9"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
  code: '<path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  lock: '<path d="M5 10.5h14v9.5H5zM8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  table: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 10h17M3.5 14.5h17M12 5v14"/>',
  tick: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
} as const;

export type IconName = keyof typeof icons;

export function Icon({ name }: { name: IconName }) {
  return <svg className="i" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons[name] }} />;
}

/* Code's icons: Drive's set, drawn the same way (24×24, the current colour), plus the few Code needs. */
import { icons as drive } from "../drive/icons";

export const icons = {
  ...drive,
  clip: '<path d="M20 11.5 12.2 19.3a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4"/>',
  file: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z"/><path d="M14 3.5v4h4"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  branch: '<circle cx="7" cy="5.5" r="2"/><circle cx="7" cy="18.5" r="2"/><circle cx="17" cy="7.5" r="2"/><path d="M7 7.5v9M17 9.5c0 4-10 2.5-10 7"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  pr: '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="18.5" r="2"/><path d="M6 7.5v9M18 16.5V9a2.5 2.5 0 0 0-2.5-2.5H11M13.5 4 11 6.5 13.5 9"/>',
  chat: '<path d="M4 5.5h16v10H10l-4.5 3.5v-3.5H4z"/>',
  diff: '<path d="M12 4v8M8 8h8M8 19h8"/>',
  rocket: '<path d="M12 3.5c3 2 4.5 5 4.5 8.5l-2 4h-5l-2-4c0-3.5 1.5-6.5 4.5-8.5z"/><circle cx="12" cy="10" r="1.6"/><path d="M9.5 16 7 19.5M14.5 16l2.5 3.5M12 16v4"/>',
  code: '<path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5"/>',
} as const;

export type IconName = keyof typeof icons;

export function Icon({ name }: { name: IconName }) {
  return <svg className="i" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons[name] }} />;
}

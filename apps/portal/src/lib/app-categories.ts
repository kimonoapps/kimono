/**
 * How Home sorts the apps. An app may sit in more than one group (Drive is
 * both one of your apps and a productivity app). "My apps" is each person's
 * own list, kept on the server so the website's rail and the phone's flower
 * show the same apps in the same order; until they change it, it's these.
 */
export const myAppsDefault = ["kimono-code", "kimono-drive", "immich"];

/**
 * Apps just added: Home lists the ones not pinned right under Your apps, and
 * every tile of one says New. Take an app off once it has settled.
 */
export const newApps = ["kimono-watch", "kimono-notes"];

/** Apps still in beta: their tiles say so. */
export const betaApps = ["kimono-watch"];

export type AppCategory = { id: string; label: string; apps: string[] };

export const appCategories: AppCategory[] = [
  { id: "productivity", label: "Productivity", apps: ["kimono-drive", "kimono-notes"] },
  { id: "for-you", label: "For you", apps: ["kimono-code", "immich", "kimono-watch"] },
  { id: "technical", label: "Technical", apps: ["pelican", "forgejo", "kimono-vpn", "kimono-tools"] },
];

/** The groups with the apps this person can open, in order; anything in no group lands under More. */
export function categorize<T extends { id: string }>(apps: T[]): { id: string; label: string; apps: T[] }[] {
  const byId = new Map(apps.map((app) => [app.id, app]));
  const placed = new Set(appCategories.flatMap((category) => category.apps));
  const groups = appCategories.map((category) => ({ id: category.id, label: category.label, apps: category.apps.flatMap((id) => byId.get(id) ?? []) }));
  groups.push({ id: "more", label: "More", apps: apps.filter((app) => !placed.has(app.id)) });
  return groups.filter((group) => group.apps.length);
}

/** A saved list cleaned up: strings only, no repeats, at most 24. */
export function cleanAppList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((id): id is string => typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(id)))].slice(0, 24);
}

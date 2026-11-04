/** Until someone pins their own: the first two apps that open inside Kimono. */
export function defaultPins(apps: { id: string; external: boolean }[]) {
  return apps.filter((app) => !app.external).slice(0, 2).map((app) => app.id);
}

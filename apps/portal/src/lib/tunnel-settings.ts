import type { PlatformSettings } from "./settings";

/** Label changes must preserve connector credentials, assignments, and state. */
export function renameTunnelSettings(settings: PlatformSettings, id: string, name: string) {
  const tunnel = settings.tunnels[id];
  if (!Object.hasOwn(settings.tunnels, id)) throw new Error("Tunnel does not exist");
  const label = name.trim();
  if (!label || label.length > 120) throw new Error("Use a connection name between 1 and 120 characters");
  tunnel.name = label;
}

/** Removing an exposure keeps the apps and their data, but makes them private. */
export function deleteTunnelSettings(settings: PlatformSettings, id: string) {
  if (!Object.hasOwn(settings.tunnels, id)) throw new Error("Tunnel does not exist");
  delete settings.tunnels[id];
  for (const app of Object.values(settings.apps)) if (app.tunnelId === id) app.tunnelId = null;
  for (const [routeId, route] of Object.entries(settings.routes)) if (route.tunnelId === id) delete settings.routes[routeId];
}

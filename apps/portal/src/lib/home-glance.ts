import "server-only";

import { db as driveDb, recentFiles, spacesOf } from "@/lib/drive";
import { db as codeDb, workspacesOf } from "@/lib/code";
import { vpnView } from "@/lib/vpn-view";

export type HomeGlance = {
  chats: { id: string; title: string; working: boolean; project: string | null; at: number }[] | null;
  chatTotals: { all: number; working: number; apps: number } | null;
  files: { id: string; name: string; space: string; spaceId: string; at: number }[] | null;
  fileTotals: { spaces: number; today: number; week: number } | null;
  devices: { id: string; name: string; online: boolean; seen: string }[] | null;
};

/**
 * What Home shows of the house now: Kimono AI's chats, what's new in Drive,
 * and which of your devices are up. Each part is read on its own; one that is
 * switched off or can't be read is null and Home leaves it out.
 */
export async function homeGlance(person: { username: string; name?: string | null; email?: string | null; role: string }, ids: string[]): Promise<HomeGlance> {
  const glance: HomeGlance = { chats: null, chatTotals: null, files: null, fileTotals: null, devices: null };
  if (ids.includes("kimono-code")) {
    try {
      const all = workspacesOf(codeDb(), person.username).filter((w) => !w.archivedAt);
      const working = all.filter((w) => w.turn?.state === "running");
      const shown = [...working, ...all.filter((w) => w.turn?.state !== "running")].slice(0, 5);
      glance.chats = shown.map((w) => ({ id: w.id, title: w.title || "New chat", working: w.turn?.state === "running", project: w.folder?.name ?? (w.kind === "project" ? w.repo.name : null), at: w.updatedAt }));
      glance.chatTotals = { all: all.length, working: working.length, apps: all.filter((w) => w.preview && !w.preview.stopped).length };
    } catch { /* Kimono AI not set up here */ }
  }
  if (ids.includes("kimono-drive")) {
    try {
      const database = driveDb();
      const spaces = spacesOf(database, person.username);
      const byId = new Map(spaces.map((space) => [space.id, space]));
      const files = recentFiles(database, person.username, 200).filter((file) => file.kind === "file");
      const day = new Date(); day.setHours(0, 0, 0, 0);
      const week = Date.now() - 7 * 24 * 3600 * 1000;
      glance.files = files.slice(0, 5).map((file) => ({ id: file.id, name: file.name, spaceId: file.spaceId, space: byId.get(file.spaceId)?.name ?? "", at: file.updatedAt }));
      glance.fileTotals = { spaces: spaces.length, today: files.filter((file) => file.updatedAt >= day.getTime()).length, week: files.filter((file) => file.updatedAt >= week).length };
    } catch { /* Drive not set up here */ }
  }
  if (ids.includes("kimono-vpn")) {
    try {
      const view = await vpnView(person);
      if (view.member && view.available) glance.devices = [...view.devices].sort((a, b) => Number(b.online) - Number(a.online)).slice(0, 5).map((d) => ({ id: d.id, name: d.name, online: d.online, seen: d.seen }));
    } catch { /* the mesh isn't answering */ }
  }
  return glance;
}

import { db as driveDb, recentFiles, spacesOf } from "@/lib/drive";
import { db as codeDb, workspacesOf } from "@/lib/code";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * One live line per Home tile, so Home doubles as a glance at the house:
 * Drive says what's new, Code whether it's working. Apps with nothing live to
 * say keep their description. Anything that can't be read keeps it too.
 */
export function homeLines(username: string, ids: string[]): Record<string, string> {
  const lines: Record<string, string> = {};
  if (ids.includes("kimono-drive")) {
    try {
      const database = driveDb();
      const spaces = spacesOf(database, username).length;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const fresh = recentFiles(database, username, 200).filter((file) => file.updatedAt >= today.getTime()).length;
      lines["kimono-drive"] = fresh ? `${plural(spaces, "space")} · ${plural(fresh, "new file")} today` : plural(spaces, "space");
    } catch { /* Drive not set up here */ }
  }
  if (ids.includes("kimono-code")) {
    try {
      const workspaces = workspacesOf(codeDb(), username);
      const working = workspaces.filter((w) => w.turn?.state === "running").length;
      const live = workspaces.filter((w) => w.preview && !w.preview.stopped).length;
      lines["kimono-code"] = working ? `Working on ${plural(working, "task")}` : live ? `${plural(live, "app")} running` : workspaces.length ? plural(workspaces.length, "task") : "Start a task";
    } catch { /* Code not set up here */ }
  }
  return lines;
}

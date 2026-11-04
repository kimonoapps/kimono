import { Choice, Seal } from "@kimono/ui";
import { Crossing, CrossingSeal } from "@/components/crossing";
import { JointSwitch } from "@/components/joint-switch";
import type { BackupConfig, BackupStatus } from "@/lib/backups";

export const when = (iso?: string) => iso ? new Date(iso).toUTCString().replace(/:\d\d GMT$/, " UTC") : null;

/** One word says where backups stand; one line says why. */
export function backupHealth(config: BackupConfig | null, status: BackupStatus | null) {
  const busy = status?.state === "running";
  const overdue = Boolean(config?.enabled && status?.overdue);
  if (!config) return { state: "quiet" as const, label: "Not set up", line: "Add storage, then save the recovery kit." };
  if (status?.state === "failed" || overdue) return { state: "wants" as const, label: "Attention", line: overdue ? "No complete upload in the last 36 hours." : status?.message || "The last run failed." };
  if (busy) return { state: "running" as const, label: "Working", line: status?.message || "A backup operation is running." };
  if (config.enabled) return { state: "running" as const, label: "Nightly", line: `Runs at ${String(config.hourUTC).padStart(2, "0")}:00 UTC. Missed runs catch up.` };
  return { state: "private" as const, label: "Paused", line: config.recoverySaved ? "Nothing runs on its own. Turn on nightly backups." : "Download the recovery kit, keep it off this server, then confirm it." };
}

/** Where copies go and when: an occasional task, so it lives in a sheet. */
export function StorageSheet({ config, save }: { config: BackupConfig | null; save: (form: FormData) => Promise<void> }) {
  return <div className="scrim open"><form className="sheet backup-sheet" action={save}>
    <span className="handle" />
    <h3>Where and when</h3>
    <p className="lead">Copies go to Backblaze B2. Changing the storage asks you to save a new recovery kit.</p>
    <label className="field"><small>Endpoint</small><input name="endpoint" type="url" required defaultValue={config?.endpoint || ""} placeholder="https://s3.us-west-004.backblazeb2.com" /></label>
    <div className="sheet-pair">
      <label className="field"><small>Bucket</small><input name="bucket" required defaultValue={config?.bucket || ""} /></label>
      <label className="field"><small>Folder</small><input name="prefix" required defaultValue={config?.prefix || "kimono"} /></label>
      <label className="field"><small>Key ID</small><input name="keyId" autoComplete="off" defaultValue={config?.keyId || ""} /></label>
      <label className="field"><small>Application key</small><input name="applicationKey" type="password" autoComplete="new-password" placeholder={config ? "Kept, leave blank" : ""} /></label>
    </div>
    <div className="pw-switch"><span><b>Nightly backups</b><small>Missed runs catch up</small></span><JointSwitch name="enabled" defaultChecked={config?.enabled || false} label="Nightly backups" /></div>
    <div className="pw-switch"><span><b>Keep Kimono itself</b><small>Settings, accounts and the identity provider</small></span><JointSwitch name="platform" defaultChecked={config?.platform ?? true} label="Keep Kimono itself" /></div>
    <div className="sheet-quad">
      <label className="field"><small>Hour, UTC</small><input type="number" name="hourUTC" min="0" max="23" required defaultValue={config?.hourUTC ?? 3} /></label>
      <label className="field"><small>Daily kept</small><input type="number" name="daily" min="1" max="365" required defaultValue={config?.daily ?? 7} /></label>
      <label className="field"><small>Weekly kept</small><input type="number" name="weekly" min="1" max="104" required defaultValue={config?.weekly ?? 4} /></label>
      <label className="field"><small>Monthly kept</small><input type="number" name="monthly" min="1" max="120" required defaultValue={config?.monthly ?? 6} /></label>
    </div>
    {config ? <div className="pw-switch"><span><b>Recovery kit is stored off this server</b><small><Crossing kind="kakejiku" external download href="/api/backups/recovery-kit">Download the kit</Crossing> first. Nothing runs until it&rsquo;s saved.</small></span><JointSwitch name="recoverySaved" defaultChecked={config.recoverySaved} label="Recovery kit is stored off this server" /></div> : null}
    <div className="sheet-actions">
      <Crossing kind="kakejiku" className="k-seal k-tone-quiet" href="/admin/backups">Cancel</Crossing>
      <Seal type="submit">Save</Seal>
    </div>
  </form></div>;
}

/** Restoring copies into a separate folder and never touches live data. */
export function RestoreSheet({ status, apps, run }: { status: BackupStatus | null; apps: Array<{ id: string; name: string }>; run: (form: FormData) => Promise<void> }) {
  const busy = status?.state === "running";
  return <div className="scrim open"><form className="sheet" action={run}>
    <span className="handle" />
    <h3>Restore a copy</h3>
    <p className="lead">Restoring copies into a separate folder and never touches live data.</p>
    {status?.snapshots?.length ? <>
      <Choice label="Snapshot" name="snapshot" defaultValue={status.snapshots[0]?.id} options={status.snapshots.map((snapshot) => ({ value: snapshot.id, label: `${when(snapshot.time)} · ${snapshot.id.slice(0, 6)}${snapshot.summary?.total_bytes_processed ? ` · ${(snapshot.summary.total_bytes_processed / 1024 ** 3).toFixed(1)} GiB` : ""}` }))} />
      <Choice label="Contents" name="appId" defaultValue="" options={[{ value: "", label: "Everything" }, ...apps.map((app) => ({ value: app.id, label: app.name }))]} />
    </> : <p className="lead">Snapshots appear here after the first backup.</p>}
    {status?.restorePath ? <p className="lead">Latest copy: <code>{status.restorePath}</code></p> : null}
    <div className="sheet-actions">
      <CrossingSeal tone="quiet" href="/admin/backups">Cancel</CrossingSeal>
      {status?.snapshots?.length ? <Seal name="action" value="restore" type="submit" disabled={busy}>Restore a copy</Seal> : null}
    </div>
  </form></div>;
}

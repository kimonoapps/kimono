import { CrossingSeal } from "@/components/crossing";
import { RunJoint } from "@/components/run-joint";
import { Compartment, Field, Mono, Seal } from "@kimono/ui";
import type { BackupConfig, BackupStatus } from "@/lib/backups";
import { BackupRefresh } from "./refresh";

export const when = (iso?: string) => iso ? new Date(iso).toUTCString().replace(/:\d\d GMT$/, " UTC") : null;

/** One stamp says where backups stand; one line says why. */
export function backupHealth(config: BackupConfig | null, status: BackupStatus | null) {
  const busy = status?.state === "running";
  const overdue = Boolean(config?.enabled && status?.overdue);
  if (!config) return { state: "quiet" as const, label: "Not set up", line: "Add storage, then save the recovery kit." };
  if (status?.state === "failed" || overdue) return { state: "wants" as const, label: "Attention", line: overdue ? "No complete upload in the last 36 hours." : status?.message || "The last run failed." };
  if (busy) return { state: "running" as const, label: "Working", line: status?.message || "A backup operation is running." };
  if (config.enabled) return { state: "running" as const, label: "Nightly", line: `Runs at ${String(config.hourUTC).padStart(2, "0")}:00 UTC. Missed runs catch up.` };
  return { state: "private" as const, label: "Paused", line: config.recoverySaved ? "Nothing runs on its own. Turn on nightly backups." : "Download the recovery kit, keep it off this server, then confirm it." };
}

/**
 * Kimono's own backup machinery: where copies go, when, and how to get one
 * back. What each app keeps is that app's own business, on its own page.
 */
export function BackupMachinery({ config, status, apps, save, run, queued }: {
  config: BackupConfig | null;
  status: BackupStatus | null;
  apps: Array<{ id: string; name: string }>;
  save: (form: FormData) => Promise<void>;
  run: (form: FormData) => Promise<void>;
  queued: boolean;
}) {
  const busy = status?.state === "running";
  return <>
    <BackupRefresh active={busy || queued} />
    <form action={save} className="backup-tray k-tray">
      <Compartment label="Storage" wants={!config}>
        <div className="backup-grid">
          <Field label="Backblaze B2 endpoint"><input name="endpoint" type="url" required defaultValue={config?.endpoint || ""} placeholder="https://s3.us-west-004.backblazeb2.com" /></Field>
          <Field label="Bucket"><input name="bucket" required defaultValue={config?.bucket || ""} /></Field>
          <Field label="Folder"><input name="prefix" required defaultValue={config?.prefix || "kimono"} /></Field>
          <Field label="Key ID"><input name="keyId" autoComplete="off" defaultValue={config?.keyId || ""} /></Field>
          <Field label="Application key"><input name="applicationKey" type="password" autoComplete="new-password" placeholder={config ? "Kept — leave blank" : ""} /></Field>
        </div>
        {config ? <div className="backup-kit">
          <CrossingSeal download href="/api/backups/recovery-kit" tone="quiet">Download recovery kit</CrossingSeal>
          <label className="settings-toggle"><input name="recoverySaved" type="checkbox" defaultChecked={config.recoverySaved} /><span>Kit is stored off this server</span></label>
        </div> : null}
      </Compartment>
      <Compartment label="Schedule">
        <div className="backup-switches">
          <RunJoint name="enabled" defaultChecked={config?.enabled || false} label="Nightly backups" />
          <label className="settings-toggle"><input name="platform" type="checkbox" defaultChecked={config?.platform ?? true} /><span>Keep Kimono itself</span></label>
        </div>
        <div className="backup-grid backup-numbers">
          <Field label="Hour, UTC"><input type="number" name="hourUTC" min="0" max="23" required defaultValue={config?.hourUTC ?? 3} /></Field>
          <Field label="Daily kept"><input type="number" name="daily" min="1" max="365" required defaultValue={config?.daily ?? 7} /></Field>
          <Field label="Weekly kept"><input type="number" name="weekly" min="1" max="104" required defaultValue={config?.weekly ?? 4} /></Field>
          <Field label="Monthly kept"><input type="number" name="monthly" min="1" max="120" required defaultValue={config?.monthly ?? 6} /></Field>
        </div>
      </Compartment>
      <footer><Seal type="submit">Save backups</Seal></footer>
    </form>
    <form action={run} className="backup-tray k-tray backup-run">
      <Compartment label="Now">
        <div className="backup-actions">
          <Seal name="action" value="backup" type="submit" disabled={!config?.recoverySaved || busy}>Back up now</Seal>
          <Seal name="action" value="check" type="submit" tone="quiet" disabled={!config?.recoverySaved || busy}>Check stored data</Seal>
          <Mono items={[`Last upload ${when(status?.lastSuccess) || "never"}`, `Last check ${when(status?.lastCheck) || "never"}`]} />
        </div>
      </Compartment>
      <Compartment label="Restore">
        {status?.snapshots?.length ? <div className="backup-grid backup-restore">
          <Field label="Snapshot"><select name="snapshot">{status.snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{when(snapshot.time)} · {snapshot.id.slice(0, 8)}{snapshot.summary?.total_bytes_processed ? ` · ${(snapshot.summary.total_bytes_processed / 1024 ** 3).toFixed(2)} GiB` : ""}</option>)}</select></Field>
          <Field label="Contents"><select name="appId"><option value="">Everything</option>{apps.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}</select></Field>
          <Seal name="action" value="restore" type="submit" tone="quiet" disabled={busy}>Restore a copy</Seal>
        </div> : <p className="k-note">Snapshots appear here after the first backup. Restoring copies into a separate folder and never touches live data.</p>}
        {status?.restorePath ? <Mono items={[`Latest copy ${status.restorePath}`]} className="backup-restore-path" /> : null}
      </Compartment>
    </form>
  </>;
}

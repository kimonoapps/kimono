import { Seal } from "@kimono/ui";
import type { TunnelInstance } from "@/lib/settings";

export function ConnectionManagement({ tunnel, assignedApps, action }: {
  tunnel: TunnelInstance;
  assignedApps: Array<{ name: string }>;
  action: (form: FormData) => Promise<void>;
}) {
  return <details className="connection-edit">
              <summary>Rename or delete connection</summary>
              <form action={action} className="connection-rename">
                <input type="hidden" name="id" value={tunnel.id} />
                <input type="hidden" name="action" value="rename" />
                <label><span>Connection name</span><input name="name" defaultValue={tunnel.name} required maxLength={120} /></label>
                <Seal type="submit" tone="quiet">Rename</Seal>
              </form>
              <details className="connection-delete">
                <summary>Delete connection</summary>
                <form action={action}>
                  <input type="hidden" name="id" value={tunnel.id} />
                  <input type="hidden" name="action" value="delete" />
                  <p>This removes {tunnel.name} from Kimono and stops its public routes. Apps and their data are kept.</p>
                  {assignedApps.length ? <p>Affected apps: {assignedApps.map(app => app.name).join(", ")}. Their public URLs will stop working, including this portal if it uses this connection.</p> : <p>No apps currently use this connection.</p>}
                  {tunnel.provider === "cloudflare" && <p>The tunnel and DNS records in Cloudflare remain. Remove them in Cloudflare if you no longer need them.</p>}
                  <label className="settings-toggle"><input type="checkbox" name="confirmed" required /><span>I understand this removes the connection and its public routes.</span></label>
                  <Seal type="submit" tone="danger">Delete connection</Seal>
                </form>
              </details>
            </details>;
}

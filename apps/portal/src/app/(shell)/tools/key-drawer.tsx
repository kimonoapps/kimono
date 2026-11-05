"use client";

import { useEffect, useRef, useState } from "react";
import { BloomMark, Seal } from "@kimono/ui";
import { manageApiKey } from "./actions";

/**
 * The key drawer: wood pulled out of the sheet, pushing the endpoints down.
 * Creating, replacing and revoking go through the same server action as
 * before. A newly born key is shown once, on a lifted inset, with the
 * blossom that marks its creation; copying it never overwrites the warning.
 */
export function KeyDrawer({ apiId, apiName, accent, configured, onClose, onPendingChange, onKeyChange }: { apiId: string; apiName: string; accent: string; configured: boolean; onClose: () => void; onPendingChange: (pending: boolean) => void; onKeyChange: (hasKey: boolean) => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [key, setKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [hasKey, setHasKey] = useState(configured);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [intent, setIntent] = useState<"rotate" | "revoke" | null>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  async function commit(action: "create" | "rotate" | "revoke") {
    setPending(true); onPendingChange(true); setError(""); setMessage("");
    try {
      const result = await manageApiKey(apiId, action);
      if (result.error) { setError(result.error); return; }
      setKey(result.key || ""); setCopied(false); setHasKey(!result.revoked); onKeyChange(!result.revoked); setIntent(null);
      setMessage(result.revoked ? "Key revoked. Protected endpoints are now disabled." : "Your key is saved. Copy it now; it will not be shown again.");
    } catch { setError("The key could not be saved. Please try again."); }
    finally { setPending(false); onPendingChange(false); }
  }
  /* Closing is plain: the warning beside the key already says it is shown once. */
  function requestClose() { if (pending) return; onClose(); }
  return <section className="tools-key-drawer k-arrive" aria-labelledby="key-drawer-title" onKeyDown={e => { if (e.key === "Escape") requestClose(); }}>
    <div className="tools-drawer-heading">
      <div><p className="tools-drawer-kicker">Caller key</p><h2 id="key-drawer-title" tabIndex={-1} ref={heading}>{apiName} API key</h2></div>
      <Seal tone="quiet" compact onClick={requestClose} disabled={pending}>Close</Seal>
    </div>
    <p className="tools-drawer-lead">One caller key for this API’s protected endpoints. Public endpoints don’t need a key.</p>
    {message && <p role="status" className="tools-drawer-status">{message}</p>}
    {error && <p role="alert" className="tools-error">{error}</p>}
    {key && <div className="tools-key-reveal">
      <BloomMark className="tools-key-bloom k-bloom-born" identity={{ id: apiId, accent }} centre={14} />
      <div className="tools-key-reveal-copy"><span className="tools-key-reveal-label">Your new key, shown once</span><code>{key}</code></div>
      <Seal tone="quiet" compact onClick={async () => { try { await navigator.clipboard.writeText(key); setCopied(true); setError(""); } catch { setError("Could not copy. Select the key and copy it manually."); } }}>{copied ? "Copied ✓" : "Copy key"}</Seal>
    </div>}
    {intent
      ? <div className="tools-key-confirm"><p>{intent === "rotate" ? "Replace the current key? Calls using the old key will immediately fail." : "Revoke this key? Protected endpoints will be disabled."}</p><div className="k-seal-group tools-action-group"><Seal tone="danger" disabled={pending} onClick={() => commit(intent)}>{pending ? "Saving…" : intent === "rotate" ? "Replace key" : "Revoke key"}</Seal><Seal tone="quiet" disabled={pending} onClick={() => setIntent(null)}>Cancel</Seal></div></div>
      : <div className="k-seal-group tools-action-group">{hasKey ? <><Seal tone="quiet" onClick={() => setIntent("rotate")}>Replace key</Seal><Seal tone="danger" onClick={() => setIntent("revoke")}>Revoke key</Seal></> : <Seal disabled={pending} onClick={() => commit("create")}>{pending ? "Creating…" : "Create API key"}</Seal>}</div>}
  </section>;
}

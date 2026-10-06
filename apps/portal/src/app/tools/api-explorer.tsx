"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Chip, MethodChip, Seal } from "@kimono/ui";
import type { ToolApi } from "@/lib/tool-apis/catalog";

type Access = "disabled" | "public" | "api-key";
type Result = { status: number; body: string };
const statuses = [[200, "Successful response"], [400, "Invalid or missing parameters"], [401, "Missing or invalid API key"], [404, "Disabled endpoint or mosque not found"], [502, "Upstream unavailable"], [503, "Incomplete API configuration"]] as const;
const accessWords: Record<Access, string> = { public: "Public", "api-key": "Requires API key", disabled: "Disabled" };

function statusTone(code: number) { return code >= 500 ? "danger" as const : code >= 400 ? "warn" as const : "ok" as const; }

/** Colours a JSON reply by building nodes, never markup: keys, strings, numbers, literals. */
function highlightJson(source: string): ReactNode[] {
  // Large replies stay complete, but avoid thousands of syntax-colouring nodes.
  if (source.length > 32 * 1024) return [source];
  const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const out: ReactNode[] = [];
  let last = 0; let index = 0; let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    if (match.index > last) out.push(source.slice(last, match.index));
    if (match[1]) out.push(<span key={index++} className={match[2] ? "k-key" : "k-str"}>{match[1]}</span>, match[2] ?? "");
    else if (match[3]) out.push(<span key={index++} className="k-lit">{match[3]}</span>);
    else out.push(<span key={index++} className="k-num">{match[4]}</span>);
    last = match.index + match[0].length;
  }
  out.push(source.slice(last));
  return out;
}

export function ApiExplorer({ api, access, enabled, callerKey, onCallerKeyChange, origin }: { api: ToolApi; access: Record<string, Access>; enabled: boolean; callerKey: string; onCallerKeyChange: (key: string) => void; origin: string }) {
  return <div className="tools-endpoints">{api.operations.map(operation => <Operation key={operation.id} apiId={api.id} operation={operation} access={access[operation.id]} enabled={enabled} callerKey={callerKey} onCallerKeyChange={onCallerKeyChange} origin={origin} />)}</div>;
}

/**
 * One endpoint: a row that opens. Closed it says method, path, name, what is
 * required and who may call it. Open it reads as a table first; the fields
 * appear only once you try the request. The reply sits on urushi so it is
 * visibly not documentation.
 */
function Operation({ apiId, operation: op, access, enabled, callerKey, onCallerKeyChange, origin }: { apiId: string; operation: ToolApi["operations"][number]; access: Access; enabled: boolean; callerKey: string; onCallerKeyChange: (key: string) => void; origin: string }) {
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState(op.example);
  const [trying, setTrying] = useState(false);
  const [tab, setTab] = useState<"request" | "response">("request");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copiedRequest, setCopiedRequest] = useState<string | null>(null);
  const [copyError, setCopyError] = useState("");
  const highlightedResult = useMemo(() => expanded && tab === "response" && result
    ? highlightJson(result.body) : null, [expanded, tab, result]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  const path = `/api/tools/${apiId}/${op.id}`;
  const query = new URLSearchParams(Object.entries(values).filter(([, value]) => value.trim()));
  const url = `${origin}${path}${query.size ? `?${query}` : ""}`;
  const curl = `curl -X GET '${url}'${access === "api-key" ? " \\\n  -H 'Authorization: Bearer YOUR_API_KEY'" : ""}`;
  const required = op.parameters.filter(parameter => parameter.required);
  const unavailable = !enabled ? "This API is disabled, so the request cannot be sent." : access === "disabled" ? "This endpoint is disabled. Its documentation remains available." : "";
  const needsKey = access === "api-key" && !callerKey.trim();
  async function execute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setTab("response");
    controller.current = new AbortController();
    try {
      const response = await fetch(`${path}?${query}`, { headers: access === "api-key" ? { Authorization: `Bearer ${callerKey}` } : {}, cache: "no-store", signal: controller.current.signal });
      const body = await response.json();
      setResult({ status: response.status, body: JSON.stringify(body, null, 2) });
    } catch (failure) {
      if (!(failure instanceof Error && failure.name === "AbortError")) setError("Request failed. Check your connection and try again.");
    } finally { setBusy(false); }
  }
  return <details className="tools-operation" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary className="tools-operation-summary">
      <span className="k-cue" aria-hidden="true" />
      <MethodChip method="GET" />
      <code className="tools-path">{path}</code>
      <span className="tools-operation-name">{op.name}</span>
      <span className="tools-operation-required">{required.length ? <>Requires {required.map((parameter, index) => <Fragment key={parameter.name}>{index ? ", " : ""}<code>{parameter.name}</code></Fragment>)}</> : "No required parameters"}</span>
      <Chip tone={access === "disabled" ? "faint" : "private"} className="tools-access">{accessWords[access]}</Chip>
    </summary>
    {expanded && <div className="tools-operation-body">
      <p className="tools-operation-description">{op.description}</p>
      <div className="tools-operation-grid">
        <form className="tools-request" onSubmit={execute}>
          <div className="tools-section-title"><h3>Parameters</h3><Seal tone="quiet" compact onClick={() => setTrying(!trying)} disabled={!!unavailable || busy}>{trying ? "Cancel" : "Try request"}</Seal></div>
          {!op.parameters.length ? <p className="tools-muted">No parameters.</p>
            : trying ? <div className="tools-fields">{op.parameters.map(parameter => <label key={parameter.name} className="k-field tools-field">
                <span>{parameter.name}{parameter.required ? <em>required</em> : null}</span>
                <input name={parameter.name} required={parameter.required} disabled={busy} autoComplete="off" placeholder={parameter.example} value={values[parameter.name] || ""} onChange={event => { setValues(old => ({ ...old, [parameter.name]: event.target.value })); setCopyError(""); }} />
                <small>{parameter.description}</small>
              </label>)}</div>
            : <table className="tools-parameter-table">
                <thead><tr><th scope="col">Name</th><th scope="col">Required</th><th scope="col">Description</th></tr></thead>
                <tbody>{op.parameters.map(parameter => <tr key={parameter.name}>
                  <td><code>{parameter.name}</code><span className="tools-param-kind">query · string</span></td>
                  <td>{parameter.required ? "Required" : "Optional"}</td>
                  <td>{parameter.description}<span className="tools-example">Example <code>{parameter.example}</code></span></td>
                </tr>)}</tbody>
              </table>}
          {trying && access === "api-key" && <label className="k-field tools-field tools-auth">
            <span>Authorization<em>Bearer</em></span>
            <input type="password" autoComplete="off" value={callerKey} onChange={event => onCallerKeyChange(event.target.value)} placeholder="This API’s caller key" />
            <small>{needsKey ? "Enter the caller key to send this request. It stays in this page’s memory." : "Sent as Authorization: Bearer. It stays in this page’s memory and is shared by every endpoint on this page."}</small>
          </label>}
          {unavailable && <p className="tools-request-note">{unavailable}</p>}
          {trying && <div className="tools-execute"><Seal type="submit" disabled={busy || !!unavailable || needsKey}>{busy ? "Requesting…" : "Execute request"}</Seal><span>GET · read only{needsKey ? " · needs a key" : ""}</span></div>}
          <div className="tools-response-docs">
            <h3>Response</h3>
            <p>{op.response}</p>
            <dl className="tools-status-list">{statuses.map(([code, description]) => <Fragment key={code}><dt><Chip tone={statusTone(code)}>{code}</Chip></dt><dd>{description}</dd></Fragment>)}</dl>
          </div>
        </form>
        <section className="tools-pane" aria-label={`${op.name} request and response`}>
          <div className="tools-pane-tabs" role="tablist" aria-label="Request output" onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "request" : event.key === "End" ? "response" : tab === "request" ? "response" : "request"; setTab(next); event.currentTarget.querySelector<HTMLButtonElement>(`#${op.id}-${next}-tab`)?.focus(); } }}>
            <button type="button" role="tab" id={`${op.id}-request-tab`} tabIndex={tab === "request" ? 0 : -1} aria-selected={tab === "request"} aria-controls={`${op.id}-request-panel`} onClick={() => setTab("request")}>Request</button>
            <button type="button" role="tab" id={`${op.id}-response-tab`} tabIndex={tab === "response" ? 0 : -1} aria-selected={tab === "response"} aria-controls={`${op.id}-response-panel`} onClick={() => setTab("response")}>Response{result && <Chip tone={statusTone(result.status)}>{result.status}</Chip>}</button>
          </div>
          <div key={tab} className="tools-pane-body" role="tabpanel" id={`${op.id}-${tab}-panel`} aria-labelledby={`${op.id}-${tab}-tab`}>
            {tab === "request" ? <>
                <div className="tools-code-heading"><span>curl</span><button type="button" className="k-seal k-tone-quiet k-compact" onClick={async () => { try { await navigator.clipboard.writeText(curl); setCopiedRequest(curl); setCopyError(""); } catch { setCopyError("Could not copy. Select the command and copy it manually."); } }}>{copiedRequest === curl ? "Copied ✓" : "Copy"}</button></div>
                {copyError && <p role="alert" className="tools-error">{copyError}</p>}
                <pre className="k-code"><code>{curl}</code></pre>
                <div className="tools-request-address"><span>Request URL</span><code>{url}</code></div>
                {access === "api-key" && <p className="tools-code-note">Replace YOUR_API_KEY with this API’s caller key.</p>}
              </>
              : busy ? <p role="status" className="tools-response-empty"><span>Waiting for the response…</span>The request is on its way.</p>
              : error ? <p role="alert" className="tools-error">{error}</p>
              : result ? <>
                  <div className="tools-result-status"><Chip tone={statusTone(result.status)}>HTTP {result.status}</Chip><span>{result.status >= 400 ? "Request failed" : "Successful response"}</span></div>
                  <pre className="k-code k-urushi"><code>{highlightedResult}</code></pre>
                </>
              : <div className="tools-response-empty"><span>No response yet</span><p>Try a request to inspect the status and JSON reply here.</p></div>}
          </div>
          <span className="tools-sr-only" role="status">{result ? `Request returned HTTP ${result.status}` : ""}</span>
        </section>
      </div>
    </div>}
  </details>;
}

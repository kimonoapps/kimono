"use client";

import { useRef, useState } from "react";
import { BloomMark, Chip, PageHeader, Seal } from "@kimono/ui";
import { Crossing, CrossingSeal } from "@/components/crossing";
import type { ToolApi } from "@/lib/tool-apis/catalog";
import { ApiExplorer } from "./api-explorer";
import { KeyDrawer } from "./key-drawer";

export type DocumentedApi = { api: ToolApi; enabled: boolean; hasKey: boolean; access: Record<string, "disabled" | "public" | "api-key"> };

/**
 * The reference: a rail of collections on the ground, and the chosen API on
 * one raised sheet — its masthead, the key drawer when it is pulled out, and
 * the endpoints as rows. Keys stay exactly where they were: the drawer saves
 * them on the server, the tester keeps a caller key in this page's memory.
 */
export function ToolsDocumentation({ apis, selectedId, administrator, origin, openKeyDrawer = false, accent = "#a84d63" }: { apis: DocumentedApi[]; selectedId: string; administrator: boolean; origin: string; openKeyDrawer?: boolean; accent?: string }) {
  const selected = apis.find(item => item.api.id === selectedId);
  const [drawer, setDrawer] = useState(administrator && openKeyDrawer);
  const [key, setKey] = useState("");
  const [keyPending, setKeyPending] = useState(false);
  const [knownKey, setKnownKey] = useState<boolean | null>(null);
  const keyTrigger = useRef<HTMLButtonElement>(null);
  if (!selected) return <div className="page tools-page"><PageHeader title="APIs" description="No APIs are currently available." />{administrator && <CrossingSeal href="/admin/apps/kimono-tools?view=environment">Configure APIs</CrossingSeal>}</div>;
  const { api, enabled, access } = selected;
  const hasKey = knownKey ?? selected.hasKey;
  const configurationHref = "/admin/apps/kimono-tools?view=environment";
  function closeDrawer() { if (keyPending) return; setDrawer(false); keyTrigger.current?.focus(); }
  return <div className="page tools-page">
    <div className="tools-workspace">
      <nav className="tools-rail" aria-label="API collections">
        <p className="tools-rail-label">Collections</p>
        <div className="tools-collections">{apis.map(item => <Crossing kind="kakejiku" key={item.api.id} href={`/tools/${item.api.id}`} aria-current={item.api.id === selectedId ? "page" : undefined} className="tools-collection" data-enabled={item.enabled}>
          <span className="tools-collection-bloom"><BloomMark identity={{ id: item.api.id, accent }} centre={15} /></span>
          <span className="tools-collection-copy">
            <span className="tools-collection-name">{item.api.name}</span>
            <span className="tools-collection-meta">{item.api.operations.length} {item.api.operations.length === 1 ? "endpoint" : "endpoints"} · {item.enabled ? "Enabled" : "Disabled"}</span>
          </span>
        </Crossing>)}</div>
        <div className="tools-rail-footer">
          <Crossing kind="kakejiku" href="/api/tools/openapi.json" download="kimono-tools.openapi.json">Download OpenAPI <span aria-hidden="true">↓</span></Crossing>
          {administrator && <Crossing kind="kakejiku" href={configurationHref}>API configuration <span aria-hidden="true">→</span></Crossing>}
        </div>
      </nav>

      <section className="tools-reference" aria-labelledby="tools-api-title">
        <header className="tools-masthead">
          <BloomMark className="tools-masthead-bloom" identity={{ id: api.id, accent }} />
          <div className="tools-masthead-copy">
            <p className="tools-kicker">Kimono Tools · API reference</p>
            <h1 id="tools-api-title">{api.name}</h1>
            <p className="tools-lead">{api.description}</p>
            <div className="tools-masthead-meta">
              {enabled ? <Chip tone="running">API enabled</Chip> : <Chip tone="faint">API disabled</Chip>}
              <span>{api.operations.length} {api.operations.length === 1 ? "endpoint" : "endpoints"} · GET · JSON</span>
              <Crossing kind="kakejiku" href={api.source} target="_blank" rel="noreferrer">Source reference <span aria-hidden="true">↗</span></Crossing>
            </div>
          </div>
          {/* While the API is disabled the primary action is enabling it, beside the notice; the key stays here as the secondary. */}
          {administrator && <div className="k-seal-group tools-masthead-actions">
            <Seal ref={keyTrigger} tone={enabled ? "primary" : "quiet"} disabled={keyPending} onClick={() => setDrawer(!drawer)} aria-expanded={drawer}>{hasKey ? "Manage API key" : "Create API key"}</Seal>
          </div>}
        </header>

        {!enabled && <p className="tools-disabled-note" role="status">
          <strong>This API is disabled.</strong>
          <span>Every endpoint answers <code>404</code> until an administrator enables it in API configuration. The documentation stays readable.</span>
          {administrator && <CrossingSeal compact href={configurationHref}>Enable {api.name}</CrossingSeal>}
        </p>}

        {drawer && <KeyDrawer apiId={api.id} apiName={api.name} accent={accent} configured={hasKey} onClose={closeDrawer} onPendingChange={setKeyPending} onKeyChange={setKnownKey} />}

        {api.operations.some(op => access[op.id] === "api-key") && <p className="tools-key-warning" role="note">{administrator ? <Crossing kind="kakejiku" href={`/tools/${api.id}?create-key=1`}>Requires API key · {hasKey ? "Manage API key" : "Create API key"} →</Crossing> : <span>Requires API key · Ask an administrator to create a key for this API.</span>}</p>}

        <div className="tools-endpoints-heading"><h2>Endpoints</h2><span>Open a row for its parameters, a request preview and the live response.</span></div>
        <ApiExplorer key={api.id} api={api} access={access} enabled={enabled} callerKey={key} onCallerKeyChange={setKey} origin={origin} />

        <footer className="tools-reference-footer">
          <span>Public endpoints need no key. Protected endpoints take <code>Authorization: Bearer</code> with this API’s caller key.</span>
        </footer>
      </section>
    </div>
  </div>;
}

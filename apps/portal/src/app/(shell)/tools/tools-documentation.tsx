"use client";

import { useRef, useState } from "react";
import { InkCard, PageHeader } from "@kimono/ui";
import { LineIcon } from "@/components/line-icon";
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
    <div className="topbar">
      <span><span className="eyebrow">API reference</span><h1 id="tools-api-title">{api.name}</h1><p className="sub">{api.description}</p></span>
      <div className="end">
        <span className={enabled ? "k-ink-dot k-running" : "k-ink-dot"}>{enabled ? "API enabled" : "API disabled"}</span>
        <Crossing kind="kakejiku" className="txt" href="/api/tools/openapi.json" download="kimono-tools.openapi.json"><LineIcon name="download" />OpenAPI</Crossing>
        {administrator ? <Crossing kind="kakejiku" className="txt" href={configurationHref}>Configure</Crossing> : null}
      </div>
    </div>

    {!enabled ? <InkCard colour="#a84d63" seed={`tools-off-${api.id}`} className="tools-off-ink"><div className="card tools-off">
      <span><b>This API is switched off</b><small>Every endpoint answers 404 until it&rsquo;s enabled. The reference stays readable.</small></span>
      {administrator ? <CrossingSeal compact href={configurationHref}>Enable {api.name}</CrossingSeal> : null}
    </div></InkCard> : null}

    {administrator ? <div className="card tools-key">
      <span className="tools-key-mark"><LineIcon name="key" /></span>
      <span><b>Caller key</b><small>{hasKey ? "Set. It was shown once, when it was made." : api.operations.some(op => access[op.id] === "api-key") ? "Protected endpoints need one." : "Only protected endpoints use it."}</small></span>
      <button ref={keyTrigger} type="button" className="tools-key-btn" disabled={keyPending} onClick={() => setDrawer(!drawer)} aria-expanded={drawer}>{drawer ? "Close" : hasKey ? "Replace" : "Create"}</button>
    </div> : null}
    {drawer ? <KeyDrawer apiId={api.id} apiName={api.name} accent={accent} configured={hasKey} onClose={closeDrawer} onPendingChange={setKeyPending} onKeyChange={setKnownKey} /> : null}

    <div className="label">Endpoints</div>
    <ApiExplorer key={api.id} api={api} access={access} enabled={enabled} callerKey={key} onCallerKeyChange={setKey} origin={origin} />
    <p className="tools-foot">Public endpoints need no key. Protected ones take <code>Authorization: Bearer</code> with this API&rsquo;s caller key. <Crossing kind="kakejiku" href={api.source} target="_blank" rel="noreferrer">Source reference</Crossing></p>
  </div>;
}

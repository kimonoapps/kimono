import { headers } from "next/headers";
import "./tools.css";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getAppDefinition } from "@/lib/definitions";
import { getPlatformSettings } from "@/lib/settings";
import { appIdentity, appRegistry } from "@/lib/apps";
import { AppShell } from "@/components/app-shell";
import { apiAccess } from "@/lib/tool-apis/access";
import { apiField } from "@/lib/tool-apis/catalog";
import { ToolsDocumentation } from "./tools-documentation";

export async function DocumentationPage({ selectedId, openKeyDrawer = false }: { selectedId?: string; openKeyDrawer?: boolean }) {
  const requestHeaders = await headers();
  const protocol = requestHeaders.get("x-forwarded-proto") === "https" ? "https" : "http";
  const origin = `${protocol}://${requestHeaders.get("host") || "localhost:3000"}`;
  const session = await auth(); if (!session?.user) redirect("/login");
  const [definition, settings] = await Promise.all([getAppDefinition("kimono-tools"), getPlatformSettings()]);
  if (!definition) notFound();
  const app = appRegistry(settings, [definition]).find(a => a.id === "kimono-tools");
  if (!app?.enabled) notFound();
  const instance = settings.apps["kimono-tools"];
  const apis = (definition.spec.apiCollection || []).map(api => ({
    api, enabled: instance?.environment[apiField(api.id, "enabled")]?.value === "on",
    hasKey: !!instance?.environment[apiField(api.id, "caller_key")]?.value,
    access: Object.fromEntries(api.operations.map(op => [op.id, apiAccess(instance, api, op.id)])),
  })).filter(item => item.enabled).map(item => ({ ...item, api: { ...item.api, operations: item.api.operations.filter(op => item.access[op.id] !== "disabled") } })).filter(item => item.api.operations.length > 0);
  if (selectedId && !apis.some(item => item.api.id === selectedId)) notFound();
  return <AppShell user={session.user} brandColors={settings.brand.colors} app={appIdentity(app)}><ToolsDocumentation key={selectedId || apis[0]?.api.id} openKeyDrawer={openKeyDrawer} apis={apis} selectedId={selectedId || apis[0]?.api.id || ""} administrator={["admin", "owner"].includes(session.user.role)} origin={origin} accent={app.accent} /></AppShell>;
}

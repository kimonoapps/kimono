import { apiError, apiJson, apiUser, failure, unauthorized } from "@/lib/api-v1";
import { changeApp, managedApp, startApp } from "@/lib/app-admin";

/*
 * One app, as the website's /admin/apps/[id] shows it. GET reads every view;
 * POST {action:"start"} starts its setup; PATCH {section, ...} saves one view
 * (setup, settings, environment or backups). Each answers with the app as it
 * now is.
 */
async function admin() {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (user.role !== "owner" && user.role !== "admin") return apiError(403, "Only administrators manage apps.");
  return null;
}

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Context) {
  const refused = await admin(); if (refused) return refused;
  try { return apiJson(await managedApp((await params).id)); } catch (error) { return failure(error, "The app couldn't be read."); }
}

export async function POST(request: Request, { params }: Context) {
  const refused = await admin(); if (refused) return refused;
  const { id } = await params;
  const body = await request.json().catch(() => null) as { action?: string } | null;
  if (body?.action !== "start") return apiError(400, "Say what to do.");
  try { await startApp(id); return apiJson(await managedApp(id)); } catch (error) { return failure(error, "Setup couldn't start."); }
}

export async function PATCH(request: Request, { params }: Context) {
  const refused = await admin(); if (refused) return refused;
  const { id } = await params;
  const body = await request.json().catch(() => null) as Parameters<typeof changeApp>[1] | null;
  if (!body || !["setup", "settings", "environment", "backups"].includes(body.section)) return apiError(400, "Say which part to change.");
  try { await changeApp(id, body); return apiJson(await managedApp(id)); } catch (error) { return failure(error, "That couldn't be saved."); }
}

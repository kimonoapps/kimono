import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { cleanAppList } from "@/lib/app-categories";
import { myApps, setMyApps } from "@/lib/my-apps";

/** This person's "My apps", in order: the website's rail and the phone's flower both show it. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return apiJson({ apps: await myApps(user.username) });
}

/** Replaces the list: `{ apps: ["kimono-code", …] }`. */
export async function PUT(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const apps = cleanAppList((read.body as { apps?: unknown } | null)?.apps);
  if (!apps) return apiError(400, "Send the apps as a list.");
  await setMyApps(user.username, apps);
  return apiJson({ apps });
}

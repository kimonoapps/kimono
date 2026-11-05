import { apiError, apiJson, apiUser, failure, unauthorized } from "@/lib/api-v1";
import { managedApps } from "@/lib/app-admin";

/** The apps an administrator can manage from the phone: GET lists them with their state. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (user.role !== "owner" && user.role !== "admin") return apiError(403, "Only administrators manage apps.");
  try { return apiJson({ apps: await managedApps() }); } catch (error) { return failure(error, "The apps couldn't be read."); }
}

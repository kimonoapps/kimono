import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { listReaders } from "@/lib/kimono-read";

/** Your paired Kimono Read e-readers. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return apiJson({ devices: listReaders(user.username) });
}

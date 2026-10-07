import { endSession } from "@/lib/account";
import { apiError, apiJson, apiUser, crossSite, failure, unauthorized } from "@/lib/api-v1";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const { id } = await params;
  try {
    return await endSession(user, id) ? apiJson({ ended: 1 }) : apiError(404, "That sign-in isn't one of yours, or it has already ended.");
  } catch (error) {
    return failure(error, "That sign-in could not be ended.");
  }
}

import { changePicture, clearPicture } from "@/lib/account";
import { apiError, apiJson, apiUser, crossSite, failure, readLimited, unauthorized } from "@/lib/api-v1";
import { pictureMaxBytes } from "@/lib/picture-png";

/** Replaces the signed-in person's picture with a 512×512 PNG sent as the body. */
export async function PUT(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "image/png") return apiError(415, "Send the cropped picture as image/png.");
  const upload = await readLimited(request, pictureMaxBytes);
  if (!upload) return apiError(413, "That picture is larger than 2 MB.");
  try {
    return apiJson({ picture: await changePicture(user, upload) });
  } catch (error) {
    return failure(error, "Your picture could not be saved.");
  }
}

export async function DELETE(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  try {
    await clearPicture(user);
    return apiJson({ picture: null });
  } catch (error) {
    return failure(error, "Your picture could not be removed.");
  }
}

import { portalOrigin } from "@/lib/account";
import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { listAccounts } from "@/lib/directory";
import { picturePaths } from "@/lib/pictures";

/**
 * The people a space can be shared with: everyone with a Kimono account,
 * by name and picture. Spaces are shared with accounts, never by email.
 */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  const [accounts, pictures] = await Promise.all([listAccounts(), picturePaths()]);
  const origin = portalOrigin();
  return apiJson({
    people: accounts.map((account) => {
      const picture = pictures[account.username.toLowerCase()];
      return { username: account.username, name: account.name || account.username, picture: picture ? `${origin}${picture}` : null };
    }),
  });
}

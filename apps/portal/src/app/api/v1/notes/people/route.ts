import { portalOrigin } from "@/lib/account";
import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { listAccounts } from "@/lib/directory";
import { notes } from "@/lib/notes";
import { picturePaths } from "@/lib/pictures";

/** The people a notebook or note can be shared with: everyone with a Kimono account, by name and picture. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  return notes(async () => {
    const [accounts, pictures] = await Promise.all([listAccounts(), picturePaths()]);
    const origin = portalOrigin();
    return apiJson({
      people: accounts.map((account) => {
        const picture = pictures[account.username.toLowerCase()];
        return { username: account.username, name: account.name || account.username, picture: picture ? `${origin}${picture}` : null };
      }),
    });
  });
}

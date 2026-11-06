import { apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { code } from "@/lib/code";
import { toolkitDetails, toolkitLook } from "@/lib/code/composio";

type Context = { params: Promise<{ slug: string }> };

/** A person's own app as Composio names and draws it ({ name, logo }), for the chat's tool calls; with ?details=1, also what it is and what it can do, for its page in Connections. */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { slug } = await params;
  return code(user, async (config) => {
    const look = new URL(request.url).searchParams.get("details")
      ? await toolkitDetails(config.composioKey, slug)
      : await toolkitLook(config.composioKey, slug);
    const response = apiJson(look);
    response.headers.set("Cache-Control", "private, max-age=86400");
    return response;
  }, false);
}

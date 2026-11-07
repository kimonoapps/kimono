import { KimonoMark, Seal } from "@kimono/ui";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { redirectWith } from "@/lib/notes/mcp-oauth";
import { authorizationRequest } from "@/lib/notes/mcp-server";

/**
 * Where a person lets an app (Claude, an editor…) into their notes. It is on
 * the Portal, where they are signed in; the answer goes to ./decide.
 */
export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function AuthorizePage({ searchParams }: { searchParams: Search }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string" && key !== "decision") params.set(key, value);
  const asked = await authorizationRequest(params);
  if ("back" in asked) redirect(redirectWith(asked.back, { error: asked.error, error_description: asked.description, state: asked.state, iss: asked.issuer }));
  const session = await auth();
  if (!session?.user?.username) redirect(`/login?callbackUrl=${encodeURIComponent(`/mcp/authorize?${params}`)}`);
  const returnsTo = "show" in asked ? "" : new URL(asked.redirectUri).host || new URL(asked.redirectUri).protocol.replace(/:$/, "");
  return (
    <main className="login-page">
      <section className="login-panel">
        <span className="kimono-brand login-brand"><KimonoMark /></span>
        <div className="login-copy">
          <p className="eyebrow">Notes</p>
          {"show" in asked ? <>
            <h1 style={{ fontSize: "clamp(36px, 4.5vw, 56px)" }}>Can&rsquo;t <em>connect.</em></h1>
            <p>{asked.show}</p>
          </> : <>
            <h1 style={{ fontSize: "clamp(36px, 4.5vw, 56px)", overflowWrap: "anywhere" }}>Allow <em>{asked.client.name}</em>?</h1>
            <p>It will read, change and delete your notes as {session.user.name || session.user.username}{returnsTo ? `, from ${returnsTo}` : ""}.</p>
          </>}
        </div>
        {"show" in asked ? null : (
          <form method="post" action="/mcp/authorize/decide" style={{ display: "flex", gap: "var(--k-space-3)", flexWrap: "wrap" }}>
            {[...params].map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
            <Seal className="login-button" type="submit" name="decision" value="allow" style={{ flex: "1 1 220px" }}>Allow <span aria-hidden="true">→</span></Seal>
            <Seal tone="quiet" type="submit" name="decision" value="deny" style={{ minHeight: 52 }}>Cancel</Seal>
          </form>
        )}
      </section>
      <aside className="login-art" aria-hidden="true">
        <span className="sun-disc" />
        <div className="color-folds"><i /><i /><i /><i /></div>
      </aside>
    </main>
  );
}

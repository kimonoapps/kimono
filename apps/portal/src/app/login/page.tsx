import { KimonoMark, Seal } from "@kimono/ui";
import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";

/** Where to go once signed in: a page on this Kimono (a share link someone opened), or home. */
function backTo(asked: string | string[] | undefined) {
  const to = typeof asked === "string" ? asked : "";
  /* Resolved against a stand-in origin: anything that lands elsewhere (//host,
     /\host, a tab or newline browsers strip) is refused, not just the obvious forms. */
  try {
    const base = "https://kimono.invalid";
    const url = new URL(to, base);
    if (!to.startsWith("/") || url.origin !== base || /[\u0000-\u001f\\]/.test(to)) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string | string[] }> }) {
  const to = backTo((await searchParams).callbackUrl);
  const session = await auth();
  if (session) redirect(to);
  return (
    <main className="login-page">
      <section className="login-panel">
        <span className="kimono-brand login-brand"><KimonoMark /></span>
        <div className="login-copy">
          <p className="eyebrow">Welcome back</p>
          <h1>Come<br /><em>home.</em></h1>
          <p>One private place for your household’s people, tools, and shared memories.</p>
        </div>
        <form action={async () => {
          "use server";
          await signIn("authentik", { redirectTo: to });
        }}>
          <Seal className="login-button" type="submit">Continue to Kimono <span aria-hidden="true">→</span></Seal>
        </form>
      </section>
      <aside className="login-art" aria-hidden="true">
        <span className="sun-disc" />
        <div className="color-folds"><i /><i /><i /><i /></div>
      </aside>
    </main>
  );
}

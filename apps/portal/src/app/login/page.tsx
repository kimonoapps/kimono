import { KimonoMark, SakuraMon, Seal } from "@kimono/ui";
import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const session = await auth();
  if (session) redirect("/");
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
          await signIn("authentik", { redirectTo: "/" });
        }}>
          <Seal className="login-button" type="submit">Continue to Kimono <span aria-hidden="true">→</span></Seal>
        </form>
      </section>
      {/* One blossom on a rose field. The house colours, and nothing else. */}
      <aside className="login-art" aria-hidden="true">
        <SakuraMon className="login-bloom" />
      </aside>
    </main>
  );
}

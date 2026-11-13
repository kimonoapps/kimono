import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Seal } from "@kimono/ui";
import { auth } from "@/auth";
import { approvePairing, pairingFor, ReadProblem } from "@/lib/kimono-read";
import "../read.css";

export const metadata: Metadata = { title: "Pair a Kimono Read" };

type Search = Promise<{ code?: string; done?: string; error?: string }>;

/**
 * Where the QR code on a Kimono Read leads: the reader asking to be paired,
 * and one button to pair it with this account. Without a code (typed from the
 * reader's screen instead), it asks for one.
 */
export default async function PairPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const session = await auth();
  if (!session?.user?.username) redirect(`/login?callbackUrl=${encodeURIComponent(`/read/pair${query.code ? `?code=${encodeURIComponent(query.code)}` : ""}`)}`);

  async function pair(form: FormData) {
    "use server";
    const current = await auth();
    if (!current?.user?.username) redirect("/login");
    const code = String(form.get("code") || "");
    try { approvePairing(code, current.user.username); }
    catch (error) { redirect(`/read/pair?code=${encodeURIComponent(code)}&error=${encodeURIComponent(error instanceof ReadProblem ? error.message : "That didn't work. Try again.")}`); }
    redirect("/read/pair?done=1");
  }

  if (query.done) return <div className="kimono-read">
    <h1>Paired</h1>
    <p className="lede">Your Kimono Read is yours now. It shows your shelf and keeps your place in Kimono Books.</p>
    <a className="go" href="/books">Open Kimono Books</a>
  </div>;

  let found: ReturnType<typeof pairingFor> | null = null, problem = query.error ?? null;
  if (query.code && !problem) {
    try { found = pairingFor(query.code); }
    catch (error) { problem = error instanceof ReadProblem ? error.message : "That code couldn't be checked."; }
  }

  return <div className="kimono-read">
    <h1>Pair a Kimono Read</h1>
    {problem ? <p className="admin-notice error" role="alert">{problem}</p> : null}
    {found ? <>
      <p className="lede">This Kimono Read is asking to be paired with you, {session.user.name || session.user.username}. Check the code matches the one on its screen.</p>
      <div className="code">{found.code}</div>
      <form action={pair}><input type="hidden" name="code" value={found.code} /><Seal type="submit">Pair with my Kimono</Seal></form>
      <p className="note">It will see your Kimono Books shelf and read your Kimono Drive. You can unpair it from You › Signed-in devices.</p>
    </> : <>
      <p className="lede">Type the six-character code shown on the reader.</p>
      <form action={pair}><input type="text" name="code" inputMode="text" autoCapitalize="characters" autoComplete="off" maxLength={8} defaultValue={query.code ?? ""} aria-label="Pairing code" /><Seal type="submit">Pair</Seal></form>
    </>}
  </div>;
}

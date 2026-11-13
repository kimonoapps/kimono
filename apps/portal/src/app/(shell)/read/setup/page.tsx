import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createTicket } from "@/lib/kimono-read";
import "../read.css";

export const metadata: Metadata = { title: "Set up Kimono Read" };

/**
 * Setting up a Kimono Read from the phone, with nothing typed on the reader.
 * The reader serves a setup page on its own Wi-Fi; this hands it this
 * Kimono's address and a one-time ticket, so the person only picks their
 * Wi-Fi and types its password, here on the phone.
 */
export default async function SetupPage() {
  const session = await auth();
  if (!session?.user?.username) redirect(`/login?callbackUrl=${encodeURIComponent("/read/setup")}`);
  const { ticket } = createTicket(session.user.username);
  const server = (process.env.KIMONO_PORTAL_URL || process.env.AUTH_URL?.replace(/\/api\/auth\/?$/, "") || "http://localhost:3000").replace(/\/+$/, "");
  const setupUrl = `http://192.168.4.1/kimono?server=${encodeURIComponent(server)}&ticket=${encodeURIComponent(ticket)}`;
  return <div className="kimono-read">
    <h1>Set up Kimono Read</h1>
    <p className="lede">Your phone does the typing. The reader never asks for anything.</p>
    <ol>
      <li>Turn the reader on. It shows <b>Set up with your phone</b> and a Wi-Fi called <b>Kimono Read-…</b>.</li>
      <li>On this phone, join that Wi-Fi (scan the reader&apos;s QR code, or pick it in Wi-Fi settings). If a sign-in sheet opens, close it.</li>
      <li>Come back here and tap <b>Continue on the reader</b>. Pick your home Wi-Fi and type its password. The reader joins it, pairs itself with your Kimono and shows your shelf.</li>
    </ol>
    <a className="go" href={setupUrl}>Continue on the reader</a>
    <p className="note">This link works once, for 20 minutes. Already set up the reader&apos;s Wi-Fi another way? <a href="/read/pair">Pair it with a code</a>.</p>
  </div>;
}

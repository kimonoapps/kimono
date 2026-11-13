import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { homeFor } from "@/lib/books";
import { booksConfig, booksIdentity } from "@/lib/books/config";
import { getPlatformSettings } from "@/lib/settings";
import { BooksEntry, BooksOff } from "./books-entry";
import type { Home } from "./api";
import "./books.css";

/* Home comes with the page when it's ready in time (it usually is: its shelves are kept for hours); if not, the browser asks for it. */
const inTime = <T,>(work: Promise<T>, ms: number) => Promise.race([work.catch(() => null), new Promise<null>((done) => setTimeout(() => done(null), ms))]);

export const metadata: Metadata = { title: { absolute: "Kimono Books" } };

/** Kimono Books on the web: find books, keep your shelf, keep your place. */
export default async function BooksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const settings = await getPlatformSettings();
  const admin = session.user.role === "owner" || session.user.role === "admin";
  const enabled = booksConfig(settings).enabled;
  if (!enabled && admin) redirect("/admin/apps/kimono-books");
  const [app, home] = await Promise.all([booksIdentity(settings), enabled ? inTime(homeFor(session.user.username), 1500) : null]);
  const firstName = (session.user.name?.trim() || session.user.username).split(/\s+/)[0];
  return <AppShell user={session.user} brandColors={settings.brand.colors} app={app}>
    {enabled ? <BooksEntry accent={app.accent} firstName={firstName} home={home as Home | null} /> : <BooksOff />}
  </AppShell>;
}

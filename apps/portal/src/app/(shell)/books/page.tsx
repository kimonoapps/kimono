import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { booksConfig, booksIdentity } from "@/lib/books/config";
import { getPlatformSettings } from "@/lib/settings";
import { BooksEntry, BooksOff } from "./books-entry";
import "./books.css";

export const metadata: Metadata = { title: { absolute: "Kimono Books" } };

/** Kimono Books on the web: find books, keep your shelf, keep your place. */
export default async function BooksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const settings = await getPlatformSettings();
  const admin = session.user.role === "owner" || session.user.role === "admin";
  const enabled = booksConfig(settings).enabled;
  if (!enabled && admin) redirect("/admin/apps/kimono-books");
  const app = await booksIdentity(settings);
  const firstName = (session.user.name?.trim() || session.user.username).split(/\s+/)[0];
  return <AppShell user={session.user} brandColors={settings.brand.colors} app={app}>
    {enabled ? <BooksEntry accent={app.accent} firstName={firstName} /> : <BooksOff />}
  </AppShell>;
}

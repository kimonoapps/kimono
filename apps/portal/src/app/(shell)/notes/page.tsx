import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { driveConfig } from "@/lib/drive/config";
import { notesConfig, notesIdentity } from "@/lib/notes/config";
import { getPlatformSettings } from "@/lib/settings";
import { NotesApp, NotesOff } from "./notes-app";
import "./notes.css";

export const metadata = { title: "Kimono Notes" };

/** Kimono Notes on the web: notebooks of notes, kept in Drive. */
export default async function NotesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const settings = await getPlatformSettings();
  const admin = session.user.role === "owner" || session.user.role === "admin";
  if (!notesConfig(settings).enabled && admin) redirect("/admin/apps/kimono-notes");
  const app = await notesIdentity(settings);
  return <AppShell user={session.user} brandColors={settings.brand.colors} app={app}>
    {notesConfig(settings).enabled
      ? <Suspense><NotesApp me={session.user.username} publicLinks={driveConfig(settings).publicLinks} /></Suspense>
      : <NotesOff />}
  </AppShell>;
}

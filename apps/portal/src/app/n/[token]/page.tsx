import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { accentRamp, AppBloom } from "@kimono/ui";
import { db, DriveProblem, publicFile, publicFolder } from "@/lib/drive";
import { driveConfig } from "@/lib/drive/config";
import { isNoteName, textOf, titleOf } from "@/lib/notes";
import { notesConfig, notesIdentity } from "@/lib/notes/config";
import { getPlatformSettings } from "@/lib/settings";
import { PublicReader, type PublicNote } from "./reader";
import "@/components/file-preview/file-preview.css";
import "./public.css";

type Props = { params: Promise<{ token: string }> };
type Shown = { kind: "note"; note: PublicNote } | { kind: "notebook"; name: string; sections: { id: string; parentId: string | null; name: string }[]; notes: PublicNote[] };

/** Whether public links open anything: Notes on, and the admin's switch for public links on. */
async function linksOn() {
  const settings = await getPlatformSettings();
  return notesConfig(settings).enabled && driveConfig(settings).publicLinks ? settings : null;
}

/* What the link opens, the same as /api/v1/notes/public/:token: a note, or a notebook and every note in it. */
async function shown(token: string): Promise<Shown | null> {
  try {
    const file = publicFile(db(), token);
    if (file) return isNoteName(file.name) ? { kind: "note", note: { id: file.id, parentId: null, title: titleOf(file.name), text: await textOf(file.blob), updatedAt: file.updatedAt } } : null;
    const folder = publicFolder(db(), token);
    if (!folder) return null;
    const top = (id: string) => id === folder.folder.id ? null : id;
    const notes = await Promise.all(folder.nodes.filter((n) => n.kind === "file" && isNoteName(n.name))
      .map(async (n) => ({ id: n.id, parentId: top(n.parentId), title: titleOf(n.name), text: await textOf(n.blob), updatedAt: n.updatedAt })));
    return {
      kind: "notebook", name: folder.folder.name,
      sections: folder.nodes.filter((n) => n.kind === "folder").map((n) => ({ id: n.id, parentId: top(n.parentId), name: n.name })).sort((a, b) => a.name.localeCompare(b.name)),
      notes: notes.sort((a, b) => b.updatedAt - a.updatedAt),
    };
  } catch (error) {
    if (error instanceof DriveProblem) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const what = (await linksOn()) ? await shown((await params).token) : null;
  return { title: what ? (what.kind === "note" ? what.note.title : what.name) : "Link", robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** A note or notebook opened by its public link: read-only, typeset, and nothing about who wrote it or where it lives. */
export default async function PublicNotePage({ params }: Props) {
  const settings = await linksOn();
  if (!settings) notFound();
  const what = await shown((await params).token);
  const app = await notesIdentity(settings);
  const ramp = accentRamp(app.accent);
  const palette = { "--k-app-accent": ramp.deep, "--k-accent": ramp.deep, "--k-accent-pale": ramp.tint } as CSSProperties;
  return <div className="np" style={palette}>
    <main className="np-main">
      {what ? <PublicReader title={what.kind === "notebook" ? what.name : null} sections={what.kind === "notebook" ? what.sections : []} notes={what.kind === "notebook" ? what.notes : [what.note]} />
        : <p className="np-gone">This link doesn&apos;t work any more.</p>}
    </main>
    <footer className="np-foot"><AppBloom identity={app} size="mark" /></footer>
  </div>;
}

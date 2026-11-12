import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { Crossing } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import { db } from "@/lib/code";
import { codeConfig } from "@/lib/code/config";
import { bankEntry } from "@/lib/code/feedback";
import { getPlatformSettings } from "@/lib/settings";
import { KeptChat, KeptTakes } from "../../../code/link-views";
import "../../../code/code.css";
import "../feedback.css";
import { Triage } from "./reply";
import { DownloadEntry } from "../download-entry";

export const metadata = { title: "Kimono AI feedback · Admin" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ ref: string }> };

/*
 * One entry of the feedback bank in Kimono AI's own chat, to read, as it was
 * kept: a thumb, the chat up to the rated answer; a report, the chat as it was
 * sent. Nothing said in the chat after that reaches an administrator.
 */
export default async function FeedbackChatPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["owner", "admin"].includes(session.user.role)) redirect("/");
  const settings = await getPlatformSettings();
  if (!codeConfig(settings).enabled) notFound();
  const found = bankEntry(db(), (await params).ref);
  if (!found) notFound();
  const entry = found;
  if (entry.type === "pick") {
    const labels: [string, string] = ({ depth: ["Straight away", "Thought through"], voice: ["Silent", "Narrated"], length: ["Short", "Fuller"] } as Record<string, [string, string]>)[entry.kind] ?? ["First", "Second"];
    return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
      <div className="page admin-page fb-page fb-chat-page">
        <div className="topbar">
          <Crossing kind="kakejiku" className="back" href="/admin/feedback" aria-label="Back to feedback"><LineIcon name="back" /></Crossing>
          <span><h1>Two takes</h1><p className="sub">Kept {labels[entry.kept].toLowerCase()} over {labels[entry.kept === 0 ? 1 : 0].toLowerCase()}. Only the artifacts are kept; nothing anyone said.</p></span>
          <span className="fb-chat-acts">
            {entry.version ? <small>Kimono {entry.version}</small> : null}
            <DownloadEntry entry={entry} />
          </span>
        </div>
        <KeptTakes takes={entry.takes} kept={entry.kept} labels={labels} />
      </div>
    </AppShell>;
  }
  const kept = entry.type === "rating" ? [...entry.before, entry.answer] : entry.chat;
  const title = entry.type === "rating" ? (entry.rating === 1 ? "Thumbs up" : "Thumbs down") : "Reported chat";
  const words = (entry.type === "rating" ? entry.note : entry.reason).trim();

  return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
    <div className="page admin-page fb-page fb-chat-page">
      <div className="topbar">
        <Crossing kind="kakejiku" className="back" href="/admin/feedback" aria-label="Back to feedback"><LineIcon name="back" /></Crossing>
        <span><h1>{title}</h1>{words ? <p className="sub">“{words}”</p> : null}</span>
        <span className="fb-chat-acts">
          {entry.version || entry.sandboxVersion ? <small>Kimono {entry.version ?? "unknown"} · Sandbox {entry.sandboxVersion ?? "unknown"}</small> : null}
          <DownloadEntry entry={entry} />
        </span>
      </div>
      {entry.ref ? <Triage entryRef={entry.ref} canReply={entry.type === "rating"} reply={entry.type === "rating" ? entry.reply : undefined} status={entry.status} /> : null}
      <KeptChat title={kept[0]?.asked.trim().split("\n")[0]?.slice(0, 80) || title} at={entry.at} chat={kept} />
    </div>
  </AppShell>;
}

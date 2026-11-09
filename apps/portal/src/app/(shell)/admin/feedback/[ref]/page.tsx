import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { Crossing } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import { db, peekToken } from "@/lib/code";
import { codeConfig } from "@/lib/code/config";
import { bankEntry } from "@/lib/code/feedback";
import { getPlatformSettings } from "@/lib/settings";
import { KeptChat, PeekChat } from "../../../code/link-views";
import "../../../code/code.css";
import "../feedback.css";

export const metadata = { title: "Kimono AI feedback · Admin" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ ref: string }> };

/*
 * One entry of the feedback bank in Kimono AI's own chat, to read: a thumb
 * opens the chat it was given in, up to the rated answer; a report, the chat
 * as it was sent.
 */
export default async function FeedbackChatPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["owner", "admin"].includes(session.user.role)) redirect("/");
  const settings = await getPlatformSettings();
  if (!codeConfig(settings).enabled) notFound();
  const found = bankEntry(db(), (await params).ref);
  if (!found) notFound();
  const { entry, chat } = found;
  const title = entry.type === "rating" ? (entry.rating === 1 ? "Thumbs up" : "Thumbs down") : "Reported chat";
  const words = (entry.type === "rating" ? entry.note : entry.reason).trim();

  return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
    <div className="page admin-page fb-page fb-chat-page">
      <div className="topbar">
        <Crossing kind="kakejiku" className="back" href="/admin/feedback" aria-label="Back to feedback"><LineIcon name="back" /></Crossing>
        <span><h1>{title}</h1>{words ? <p className="sub">“{words}”</p> : null}</span>
      </div>
      {chat
        ? <PeekChat token={peekToken(chat.id, session.user.username)} id={chat.id} upTo={chat.upTo} />
        : entry.type === "report" ? <KeptChat title={entry.chat[0]?.asked.trim().split("\n")[0]?.slice(0, 80) || "Reported chat"} at={entry.at} chat={entry.chat} /> : null}
    </div>
  </AppShell>;
}

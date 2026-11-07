import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CrossingSeal } from "@/components/crossing";
import { auth } from "@/auth";
import { chatOfLink, db } from "@/lib/code";
import { codeConfig, codeIdentity } from "@/lib/code/config";
import { listAccounts } from "@/lib/directory";
import { getPlatformSettings } from "@/lib/settings";
import { GuestChat, JoinChat } from "../../../(shell)/code/link-views";
import { LinkFrame, LinkNote } from "../../_link/link-frame";

type Props = { params: Promise<{ token: string }> };

function chatFor(token: string) {
  const link = chatOfLink(db(), token);
  if (!link) return null;
  const row = db().prepare("SELECT owner, title FROM workspaces WHERE id = ?").get(link.workspaceId) as { owner: string; title: string } | undefined;
  return row ? { id: link.workspaceId, access: link.access, owner: row.owner, title: row.title } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const chat = chatFor((await params).token);
  /* The title is the chat's own words: only for whoever the link would open for. */
  const shown = chat && (Boolean((await auth())?.user) || codeConfig(await getPlatformSettings()).publicLinks);
  return { title: shown ? chat.title : "Link", robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/**
 * A chat opened by its link. Someone signed in keeps it (it joins the chats
 * shared with them) and goes on in their own Kimono AI; anyone else reads it
 * here, and is offered to sign in when the link lets people write.
 */
export default async function SharedChatPage({ params }: Props) {
  const settings = await getPlatformSettings();
  if (!codeConfig(settings).enabled) notFound();
  const { token } = await params;
  const app = await codeIdentity(settings);
  const chat = chatFor(token);
  if (!chat) return <LinkFrame app={app}><LinkNote>This link doesn&rsquo;t work any more.</LinkNote></LinkFrame>;
  const session = await auth();
  if (session?.user) return <LinkFrame app={app}><JoinChat token={token} /></LinkFrame>;
  /* Only the owner's name: nothing else about who is in the house. */
  const ownerName = (await listAccounts().catch(() => [])).find((a) => a.username.toLowerCase() === chat.owner)?.name || chat.owner;
  const signIn = chat.access === "edit" ? <CrossingSeal tone="quiet" href={`/login?callbackUrl=${encodeURIComponent(`/ai/c/${token}`)}`}>Sign in to write</CrossingSeal> : null;
  return <LinkFrame app={app} actions={signIn}><GuestChat token={token} id={chat.id} owner={chat.owner} ownerName={ownerName} /></LinkFrame>;
}

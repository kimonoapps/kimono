import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CrossingSeal } from "@/components/crossing";
import { auth } from "@/auth";
import { artifactByLink, CodeProblem, db } from "@/lib/code";
import { codeConfig, codeIdentity } from "@/lib/code/config";
import { getPlatformSettings } from "@/lib/settings";
import { ArtifactAlone } from "../../../(shell)/code/link-views";
import { LinkFrame, LinkNote } from "../../_link/link-frame";

type Props = { params: Promise<{ token: string }> };

/** The artifact a link opens for whoever is looking, or why it doesn't: they need to sign in (401), or it isn't theirs to see (404). */
async function opened(token: string) {
  const session = await auth();
  try {
    /* With public links switched off, a link opens only for someone signed in, as the API's do. */
    if (!session?.user && !codeConfig(await getPlatformSettings()).publicLinks) throw new CodeProblem("Sign in to open this artifact.", 401);
    return { artifact: artifactByLink(db(), token, session?.user?.username || null) };
  } catch (error) {
    if (error instanceof CodeProblem) return { problem: error.message, status: error.status, signedIn: Boolean(session?.user) };
    throw error;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await opened((await params).token);
  return { title: "artifact" in found && found.artifact ? found.artifact.title : "Link", robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** An artifact opened by its link: the page alone, as big as the window, in the sandboxed frame Kimono AI draws it in. */
export default async function SharedArtifactPage({ params }: Props) {
  const settings = await getPlatformSettings();
  if (!codeConfig(settings).enabled) notFound();
  const { token } = await params;
  const found = await opened(token);
  const app = await codeIdentity(settings);
  if ("artifact" in found && found.artifact) return <LinkFrame app={app}><ArtifactAlone title={found.artifact.title} content={found.artifact.content} media={found.artifact.media} /></LinkFrame>;
  const signIn = found.status === 401 && !found.signedIn;
  return <LinkFrame app={app}>
    {signIn
      ? <LinkNote action={<CrossingSeal href={`/login?callbackUrl=${encodeURIComponent(`/ai/a/${token}`)}`}>Sign in</CrossingSeal>}>Sign in to open this.</LinkNote>
      : <LinkNote>{found.status === 404 && found.problem !== "This link doesn't work any more." ? found.problem : "This link doesn’t work any more."}</LinkNote>}
  </LinkFrame>;
}

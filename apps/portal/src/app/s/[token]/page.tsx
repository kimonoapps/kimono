import type { CSSProperties } from "react";
import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { accentRamp, AppLockup } from "@kimono/ui";
import { crestSvg } from "@kimono/ui/crest";
import { db, DriveProblem, linkedSpace } from "@/lib/drive";
import { driveConfig, driveIdentity } from "@/lib/drive/config";
import { getPlatformSettings } from "@/lib/settings";
import { GuestDrive } from "../../(shell)/drive/drive-app";
import "../../(shell)/drive/drive.css";

type Props = { params: Promise<{ token: string }> };

/** Whether links open anything at all: Drive on, and public links allowed. */
async function linksOn() {
  const settings = await getPlatformSettings();
  const config = driveConfig(settings);
  return config.enabled && config.publicLinks ? settings : null;
}

function spaceFor(token: string) {
  try {
    return linkedSpace(db(), token);
  } catch (error) {
    if (error instanceof DriveProblem) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const on = await linksOn();
  const space = on ? spaceFor((await params).token) : null;
  return { title: space ? space.name : "Link", robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** A space opened by its link: the Drive sheet, with no sign-in and nothing about who is in it. */
export default async function SharedSpacePage({ params }: Props) {
  const settings = await linksOn();
  if (!settings) notFound();
  const { token } = await params;
  const space = spaceFor(token);
  const app = await driveIdentity(settings);
  const ramp = accentRamp(app.accent);
  const palette = {
    "--k-app-accent": ramp.deep,
    "--k-accent": ramp.deep,
    "--k-accent-deep": `color-mix(in srgb, ${ramp.deep} 82%, #24221f)`,
    "--k-accent-pale": ramp.tint,
  } as CSSProperties;
  /* No rail here: someone opening a link isn't in the house. Drive's name sits
     in a slim bar above the sheet, both on one centred column. */
  return <div className="app-frame in-app share-frame" style={palette}>
    <header className="share-bar"><AppLockup identity={app} /></header>
    <main className="share-main">
      {space ? <Suspense>
        <GuestDrive token={token} space={space} mark={crestSvg(space.crest, space.color)} />
      </Suspense> : <div className="dv"><div className="dv-body solo"><section className="dv-sheet"><div className="dv-empty">
        <h3>This link doesn&apos;t work any more.</h3>
      </div></section></div></div>}
    </main>
  </div>;
}

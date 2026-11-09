import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { Crossing } from "@/components/crossing";
import { LineIcon } from "@/components/line-icon";
import { db } from "@/lib/code";
import { codeConfig } from "@/lib/code/config";
import { bank, type BankEntry } from "@/lib/code/feedback";
import { getPlatformSettings } from "@/lib/settings";
import { FeedbackExplorer } from "./feedback-explorer";
import "../../code/code.css";
import "./feedback.css";

export const metadata = { title: "Kimono AI feedback · Admin" };
export const dynamic = "force-dynamic";

/*
 * The feedback bank to read, not to download: every thumb and report, newest
 * first, each answer laid out the way the chat showed it. The JSONL export
 * stays a link away, for handing the lot to an AI.
 */
export default async function FeedbackPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["owner", "admin"].includes(session.user.role)) redirect("/");
  const settings = await getPlatformSettings();
  let entries: BankEntry[] = [];
  if (codeConfig(settings).enabled) {
    try { entries = bank(db(), 0, true).reverse(); } catch { entries = []; }
  }

  return <AppShell user={session.user} brandColors={settings.brand.colors} active="admin">
    <div className="page admin-page fb-page">
      <div className="topbar">
        <Crossing kind="kakejiku" className="back" href="/admin" aria-label="Back to Admin"><LineIcon name="back" /></Crossing>
        <span><h1>Kimono AI feedback</h1><p className="sub">Thumbs and reports on its answers, without names.</p></span>
        {/* eslint-disable-next-line no-restricted-syntax -- a file download, not a page change. */}
        <a className="k-seal k-tone-quiet fb-export" href="/api/v1/code/feedback?format=jsonl" download><LineIcon name="download" />JSONL</a>
      </div>
      <FeedbackExplorer entries={entries} />
    </div>
  </AppShell>;
}

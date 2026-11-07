/* The few fields a card reads, in the shapes of lib/code/events.ts (and the page's copy in code/api.ts). */
type CardTool = {
  progress?: { label?: string; done?: boolean; status?: string; percent?: number; left?: number; at: number };
  probe?: { state: "running" | "done" | "failed"; status?: string; percent?: number; left?: number; watched?: boolean };
};

/**
 * How a long job's card stands, for the web and (in the same words) the phone: the job's own word as Kimono
 * read it from the sandbox (`probe` on the start), else what the agent last reported with --status. No guess
 * from the clock: `percent` is there only when the job or its tool gave one.
 */
export function cardOf(tools: CardTool[], live: boolean) {
  const start = [...tools].reverse().find((t) => t.progress?.label)!;
  const begun = start.progress!.at;
  const later = tools.filter((t) => t.progress && t.progress.at >= begun);
  const said = [...later].reverse().find((t) => t.progress?.status)?.progress;
  const probe = start.probe;
  const state = probe?.state ?? (later.some((t) => t.progress?.done) ? "done" : "running");
  /* Ended without word that it was done, and nothing in the sandbox follows it on. */
  const stopped = state === "running" && !live && !probe?.watched;
  const status = probe?.status ?? said?.status;
  const percent = state === "done" ? 100 : probe?.percent ?? said?.percent;
  const left = state !== "running" ? undefined : probe ? probe.left : said?.left;
  return { label: start.progress!.label!, state, stopped, status, percent, left };
}

export const leftWords = (seconds: number) => seconds < 10 ? "almost done" : seconds < 90 ? `about ${Math.round(seconds / 5) * 5} s left` : `about ${Math.round(seconds / 60)} min left`;

/** The card's line under its title: where it stands, in a few words. */
export function cardWords(card: ReturnType<typeof cardOf>, failedSteps = 0): string {
  const words = card.state === "done" ? ["Done", card.status && card.status !== "Finished" ? card.status : null]
    : card.state === "failed" ? ["Didn't finish", card.status]
    : card.stopped ? ["Stopped", card.percent != null ? `at ${Math.round(card.percent)}%` : null]
    : [card.status, card.percent != null ? `${Math.round(card.percent)}%` : null, card.left != null ? leftWords(card.left) : null];
  return [...words, failedSteps ? `${failedSteps} step${failedSteps === 1 ? "" : "s"} failed` : null].filter(Boolean).join(" · ") || "Working on it";
}

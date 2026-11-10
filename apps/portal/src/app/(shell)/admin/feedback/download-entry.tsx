"use client";

import { LineIcon } from "@/components/line-icon";
import type { BankEntry } from "@/lib/code/feedback";

/** One entry as its own JSON file, in the shape the JSONL export gives each line. */
export function DownloadEntry({ entry }: { entry: BankEntry }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...entry, ref: undefined }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `kimono-ai-${entry.type}-${new Date(entry.at).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <button type="button" className="k-seal k-tone-quiet fb-download" onClick={download}><LineIcon name="download" />Download</button>;
}

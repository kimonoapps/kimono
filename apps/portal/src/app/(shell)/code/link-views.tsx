"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { InkBlot, MorphLoader } from "@kimono/ui";
import { useCrossTo } from "@/components/crossing";
import { code } from "./api";
import { ArtifactFrame, SceneBar, type SceneControl, type SceneState } from "./artifact-frame";
import { Icon } from "./icons";

/*
 * What a link opens for someone who isn't reading the chat here: an artifact on
 * its own page, or (signed in) the hop into their own Kimono AI. Kept apart from
 * code-app.tsx so these pages don't load all of Kimono AI.
 */

const problemText = (error: unknown, fallback = "That didn't work.") => error instanceof Error ? error.message : fallback;

/** Someone signed in opened a chat's link: it joins their shared chats, and opens in their Kimono AI. */
export function JoinChat({ token }: { token: string }) {
  const [problem, setProblem] = useState<string | null>(null);
  const crossTo = useCrossTo();
  useEffect(() => {
    code.join(token).then((w) => crossTo("kakejiku", `/code#w=${encodeURIComponent(w.id)}`), (error) => setProblem(problemText(error)));
  }, [token, crossTo]);
  return <div className="cd cd-guest"><div className="cd-sheet cd-empty cd-link-note">{problem ? <p>{problem}</p> : <MorphLoader label="Opening" className="cd-artifact-loading" />}</div></div>;
}

/** An artifact opened by its link: the page, as big as the window, in the same sandboxed frame. */
export function ArtifactAlone({ title, content, media }: { title: string; content: string; media?: string }) {
  const [scene, setScene] = useState<SceneState | null>(null);
  const [control, setControl] = useState<SceneControl | null>(null);
  const send = (action: SceneControl["action"], t?: number, name?: string, value?: number) => setControl((c) => ({ n: (c?.n ?? 0) + 1, action, t, name, value }));
  /* as tall as its page, up to the window: a short artifact doesn't leave a tall empty card */
  const [height, setHeight] = useState<number | null>(null);
  return <div className="cd cd-guest cd-artifact-alone">
    <figure className="cd-artifact is-full">
      <figcaption className="cd-artifact-head">
        <InkBlot className="cd-artifact-mark" tint="#a84d63" seed={title}><Icon name="spark" /></InkBlot>
        <span className="cd-artifact-name"><b title={title}>{title}</b><small>{/<k-scene\b/i.test(content) ? "Animation" : "Artifact"}</small></span>
      </figcaption>
      <div className="cd-artifact-body" style={height ? { height } : undefined}><ArtifactFrame content={content} final title={title} media={media} control={control} onHeight={setHeight} onScene={setScene} /></div>
      {scene && scene.end > 0 ? <SceneBar scene={scene} send={send} /> : null}
    </figure>
  </div>;
}

/** A chat read by someone not signed in. Its reader is the whole of Kimono AI's chat, so it's fetched only for them. */
export const GuestChat = dynamic(() => import("./code-app").then((m) => m.GuestChat), {
  loading: () => <div className="cd cd-guest"><div className="cd-sheet cd-empty cd-link-note"><MorphLoader label="Opening" className="cd-artifact-loading" /></div></div>,
});

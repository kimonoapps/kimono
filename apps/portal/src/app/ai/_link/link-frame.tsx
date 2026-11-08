import type { CSSProperties, ReactNode } from "react";
import { accentRamp, AppLockup, type AppIdentity } from "@kimono/ui";
import "../../(shell)/code/code.css";

/*
 * A Kimono AI share link's page, framed as Drive's are (app/s/[token]): no
 * rail, since someone opening a link isn't in the house; Kimono AI's name in
 * a slim bar above, and what the link opens below it.
 */
export function LinkFrame({ app, actions, children }: { app: AppIdentity; actions?: ReactNode; children: ReactNode }) {
  const ramp = accentRamp(app.accent);
  const palette = {
    "--k-app-accent": ramp.deep,
    "--k-app-tint": ramp.tint,
  } as CSSProperties;
  return <div className="app-frame in-app ai-share" style={palette}>
    <header className="ai-share-bar"><AppLockup identity={app} />{actions ? <span className="ai-share-acts">{actions}</span> : null}</header>
    <main className="ai-share-main">{children}</main>
  </div>;
}

/** What a link says when it opens nothing: a line, and maybe a way in. */
export function LinkNote({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="cd cd-guest"><div className="cd-sheet cd-empty cd-link-note"><p>{children}</p>{action}</div></div>;
}

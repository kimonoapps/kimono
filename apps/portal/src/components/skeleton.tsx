/*
 * Skeletons: the shape of what's coming, shimmering. They stay invisible for
 * the first third of a second, so a quick load shows nothing at all and only a
 * slow one shows them (ADR 0006).
 */

/** Rows of a list: a mark, a name and a short line under it. */
export function SkeletonRows({ rows = 5, mark = true, className }: { rows?: number; mark?: boolean; className?: string }) {
  return <div className={`skel-wait skel-rows${className ? ` ${className}` : ""}`} aria-busy="true" aria-label="Loading">
    {Array.from({ length: rows }, (_, index) => <div className="skel-row" key={index}>
      {mark ? <i className="skel skel-mark" /> : null}
      <span><i className="skel" style={{ width: `${[58, 42, 66, 36, 50, 61][index % 6]}%` }} /><i className="skel skel-small" style={{ width: `${[28, 22, 34, 18, 26][index % 5]}%` }} /></span>
    </div>)}
  </div>;
}

/** A whole page: a title, a line under it, and a list. */
export function SkeletonPage() {
  return <div className="page skel-wait skel-page" aria-busy="true" aria-label="Loading">
    <i className="skel skel-title" />
    <i className="skel skel-line" />
    <div className="skel-cards"><i className="skel skel-card" /><i className="skel skel-card" /><i className="skel skel-card" /></div>
    <SkeletonRows rows={4} />
  </div>;
}

/** A conversation: your message on the right, the reply on the left. */
export function SkeletonChat() {
  return <div className="skel-wait skel-chat" aria-busy="true" aria-label="Loading">
    <i className="skel skel-bubble" />
    <i className="skel" style={{ width: "82%" }} />
    <i className="skel" style={{ width: "64%" }} />
    <i className="skel skel-pill" />
    <i className="skel" style={{ width: "74%" }} />
  </div>;
}

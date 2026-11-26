"use client";

import { useState, type CSSProperties } from "react";
import { initialOf } from "@kimono/account";

/** Each person's own colour, the same everywhere: behind their initial when `tint` is asked for. */
const tints = ["#7E3448", "#3E5236", "#5B3F45", "#8A5A2B", "#3F4A5B", "#5A4A2B"];
export const tintOf = (username: string) => tints[[...username].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % tints.length];

/**
 * 肖 A person: their picture, or the first letter of their name in ink on
 * paper when they have none (or it won't load). The letter is drawn by Kimono
 * rather than taken from the identity provider's generated image, so it
 * matches everything else. `tint` sets the letter on the person's own colour
 * instead, for places with many faces at once (Watch, a party, a shelf).
 */
export function Portrait({ name, username, picture, size = 34, tint = false, title, className }: {
  name?: string | null;
  username?: string | null;
  picture?: string | null;
  size?: number;
  tint?: boolean;
  title?: string;
  className?: string;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const style = { "--portrait-size": `${size}px` } as CSSProperties;
  const label = name?.trim() || username || "Someone";
  const classes = (...more: (string | false)[]) => ["portrait", ...more, className].filter(Boolean).join(" ");
  return picture && broken !== picture
    // eslint-disable-next-line @next/next/no-img-element -- a 512px square served by the Portal itself
    ? <img className={classes(false)} style={style} src={picture} alt={label} title={title} data-name={label} width={size} height={size} onError={() => setBroken(picture)} />
    : <span className={classes("portrait-initial", tint && "portrait-tint")} style={tint ? { ...style, background: tintOf(username || label) } : style} role="img" aria-label={label} title={title} data-name={label}>{initialOf(name, username)}</span>;
}

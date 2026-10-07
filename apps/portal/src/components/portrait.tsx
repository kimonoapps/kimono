import type { CSSProperties } from "react";
import { initialOf } from "@/lib/account-input";

/**
 * 肖 A person: their picture, or the first letter of their name in ink on
 * paper when they have none. The letter is drawn by Kimono rather than taken
 * from the identity provider's generated image, so it matches everything else.
 */
export function Portrait({ name, username, picture, size = 34, className }: {
  name?: string | null;
  username?: string | null;
  picture?: string | null;
  size?: number;
  className?: string;
}) {
  const style = { "--portrait-size": `${size}px` } as CSSProperties;
  const label = name?.trim() || username || "Someone";
  return picture
    // eslint-disable-next-line @next/next/no-img-element -- a 512px square served by the Portal itself
    ? <img className={["portrait", className].filter(Boolean).join(" ")} style={style} src={picture} alt={label} width={size} height={size} />
    : <span className={["portrait portrait-initial", className].filter(Boolean).join(" ")} style={style} role="img" aria-label={label}>{initialOf(name, username)}</span>;
}

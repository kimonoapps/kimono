import "server-only";

import { crestSvg } from "@kimono/ui/crest";

/** A space with its crest drawn, so the phone apps show it rather than draw it. */
export function withMark<T extends { crest: string; color: string }>(space: T): T & { mark: string } {
  return { ...space, mark: crestSvg(space.crest, space.color) };
}

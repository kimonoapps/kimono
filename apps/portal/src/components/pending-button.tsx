"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Seal, type SealTone } from "@kimono/ui";

/*
 * A form's submit button that shows it's working while the server action
 * runs: disabled, marked busy, and saying what it's doing. As a Seal, or as
 * a plain text button (className "txt").
 */
export function PendingButton({ children, pending: pendingLabel, seal, tone, compact, ...props }: { children: ReactNode; pending: string; seal?: boolean; tone?: SealTone; compact?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  const { pending } = useFormStatus();
  if (seal) return <Seal type="submit" busy={pending} tone={tone} compact={compact} {...props}>{pending ? pendingLabel : children}</Seal>;
  return <button type="submit" disabled={pending} aria-busy={pending || undefined} {...props}>{pending ? pendingLabel : children}</button>;
}

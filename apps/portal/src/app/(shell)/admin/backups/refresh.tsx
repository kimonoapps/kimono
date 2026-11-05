"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export function BackupRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible" && !document.querySelector("form:focus-within")) router.refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}

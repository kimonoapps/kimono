import type { Metadata } from "next";
import { appIcons } from "@/lib/app-favicon";

/* Kimono Tools's own tab icon, on every page of it (app/app-icon/[app]/[file]/route.ts). */
export const metadata: Metadata = { icons: appIcons("tools") };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

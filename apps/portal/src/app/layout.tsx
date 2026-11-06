import { CrossingProvider } from "@/components/crossing";
import { InkIconDefs } from "@/components/line-icon";
import { NameTips } from "@/components/name-tips";
import type { Metadata } from "next";
import "@kimono/ui/kata.css";
import "./globals.css";
import "./shell.css";
import "./m3.css";

export const metadata: Metadata = {
  title: {
    default: "Kimono",
    template: "%s · Kimono",
  },
  description: "A private home for your household's apps and shared services.",
  icons: {
    icon: [
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/brand/favicon.ico",
    apple: "/brand/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      {/* Browser extensions (ColorZilla, password managers) add attributes to <body> before React loads; only <body>'s own attributes are let off, nothing inside it. */}
      <body suppressHydrationWarning><InkIconDefs /><CrossingProvider>{children}</CrossingProvider><NameTips /></body>
    </html>
  );
}

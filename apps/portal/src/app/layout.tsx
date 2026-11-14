import { CrossingProvider } from "@/components/crossing";
import { InkIconDefs } from "@/components/line-icon";
import { NameTips } from "@/components/name-tips";
import { appearanceScript } from "@/components/appearance";
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
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
      { url: "/brand/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/brand/favicon.ico",
    apple: { url: "/brand/apple-touch-icon.png", sizes: "180x180" },
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    /* The page's light or dark is set on <html> by the script before it paints (see components/appearance.tsx). */
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: appearanceScript }} /></head>
      {/* Browser extensions (ColorZilla, password managers) add attributes to <body> before React loads; only <body>'s own attributes are let off, nothing inside it. */}
      <body suppressHydrationWarning><InkIconDefs /><CrossingProvider>{children}</CrossingProvider><NameTips /></body>
    </html>
  );
}

import { CrossingProvider } from "@/components/crossing";
import { InkIconDefs } from "@/components/line-icon";
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
      <body><InkIconDefs /><CrossingProvider>{children}</CrossingProvider></body>
    </html>
  );
}

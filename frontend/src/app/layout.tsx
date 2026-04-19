import type { Metadata } from "next";
import Link from "next/link";
import { CommandPalette } from "@/components/CommandPalette";
import { NavLinks } from "@/components/NavLinks";
import { StarMark } from "@/components/StarMark";
import "./globals.css";

export const metadata: Metadata = {
  title: "NorthStar — IT Operational Command System",
  description: "Queryable knowledge graph of IT architecture assets.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Geist:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Skip link — WCAG 2.4.1. Lives here, NOT per-page, per DESIGN.md
            App Detail Redesign Extensions. First tab stop for keyboard users. */}
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <header className="nav">
          <div className="nav-inner">
            <Link href="/" className="brand">
              <span className="star" aria-hidden="true">
                <StarMark size={18} />
              </span>
              <span>NorthStar</span>
            </Link>
            <NavLinks />
          </div>
        </header>
        <main id="main-content" className="main">
          {children}
        </main>
        <CommandPalette />
      </body>
    </html>
  );
}

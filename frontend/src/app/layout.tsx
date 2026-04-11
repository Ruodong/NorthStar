import type { Metadata } from "next";
import Link from "next/link";
import { CommandPalette } from "@/components/CommandPalette";
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
        <header className="nav">
          <div className="nav-inner">
            <Link href="/" className="brand">
              <span className="star" aria-hidden="true">
                <StarMark size={18} />
              </span>
              <span>NorthStar</span>
            </Link>
            <nav>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/graph">Graph</Link>
              <Link href="/whats-new">What&apos;s New</Link>
              <Link href="/ingestion">Ingestion</Link>
              <Link href="/admin">Admin</Link>
            </nav>
          </div>
        </header>
        <main className="main">{children}</main>
        <CommandPalette />
      </body>
    </html>
  );
}

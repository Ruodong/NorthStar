import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "NorthStar",
  description: "IT Operational Command System",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="nav">
          <div className="nav-inner">
            <Link href="/" className="brand">
              ★ NorthStar
            </Link>
            <nav>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/graph">Graph</Link>
              <Link href="/ingestion">Ingestion</Link>
            </nav>
          </div>
        </header>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}

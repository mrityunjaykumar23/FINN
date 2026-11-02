import type { Metadata } from "next";
import "./globals.css";
import "./institutional.css";

export const metadata: Metadata = {
  title: "FINN. — Financial Investment Agent",
  description:
    "Signal over noise. Know what changed, why it matters, and what the evidence says. Primary-source intelligence for Indian public markets.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preload"
          href="/fonts/geist-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}

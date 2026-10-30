import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FINN — Investment Intelligence",
  description:
    "Less noise. More perspective. Primary-source investment intelligence for Indian public markets.",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}

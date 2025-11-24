import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Funeral Home Training Platform",
  description: "Practice conversations with grieving family members",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}


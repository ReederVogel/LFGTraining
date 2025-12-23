import type { Metadata, Viewport } from "next";
import "./globals.css";
// Validate environment variables in production
import "@/lib/env-validation";

export const metadata: Metadata = {
  title: "Funeral Home Training Platform",
  description: "Practice conversations with grieving family members",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
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


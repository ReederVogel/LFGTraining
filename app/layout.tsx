import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/constants";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: 'swap', // Prevent font loading from blocking render
  fallback: ['system-ui', '-apple-system', 'sans-serif'], // Fallback fonts
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: 'swap', // Prevent font loading from blocking render
  fallback: ['monospace'], // Fallback fonts
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <head>
        {/* DNS Prefetch and Preconnect for minimum latency */}
        <link rel="dns-prefetch" href="https://embed.liveavatar.com" />
        <link rel="preconnect" href="https://embed.liveavatar.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://api.liveavatar.com" />
        <link rel="preconnect" href="https://api.liveavatar.com" crossOrigin="anonymous" />
        {/* Performance hints */}
        <meta httpEquiv="x-dns-prefetch-control" content="on" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-50`}
        suppressHydrationWarning
      >
        <div className="min-h-screen flex flex-col">
          {/* Global app chrome */}
          <header className="border-b border-white/5 bg-slate-950/60 backdrop-blur-xl">
            <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6 lg:px-8">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 shadow-lg shadow-blue-500/40">
                  <span className="text-sm font-semibold text-white">RT</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold tracking-tight text-slate-50">
                    {APP_NAME}
                  </span>
                  <span className="text-xs text-slate-400">
                    Real‑time roleplay with AI avatars
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live session ready
                </span>
                <span className="text-slate-500">
                  Built with LiveAvatar SDK + Deepgram
                </span>
              </div>
            </div>
          </header>

          <main className="flex-1">
            {children}
          </main>

          <footer className="border-t border-white/5 bg-slate-950/80 backdrop-blur-xl">
            <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-4 text-xs text-slate-500 sm:flex-row sm:px-6 lg:px-8">
              <p className="text-center sm:text-left">
                Practice difficult conversations in a safe, repeatable way.
              </p>
              <p className="text-center sm:text-right">
                Audio & video may take a moment to initialize on first run.
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}

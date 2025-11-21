import Button from '@/components/ui/Button';
import { APP_NAME } from '@/lib/constants';
import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-10 sm:py-16">
      <main className="mx-auto flex w-full max-w-5xl flex-col items-center gap-10 text-center sm:gap-12">
        <div className="space-y-6 sm:space-y-7">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1 text-xs font-medium uppercase tracking-[0.2em] text-slate-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live Training Environment
          </p>

          <h1 className="bg-gradient-to-r from-sky-400 via-blue-400 to-indigo-400 bg-clip-text text-4xl font-semibold tracking-tight text-transparent sm:text-5xl md:text-6xl">
            {APP_NAME}
          </h1>
          
          <p className="mx-auto max-w-2xl text-base text-slate-300 sm:text-lg md:text-xl">
            Master high‑stakes conversations with lifelike AI avatars. Practice difficult scenarios,
            get comfortable with uncertainty, and replay moments as often as you need.
          </p>
        </div>

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
          <Button
            href="/select-avatar"
            variant="primary"
            size="lg"
            className="shadow-lg shadow-blue-500/40"
          >
            Begin Training
          </Button>
        </div>

        {/* Prefetch the next page for instant navigation */}
        <Link href="/select-avatar" prefetch={true} className="hidden" aria-hidden="true" />
      </main>
    </div>
  );
}

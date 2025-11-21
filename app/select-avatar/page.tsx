'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { avatars } from '@/lib/avatars';
import dynamic from 'next/dynamic';

// Dynamically import AvatarCard to reduce initial bundle size
const AvatarCard = dynamic(() => import('@/components/AvatarCard'), {
  loading: () => (
    <div className="w-full max-w-md h-96 bg-gray-100 rounded-lg animate-pulse"></div>
  ),
});

export default function SelectAvatarPage() {
  const router = useRouter();

  const handleBack = useCallback(() => {
    router.push('/');
  }, [router]);

  // Memoize avatars to prevent unnecessary re-renders
  const avatarList = useMemo(() => avatars, []);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] justify-center px-4 py-10 pb-16 sm:py-12 sm:px-6 lg:px-8">
      <div className="flex w-full max-w-6xl flex-col space-y-8 sm:space-y-10">
        {/* Back button */}
        <div className="flex items-center justify-between">
          <button
            onClick={handleBack}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 shadow-sm shadow-slate-900/40 transition hover:bg-white/10"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>Back</span>
          </button>
        </div>

        {/* Header */}
        <div className="mx-auto mt-4 w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-slate-950/85 px-5 py-6 text-center shadow-2xl shadow-slate-950/80 sm:mt-6 sm:px-8 sm:py-8">
          <div className="flex flex-col items-center space-y-3 sm:space-y-4">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-slate-200">
              Scenario Library
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">
              Select a conversation to practice
            </h1>
            <p className="mx-auto max-w-3xl text-xs leading-relaxed text-slate-200 sm:text-sm">
              Each avatar represents a different real‑world scenario. Choose one that matches a situation
              you want to get better at handling.
            </p>
          </div>
        </div>

        {/* Avatar Cards Grid */}
        <div className="mx-auto mt-10 grid w-full max-w-5xl grid-cols-1 gap-8 justify-items-center md:mt-12 md:grid-cols-2">
          {avatarList.map((avatar) => (
            <AvatarCard key={avatar.id} avatar={avatar} />
          ))}
        </div>
      </div>
    </div>
  );
}


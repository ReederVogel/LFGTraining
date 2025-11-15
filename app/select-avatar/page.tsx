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
    <div className="min-h-screen py-8 px-4 sm:px-6 lg:px-8 flex flex-col items-center">
      <div className="w-full max-w-6xl">
        {/* Back button */}
        <div className="mb-12">
          <button
            onClick={handleBack}
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span className="font-medium">Back</span>
          </button>
        </div>

        {/* Header */}
        <div className="mb-20 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            Select a Scenario
          </h1>
          <p className="text-lg text-gray-600">
            Choose a training scenario to begin
          </p>
        </div>

        {/* Avatar Cards Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 justify-items-center">
          {avatarList.map((avatar) => (
            <AvatarCard key={avatar.id} avatar={avatar} />
          ))}
        </div>
      </div>
    </div>
  );
}


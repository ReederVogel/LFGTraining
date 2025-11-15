'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useCallback } from 'react';
import { getAvatarById } from '@/lib/avatars';
import dynamic from 'next/dynamic';

// Dynamically import AvatarEmbed to reduce initial bundle size
const AvatarEmbed = dynamic(() => import('@/components/AvatarEmbed'), {
  loading: () => (
    <div className="flex items-center justify-center h-96">
      <div className="text-center">
        <div className="spinner mx-auto mb-4"></div>
        <p className="text-gray-600">Loading avatar...</p>
      </div>
    </div>
  ),
  ssr: false,
});

export default function ConversationPage() {
  const params = useParams();
  const router = useRouter();
  const avatarId = params?.avatarId as string;

  const avatar = useMemo(() => 
    avatarId ? getAvatarById(avatarId) : undefined,
    [avatarId]
  );

  const handleBack = useCallback(() => {
    router.push('/select-avatar');
  }, [router]);

  useEffect(() => {
    if (!avatarId || !avatar) {
      router.push('/select-avatar');
    }
  }, [avatarId, avatar, router]);

  if (!avatar) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="spinner mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4 sm:px-6 lg:px-8 flex flex-col items-center">
      <div className="w-full max-w-4xl">
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
        <div className="mb-12 text-center">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
            {avatar.name}
          </h1>
          <p className="text-sm text-gray-600">Training Session</p>
        </div>

        {/* Avatar Embed */}
        <div>
          <AvatarEmbed avatar={avatar} />
        </div>
      </div>
    </div>
  );
}


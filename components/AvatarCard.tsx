'use client';

import React, { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/types/avatar';
import Card from './ui/Card';

interface AvatarCardProps {
  avatar: Avatar;
}

export default React.memo(function AvatarCard({ avatar }: AvatarCardProps) {
  const router = useRouter();

  const handleClick = useCallback(() => {
    router.push(`/conversation/${avatar.id}`);
  }, [router, avatar.id]);

  const handleButtonClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    handleClick();
  }, [handleClick]);

  // Memoize iframe URL to prevent unnecessary re-renders
  const iframeUrl = useMemo(() => 
    `https://embed.liveavatar.com/v1/${avatar.embedId}`,
    [avatar.embedId]
  );

  return (
    <Card onClick={handleClick} className="w-full max-w-md">
      {/* Avatar Preview */}
      <div className="relative w-full h-80 bg-gradient-to-b from-gray-50 to-white overflow-hidden">
        <iframe
          src={iframeUrl}
          allow="microphone"
          className="absolute inset-0 w-full h-full border-0"
          title={`${avatar.name} Preview`}
          style={{ 
            pointerEvents: 'none',
          }}
          loading="lazy"
          aria-hidden="true"
        />
        {/* Bottom fade to hide controls */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-white via-white/90 to-transparent pointer-events-none"></div>
      </div>

      {/* Content */}
      <div className="p-8">
        <h3 className="text-xl font-semibold text-gray-900 mb-6 text-center">
          {avatar.name}
        </h3>
        
        <button 
          onClick={handleButtonClick}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
        >
          Start Training
        </button>
      </div>
    </Card>
  );
});


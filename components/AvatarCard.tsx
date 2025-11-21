'use client';

import React, { useCallback } from 'react';
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

  return (
    <Card onClick={handleClick} className="w-full max-w-md bg-slate-900/40 border-white/10 shadow-xl shadow-slate-950/60 rounded-2xl overflow-hidden backdrop-blur">
      {/* Avatar Image */}
      <div className="relative w-full h-80 bg-gradient-to-b from-slate-900 to-slate-950 overflow-hidden">
        <img
          src={avatar.imageUrl}
          alt={avatar.name}
          className="absolute inset-0 h-full w-full object-cover opacity-90 transition duration-500 group-hover:scale-105"
        />
        {/* Bottom gradient overlay */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent" />
      </div>

      {/* Content */}
      <div className="space-y-6 p-6 sm:p-7">
        <h3 className="text-center text-lg font-semibold tracking-tight text-slate-50 sm:text-xl">
          {avatar.name}
        </h3>
        
        <button 
          onClick={handleButtonClick}
          className="w-full rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/40 transition hover:from-sky-400 hover:to-indigo-500 hover:shadow-blue-500/60"
        >
          Start Training
        </button>
      </div>
    </Card>
  );
});


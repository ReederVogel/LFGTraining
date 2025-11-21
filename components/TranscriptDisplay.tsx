'use client';

import React, { useEffect, useRef, useState } from 'react';

interface TranscriptMessage {
  speaker: 'user' | 'avatar';
  text: string;
  timestamp: Date;
  isInterim?: boolean;
}

interface TranscriptDisplayProps {
  messages: TranscriptMessage[];
  showInterim?: boolean;
  onExport?: () => void;
  /** Optional avatar metadata so we can show the real avatar image instead of a generic icon */
  avatarName?: string;
  avatarImageUrl?: string;
  userName?: string;
  userAvatarUrl?: string;
}

export default function TranscriptDisplay({ 
  messages, 
  showInterim = true,
  onExport,
  avatarName = 'Avatar',
  avatarImageUrl,
  userName = 'You',
  userAvatarUrl,
}: TranscriptDisplayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to TOP when new messages arrive (reverse chat behavior - newest at top)
  useEffect(() => {
    if (scrollRef.current && autoScroll) {
      scrollRef.current.scrollTop = 0;
    }
  }, [messages, autoScroll]);

  // Handle manual scroll - disable auto-scroll if user scrolls away from the top
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop } = scrollRef.current;
    const isAtTop = scrollTop <= 50;
    setAutoScroll(isAtTop);
  };

  const filteredMessages = showInterim ? messages : messages.filter(m => !m.isInterim);
  // Show messages in reverse chronological order (newest first, oldest last)
  const displayMessages = [...filteredMessages].reverse();
  const finalMessages = messages.filter(m => !m.isInterim);
  const userMessages = finalMessages.filter(m => m.speaker === 'user').length;
  const avatarMessages = finalMessages.filter(m => m.speaker === 'avatar').length;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-white/10 bg-slate-950/40 shadow-sm shadow-slate-950/60 backdrop-blur">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 bg-slate-950/60 px-4 py-3">
        <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
          <svg className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          Transcripts
          {filteredMessages.length > 0 && (
            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">
              {finalMessages.length}
            </span>
          )}
        </h3>
        
        {onExport && finalMessages.length > 0 && (
          <button
            onClick={onExport}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-slate-900/60 px-3 py-1.5 text-[0.7rem] font-medium text-slate-100 transition-colors hover:bg-slate-800/80"
            title="Export transcripts"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export
          </button>
        )}
      </div>
      
      {/* Messages Container - Scrollable area for all messages */}
      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className="space-y-3 overflow-y-scroll overflow-x-hidden bg-gradient-to-b from-slate-950/40 via-slate-950/60 to-slate-950/80 p-4 w-full"
        style={{ 
          scrollBehavior: 'smooth',
          height: '500px',
          maxHeight: '70vh'
        }}
      >
        {displayMessages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-slate-500">
            <div className="text-center">
              <svg className="mx-auto mb-3 h-10 w-10 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="mb-1 text-sm font-medium text-slate-200">No messages yet</p>
              <p className="text-xs text-slate-400">Start speaking to see transcripts appear here.</p>
            </div>
          </div>
        ) : (
          <>
            {displayMessages.map((msg, index) => (
              <div
                key={index}
                className={`flex ${msg.speaker === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in w-full`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-4 py-3 ${
                    msg.speaker === 'user'
                      ? 'bg-sky-500 text-white shadow-sm shadow-sky-700/40'
                      : 'bg-slate-900/70 border border-white/10 text-slate-50'
                  } ${msg.isInterim ? 'opacity-60 italic' : ''}`}
                  style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-shrink-0 mt-0.5">
                      {msg.speaker === 'user' ? (
                        userAvatarUrl ? (
                          <img
                            src={userAvatarUrl}
                            alt={userName}
                            className="h-7 w-7 rounded-full object-cover border border-white/30"
                          />
                        ) : (
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500 text-xs font-semibold text-white">
                            {userName.charAt(0).toUpperCase()}
                          </div>
                        )
                        ) : avatarImageUrl ? (
                        <img
                          src={avatarImageUrl}
                          alt={avatarName}
                          className="h-7 w-7 rounded-full object-cover border border-gray-200"
                        />
                        ) : (
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-500 text-xs font-semibold text-white">
                          {avatarName.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-medium">
                          {msg.speaker === 'user' ? userName : avatarName}
                        </span>
                        <span className={`text-xs ${msg.speaker === 'user' ? 'text-sky-200' : 'text-slate-400'}`}>
                          {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {msg.isInterim && (
                          <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-xs font-medium text-amber-300">
                            speaking…
                          </span>
                        )}
                      </div>
                      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap overflow-wrap-anywhere">{msg.text}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            
            {/* Anchor point for auto-scroll to top */}
            <div style={{ height: '1px' }} />
            
            {/* Scroll to TOP indicator - appears when user scrolls down */}
            {!autoScroll && displayMessages.length > 0 && (
              <button
                onClick={() => {
                  if (scrollRef.current) {
                    scrollRef.current.scrollTop = 0;
                    setAutoScroll(true);
                  }
                }}
                className="fixed bottom-24 right-8 z-50 inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-3 text-sm font-medium text-white shadow-xl transition hover:bg-blue-700 hover:scale-105 animate-bounce"
                title="Scroll to latest message"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
                New messages
              </button>
            )}
          </>
        )}
      </div>
      
      {/* Stats Footer */}
      <div className="border-t border-white/10 bg-slate-950/70 px-4 py-2.5 text-xs text-slate-300">
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-medium">
            Total: <span className="text-slate-50">{finalMessages.length}</span>
          </span>
          <span>
            You: <span className="font-medium text-sky-400">{userMessages}</span>
          </span>
          <span>
            Avatar: <span className="font-medium text-purple-400">{avatarMessages}</span>
          </span>
          
          {finalMessages.length > 3 && (
            <span className="ml-auto text-xs text-slate-400 flex items-center gap-1">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Scroll to see all
            </span>
          )}
          
          {!autoScroll && (
            <span className="ml-auto font-medium text-amber-300 animate-pulse">
              📜 Auto-scroll paused
            </span>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
        
        /* Custom scrollbar styling - ALWAYS visible for better UX */
        :global(.overflow-y-scroll::-webkit-scrollbar) {
          width: 12px;
        }
        :global(.overflow-y-scroll::-webkit-scrollbar-track) {
          background: rgba(15, 23, 42, 0.5);
          border-radius: 6px;
          margin: 4px 0;
        }
        :global(.overflow-y-scroll::-webkit-scrollbar-thumb) {
          background: rgba(59, 130, 246, 0.6);
          border-radius: 6px;
          border: 2px solid rgba(15, 23, 42, 0.5);
        }
        :global(.overflow-y-scroll::-webkit-scrollbar-thumb:hover) {
          background: rgba(59, 130, 246, 0.8);
        }
        :global(.overflow-y-scroll::-webkit-scrollbar-thumb:active) {
          background: rgba(59, 130, 246, 1);
        }
      `}</style>
    </div>
  );
}


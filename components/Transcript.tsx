'use client';

import React, { useState } from 'react';
import { TranscriptMessage } from '@/types/transcript';
import { Avatar } from '@/types/avatar';

interface TranscriptProps {
  messages: TranscriptMessage[];
  avatar: Avatar;
  userInfo?: {
    name: string;
    avatarUrl?: string;
  };
}

// Avatar display component with fallback
function AvatarDisplay({ avatarUrl, displayName, isUser }: { avatarUrl?: string; displayName: string; isUser: boolean }) {
  const [imageError, setImageError] = useState(false);
  const initials = displayName.charAt(0).toUpperCase();
  const bgColor = isUser ? 'bg-blue-500' : 'bg-purple-500';

  if (!avatarUrl || imageError) {
    return (
      <div className={`w-10 h-10 rounded-full ${bgColor} flex items-center justify-center text-white text-sm font-semibold`}>
        {initials}
      </div>
    );
  }

  return (
    <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center">
      <img
        src={avatarUrl}
        alt={displayName}
        className="w-full h-full object-cover"
        onError={() => setImageError(true)}
      />
    </div>
  );
}

export default React.memo(function Transcript({ messages, avatar, userInfo }: TranscriptProps) {
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Log when component mounts
  React.useEffect(() => {
    console.log('%c[Transcript] 🎯 Component MOUNTED and ready to receive messages', 'color: blue; font-weight: bold; font-size: 16px; background: yellow; padding: 4px;');
    console.log('[Transcript] Initial messages:', messages);
  }, []);

  // Debounced auto-scroll to prevent jank during rapid updates
  React.useEffect(() => {
    // Clear existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    // Set new timeout for smooth scrolling
    scrollTimeoutRef.current = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
    
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [messages.length]); // Only re-run when message count changes, not on content updates

  // Debug logging
  React.useEffect(() => {
    console.log('%c[Transcript] 📊 RENDER UPDATE', 'background: purple; color: white; font-weight: bold; padding: 4px;');
    console.log('[Transcript] Message count:', messages.length);
    console.log('[Transcript] Messages array:', messages);
    
    if (messages.length > 0) {
      console.log('%c[Transcript] ✅ MESSAGES EXIST - SHOULD BE VISIBLE!', 'color: green; font-weight: bold; font-size: 16px; background: lightgreen; padding: 4px;');
      messages.forEach((m, idx) => {
        console.log(`  [${idx}] ${m.speaker}: "${m.text?.substring(0, 50)}${m.text?.length > 50 ? '...' : ''}" (interim: ${m.isInterim})`);
      });
    } else {
      console.log('%c[Transcript] ⏳ NO MESSAGES YET', 'color: orange; font-weight: bold; font-size: 14px;');
    }
  }, [messages.length]); // Only log when message count changes

  if (messages.length === 0) {
    return (
      <div className="bg-white border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
        <div className="mb-4">
          <svg className="w-12 h-12 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <p className="text-gray-600 text-base font-medium mb-2">No conversation yet</p>
        <p className="text-gray-500 text-sm mb-1">Start speaking to see the transcript here.</p>
        <p className="text-xs text-gray-400 mt-2">💡 Make sure microphone permission is granted</p>
        <p className="text-xs text-blue-600 mt-3 font-mono">[Debug] Component rendered, waiting for messages...</p>
      </div>
    );
  }

  return (
    <div className="bg-white border-2 border-gray-300 rounded-lg overflow-hidden shadow-lg">
      {/* Header */}
      <div className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-300 px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Conversation Transcript</h3>
          <span className="text-xs text-gray-600 bg-white px-2 py-1 rounded-full border border-gray-300">
            {messages.length} {messages.length === 1 ? 'message' : 'messages'}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="max-h-96 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.map((message) => {
          const isUser = message.speaker === 'user';
          const displayName = isUser ? (userInfo?.name || 'You') : avatar.name;
          const avatarUrl = isUser 
            ? (userInfo?.avatarUrl || '/images/default-user-avatar.png')
            : avatar.imageUrl;
          
          // Skip empty messages unless they're interim (for real-time feedback)
          if (!message.text && !message.isInterim) {
            console.warn('[Transcript] Skipping empty message:', message);
            return null;
          }
          
          // Debug log each message being rendered
          console.log('[Transcript] Rendering message:', {
            speaker: message.speaker,
            text: message.text?.substring(0, 50),
            isInterim: message.isInterim
          });

          return (
            <div
              key={message.id}
              className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} ${message.isInterim ? 'animate-pulse' : ''}`}
            >
              {/* Avatar */}
              <div className="flex-shrink-0">
                <AvatarDisplay 
                  avatarUrl={avatarUrl} 
                  displayName={displayName}
                  isUser={isUser}
                />
              </div>

              {/* Message Content */}
              <div className={`flex-1 ${isUser ? 'text-right' : 'text-left'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-gray-700">{displayName}</span>
                  {!message.isInterim && (
                    <span className="text-xs text-gray-500">
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                  {message.isInterim && (
                    <span className="text-xs text-blue-600 font-semibold animate-pulse">🔴 Speaking...</span>
                  )}
                </div>
                <div
                  className={`inline-block px-4 py-2 rounded-lg ${
                    isUser
                      ? message.isInterim
                        ? 'bg-blue-500 text-white shadow-md border-2 border-blue-300'
                        : 'bg-blue-600 text-white'
                      : message.isInterim
                        ? 'bg-gray-300 text-gray-800 shadow-md border-2 border-gray-400'
                        : 'bg-gray-100 text-gray-900'
                  } transition-all duration-150`}
                >
                  <p className={`text-sm whitespace-pre-wrap break-words ${message.isInterim ? 'font-medium' : ''}`}>
                    {message.text || (message.isInterim ? '...' : '')}
                    {message.isInterim && <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse" />}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
});


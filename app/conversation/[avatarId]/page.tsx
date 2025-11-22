'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import AvatarSDKSimple from '@/components/AvatarSDKSimple';
import TranscriptDisplay from '@/components/TranscriptDisplay';
import { getAvatarById } from '@/lib/avatars';
import { 
  exportTranscriptsAsText, 
  exportTranscriptsAsJSON, 
  exportTranscriptsAsMarkdown,
  copyTranscriptsToClipboard 
} from '@/utils/transcriptExport';

/**
 * Dynamic Conversation Page - Uses the same clean SDK approach as /test-simple
 * Works with any avatar selected from /select-avatar
 */

export default function ConversationPage() {
  const params = useParams();
  const router = useRouter();
  const avatarId = params?.avatarId as string;

  // Get the avatar based on URL parameter
  const avatar = useMemo(() => 
    avatarId ? getAvatarById(avatarId) : undefined,
    [avatarId]
  );
  
  const [transcripts, setTranscripts] = useState<Array<{
    speaker: 'user' | 'avatar';
    text: string;
    timestamp: Date;
    isInterim?: boolean;
  }>>([]);
  
  const [error, setError] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<'text' | 'json' | 'markdown'>('text');
  const [showCopySuccess, setShowCopySuccess] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [isAvatarConnected, setIsAvatarConnected] = useState(false);
  const [conversationTime, setConversationTime] = useState(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const accumulatedTimeRef = useRef(0);

  // Redirect to select page if invalid avatar
  useEffect(() => {
    if (!avatarId || !avatar) {
      router.push('/select-avatar');
    }
  }, [avatarId, avatar, router]);

  // Handle back button
  const handleBack = useCallback(() => {
    router.push('/select-avatar');
  }, [router]);

  // Handle incoming transcripts
  const handleTranscript = useCallback((message: {
    speaker: 'user' | 'avatar';
    text: string;
    timestamp: Date;
    isInterim?: boolean;
  }) => {
    console.log('[ConversationPage] ========================================');
    console.log('[ConversationPage] 🎯 handleTranscript CALLED');
    console.log('[ConversationPage] ========================================');
    console.log('[ConversationPage] 📩 handleTranscript called:', {
      speaker: message.speaker,
      text: message.text.substring(0, 50) + '...',
      textLength: message.text.length,
      isInterim: message.isInterim,
      currentTranscriptCount: transcripts.length
    });
    
    // CRITICAL: Log if this is the first USER message (for debugging first message issue)
    const isFirstUserMessage = transcripts.filter(m => m.speaker === 'user' && !m.isInterim).length === 0 && 
                                message.speaker === 'user' && !message.isInterim;
    if (isFirstUserMessage) {
      console.log('[ConversationPage] 🎉🎉 FIRST USER MESSAGE RECEIVED:', message.text);
    }
    
    setTranscripts(prev => {
      console.log('[ConversationPage] 📊 Current transcript count:', prev.length);
      console.log('[ConversationPage] 📊 User transcripts:', prev.filter(m => m.speaker === 'user' && !m.isInterim).length);
      console.log('[ConversationPage] 📊 Avatar transcripts:', prev.filter(m => m.speaker === 'avatar' && !m.isInterim).length);
      
      // Handle interim messages
      if (message.isInterim) {
        const filtered = prev.filter(m => !(m.isInterim && m.speaker === message.speaker));
        console.log('[ConversationPage] Adding interim message, new count:', filtered.length + 1);
        return [...filtered, message];
      }
      
      // Handle final messages
      // First, remove any interim messages for this speaker
      const newTranscripts = prev.filter(m => !m.isInterim || m.speaker !== message.speaker);
      
      // CRITICAL: Always allow the first user message - skip duplicate checks for it
      const isFirstUserMessage = message.speaker === 'user' && 
                                 newTranscripts.filter(m => m.speaker === 'user' && !m.isInterim).length === 0;
      
      // NEW FIX: Time-aware duplicate detection
      // Only block duplicates if they occur within 2 seconds of each other
      // This prevents legitimate messages from being blocked while catching true duplicates
      const DUPLICATE_WINDOW_MS = 2000; // 2 seconds
      const messageTimestamp = message.timestamp?.getTime() || Date.now();
      
      // Check if this is a duplicate or extension of the last message
      // This fixes the issue where "I'm not sure yet" is followed by "I'm not sure yet. I'd like to know..."
      // SKIP this check for the first user message to ensure it always shows
      const lastMessage = newTranscripts[newTranscripts.length - 1];
      
      if (!isFirstUserMessage && lastMessage && lastMessage.speaker === message.speaker && !lastMessage.isInterim) {
        const timeDiff = messageTimestamp - (lastMessage.timestamp?.getTime() || 0);
        const normalize = (str: string) => str.trim().replace(/[.,!?;:]+$/, '').toLowerCase();
        const prevNorm = normalize(lastMessage.text);
        const newNorm = normalize(message.text);
        
        // ONLY check for duplicates if messages are within the duplicate window
        if (timeDiff < DUPLICATE_WINDOW_MS) {
          // CRITICAL FIX: Check if messages are exactly the same - this is a true duplicate
          if (prevNorm === newNorm) {
            console.warn('[ConversationPage] 🚨 BLOCKING - Exact duplicate within 2s window');
            console.warn('[ConversationPage] 📊 Duplicate text:', newNorm.substring(0, 50));
            console.warn('[ConversationPage] 📊 Time difference:', timeDiff + 'ms');
            console.warn('[ConversationPage] ========================================');
            return [...newTranscripts];
          }
          
          // Robust Deduplication Logic:
          // 1. New text starts with old text (extension)
          // 2. Old text starts with new text (rare update)
          if ((newNorm.startsWith(prevNorm) && prevNorm.length > 0) ||
              (prevNorm.startsWith(newNorm) && newNorm.length > 0)) {
             
             // Use the longer message to capture the most detail
             const longerText = message.text.length >= lastMessage.text.length ? message.text : lastMessage.text;
             
             // Replace the last message with the longer/newer version
             // Keep the original timestamp to show when they started speaking
             newTranscripts[newTranscripts.length - 1] = {
               ...message,
               text: longerText,
               timestamp: lastMessage.timestamp
             };
             console.log('[ConversationPage] ✅ Updated message with longer version:', longerText.substring(0, 50));
             return [...newTranscripts];
          }
        } else {
          console.log('[ConversationPage] ⏰ Messages are >2s apart, treating as separate messages');
        }
      }
      
      // REMOVED: The overly aggressive "last 3 messages" check
      // This was blocking legitimate messages that happened to have similar text
      // The time-aware check above is sufficient
      
      if (isFirstUserMessage) {
        console.log('[ConversationPage] 🎉 First user message - skipping duplicate check to ensure it displays');
      }
      
      const result = [...newTranscripts, message];
      console.log('[ConversationPage] ✅ Transcript added, new total:', result.length);
      console.log('[ConversationPage] ✅ Last message added:', {
        speaker: message.speaker,
        text: message.text.substring(0, 50),
        timestamp: message.timestamp
      });
      return result;
    });
  }, []);

  // Reset timer when session fully ends
  useEffect(() => {
    if (!sessionStarted) {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      setConversationTime(0);
      startTimeRef.current = null;
      accumulatedTimeRef.current = 0;
    }
  }, [sessionStarted]);

  // Start timer only after avatar connection is established
  useEffect(() => {
    if (!sessionStarted) {
      return;
    }

    if (isAvatarConnected) {
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
      }

      if (!timerIntervalRef.current) {
        timerIntervalRef.current = setInterval(() => {
          if (startTimeRef.current !== null) {
            const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
            setConversationTime(accumulatedTimeRef.current + elapsed);
          }
        }, 1000);
      }
    } else {
      if (startTimeRef.current !== null) {
        const elapsedWhileConnected = Math.floor((Date.now() - startTimeRef.current) / 1000);
        accumulatedTimeRef.current += elapsedWhileConnected;
        startTimeRef.current = null;
        setConversationTime(accumulatedTimeRef.current);
      }

      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
  }, [sessionStarted, isAvatarConnected]);

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  // Format time as MM:SS
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Export transcripts
  const handleExport = useCallback(() => {
    if (transcripts.length === 0) return;

    switch (exportFormat) {
      case 'text':
        exportTranscriptsAsText(transcripts);
        break;
      case 'json':
        exportTranscriptsAsJSON(transcripts);
        break;
      case 'markdown':
        exportTranscriptsAsMarkdown(transcripts);
        break;
    }
  }, [transcripts, exportFormat]);

  // Copy to clipboard
  const handleCopy = useCallback(async () => {
    if (transcripts.length === 0) return;
    
    try {
      await copyTranscriptsToClipboard(transcripts);
      setShowCopySuccess(true);
      setTimeout(() => setShowCopySuccess(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  }, [transcripts]);

  // Clear transcripts
  const handleClear = useCallback(() => {
    if (confirm('Are you sure you want to clear all transcripts?')) {
      setTranscripts([]);
    }
  }, []);

  const finalTranscripts = transcripts.filter(m => !m.isInterim);

  // Loading state
  if (!avatar) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4">
        <div className="text-center">
          <div className="spinner mx-auto mb-4"></div>
          <p className="text-sm text-slate-300">Loading conversation…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 sm:gap-10">
        {/* Elegant Header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handleBack}
              className="group flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 shadow-sm shadow-slate-950/40 transition-all hover:border-blue-500/60 hover:bg-blue-500/10 hover:text-sky-300 active:scale-95"
              title="Back to selection"
            >
              <svg className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">
                {avatar.name}
              </h1>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Interactive session in progress
              </div>
            </div>
          </div>

        </header>

        {/* Main Content - Stacked Layout */}
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
          {/* Avatar Section */}
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40 shadow-2xl shadow-slate-950/70 backdrop-blur">
            <AvatarSDKSimple
              avatar={avatar}
              onTranscript={handleTranscript}
              onError={setError}
              onSessionStart={setSessionStarted}
              onConnectionChange={setIsAvatarConnected}
              conversationTime={conversationTime}
            />
          </div>

          {/* Transcript Section - Full Width Under Avatar */}
          <div className="space-y-4 w-full overflow-hidden">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-wide text-slate-200 sm:text-base">
                Live transcript
              </h2>
            </div>
            
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 shadow-xl shadow-slate-950/70 backdrop-blur w-full overflow-hidden">
              <TranscriptDisplay 
                messages={transcripts} 
                onExport={handleExport}
                avatarName={avatar.name}
                avatarImageUrl={avatar.imageUrl}
              />
            </div>

            {/* Export Controls */}
            {finalTranscripts.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4 text-xs text-slate-200 shadow-sm shadow-slate-950/60 sm:text-sm">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-300 sm:text-sm">Export format:</span>
                    <div className="flex rounded-lg border border-white/15 bg-slate-900/60 p-0.5">
                      {(['text', 'json', 'markdown'] as const).map((format) => (
                        <button
                          key={format}
                          onClick={() => setExportFormat(format)}
                          className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                            exportFormat === format
                              ? 'bg-slate-100 text-slate-900 shadow-sm'
                              : 'text-slate-300 hover:text-slate-100'
                          }`}
                        >
                          {format.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleExport}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-medium text-white shadow-sm shadow-sky-500/40 transition-colors hover:bg-sky-400 sm:text-sm"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download
                    </button>
                    
                    <button
                      onClick={handleCopy}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/20 bg-slate-900/60 px-4 py-2 text-xs font-medium text-slate-100 transition-colors hover:bg-slate-800/80 sm:text-sm"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      {showCopySuccess ? 'Copied!' : 'Copy'}
                    </button>
                    
                    <button
                      onClick={handleClear}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/20 sm:text-sm"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error Display - Floating toast style */}
        {error && (
          <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-fade-in">
            <div className="flex items-center gap-3 rounded-xl border border-red-500/60 bg-slate-950/95 p-4 shadow-2xl shadow-red-900/60">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-300">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-semibold text-red-200 sm:text-sm">Connection error</p>
                <p className="text-xs text-red-300 sm:text-sm">{error}</p>
              </div>
              <button onClick={() => setError(null)} className="ml-2 text-slate-500 hover:text-slate-200">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


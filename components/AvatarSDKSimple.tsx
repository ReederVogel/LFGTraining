'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Avatar } from '@/types/avatar';
import { useLiveAvatarSDK } from '@/hooks/useLiveAvatarSDK';
import { useHybridSpeechRecognition } from '@/hooks/useHybridSpeechRecognition';
import { useAvatarAudioCapture } from '@/hooks/useAvatarAudioCapture';
import { useClientVAD } from '@/hooks/useClientVAD';
import { AVATAR_CONFIG } from '@/lib/avatar-config';
import { correctAndLog } from '@/lib/speech-corrections';

interface AvatarSDKSimpleProps {
  avatar: Avatar;
  onTranscript?: (message: { speaker: 'user' | 'avatar'; text: string; timestamp: Date; isInterim?: boolean }) => void;
  onError?: (error: string | null) => void;
  onSessionStart?: (started: boolean) => void;
  conversationTime?: number;
}

/**
 * Simplified Avatar SDK - Clean conversation without interruptions
 * 
 * Simple flow:
 * 1. User speaks (speech recognition captures it)
 * 2. User finishes speaking (stops talking)
 * 3. Avatar receives the text and responds
 * 4. No interruptions, no complex VAD
 */
export default function AvatarSDKSimple({ avatar, onTranscript, onError, onSessionStart, conversationTime = 0 }: AvatarSDKSimpleProps) {
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [userInterrupted, setUserInterrupted] = useState(false);
  const [hasVideoStream, setHasVideoStream] = useState(false);
  const currentUserSpeechRef = React.useRef<string>('');
  
  // Video element ref - use ref callback to prevent unnecessary re-renders
  const videoElementRef = React.useRef<HTMLVideoElement | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  
  // Stable ref callback to prevent unnecessary re-renders
  const videoRefCallback = React.useCallback((node: HTMLVideoElement | null) => {
    if (videoElementRef.current !== node) {
      videoElementRef.current = node;
      setVideoElement(node);
    }
  }, []);

  // Get Deepgram API key
  const deepgramApiKey = typeof window !== 'undefined' 
    ? process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY 
    : undefined;

  // Initialize LiveAvatar SDK
  const {
    isConnected,
    isSpeaking: avatarIsSpeaking,
    error: sdkError,
    speak,
    interrupt,
    cleanup,
  } = useLiveAvatarSDK({
    avatarId: avatar.id,
    contextId: avatar.contextId,
    sessionLanguage: 'en',
    enabled: sessionStarted,
    videoElement,
    onTranscript: (speaker, text, isFinal) => {
      console.log('[AvatarSDKSimple] 📝 SDK transcript received:', {
        speaker,
        text: text?.substring(0, 50),
        isFinal,
        hasCallback: !!onTranscript,
        textLength: text?.length,
        textTrimmed: text?.trim(),
      });

      if (!onTranscript) {
        console.warn('[AvatarSDKSimple] ⚠️ No onTranscript callback provided');
        return;
      }

      if (!text || !text.trim()) {
        console.warn('[AvatarSDKSimple] ⚠️ Empty text received, skipping');
        return;
      }

      console.log('[AvatarSDKSimple] ✅ Sending transcript to parent:', {
        speaker,
        text: text.trim().substring(0, 50),
        isFinal,
      });

      onTranscript({
        speaker,
        text: text.trim(),
        timestamp: new Date(),
        isInterim: !isFinal,
      });
    },
    onStatus: (status) => {
      // Status updates handled silently
    },
    onError: (err) => {
      console.error('[AvatarSDKSimple] Error:', err);
      setError(err);
    },
  });

  // Ref for tracking last spoken text to prevent duplicates
  const lastUserSpeakRef = React.useRef<string>('');
  const lastUserSpeakTimeRef = React.useRef<number>(0);

  // Track if we've sent a user message to prevent duplicates between browser and SDK
  const lastBrowserUserMessageRef = React.useRef<string>('');
  const lastBrowserUserMessageTimeRef = React.useRef<number>(0);

  // Handle user speech - FOR DISPLAY AND INTERRUPTION ONLY
  // ⚠️ IMPORTANT: VoiceChat mode handles actual communication automatically!
  // This is ONLY for showing transcripts in UI and detecting interruptions
  const handleSpeechResult = useCallback((text: string, isFinal: boolean) => {
    if (!text.trim()) return;

    console.log('[AvatarSDKSimple] 🎤 Browser speech (display only):', { 
      text: text.trim(), 
      isFinal, 
      avatarIsSpeaking,
      userInterrupted 
    });

    // CRITICAL: Interrupt IMMEDIATELY on ANY user speech while avatar is talking
    // Check on every speech event (interim and final) to catch interruptions fast
    if (avatarIsSpeaking) {
      if (!userInterrupted) {
        console.log('[AvatarSDKSimple] 🛑 USER INTERRUPTED AVATAR - STOPPING NOW!');
        setUserInterrupted(true);
        interrupt();
      }
      // Clear any accumulated speech when interrupting
      currentUserSpeechRef.current = '';
    }

    // Accumulate user speech FOR DISPLAY ONLY
    if (!isFinal) {
      currentUserSpeechRef.current = text.trim();
    }

    // ⚠️ DO NOT SEND TO AVATAR MANUALLY!
    // VoiceChat mode handles this automatically via SDK's microphone capture
    // We just show the transcript in UI for user feedback
    
    // Send transcript to UI for DISPLAY ONLY
    // This is needed because SDK's user.transcription_ended events may not always fire
    // Browser speech recognition provides fallback display of user speech
    // Only send final results to avoid duplicates with SDK
    if (onTranscript && text.trim() && isFinal) {
      // Apply minimal corrections (only funeral-specific terms)
      // Show transcripts as recognized - don't over-correct general speech
      const correctedText = correctAndLog(text.trim(), 'user');
      const normalizedText = correctedText.trim();
      const now = Date.now();
      
      // Check if this is an EXACT duplicate of recent browser message (within 1 second)
      // Use exact match to avoid blocking legitimate variations or corrections
      // Only block if it's the exact same text within 1 second (likely a duplicate event)
      const isDuplicate = lastBrowserUserMessageRef.current === normalizedText && 
                          now - lastBrowserUserMessageTimeRef.current < 1000;
      
      if (!isDuplicate) {
        console.log('[AvatarSDKSimple] ✅ Sending browser user transcript to UI:', normalizedText);
        lastBrowserUserMessageRef.current = normalizedText;
        lastBrowserUserMessageTimeRef.current = now;
        
        onTranscript({
          speaker: 'user',
          text: normalizedText,
          timestamp: new Date(),
          isInterim: false,
        });
      } else {
        console.log('[AvatarSDKSimple] ⚠️ Skipping duplicate browser transcript:', normalizedText);
      }
    }
    
    if (isFinal) {
      currentUserSpeechRef.current = '';
      setUserInterrupted(false); // Reset interrupted flag
    }
  }, [avatarIsSpeaking, userInterrupted, interrupt, onTranscript]);

  // Ref for tracking last spoken text to prevent duplicates
  // MOVED THESE REFS ABOVE handleSpeechResult definition because they are used inside it
  
  // Browser speech recognition enabled for DISPLAY ONLY
  // VoiceChat SDK handles actual communication, but we need browser speech recognition
  // to show user transcripts in the UI (SDK's user.transcription_ended events may not always fire)
  const { 
    startListening, 
    stopListening, 
    isSupported: speechSupported,
    activeProvider,
    isListening: speechIsListening,
  } = useHybridSpeechRecognition({
    onResult: handleSpeechResult,
    onStatusChange: (status) => {
      // Status changes handled silently
    },
    onError: (error) => {
      console.error('[AvatarSDKSimple] Speech error:', error);
    },
    // ✅ ENABLED: For displaying user transcripts in UI
    // SDK handles actual communication, browser speech recognition is just for display
    enabled: !!onTranscript && sessionStarted && isConnected,
    apiKey: deepgramApiKey,
    preferDeepgram: true,
  });

  // VAD handlers for instant interruption detection
  const handleVADSpeechStart = useCallback(() => {
    console.log('[AvatarSDKSimple] 🎤 VAD: User started speaking', {
      avatarIsSpeaking,
      isConnected,
      sessionStarted,
    });
    
    // INSTANT INTERRUPTION: User started making sound while avatar is speaking
    if (avatarIsSpeaking) {
      console.log('[AvatarSDKSimple] ⚠️ VAD DETECTED INTERRUPTION - STOPPING AVATAR NOW!');
      setUserInterrupted(true);
      interrupt();
    } else {
      console.log('[AvatarSDKSimple] ℹ️ Avatar not speaking, no interruption needed');
    }
  }, [avatarIsSpeaking, interrupt, isConnected, sessionStarted]);

  const handleVADSpeechEnd = useCallback(() => {
    console.log('[AvatarSDKSimple] 🤫 VAD: User stopped speaking');
    
    // ⚠️ DO NOT SEND MESSAGES MANUALLY!
    // VoiceChat mode handles everything automatically
    // VAD is ONLY for interruption detection, not for message sending
    // SDK's own microphone capture will handle the actual communication
    
    // Just clear state and reset flags
    currentUserSpeechRef.current = '';
    setUserInterrupted(false);
    
    console.log('[AvatarSDKSimple] ✅ VAD: Reset state (VoiceChat handles actual message)');
  }, []);

  // Initialize VAD for instant interruption detection
  useClientVAD({
    onSpeechStart: handleVADSpeechStart,
    onSpeechEnd: handleVADSpeechEnd,
    enabled: isConnected && sessionStarted,
    silenceDurationMs: AVATAR_CONFIG.latency.interruptionSilenceDuration,
    silenceThreshold: AVATAR_CONFIG.latency.interruptionThreshold,
    suppressLogs: false,
  });

  // Track listening state
  useEffect(() => {
    setIsListening(speechIsListening);
  }, [speechIsListening]);

  // Set up automatic avatar audio capture to ensure ALL avatar speech is transcribed
  const { isCapturing: isCapturingAvatar } = useAvatarAudioCapture({
    videoElement,
    deepgramApiKey,
    enabled: isConnected && sessionStarted && !!deepgramApiKey,
    onTranscript: (text, isFinal) => {
      if (text.trim() && onTranscript) {
        onTranscript({
          speaker: 'avatar',
          text: text.trim(),
          timestamp: new Date(),
          isInterim: !isFinal,
        });
      }
    },
    onError: (error) => {
      // This is a non-critical error - the SDK provides transcripts via its own callbacks
      // Avatar audio capture is just a backup/verification method
      // Silently handled in production
    },
  });

  // Auto-start browser speech recognition for display when connected
  // This provides user transcript display even if SDK's user.transcription_ended events don't fire
  useEffect(() => {
    if (speechSupported && isConnected && sessionStarted && onTranscript && !speechIsListening) {
      const timer = setTimeout(() => {
        try {
          console.log('[AvatarSDKSimple] 🎤 Starting browser speech recognition for display...');
          startListening();
        } catch (error) {
          console.error('[AvatarSDKSimple] Error auto-starting speech:', error);
        }
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [speechSupported, isConnected, sessionStarted, onTranscript, speechIsListening, startListening]);

  // Handle SDK errors
  useEffect(() => {
    if (sdkError) {
      setError(sdkError);
    }
  }, [sdkError]);

  // Track connection state to detect actual disconnections (not initial connection)
  const wasConnectedRef = React.useRef(false);
  
  // Monitor video stream state - check periodically if video stream is still valid
  useEffect(() => {
    if (!isConnected || !sessionStarted) {
      setHasVideoStream(false);
      return;
    }

    const checkVideoStream = () => {
      if (videoElementRef.current) {
        const video = videoElementRef.current;
        const hasValidStream = video.videoWidth > 0 && video.videoHeight > 0 && !!video.srcObject;
        setHasVideoStream(hasValidStream);
        
        if (!hasValidStream && isConnected) {
          console.warn('[AvatarSDKSimple] ⚠️ Video stream lost - video element has no valid stream');
        }
      } else {
        setHasVideoStream(false);
      }
    };

    // Check immediately
    checkVideoStream();

    // Check periodically (every 500ms) to catch stream loss
    const interval = setInterval(checkVideoStream, 500);

    return () => clearInterval(interval);
  }, [isConnected, sessionStarted]);

  // Reset video stream state when disconnected
  useEffect(() => {
    if (!isConnected) {
      setHasVideoStream(false);
    }
  }, [isConnected]);
  
  // Handle disconnections - CRITICAL for speech recognition
  useEffect(() => {
    // Only trigger if we WERE connected and now are NOT
    // Don't trigger during initial connection phase
    if (isConnected) {
      wasConnectedRef.current = true; // Mark that we've been connected
    } else if (wasConnectedRef.current && sessionStarted) {
      // We WERE connected, now we're NOT - this is a real disconnection!
      console.error('[AvatarSDKSimple] ❌ CRITICAL: Session disconnected!');
      console.error('[AvatarSDKSimple] Speech recognition is now DISABLED');
      console.error('[AvatarSDKSimple] User will NOT be able to send messages');
      setError('Session disconnected. Speech recognition stopped. Please refresh the page.');
      onError?.('Session disconnected. Please refresh the page to continue.');
    }
  }, [sessionStarted, isConnected, onError]);

  useEffect(() => {
    if (error) {
      onError?.(error);
    } else if (isConnected) {
      onError?.(null);
    }
  }, [error, isConnected, onError]);

  // Get current status - memoized to prevent unnecessary recalculations
  const status = React.useMemo(() => {
    if (!sessionStarted) return { color: 'bg-gray-400', text: 'Session not started', pulse: false };
    // Only show disconnected if we were previously connected (not during initial connection)
    if (sessionStarted && !isConnected && wasConnectedRef.current) {
      return { color: 'bg-red-500', text: 'Disconnected - Refresh Page!', pulse: true };
    }
    if (avatarIsSpeaking) return { color: 'bg-blue-500', text: 'Avatar Speaking...', pulse: false };
    // VoiceChat mode is always "listening" - show as ready instead
    return { color: 'bg-green-500', text: 'Ready - Speak Anytime', pulse: false };
  }, [sessionStarted, avatarIsSpeaking, isConnected]);

  // Format conversation time as MM:SS
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const handleStartSession = () => {
    setError(null);
    setHasUserInteracted(false);
    setSessionStarted(true);
    setAudioEnabled(true);
    onSessionStart?.(true);
    
    // Ensure video element is unmuted and playing
    if (videoElementRef.current) {
      const video = videoElementRef.current;
      video.muted = false;
      video.volume = 1.0;
      video.play().catch((err) => {
        console.warn('[AvatarSDKSimple] Play on start failed:', err);
      });
    }
  };
  
  const handleEnableAudio = () => {
    if (videoElementRef.current) {
      const video = videoElementRef.current;
      video.muted = false;
      video.volume = 1.0;
      
      video.play().then(() => {
        console.log('[AvatarSDKSimple] ✅ Audio enabled successfully');
        setAudioEnabled(true);
      }).catch((err) => {
        console.error('[AvatarSDKSimple] ❌ Failed to enable audio:', err);
        setError('Failed to enable audio. Please check your browser settings.');
      });
    }
  };

  return (
    <div className="w-full h-full flex flex-col">
      {/* Avatar Container */}
      <div className="relative aspect-video w-full overflow-hidden bg-slate-100">
        {/* Before session started - show card-style placeholder like embed */}
          {!sessionStarted && !error && (
            <div className="absolute inset-0 flex flex-col">
              {/* Background image */}
              <img
                src={avatar.imageUrl}
                alt={avatar.name}
                className="h-full w-full object-cover"
              />
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />

              {/* Bottom name + start training bar - Positioned absolutely with specific bottom offset */}
              <div className="absolute inset-x-0 bottom-5 flex justify-center pointer-events-none">
                <div className="flex flex-col items-center gap-4 px-8 w-full max-w-md mx-auto pointer-events-auto pb-6 pt-10 rounded-2xl bg-black/20 backdrop-blur-sm border border-white/10">
                  <div className="space-y-1 text-center animate-fade-in-up">
                    <p className="text-xs uppercase tracking-wide text-gray-200">
                      Training Scenario
                    </p>
                    <p className="text-lg font-semibold text-white">
                      {avatar.name}
                    </p>
                  </div>
                  <button
                    onClick={handleStartSession}
                    className="inline-flex items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-12 py-4 text-base font-semibold text-white shadow-lg shadow-blue-500/50 transition-all duration-300 hover:scale-105 hover:from-blue-700 hover:to-blue-800 hover:shadow-xl hover:shadow-blue-600/50 active:scale-95"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Start Training</span>
                  </button>
                </div>
              </div>
              
              {/* Subtle gradient at very bottom for depth */}
              <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
            </div>
          )}

          {/* After session started but still connecting or waiting for video stream */}
          {sessionStarted && (!isConnected || !hasVideoStream) && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
              <div className="text-center">
                <div className="spinner mx-auto mb-3" />
                <p className="text-sm text-gray-600">
                  {!isConnected ? 'Connecting...' : 'Loading avatar...'}
                </p>
              </div>
            </div>
          )}
          
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-red-50 p-4">
              <div className="max-w-md rounded-lg border border-red-200 bg-white p-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                  <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <p className="mb-2 text-sm font-semibold text-red-700">Error</p>
                <p className="text-sm text-gray-700">{error}</p>
              </div>
            </div>
          )}

          {/* Status Indicator */}
          {isConnected && hasVideoStream && !error && (
            <>
              <div className="absolute top-4 left-4 z-20 flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-md">
                <div className={`w-2 h-2 rounded-full ${status.color} ${status.pulse ? 'animate-pulse' : ''}`}></div>
                <span>{status.text}</span>
              </div>
              
              {/* Enable Audio Button - shows if audio might be blocked */}
              {!audioEnabled && (
                <div className="absolute top-4 right-4 z-20">
                  <button
                    onClick={handleEnableAudio}
                    className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-md transition hover:bg-blue-700"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                    <span>Enable Audio</span>
                  </button>
                </div>
              )}
            </>
          )}

          {/* Video element */}
          <video
            ref={videoRefCallback}
            autoPlay
            playsInline
            muted={false}
            className="h-full w-full object-cover"
            style={{ 
              opacity: isConnected && hasVideoStream ? 1 : 0,
              visibility: isConnected && hasVideoStream ? 'visible' : 'hidden',
              transition: 'opacity 0.2s ease-in-out'
            }}
            onLoadedData={(e) => {
              const target = e.target as HTMLVideoElement;
              const hasValidStream = target.videoWidth > 0 && target.videoHeight > 0 && !!target.srcObject;
              
              console.log('[AvatarSDKSimple] Video data loaded', {
                hasVideo: hasValidStream,
                videoWidth: target.videoWidth,
                videoHeight: target.videoHeight,
                hasSrcObject: !!target.srcObject,
              });
              
              // Update video stream state when data is loaded
              setHasVideoStream(hasValidStream);
            }}
            onLoadedMetadata={(e) => {
              const target = e.target as HTMLVideoElement & { audioTracks?: { length: number } };
              const hasValidStream = target.videoWidth > 0 && target.videoHeight > 0;
              
              console.log('[AvatarSDKSimple] Video metadata loaded', {
                hasVideo: hasValidStream,
                videoWidth: target.videoWidth,
                videoHeight: target.videoHeight,
                hasAudio: target.audioTracks ? target.audioTracks.length > 0 : undefined,
                muted: target.muted,
                volume: target.volume,
                paused: target.paused,
                hasSrcObject: !!target.srcObject,
              });
              
              // Update video stream state - only show video when we have a valid stream
              setHasVideoStream(hasValidStream);
              
              // NOTE: Don't manipulate muted state here - the SDK controls this
              // If Web Audio API is being used, the video element stays muted
              // If HTML5 audio is being used, the SDK will unmute it
              
              // Try to play if paused
              if (target.paused) {
                target.play().catch((err) => {
                  console.warn('[AvatarSDKSimple] Autoplay prevented, trying muted first:', err);
                  // Try playing muted first (browser autoplay workaround)
                  const wasMuted = target.muted;
                  target.muted = true;
                  target.play().then(() => {
                    console.log('[AvatarSDKSimple] Video playing (muted for autoplay)');
                    // Restore muted state after a moment if needed
                    if (!wasMuted) {
                      setTimeout(() => {
                        target.muted = false;
                        console.log('[AvatarSDKSimple] Video unmuted after autoplay workaround');
                      }, 100);
                    }
                  }).catch((err2) => {
                    console.error('[AvatarSDKSimple] Failed to play even muted:', err2);
                  });
                });
              }
            }}
            onPlay={() => {
              console.log('[AvatarSDKSimple] Video started playing');
              // Check if video has valid stream when playing
              if (videoElementRef.current) {
                const hasValidStream = videoElementRef.current.videoWidth > 0 && videoElementRef.current.videoHeight > 0;
                setHasVideoStream(hasValidStream);
              }
            }}
            onPlaying={() => {
              console.log('[AvatarSDKSimple] Video is playing');
              // Ensure video stream state is set when playing
              if (videoElementRef.current) {
                const hasValidStream = videoElementRef.current.videoWidth > 0 && videoElementRef.current.videoHeight > 0;
                setHasVideoStream(hasValidStream);
              }
            }}
            onVolumeChange={(e) => {
              const target = e.target as HTMLVideoElement;
              console.log('[AvatarSDKSimple] Volume changed:', {
                muted: target.muted,
                volume: target.volume,
              });
            }}
            onError={(e) => {
              const target = e.target as HTMLVideoElement;
              
              // Check if this is an actual error or just a harmless Web Audio routing artifact
              if (target.error) {
                const errorCode = target.error.code;
                const errorMessage = target.error.message || '';
                
                // MediaError codes:
                // 1 = MEDIA_ERR_ABORTED - User aborted (not critical)
                // 2 = MEDIA_ERR_NETWORK - Network error (critical)
                // 3 = MEDIA_ERR_DECODE - Decode error (can be harmless with Web Audio)
                // 4 = MEDIA_ERR_SRC_NOT_SUPPORTED - Source not supported (critical)
                
                // When using Web Audio API, decode errors are expected and harmless
                // because the audio stream is being routed through Web Audio instead
                const isWebAudioRelated = (
                  errorCode === 3 && // MEDIA_ERR_DECODE
                  target.muted === true // Video is muted (likely using Web Audio)
                );
                
                if (isWebAudioRelated) {
                  // This is expected when Web Audio API is routing the audio
                  console.log('[AvatarSDKSimple] Video decode event (harmless - audio routed via Web Audio API)');
                  return;
                }
                
                // Log actual errors
                const errorDetails = {
                  code: errorCode,
                  message: errorMessage,
                  codeText: errorCode === 1 ? 'ABORTED' : 
                           errorCode === 2 ? 'NETWORK' : 
                           errorCode === 3 ? 'DECODE' : 
                           errorCode === 4 ? 'SRC_NOT_SUPPORTED' : 'UNKNOWN',
                  muted: target.muted,
                  volume: target.volume,
                  srcAvailable: !!target.src || !!target.srcObject,
                };
                
                // Only log non-critical errors as warnings
                if (errorCode === 1 || errorCode === 3) {
                  console.warn('[AvatarSDKSimple] Video non-critical error:', errorDetails);
                } else {
                  console.error('[AvatarSDKSimple] Video error:', errorDetails);
                  setError(`Video error: ${errorDetails.codeText}`);
                }
              } else {
                console.log('[AvatarSDKSimple] Video error event (no error details available - likely harmless)');
              }
            }}
          />
        </div>
      

      {/* Session Controls */}
      {sessionStarted && (
        <div className="border-t border-slate-100 bg-slate-50/50 p-4 backdrop-blur-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-center gap-3">
            {conversationTime > 0 && (
              <div className="flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-xs shadow-sm shadow-emerald-500/30">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
                </span>
                <span className="min-w-[3rem] font-mono text-sm font-semibold text-emerald-200">
                  {formatTime(conversationTime)}
                </span>
              </div>
            )}
            <button
              onClick={() => {
                try {
                  stopListening();
                } catch (e) {
                  // Silently handle
                }
                try {
                  cleanup();
                } catch (e) {
                  console.error('[AvatarSDKSimple] Error stopping session:', e);
                }
                setSessionStarted(false);
                onSessionStart?.(false);
              }}
              className="w-full rounded-lg bg-white border border-red-200 px-6 py-3 text-base font-medium text-red-600 hover:bg-red-50 hover:border-red-300 transition-colors shadow-sm sm:w-auto"
            >
              End Session
            </button>
          </div>
        </div>
      )}
    </div>
  );
}



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
  onConnectionChange?: (connected: boolean) => void;
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
export default function AvatarSDKSimple({ avatar, onTranscript, onError, onSessionStart, onConnectionChange, conversationTime = 0 }: AvatarSDKSimpleProps) {
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [userInterrupted, setUserInterrupted] = useState(false);
  const [hasVideoStream, setHasVideoStream] = useState(false);
  const [hasSrcObject, setHasSrcObject] = useState(false); // Track srcObject directly
  const [conversationStarted, setConversationStarted] = useState(false);
  const [showHelloMessage, setShowHelloMessage] = useState(false);
  const currentUserSpeechRef = React.useRef<string>('');
  // Track loading state with minimum display time to prevent flickering
  const [displayedLoadingState, setDisplayedLoadingState] = useState<'connecting' | 'loading-avatar' | null>(null);
  const loadingStateStartTimeRef = React.useRef<number>(0);
  const MIN_LOADING_STATE_DURATION = 800; // Minimum 800ms per loading state for smooth UX
  
  // Video element ref - use ref callback to prevent unnecessary re-renders
  const videoElementRef = React.useRef<HTMLVideoElement | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const attachAttemptCountRef = React.useRef<number>(0); // Track attachment attempts
  const MAX_ATTACH_ATTEMPTS = 3; // Max retries for attaching video
  
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

      // Mark conversation as started when first transcript is received
      if (!conversationStarted && isFinal) {
        setConversationStarted(true);
        setShowHelloMessage(false); // Hide hello message when conversation starts
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

  useEffect(() => {
    onConnectionChange?.(isConnected);
  }, [isConnected, onConnectionChange]);

  // Track connection state to detect actual disconnections (not initial connection)
  const wasConnectedRef = React.useRef(false);
  
  // Track last known video stream state to prevent unnecessary updates
  const lastVideoStreamStateRef = React.useRef<boolean>(false);
  
  // Monitor video stream state - check periodically if video stream is still valid
  useEffect(() => {
    if (!isConnected || !sessionStarted) {
      if (lastVideoStreamStateRef.current !== false) {
        setHasVideoStream(false);
        lastVideoStreamStateRef.current = false;
      }
      return;
    }

    const checkVideoStream = () => {
      if (videoElementRef.current) {
        const video = videoElementRef.current;
        // Check multiple indicators of a valid video stream:
        // 1. Has srcObject (stream source) - CRITICAL: If srcObject exists and is MediaStream, consider it valid
        // 2. Has video dimensions (metadata loaded) - preferred but not required
        // 3. OR video is playing (which means stream is active)
        // 4. OR readyState indicates data is available
        const hasSrcObject = !!video.srcObject;
        const isMediaStream = video.srcObject instanceof MediaStream;
        const hasDimensions = video.videoWidth > 0 && video.videoHeight > 0;
        const isPlaying = !video.paused && !video.ended && video.readyState >= 2; // HAVE_CURRENT_DATA or higher
        const hasData = video.readyState >= 2; // HAVE_CURRENT_DATA or higher
        
        // CRITICAL FIX: If we have a MediaStream attached, ALWAYS consider it valid
        // This fixes the issue where video stream is attached but metadata hasn't loaded
        const hasValidStream = hasSrcObject && (
          isMediaStream || // MediaStream attached = valid stream (MOST IMPORTANT)
          hasDimensions || // Has dimensions = valid stream
          isPlaying || // Is playing = valid stream
          hasData // Has data = valid stream
        );
        
        // CRITICAL FIX: Only update state if it actually changed to prevent infinite loops
        if (hasValidStream !== lastVideoStreamStateRef.current) {
          lastVideoStreamStateRef.current = hasValidStream;
          setHasVideoStream(hasValidStream);
          
          if (hasValidStream) {
            console.log('[AvatarSDKSimple] ✅ Video stream detected:', {
              hasSrcObject,
              isMediaStream,
              hasDimensions,
              isPlaying,
              hasData,
              videoWidth: video.videoWidth,
              videoHeight: video.videoHeight,
            });
          }
        }
        
        // If we have srcObject but video isn't playing, try to play it
        if (hasSrcObject && video.paused) {
          console.log('[AvatarSDKSimple] 🔄 Video has srcObject but paused - attempting to play...');
          video.play().catch((err) => {
            console.warn('[AvatarSDKSimple] ⚠️ Could not play video:', err);
            // Try muted play as fallback
            const wasMuted = video.muted;
            video.muted = true;
            video.play().then(() => {
              console.log('[AvatarSDKSimple] ✅ Video playing muted');
              if (!wasMuted) {
                setTimeout(() => {
                  video.muted = false;
                }, 100);
              }
            }).catch((err2) => {
              console.error('[AvatarSDKSimple] ❌ Could not play video even muted:', err2);
            });
          });
        }
      } else {
        if (lastVideoStreamStateRef.current !== false) {
          setHasVideoStream(false);
          lastVideoStreamStateRef.current = false;
        }
      }
    };

    // Check immediately
    checkVideoStream();

    // Check frequently enough to catch stream quickly (every 300ms)
    const interval = setInterval(checkVideoStream, 300);

    return () => clearInterval(interval);
  }, [isConnected, sessionStarted]); // REMOVED hasVideoStream from dependencies to prevent infinite loop

  // FAILSAFE: If srcObject is detected but hasVideoStream hasn't updated yet, sync it immediately
  useEffect(() => {
    if (hasSrcObject && !lastVideoStreamStateRef.current) {
      console.log('[AvatarSDKSimple] ✅ hasSrcObject detected - syncing hasVideoStream state');
      lastVideoStreamStateRef.current = true;
      setHasVideoStream(true);
    }
  }, [hasSrcObject]);

  // Reset attachment attempts when successfully connected
  useEffect(() => {
    if (hasSrcObject && isConnected) {
      // Successfully got srcObject, reset attempt counter
      if (attachAttemptCountRef.current > 0) {
        console.log('[AvatarSDKSimple] ✅ srcObject attached successfully, resetting attempt counter');
        attachAttemptCountRef.current = 0;
      }
    }
  }, [hasSrcObject, isConnected]);

  // Reset video stream state when disconnected
  useEffect(() => {
    if (!isConnected) {
      setHasVideoStream(false);
      setHasSrcObject(false);
      setShowHelloMessage(false);
      setDisplayedLoadingState(null);
      loadingStateStartTimeRef.current = 0;
      attachAttemptCountRef.current = 0; // Reset attempts on disconnect
    }
  }, [isConnected]);

  // Track last srcObject state to prevent unnecessary updates
  const lastSrcObjectRef = React.useRef<MediaStream | MediaSource | Blob | null>(null);
  const hasSrcObjectSetRef = React.useRef<boolean>(false);
  
  // Watch for srcObject changes (more reliable than polling)
  useEffect(() => {
    if (!isConnected || !sessionStarted || !videoElementRef.current) {
      if (hasSrcObjectSetRef.current) {
        setHasSrcObject(false);
        hasSrcObjectSetRef.current = false;
        lastSrcObjectRef.current = null;
      }
      return;
    }

    const video = videoElementRef.current;
    let checkCount = 0;
    const MAX_CHECKS = 100; // Check for up to 20 seconds (100 * 200ms)

    // Check immediately
    if (video.srcObject && video.srcObject !== lastSrcObjectRef.current) {
      console.log('[AvatarSDKSimple] 🎯 Initial check: srcObject already attached!', {
        isMediaStream: video.srcObject instanceof MediaStream,
        hasTracks: video.srcObject instanceof MediaStream ? video.srcObject.getTracks().length : 0,
      });
      setHasSrcObject(true);
      setHasVideoStream(true); // CRITICAL: Also set hasVideoStream immediately
      hasSrcObjectSetRef.current = true;
      lastSrcObjectRef.current = video.srcObject;
    }

    // Watch for srcObject property changes
    const checkSrcObject = () => {
      checkCount++;
      const currentSrcObject = video.srcObject;
      
      // Only update if srcObject actually changed
      if (currentSrcObject !== lastSrcObjectRef.current) {
        if (currentSrcObject) {
          console.log('[AvatarSDKSimple] 🎯 srcObject CHANGED - stream attached!', {
            isMediaStream: currentSrcObject instanceof MediaStream,
            hasTracks: currentSrcObject instanceof MediaStream ? currentSrcObject.getTracks().length : 0,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            checkCount,
            elapsedMs: checkCount * 200,
          });
          // CRITICAL: Always set state when srcObject appears
          setHasSrcObject(true);
          setHasVideoStream(true); // CRITICAL: Also set hasVideoStream immediately
          hasSrcObjectSetRef.current = true;
          lastSrcObjectRef.current = currentSrcObject;
          
          // Try to play immediately
          if (video.paused) {
            video.play().catch((err) => {
              console.warn('[AvatarSDKSimple] ⚠️ Could not play on srcObject change:', err);
              // Try muted
              const wasMuted = video.muted;
              video.muted = true;
              video.play().then(() => {
                console.log('[AvatarSDKSimple] ✅ Video playing muted');
                if (!wasMuted) {
                  setTimeout(() => {
                    video.muted = false;
                  }, 100);
                }
              }).catch((err2) => {
                console.error('[AvatarSDKSimple] ❌ Could not play even muted:', err2);
              });
            });
          }
        } else {
          console.log('[AvatarSDKSimple] ⚠️ srcObject removed');
          setHasSrcObject(false);
          hasSrcObjectSetRef.current = false;
          lastSrcObjectRef.current = null;
        }
      } else if (currentSrcObject && !hasSrcObjectSetRef.current) {
        // CRITICAL FIX: If srcObject exists but state isn't set, set it now
        // This handles cases where the ref check missed the initial attachment
        console.log('[AvatarSDKSimple] 🔧 srcObject exists but state not set - fixing now!');
        setHasSrcObject(true);
        setHasVideoStream(true); // CRITICAL: Also set hasVideoStream
        hasSrcObjectSetRef.current = true;
        lastSrcObjectRef.current = currentSrcObject;
      }
      
      // Stop checking after max attempts (to avoid infinite loop)
      if (checkCount >= MAX_CHECKS && !currentSrcObject) {
        console.error('[AvatarSDKSimple] ❌ TIMEOUT: srcObject never appeared after 20 seconds!', {
          isConnected,
          sessionStarted,
          hasVideoElement: !!videoElementRef.current,
          videoReadyState: video.readyState,
          videoSrc: video.src ? 'present' : 'none',
          videoError: video.error ? {
            code: video.error.code,
            message: video.error.message
          } : null,
          attemptCount: attachAttemptCountRef.current,
        });
        console.error('[AvatarSDKSimple] 🔍 Troubleshooting:');
        console.error('[AvatarSDKSimple]   1. Check if LiveAvatar API key is valid');
        console.error('[AvatarSDKSimple]   2. Check if avatar ID is correct');
        console.error('[AvatarSDKSimple]   3. Check browser console for WebRTC errors');
        console.error('[AvatarSDKSimple]   4. Check if firewall/VPN is blocking WebRTC');
        console.error('[AvatarSDKSimple]   5. Try refreshing the page');
        
        // Try to force a re-attachment if we haven't exceeded max attempts
        if (attachAttemptCountRef.current < MAX_ATTACH_ATTEMPTS) {
          attachAttemptCountRef.current += 1;
          console.log(`[AvatarSDKSimple] 🔄 Attempting to re-attach video (attempt ${attachAttemptCountRef.current}/${MAX_ATTACH_ATTEMPTS})...`);
          
          // Trigger a re-render by setting video element to null and back
          // This will cause the SDK's attach logic to run again
          const currentVideo = videoElementRef.current;
          setVideoElement(null);
          
          setTimeout(() => {
            if (currentVideo) {
              setVideoElement(currentVideo);
              console.log('[AvatarSDKSimple] ✅ Video element reset complete, SDK should re-attach');
            }
          }, 1000);
        } else {
          // Max attempts reached, set error
          console.error('[AvatarSDKSimple] ❌ Max attachment attempts reached, giving up');
          setError('Failed to load avatar video stream after multiple attempts. Please check your connection and refresh the page.');
        }
        
        // Don't clear interval - keep checking but less frequently
      }
    };

    // Check frequently enough to catch stream quickly (every 200ms)
    const interval = setInterval(checkSrcObject, 200);

    return () => clearInterval(interval);
  }, [isConnected, sessionStarted]);

  // Force video element visibility when connected (even without srcObject yet)
  // This helps debug - we'll see if the video element itself is the issue
  useEffect(() => {
    if (isConnected && sessionStarted && videoElementRef.current) {
      const video = videoElementRef.current;
      let playAttempted = false; // Track if we've already tried to play
      
      // Log video element state for debugging every 5 seconds (less frequent to reduce re-renders)
      const debugInterval = setInterval(() => {
        // Only log if video isn't playing yet (to reduce console spam)
        if (!video.srcObject || video.paused) {
          console.log('[AvatarSDKSimple] 🔍 Video element debug state:', {
            hasSrcObject: !!video.srcObject,
            isMediaStream: video.srcObject instanceof MediaStream,
            hasTracks: video.srcObject instanceof MediaStream ? video.srcObject.getTracks().length : 0,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            readyState: video.readyState,
            paused: video.paused,
            muted: video.muted,
            volume: video.volume,
          });
        }
        
        // If we have srcObject but video isn't playing, try to play (only once)
        if (video.srcObject && video.paused && !playAttempted) {
          playAttempted = true;
          console.log('[AvatarSDKSimple] 🔄 Attempting to play video with srcObject...');
          video.play().catch((err) => {
            console.warn('[AvatarSDKSimple] ⚠️ Play failed:', err);
            // Try muted
            const wasMuted = video.muted;
            video.muted = true;
            video.play().then(() => {
              console.log('[AvatarSDKSimple] ✅ Video playing muted');
              if (!wasMuted) {
                setTimeout(() => {
                  video.muted = false;
                }, 100);
              }
            }).catch((err2) => {
              console.error('[AvatarSDKSimple] ❌ Could not play even muted:', err2);
            });
          });
        }
      }, 5000); // Reduced frequency to 5 seconds
      
      return () => clearInterval(debugInterval);
    }
  }, [isConnected, sessionStarted]); // REMOVED hasVideoStream and hasSrcObject to prevent re-runs

  // Track last loading state to prevent unnecessary updates
  const lastLoadingStateRef = React.useRef<'connecting' | 'loading-avatar' | null>(null);
  
  // Manage loading state transitions with minimum display time to prevent flickering
  useEffect(() => {
    if (!sessionStarted || error) {
      if (lastLoadingStateRef.current !== null) {
        setDisplayedLoadingState(null);
        loadingStateStartTimeRef.current = 0;
        lastLoadingStateRef.current = null;
      }
      return;
    }

    const now = Date.now();
    const timeSinceStateStart = loadingStateStartTimeRef.current > 0 
      ? now - loadingStateStartTimeRef.current 
      : MIN_LOADING_STATE_DURATION + 1; // If no start time, allow immediate transition

    // CRITICAL: Check video element directly for srcObject (more reliable than state)
    const videoHasStream = videoElementRef.current?.srcObject instanceof MediaStream;
    const videoHasDimensions = (videoElementRef.current?.videoWidth || 0) > 0 && (videoElementRef.current?.videoHeight || 0) > 0;
    const videoIsPlaying = videoElementRef.current && !videoElementRef.current.paused && !videoElementRef.current.ended;
    
    // CRITICAL: Check if video is ready (multiple indicators)
    const videoIsReady = videoHasStream || videoHasDimensions || videoIsPlaying || hasVideoStream || hasSrcObject;
    
    console.log('[AvatarSDKSimple] 🔍 Loading state check:', {
      isConnected,
      sessionStarted,
      videoIsReady,
      videoHasStream,
      videoHasDimensions,
      videoIsPlaying,
      hasVideoStream,
      hasSrcObject,
      displayedLoadingState,
      lastLoadingStateRef: lastLoadingStateRef.current,
    });
    
    // CRITICAL FIX: If video is ready, ALWAYS clear loading immediately
    if (videoIsReady) {
      if (displayedLoadingState !== null) {
        console.log('[AvatarSDKSimple] 🎯 Video ready - forcing loading state to clear immediately!');
        setDisplayedLoadingState(null);
        loadingStateStartTimeRef.current = 0;
        lastLoadingStateRef.current = null;
      }
      return; // Exit early - video is ready
    }
    
    // Determine what loading state should be shown based on actual connection status
    let targetState: 'connecting' | 'loading-avatar' | null = null;
    
    if (!isConnected) {
      targetState = 'connecting';
    } else {
      // Connected but video not ready yet
      targetState = 'loading-avatar';
    }

    // Only update if state actually changed to prevent infinite loops
    if (targetState === lastLoadingStateRef.current) {
      return; // No change needed
    }

    // Update state if it changed
    lastLoadingStateRef.current = targetState;
    setDisplayedLoadingState(targetState);
    loadingStateStartTimeRef.current = now;
  }, [sessionStarted, isConnected, hasVideoStream, hasSrcObject, error, displayedLoadingState]); // Added displayedLoadingState to ensure we react when it needs clearing

  // Show "Say Hello" message when avatar is ready, then auto-dismiss after 4 seconds
  useEffect(() => {
    if (isConnected && (hasVideoStream || hasSrcObject) && !error && !conversationStarted) {
      // Show the message
      setShowHelloMessage(true);
      
      // Auto-dismiss after 4 seconds
      const timer = setTimeout(() => {
        setShowHelloMessage(false);
      }, 4000); // 4 seconds

      return () => {
        clearTimeout(timer);
      };
    } else {
      // Hide immediately if conditions change
      setShowHelloMessage(false);
    }
  }, [isConnected, hasVideoStream, hasSrcObject, error, conversationStarted]);
  
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
    // Reset loading state when starting new session
    setDisplayedLoadingState('connecting');
    loadingStateStartTimeRef.current = Date.now();
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

  // Derived UI state helpers
  const showVideoFeed = isConnected && (hasVideoStream || hasSrcObject);
  const showAvatarPlaceholder = sessionStarted && !showVideoFeed && !error;
  
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

  const loadingHeadline = displayedLoadingState === 'connecting'
    ? `Connecting to ${avatar.name}`
    : `Preparing ${avatar.name}`;
  const loadingSubcopy = displayedLoadingState === 'connecting'
    ? 'Establishing secure voice & video session…'
    : 'Bringing the live stream online…';

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

        {/* Placeholder avatar while we wait for the live stream */}
        {showAvatarPlaceholder && (
          <div className="absolute inset-0 overflow-hidden">
            <img
              src={avatar.imageUrl}
              alt={`${avatar.name} placeholder`}
              className="h-full w-full object-cover scale-105 blur-[1px] brightness-90"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-slate-900/20 via-slate-950/60 to-black/80" />
            <div className="absolute inset-x-4 bottom-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/10 px-5 py-3 backdrop-blur text-white shadow-2xl">
              <div className="h-12 w-12 overflow-hidden rounded-xl border border-white/20 shadow-lg shadow-black/40">
                <img src={avatar.imageUrl} alt={avatar.name} className="h-full w-full object-cover" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-white/70">Avatar preparing</p>
                <p className="text-base font-semibold">{avatar.name}</p>
              </div>
            </div>
          </div>
        )}

        {/* After session started but still connecting or waiting for video stream */}
        {sessionStarted && displayedLoadingState && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 backdrop-blur">
            <div className="flex flex-col items-center gap-4 text-center text-white animate-in fade-in duration-300">
              <div className="relative h-16 w-16">
                <span className="absolute inset-0 rounded-full border-2 border-white/20" />
                <span className="absolute inset-1 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
                <span className="absolute inset-3 rounded-full bg-gradient-to-tr from-sky-500 to-cyan-300 opacity-60 animate-pulse" />
              </div>
              <div>
                <p className="text-sm font-semibold tracking-wider uppercase text-white/80">{loadingHeadline}</p>
                <p className="mt-1 text-xs text-white/60">{loadingSubcopy}</p>
              </div>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-white/50">
                <span className="h-1.5 w-1.5 rounded-full bg-white/60 animate-bounce"></span>
                <span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce [animation-delay:120ms]"></span>
                <span className="h-1.5 w-1.5 rounded-full bg-white/30 animate-bounce [animation-delay:240ms]"></span>
              </div>
              {isConnected && !hasVideoStream && !hasSrcObject && (
                <p className="text-[11px] text-white/40">
                  Connection established, waiting for live video…
                </p>
              )}
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
          {showVideoFeed && !error && (
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

          {/* "Say Hello" Message - Shows when avatar is ready, auto-dismisses after 4 seconds */}
          {showHelloMessage && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/20 backdrop-blur-sm animate-in fade-in duration-300">
              <div className="relative mx-4 rounded-2xl bg-white/95 px-6 py-5 text-center shadow-2xl backdrop-blur-sm animate-in zoom-in-95 duration-300">
                <button
                  type="button"
                  onClick={() => setShowHelloMessage(false)}
                  className="absolute right-3 top-3 rounded-full bg-black/5 p-1 text-gray-500 transition hover:bg-black/10 hover:text-gray-700"
                  aria-label="Dismiss welcome message"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div className="mb-3 flex justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                    <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                </div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900">
                  Avatar is Ready!
                </h3>
                <p className="text-sm text-gray-600">
                  Say hello to start the conversation
                </p>
                <div className="mt-4 flex items-center justify-center gap-2 text-xs text-gray-500">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  <span>Speak naturally - your microphone is active</span>
                </div>
              </div>
            </div>
          )}

          {/* Video element */}
          <video
            ref={videoRefCallback}
            autoPlay
            playsInline
            muted={false}
            className="h-full w-full object-cover"
            style={{ 
              opacity: showVideoFeed ? 1 : 0,
              visibility: showVideoFeed ? 'visible' : 'hidden',
              transition: 'opacity 0.2s ease-in-out'
            }}
            onLoadedData={(e) => {
              const target = e.target as HTMLVideoElement;
              // IMPROVED: Consider stream valid if srcObject exists (MediaStream) even without dimensions
              const srcObjectExists = !!target.srcObject;
              const isMediaStream = target.srcObject instanceof MediaStream;
              const hasDimensions = target.videoWidth > 0 && target.videoHeight > 0;
              const hasValidStream = srcObjectExists && (isMediaStream || hasDimensions);
              
              console.log('[AvatarSDKSimple] Video data loaded', {
                hasVideo: hasValidStream,
                hasSrcObject: srcObjectExists,
                isMediaStream,
                videoWidth: target.videoWidth,
                videoHeight: target.videoHeight,
                readyState: target.readyState,
              });
              
              // Update both states
              if (srcObjectExists) {
                setHasSrcObject(true);
              }
              setHasVideoStream(hasValidStream);
              
              // Ensure video is playing
              if (hasValidStream && target.paused) {
                target.play().catch((err) => {
                  console.warn('[AvatarSDKSimple] Could not play on loadedData:', err);
                });
              }
            }}
            onLoadedMetadata={(e) => {
              const target = e.target as HTMLVideoElement & { audioTracks?: { length: number } };
              // IMPROVED: Consider stream valid if srcObject exists (MediaStream) even without dimensions
              const srcObjectExists = !!target.srcObject;
              const isMediaStream = target.srcObject instanceof MediaStream;
              const hasDimensions = target.videoWidth > 0 && target.videoHeight > 0;
              const hasValidStream = srcObjectExists && (isMediaStream || hasDimensions);
              
              console.log('[AvatarSDKSimple] Video metadata loaded', {
                hasVideo: hasValidStream,
                hasSrcObject: srcObjectExists,
                isMediaStream,
                videoWidth: target.videoWidth,
                videoHeight: target.videoHeight,
                hasAudio: target.audioTracks ? target.audioTracks.length > 0 : undefined,
                muted: target.muted,
                volume: target.volume,
                paused: target.paused,
                readyState: target.readyState,
              });
              
              // Update both states
              if (srcObjectExists) {
                setHasSrcObject(true);
              }
              setHasVideoStream(hasValidStream);
              
              // NOTE: Don't manipulate muted state here - the SDK controls this
              // If Web Audio API is being used, the video element stays muted
              // If HTML5 audio is being used, the SDK will unmute it
              
              // CRITICAL: Try to play if paused - this ensures video shows up
              if (hasValidStream && target.paused) {
                console.log('[AvatarSDKSimple] 🔄 Video has valid stream but paused - attempting to play...');
                target.play().catch((err) => {
                  console.warn('[AvatarSDKSimple] Autoplay prevented, trying muted first:', err);
                  // Try playing muted first (browser autoplay workaround)
                  const wasMuted = target.muted;
                  target.muted = true;
                  target.play().then(() => {
                    console.log('[AvatarSDKSimple] ✅ Video playing (muted for autoplay)');
                    // Restore muted state after a moment if needed
                    if (!wasMuted) {
                      setTimeout(() => {
                        target.muted = false;
                        console.log('[AvatarSDKSimple] ✅ Video unmuted after autoplay workaround');
                      }, 100);
                    }
                  }).catch((err2) => {
                    console.error('[AvatarSDKSimple] ❌ Failed to play even muted:', err2);
                  });
                });
              }
            }}
            onPlay={() => {
              console.log('[AvatarSDKSimple] ✅ Video started playing');
              // If video is playing, it means we have a valid stream
              if (videoElementRef.current) {
                const video = videoElementRef.current;
                const srcObjectExists = !!video.srcObject;
                const hasValidStream = srcObjectExists && !video.paused && !video.ended;
                console.log('[AvatarSDKSimple] Video play event - setting hasVideoStream:', {
                  hasValidStream,
                  hasSrcObject: srcObjectExists,
                  paused: video.paused,
                  ended: video.ended,
                  videoWidth: video.videoWidth,
                  videoHeight: video.videoHeight,
                  readyState: video.readyState,
                });
                if (srcObjectExists) {
                  setHasSrcObject(true);
                }
                setHasVideoStream(hasValidStream);
              }
            }}
            onPlaying={() => {
              console.log('[AvatarSDKSimple] ✅ Video is playing');
              // If video is playing, it means we have a valid stream
              // Set hasVideoStream immediately when playing starts
              if (videoElementRef.current) {
                const video = videoElementRef.current;
                // Video is playing = valid stream (even if dimensions aren't set yet)
                const srcObjectExists = !!video.srcObject;
                const hasValidStream = srcObjectExists && !video.paused && !video.ended;
                console.log('[AvatarSDKSimple] ✅ Video playing - setting hasVideoStream:', {
                  hasValidStream,
                  hasSrcObject: srcObjectExists,
                  isMediaStream: video.srcObject instanceof MediaStream,
                  paused: video.paused,
                  ended: video.ended,
                  videoWidth: video.videoWidth,
                  videoHeight: video.videoHeight,
                  readyState: video.readyState,
                });
                if (srcObjectExists) {
                  setHasSrcObject(true);
                }
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



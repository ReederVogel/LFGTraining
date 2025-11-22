'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { AVATAR_CONFIG } from '@/lib/avatar-config';
import { correctAndLog } from '@/lib/speech-corrections';

/**
 * ========================================
 * SPEAKER DETECTION SYSTEM
 * ========================================
 * 
 * CRITICAL: This file handles speaker detection (user vs avatar)
 * 
 * HOW IT WORKS:
 * 
 * 1. USER MESSAGES come from: 'user.transcription_ended' event
 *    - This is the PRIMARY and AUTHORITATIVE source for user speech
 *    - Always attributed to user, no guessing needed
 * 
 * 2. AVATAR MESSAGES come from: 'avatar.transcription' AND 'avatar.transcription_ended' events
 *    - These events are for AVATAR speech
 *    - Default to avatar unless explicit role='user' 
 *    - Use avatarSpeakingRef flag as primary indicator
 * 
 * 3. NEVER mix them up!
 *    - User messages going to avatar = avatar talks to itself
 *    - Avatar messages going to user = conversation breaks
 * 
 * SIMPLIFIED LOGIC (NO complex timing heuristics):
 *    - If event is 'user.transcription_ended' → USER (100%)
 *    - If event is 'avatar.transcription' → AVATAR (unless explicit role='user')
 *    - If avatarSpeakingRef.current === true → AVATAR (100%)
 * 
 * ========================================
 */

export interface UseLiveAvatarSDKOptions {
  avatarId: string;
  contextId?: string;
  sessionLanguage?: string;
  onTranscript?: (speaker: 'user' | 'avatar', text: string, isFinal: boolean) => void;
  onStatus?: (status: 'idle' | 'listening' | 'thinking' | 'speaking') => void;
  onError?: (error: string) => void;
  enabled?: boolean;
  videoElement?: HTMLVideoElement | null;
}

export function useLiveAvatarSDK({
  avatarId,
  contextId,
  sessionLanguage = 'en',
  onTranscript,
  onStatus,
  onError,
  enabled = true,
  videoElement,
}: UseLiveAvatarSDKOptions) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<any>(null); // LiveAvatarSession type
  const voiceChatRef = useRef<any>(null); // VoiceChat type
  const avatarSpeakingRef = useRef<boolean>(false); // Track avatar speaking state for transcript validation
  const lastAvatarSpeakTimeRef = useRef<number>(0); // Track when avatar last spoke
  const lastUserSpeakTimeRef = useRef<number>(0); // Track when user last spoke (to avoid mislabeling)
  const videoElementRef = useRef<HTMLVideoElement | null>(null); // Keep latest video element reference
  const isInterruptedRef = useRef<boolean>(false); // Track if avatar was interrupted
  const currentResponseRef = useRef<string>(''); // Track current avatar response to cancel on interrupt
  const currentAvatarTranscriptRef = useRef<string>(''); // Track accumulating avatar transcript
  const finalizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSentTranscriptRef = useRef<string>(''); // Track last sent transcript to prevent duplicates
  const lastTranscriptTimeRef = useRef<number>(0); // Track when last transcript was sent
  const recentTranscriptsRef = useRef<Array<{ text: string; time: number; speaker: 'user' | 'avatar' }>>([]);  // Track recent transcripts to prevent repetition
  const speakingStartTimeRef = useRef<number>(0); // Track when avatar started speaking for max duration check
  const maxSpeakingDurationTimerRef = useRef<NodeJS.Timeout | null>(null); // Timer to auto-stop avatar if speaking too long
  const currentSpeakingWordsRef = useRef<string[]>([]); // Track words being spoken in real-time to detect repetition
  const lastInterruptTimeRef = useRef<number>(0);
  const stateCheckIntervalRef = useRef<NodeJS.Timeout | null>(null); // Periodic state sync checker // Track when last interrupt happened to debounce
  const isProcessingInterruptRef = useRef<boolean>(false); // Prevent multiple simultaneous interrupts
  const videoHealthCheckIntervalRef = useRef<NodeJS.Timeout | null>(null); // Interval for checking video health
  const lastVideoTimeRef = useRef<number>(0); // Track last video currentTime to detect frozen video
  const lastVideoFrameRef = useRef<number>(0); // Track last video frame to detect repeating animations
  const audioContextRef = useRef<AudioContext | null>(null); // Web Audio API context for precise audio control
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null); // Audio source node
  const audioGainRef = useRef<GainNode | null>(null); // Audio gain node for instant muting
  const userSpeakStartTimeRef = useRef<number>(0); // Track when user started speaking
  const userTranscriptionTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Timeout to detect missing transcriptions
  const sessionKeepaliveIntervalRef = useRef<NodeJS.Timeout | null>(null); // Keepalive to prevent session timeout
  const lastActivityTimeRef = useRef<number>(Date.now()); // Track last activity to detect stalls
  const connectionHealthIntervalRef = useRef<NodeJS.Timeout | null>(null); // Monitor connection health
  const reconnectAttemptsRef = useRef<number>(0); // Track reconnection attempts
  const sessionExpirationTimeRef = useRef<number>(0); // Track when session expires
  const videoInitializedRef = useRef<boolean>(false); // Track if video has ever been ready
  const lastGoodVideoStateTimeRef = useRef<number>(Date.now()); // Track when video was last in good state
  const intentionalDisconnectRef = useRef<boolean>(false); // Track if disconnection is intentional (user clicked End Session)

  // Helper to check if a transcript was recently sent (within 5 seconds)
  // CRITICAL: Only checks against transcripts from the SAME speaker
  // This prevents user messages from being blocked by similar avatar messages
  const isRecentDuplicate = useCallback((text: string, speaker: 'user' | 'avatar'): boolean => {
    const normalizedText = text.trim();
    const now = Date.now();
    
    // Clean up old entries (older than 5 seconds)
    recentTranscriptsRef.current = recentTranscriptsRef.current.filter(
      entry => now - entry.time < 5000
    );
    
    // Check for EXACT duplicates within the time window
    // For USER messages: Use 1 second window (very short to allow legitimate repeated words)
    // For AVATAR messages: Use 3 second window (longer since avatar shouldn't repeat)
    const timeWindow = speaker === 'user' ? 1000 : 3000;
    
    const isDuplicate = recentTranscriptsRef.current.some(
      entry => entry.speaker === speaker && 
               entry.text === normalizedText && 
               now - entry.time < timeWindow
    );
    
    if (isDuplicate && speaker === 'user') {
      console.log(`[LiveAvatarSDK] 🔍 Duplicate check: Found exact match within ${timeWindow}ms for USER message`);
    }
    
    return isDuplicate;
  }, []);

  // Helper to record a sent transcript
  const recordTranscript = useCallback((text: string, speaker: 'user' | 'avatar') => {
    const normalizedText = text.trim();
    const now = Date.now();
    recentTranscriptsRef.current.push({ text: normalizedText, time: now, speaker });
  }, []);

  // Helper to detect real-time repetition during speaking
  const detectRealTimeRepetition = useCallback((newText: string): boolean => {
    const words = newText.trim().toLowerCase().split(/\s+/);
    const normalizedText = newText.trim().toLowerCase();
    
    // CRITICAL: Detect apology/confusion loops immediately
    // These phrases indicate the avatar is stuck or confused
    const confusionPhrases = [
      "i'm sorry, could you repeat that",
      "could you repeat that",
      "i'm just trying to keep track",
      "thank you for your patience",
      "i didn't quite catch that",
      "could you say that again",
      "i'm having trouble understanding",
      "let me make sure i understand",
      "can you clarify",
    ];
    
    // Check if current text contains any confusion phrases
    const hasConfusionPhrase = confusionPhrases.some(phrase => 
      normalizedText.includes(phrase)
    );
    
    if (hasConfusionPhrase) {
      // Check if we've seen confusion phrases recently (within last 30 seconds)
      const recentConfusion = recentTranscriptsRef.current
        .filter(t => t.speaker === 'avatar' && Date.now() - t.time < 30000)
        .some(t => confusionPhrases.some(phrase => t.text.toLowerCase().includes(phrase)));
      
      if (recentConfusion) {
        console.log('[LiveAvatarSDK] 🚨 CONFUSION LOOP DETECTED - Avatar is stuck and repeating apologies!');
        console.log('[LiveAvatarSDK] 🛑 Will force stop and reset conversation state');
        return true;
      }
    }
    
    // Add new words to current speaking words
    currentSpeakingWordsRef.current.push(...words);
    
    // Keep only last 50 words to check for repetition patterns
    if (currentSpeakingWordsRef.current.length > 50) {
      currentSpeakingWordsRef.current = currentSpeakingWordsRef.current.slice(-50);
    }
    
    // Check if the same phrase is being repeated (e.g., "that sounds good" repeated 3+ times)
    const recentWords = currentSpeakingWordsRef.current.slice(-20); // Check last 20 words
    
    // Look for patterns of 2-5 word phrases repeated consecutively
    for (let phraseLength = 2; phraseLength <= 5; phraseLength++) {
      if (recentWords.length >= phraseLength * 3) {
        const lastPhrase = recentWords.slice(-phraseLength).join(' ');
        const secondLastPhrase = recentWords.slice(-phraseLength * 2, -phraseLength).join(' ');
        const thirdLastPhrase = recentWords.slice(-phraseLength * 3, -phraseLength * 2).join(' ');
        
        // If the same phrase appears 3 times in a row, it's a repetition
        if (lastPhrase === secondLastPhrase && secondLastPhrase === thirdLastPhrase) {
          console.log('[LiveAvatarSDK] 🚨 REAL-TIME REPETITION DETECTED:', lastPhrase);
          return true;
        }
      }
    }
    
    return false;
  }, []);

  // Helper to reset conversation state completely (for when avatar gets confused/stuck)
  const resetConversationState = useCallback(async () => {
    console.log('[LiveAvatarSDK] 🔄 RESETTING CONVERSATION STATE - Avatar was stuck/confused');
    
    // Clear ALL transcript history to give avatar a fresh start
    recentTranscriptsRef.current = [];
    currentAvatarTranscriptRef.current = '';
    currentResponseRef.current = '';
    currentSpeakingWordsRef.current = [];
    lastSentTranscriptRef.current = '';
    lastTranscriptTimeRef.current = 0;
    
    // Reset timing references
    lastAvatarSpeakTimeRef.current = 0;
    lastUserSpeakTimeRef.current = 0;
    speakingStartTimeRef.current = 0;
    
    // Clear all timers
    if (maxSpeakingDurationTimerRef.current) {
      clearTimeout(maxSpeakingDurationTimerRef.current);
      maxSpeakingDurationTimerRef.current = null;
    }
    
    if (finalizeTimeoutRef.current) {
      clearTimeout(finalizeTimeoutRef.current);
      finalizeTimeoutRef.current = null;
    }
    
    if (userTranscriptionTimeoutRef.current) {
      clearTimeout(userTranscriptionTimeoutRef.current);
      userTranscriptionTimeoutRef.current = null;
    }
    
    // Reset all flags
    isInterruptedRef.current = false;
    avatarSpeakingRef.current = false;
    isProcessingInterruptRef.current = false;
    
    // Update UI state
    setIsSpeaking(false);
    onStatus?.('idle');
    
    console.log('[LiveAvatarSDK] ✅ Conversation state reset complete - ready for fresh start');
  }, [onStatus]);

  // Helper to force stop avatar immediately
  const forceStopAvatar = useCallback(async () => {
    console.log('[LiveAvatarSDK] 🛑 FORCE STOPPING AVATAR');
    
    // Mark as interrupted and record time
    isInterruptedRef.current = true;
    lastInterruptTimeRef.current = Date.now();
    
    // Clear all timers and state
    if (maxSpeakingDurationTimerRef.current) {
      clearTimeout(maxSpeakingDurationTimerRef.current);
      maxSpeakingDurationTimerRef.current = null;
    }
    
    if (finalizeTimeoutRef.current) {
      clearTimeout(finalizeTimeoutRef.current);
      finalizeTimeoutRef.current = null;
    }
    
    // Reset speaking time tracker
    speakingStartTimeRef.current = 0;
    
    // Clear all tracking
    currentAvatarTranscriptRef.current = '';
    currentResponseRef.current = '';
    currentSpeakingWordsRef.current = [];
    lastSentTranscriptRef.current = '';
    
    // Stop video playback AND clear buffers
    if (videoElementRef.current) {
      try {
        const video = videoElementRef.current;
        
        // CRITICAL: Instantly mute audio using Web Audio API for immediate cutoff (if available)
        if (audioGainRef.current && audioContextRef.current) {
          try {
            audioGainRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime);
            console.log('[LiveAvatarSDK] ✅ Audio instantly muted via Web Audio API');
          } catch (e) {
            console.warn('[LiveAvatarSDK] Could not mute via Web Audio:', e);
          }
        }
        
        // Always mute video element as backup
        video.muted = true;
        video.pause();
        
        // CRITICAL: Clear video/audio buffers to prevent stuck playback
        // This removes any buffered audio/video chunks that haven't played yet
        const currentSrc = video.src;
        const currentSrcObject = video.srcObject;
        
        // For MediaStreams, temporarily disable tracks to flush buffers
        // DON'T disconnect the source entirely - that causes SRC_NOT_SUPPORTED errors
        if (currentSrcObject && currentSrcObject instanceof MediaStream) {
          const tracks = currentSrcObject.getTracks();
          console.log(`[LiveAvatarSDK] Temporarily disabling ${tracks.length} media tracks to flush buffers`);
          tracks.forEach(track => {
            const enabled = track.enabled;
            track.enabled = false;
            // Re-enable after a brief moment
            setTimeout(() => {
              track.enabled = enabled;
            }, 50);
          });
        }
        
        // DON'T clear srcObject for MediaStreams - causes browser to reject the source
        // Instead, just pause and the track disabling will flush buffers
        
        // Restore audio after clearing (Web Audio if available, otherwise video element)
        if (audioGainRef.current && audioContextRef.current) {
          try {
            // Gradually restore audio to avoid clicks
            audioGainRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime);
            audioGainRef.current.gain.linearRampToValueAtTime(1, audioContextRef.current.currentTime + 0.1);
            // Keep video muted since Web Audio handles audio
            console.log('[LiveAvatarSDK] ✅ Video buffers cleared and audio restored (Web Audio)');
          } catch (e) {
            console.warn('[LiveAvatarSDK] Could not restore Web Audio:', e);
            video.muted = false;
            console.log('[LiveAvatarSDK] ✅ Video buffers cleared and audio restored (HTML5)');
          }
        } else {
          video.muted = false;
          console.log('[LiveAvatarSDK] ✅ Video buffers cleared and audio restored (HTML5)');
        }
      } catch (e) {
        console.warn('[LiveAvatarSDK] Could not clear video buffers:', e);
      }
    }
    
    // Send interrupt command
    if (sessionRef.current) {
      try {
        // @ts-ignore
        const room = sessionRef.current.room || sessionRef.current.livekitRoom;
        if (room && room.localParticipant) {
          const commands = ['avatar.interrupt', 'avatar.stop_speaking'];
          for (const command of commands) {
            const eventData = JSON.stringify({ type: command });
            const data = new TextEncoder().encode(eventData);
            await room.localParticipant.publishData(data, { reliable: true });
          }
        }
      } catch (e) {
        console.warn('[LiveAvatarSDK] Error sending stop command:', e);
      }
    }
    
    // Update UI state
    setIsSpeaking(false);
    avatarSpeakingRef.current = false;
    onStatus?.('idle');
    
    console.log('[LiveAvatarSDK] ✅ Avatar force stopped');
  }, [onStatus]);

  // Helper to finalize the current avatar transcript
  const finalizeAvatarTranscript = useCallback(() => {
    if (finalizeTimeoutRef.current) {
      clearTimeout(finalizeTimeoutRef.current);
      finalizeTimeoutRef.current = null;
    }
    
    if (currentAvatarTranscriptRef.current && onTranscript) {
      const normalizedText = currentAvatarTranscriptRef.current.trim();
      
      // Check if this is a duplicate of what we already sent
      if (normalizedText === lastSentTranscriptRef.current.trim() || isRecentDuplicate(normalizedText, 'avatar')) {
        console.log('[LiveAvatarSDK] ⚠️ Duplicate transcript in finalize, skipping:', normalizedText.substring(0, 50));
        currentAvatarTranscriptRef.current = '';
        return;
      }
      
      console.log('[LiveAvatarSDK] 📝 Finalizing avatar transcript:', normalizedText.substring(0, 50));
      lastSentTranscriptRef.current = normalizedText;
      lastTranscriptTimeRef.current = Date.now();
      recordTranscript(normalizedText, 'avatar');
      onTranscript('avatar', currentAvatarTranscriptRef.current, true);
      currentAvatarTranscriptRef.current = '';
    }
  }, [onTranscript, isRecentDuplicate, recordTranscript]);

  // Set up SDK event listeners
  const setupEventListeners = useCallback((session: any) => {
    if (!session) return;

    console.log('[LiveAvatarSDK] 📡 Setting up event listeners...');

    // DEBUG: Intercept ALL events to see what's being fired
    const eventLog: string[] = [];
    const originalOn = session.on?.bind(session);
    if (originalOn && typeof originalOn === 'function') {
      session.on = function(eventName: string, handler: any) {
        if (!eventLog.includes(eventName)) {
          console.log('[LiveAvatarSDK] 🎯 Registering listener for:', eventName);
          eventLog.push(eventName);
        }
        return originalOn(eventName, (...args: any[]) => {
          console.log(`[LiveAvatarSDK] 🔔 EVENT FIRED: ${eventName}`, args);
          return handler(...args);
        });
      };
    }

    // Session state events (use enum string values from SDK)
    session.on('session.state_changed', (state: any) => {
      console.log('[LiveAvatarSDK] 🔄 Session state changed:', state);
      console.log('[LiveAvatarSDK] 🔍 intentionalDisconnect flag:', intentionalDisconnectRef.current);
      lastActivityTimeRef.current = Date.now(); // Update activity time
      
      if (state === 'CONNECTED') {
        setIsConnected(true);
        setError(null);
        onStatus?.('idle');
        reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection
      }
      if (state === 'DISCONNECTED') {
        // Check if this was an intentional disconnection (user clicked "End Session")
        if (intentionalDisconnectRef.current) {
          console.log('[LiveAvatarSDK] ℹ️ Session disconnected intentionally (user ended session) - no error');
          setIsConnected(false);
          onStatus?.('idle');
          // Don't try to reconnect - user intentionally ended session
          return;
        }
        
        // Unintentional disconnection - connection was lost
        console.warn('[LiveAvatarSDK] ⚠️ Session DISCONNECTED - connection lost (unintentional)');
        setIsConnected(false);
        onStatus?.('idle');
        
        // Attempt to reconnect if not intentionally disconnected
        if (reconnectAttemptsRef.current < 3) {
          reconnectAttemptsRef.current++;
          console.log(`[LiveAvatarSDK] 🔄 Attempting reconnection (${reconnectAttemptsRef.current}/3)...`);
          
          setTimeout(() => {
            if (sessionRef.current && reconnectAttemptsRef.current > 0) {
              console.log('[LiveAvatarSDK] 🔄 Reconnecting session...');
              // Try to restart the session
              sessionRef.current.start().then(() => {
                console.log('[LiveAvatarSDK] ✅ Reconnection successful!');
                setIsConnected(true);
                setError(null);
              }).catch((err) => {
                console.error('[LiveAvatarSDK] ❌ Reconnection failed:', err);
                onError?.(`Connection lost. Reconnection attempt ${reconnectAttemptsRef.current} failed.`);
              });
            }
          }, 2000); // Wait 2 seconds before reconnecting
        } else {
          console.error('[LiveAvatarSDK] ❌ Max reconnection attempts reached (3)');
          onError?.('Connection lost. Please refresh the page to reconnect.');
        }
      }
    });

    session.on('session.disconnected', (reason: any) => {
      console.log('[LiveAvatarSDK] 📴 Session disconnected:', reason);
      
      // Check if it's a user-initiated disconnection (normal) or an error
      const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
      const isClientInitiated = reasonStr.includes('CLIENT_INITIATED') || reasonStr.includes('client_initiated');
      
      if (isClientInitiated) {
        console.log('[LiveAvatarSDK] ℹ️ User disconnected session (normal)');
      } else {
        console.warn('[LiveAvatarSDK] ⚠️ Disconnection reason:', reasonStr);
        
        // Check if it's an error disconnection
        if (reason && (reason.error || reason.code)) {
          const errorMsg = reason.error || reason.message || `Disconnected with code: ${reason.code}`;
          console.error('[LiveAvatarSDK] ❌ Disconnection error:', errorMsg);
          onError?.(`Connection error: ${errorMsg}`);
        }
      }
      
      setIsConnected(false);
      onStatus?.('idle');
    });

    // Avatar speech & transcription events from LiveAvatar SDK
    session.on('avatar.speak_started', (event: any) => {
      console.log('[LiveAvatarSDK] 🗣️ ========== AVATAR STARTED SPEAKING ==========');
      console.log('[LiveAvatarSDK] 🔊 Setting isSpeaking = TRUE');
      console.log('[LiveAvatarSDK] Event data:', event);
      console.log('[LiveAvatarSDK] 🔍 Interrupted state:', isInterruptedRef.current);
      console.log('[LiveAvatarSDK] 🔍 Current response ref:', currentResponseRef.current?.substring(0, 50) || 'empty');
      
      // Log recent avatar messages to detect repetition loops
      const recentAvatarMessages = recentTranscriptsRef.current
        .filter(t => t.speaker === 'avatar')
        .map(t => ({ text: t.text.substring(0, 40), timeAgo: `${((Date.now() - t.time) / 1000).toFixed(1)}s` }));
      
      if (recentAvatarMessages.length > 0) {
        console.log('[LiveAvatarSDK] 📝 Recent avatar messages (last 5s):', recentAvatarMessages);
      }
      
      // SAFETY CHECK: If still marked as interrupted, avatar might be trying to continue old response
      // This can happen if avatar doesn't properly stop and tries to resume
      if (isInterruptedRef.current) {
        console.log('[LiveAvatarSDK] ⚠️ WARNING: Avatar trying to speak while still marked as interrupted!');
        console.log('[LiveAvatarSDK] 🛑 This might be old response - stopping immediately');
        
        // Give it a very short grace period (100ms) to see if this is a new response
        // If user provided new input, isInterruptedRef would have been cleared
        setTimeout(() => {
          if (isInterruptedRef.current && avatarSpeakingRef.current) {
            console.log('[LiveAvatarSDK] 🚨 Confirmed old response - force stopping');
            forceStopAvatar();
            return;
          }
        }, 100);
      }
      
      // CRITICAL: Set avatarSpeakingRef IMMEDIATELY to prevent race conditions
      // This must happen FIRST before any other processing
      avatarSpeakingRef.current = true;
      lastAvatarSpeakTimeRef.current = Date.now();
      
      // Force finalize any previous transcript
      finalizeAvatarTranscript();
      
      // CRITICAL: Clear all transcript tracking to prevent duplicates
      currentAvatarTranscriptRef.current = '';
      lastSentTranscriptRef.current = '';
      lastTranscriptTimeRef.current = 0;
      currentSpeakingWordsRef.current = []; // Clear real-time repetition tracking
      
      // Track speaking start time
      speakingStartTimeRef.current = Date.now();
      
      // Set maximum speaking duration timer (20 seconds)
      // If avatar speaks longer than this, it's likely stuck - force stop and reset
      if (maxSpeakingDurationTimerRef.current) {
        clearTimeout(maxSpeakingDurationTimerRef.current);
      }
      maxSpeakingDurationTimerRef.current = setTimeout(() => {
        console.log('[LiveAvatarSDK] ⚠️ Avatar speaking for too long (>20s), likely stuck - force stopping and resetting...');
        forceStopAvatar().then(() => {
          setTimeout(() => {
            resetConversationState();
          }, 500);
        });
      }, 20000); // 20 seconds max (reduced from 30s)
      
      // Update UI state
      setIsSpeaking(true);
      isInterruptedRef.current = false; // Reset interrupted flag for new response
      onStatus?.('speaking');
      
      console.log('[LiveAvatarSDK] ✅ Avatar speaking state updated');
    });

    session.on('avatar.speak_ended', (event: any) => {
      console.log('[LiveAvatarSDK] 🛑 ========== AVATAR STOPPED SPEAKING ==========');
      console.log('[LiveAvatarSDK] 🔇 Setting isSpeaking = FALSE');
      console.log('[LiveAvatarSDK] Event data:', event);
      const wasInterrupted = isInterruptedRef.current;
      
      // Clear max speaking duration timer
      if (maxSpeakingDurationTimerRef.current) {
        clearTimeout(maxSpeakingDurationTimerRef.current);
        maxSpeakingDurationTimerRef.current = null;
      }
      
      // Clear real-time repetition tracking
      currentSpeakingWordsRef.current = [];
      
      // Log speaking duration
      if (speakingStartTimeRef.current > 0) {
        const duration = Date.now() - speakingStartTimeRef.current;
        console.log(`[LiveAvatarSDK] 📊 Avatar spoke for ${(duration / 1000).toFixed(1)}s`);
        speakingStartTimeRef.current = 0;
      }
      
      // DON'T clear buffers when speech ends - causes visible stuttering/blinking
      // Repetition is already prevented by transcript deduplication and real-time detection
      // Let the browser handle buffer management naturally for smooth playback
      
      // Update UI state immediately
      setIsSpeaking(false);
      onStatus?.('idle');
      
      if (wasInterrupted) {
        console.log('[LiveAvatarSDK] ⚠️ Avatar was interrupted - clearing current response');
        currentResponseRef.current = ''; // Clear any pending response
        currentAvatarTranscriptRef.current = ''; // Clear transcript too
        // Set avatarSpeakingRef to false immediately for interrupted speech
        avatarSpeakingRef.current = false;
        if (finalizeTimeoutRef.current) {
          clearTimeout(finalizeTimeoutRef.current);
          finalizeTimeoutRef.current = null;
        }
      } else {
        // CRITICAL FIX: Keep avatarSpeakingRef true for a brief grace period
        // to correctly attribute any delayed transcripts that are still arriving
        // This prevents misattribution of late avatar transcripts as user speech
        console.log('[LiveAvatarSDK] ⏳ Keeping avatarSpeakingRef=true for grace period to catch delayed transcripts');
        
        // Schedule finalization after grace period to catch delayed transcripts
        if (finalizeTimeoutRef.current) {
          clearTimeout(finalizeTimeoutRef.current);
        }
        
        finalizeTimeoutRef.current = setTimeout(() => {
          console.log('[LiveAvatarSDK] ⏰ Grace period ended - finalizing transcript and clearing avatar speaking flag');
          finalizeAvatarTranscript();
          avatarSpeakingRef.current = false;
        }, AVATAR_CONFIG.latency.transcriptGracePeriod);
      }
    });

    // --- NEW SERVER EVENTS (Performance Improvements) ---
    
    session.on('user.speak_started', () => {
      console.log('[LiveAvatarSDK] 🎤 ========== USER STARTED SPEAKING (Server Event) ==========');
      console.log('[LiveAvatarSDK] ⏱️ Timestamp:', new Date().toLocaleTimeString());
      
      // Record when user started speaking
      userSpeakStartTimeRef.current = Date.now();
      
      // Set timeout to detect if transcription never arrives (15 seconds)
      // NOTE: This timeout is for LiveAvatar SDK's server-side transcription
      // Browser speech recognition runs separately and is more reliable
      // So this timeout is mainly for diagnostics, not critical for functionality
      if (userTranscriptionTimeoutRef.current) {
        clearTimeout(userTranscriptionTimeoutRef.current);
      }
      userTranscriptionTimeoutRef.current = setTimeout(() => {
        console.warn('[LiveAvatarSDK] ⚠️ LiveAvatar SDK transcription did not arrive after 15 seconds');
        console.warn('[LiveAvatarSDK] This is expected if browser speech recognition is being used');
        console.warn('[LiveAvatarSDK] If browser speech is working, this warning can be ignored');
        // Don't call onError - browser speech recognition should be handling it
      }, 15000);
      
      // CRITICAL: If avatar is speaking, INTERRUPT IMMEDIATELY
      if (avatarSpeakingRef.current || isSpeaking) {
        console.log('[LiveAvatarSDK] 🚨 INTERRUPTION DETECTED - Avatar was speaking when user started!');
        console.log('[LiveAvatarSDK] 🛑 Forcing avatar to stop immediately...');
        
        // Mark as interrupted to prevent processing any pending responses
        isInterruptedRef.current = true;
        
        // Force stop the avatar (this clears responses and stops playback)
        interrupt();
        
        // Clear ALL pending data to prevent wrong/duplicate responses
        currentResponseRef.current = '';
        currentAvatarTranscriptRef.current = '';
        lastSentTranscriptRef.current = '';
        currentSpeakingWordsRef.current = [];
        
        console.log('[LiveAvatarSDK] ✅ Avatar interrupted and state cleared');
      }
      
      // Update status to listening
      onStatus?.('listening');
    });

    session.on('user.speak_ended', () => {
      console.log('[LiveAvatarSDK] 🤐 User stopped speaking (Server Event)');
      console.log('[LiveAvatarSDK] ⏱️ Timestamp:', new Date().toLocaleTimeString());
      console.log('[LiveAvatarSDK] ⚠️ Waiting for user.transcription_ended event...');
      console.log('[LiveAvatarSDK] 🔍 If transcription doesn\'t arrive in 10s, timeout will fire');
      
      // Calculate time since user started speaking
      if (userSpeakStartTimeRef.current > 0) {
        const speakDuration = Date.now() - userSpeakStartTimeRef.current;
        console.log(`[LiveAvatarSDK] 📊 User spoke for ${speakDuration}ms`);
        if (speakDuration < 500) {
          console.warn('[LiveAvatarSDK] ⚠️ Very short speech (<500ms) - might not be transcribed by SDK');
        }
      }
      
      // User stopped, system is processing/thinking
      onStatus?.('thinking');
    });

    session.on('user.transcription_started', () => {
       console.log('[LiveAvatarSDK] 👂 User transcription started (Server Event)');
    });

    session.on('user.transcription_ended', (event: any) => {
      console.log('[LiveAvatarSDK] 📝 ===== USER TRANSCRIPTION ENDED (PRIMARY USER SOURCE) =====');
      console.log('[LiveAvatarSDK] ⏱️ Timestamp:', new Date().toLocaleTimeString());
      
      // Clear timeout - transcription arrived!
      if (userTranscriptionTimeoutRef.current) {
        clearTimeout(userTranscriptionTimeoutRef.current);
        userTranscriptionTimeoutRef.current = null;
      }
      
      // Calculate transcription delay
      if (userSpeakStartTimeRef.current > 0) {
        const delay = Date.now() - userSpeakStartTimeRef.current;
        console.log(`[LiveAvatarSDK] ⏱️ Transcription delay: ${delay}ms`);
        if (delay > 5000) {
          console.warn(`[LiveAvatarSDK] ⚠️ HIGH TRANSCRIPTION DELAY: ${delay}ms (>5s)`);
        }
        userSpeakStartTimeRef.current = 0;
      }
      
      console.log('[LiveAvatarSDK] 📋 Event:', event);
      const text = event?.text || event?.transcript;
      console.log('[LiveAvatarSDK] 💬 User text:', text);
      
      if (!text || !text.trim()) {
        console.error('[LiveAvatarSDK] ❌ CRITICAL: user.transcription_ended fired but NO TEXT!');
        console.error('[LiveAvatarSDK] This is likely why user message was missed');
        console.error('[LiveAvatarSDK] Full event:', JSON.stringify(event, null, 2));
        return; // Don't process empty text
      }
      
      if (onTranscript) {
        // Apply corrections FIRST before any processing
        const correctedText = correctAndLog(text, 'user');
        const correctedNormalizedText = correctedText.trim();
        
        // SAFETY CHECK: Don't accept if text is too short (likely noise)
        if (correctedNormalizedText.length < 2) {
          console.warn('[LiveAvatarSDK] ⚠️ User text too short (noise?), skipping:', correctedNormalizedText);
          return;
        }
        
        // Count how many USER messages we've received so far
        const userMessageCount = recentTranscriptsRef.current.filter(t => t.speaker === 'user').length;
        console.log('[LiveAvatarSDK] 📊 User message count so far:', userMessageCount);
        
        // CRITICAL FIX: NEVER skip the first user message, even if duplicate detection thinks it's a duplicate
        // This fixes the issue where the first user message sometimes doesn't show up
        const isFirstUserMessage = userMessageCount === 0;
        
        if (isFirstUserMessage) {
          console.log('[LiveAvatarSDK] 🎉 This is the FIRST user message - ALWAYS accepting it (no duplicate check)');
        } else {
          // Check for EXACT duplicates ONLY against recent USER transcripts
          // Use 1 second window (reduced from 3s) to avoid blocking legitimate messages
          // Only block if it's the exact same corrected text within 1 second
          const now = Date.now();
          const isDuplicate = recentTranscriptsRef.current
            .filter(t => t.speaker === 'user' && now - t.time < 1000) // Changed: 1 second instead of 3
            .some(t => t.text === correctedNormalizedText); // Exact match only
          
          console.log('[LiveAvatarSDK] 🔍 Duplicate check result:', isDuplicate, 'for text:', correctedNormalizedText.substring(0, 50));
          console.log('[LiveAvatarSDK] 📊 Recent user transcripts in memory (last 1 second):', 
            recentTranscriptsRef.current
              .filter(t => t.speaker === 'user' && now - t.time < 1000)
              .map(t => ({ text: t.text.substring(0, 30), timeAgo: `${((now - t.time) / 1000).toFixed(2)}s` }))
          );
          
          if (isDuplicate) {
            console.warn('[LiveAvatarSDK] ⚠️ Exact duplicate USER transcript detected (within 1s), skipping:', correctedNormalizedText.substring(0, 50));
            console.warn('[LiveAvatarSDK] 🚨 USER MESSAGE BLOCKED - This is why transcript is not showing!');
            console.warn('[LiveAvatarSDK] 📊 Recent user transcripts that caused block:', 
              recentTranscriptsRef.current.filter(t => t.speaker === 'user').map(t => ({
                text: t.text.substring(0, 40),
                timeAgo: `${((Date.now() - t.time) / 1000).toFixed(1)}s ago`
              }))
            );
            return;
          }
        }
        
        // If this user input came after an interruption, this is NEW input
        // Reset interruption flag so avatar can respond to the new input
        if (isInterruptedRef.current) {
          console.log('[LiveAvatarSDK] ✅ User transcription after interruption - this is NEW input');
          isInterruptedRef.current = false; // Reset so avatar can respond to new input
        }
        
        // correctedText already applied above
        console.log('[LiveAvatarSDK] ========================================');
        console.log('[LiveAvatarSDK] 📢 USER TRANSCRIPT ABOUT TO BE SENT TO UI');
        console.log('[LiveAvatarSDK] ========================================');
        console.log('[LiveAvatarSDK] 📝 Text:', correctedText);
        console.log('[LiveAvatarSDK] 📝 Text length:', correctedText.length);
        console.log('[LiveAvatarSDK] 📝 Is final:', true);
        console.log('[LiveAvatarSDK] 📝 Speaker:', 'user');
        console.log('[LiveAvatarSDK] 📝 Has onTranscript callback:', !!onTranscript);
        console.log('[LiveAvatarSDK] 📝 Callback type:', typeof onTranscript);
        console.log('[LiveAvatarSDK] 📝 User message #:', userMessageCount + 1);
        console.log('[LiveAvatarSDK] 📝 Timestamp:', new Date().toISOString());
        
        lastUserSpeakTimeRef.current = Date.now();
        recordTranscript(correctedNormalizedText, 'user');
        
        console.log('[LiveAvatarSDK] 🚀 CALLING onTranscript NOW...');
        try {
          onTranscript('user', correctedText, true); // Send corrected text as final
          console.log('[LiveAvatarSDK] ✅ ✅ ✅ onTranscript callback executed successfully! ✅ ✅ ✅');
        } catch (error) {
          console.error('[LiveAvatarSDK] ❌ ERROR calling onTranscript:', error);
          throw error;
        }
        
        console.log('[LiveAvatarSDK] 📊 Total user messages sent to UI so far:', userMessageCount + 1);
        console.log('[LiveAvatarSDK] ========================================');
      } else {
        console.warn('[LiveAvatarSDK] ⚠️ No onTranscript callback available');
      }
    });

    session.on('avatar.transcription_started', () => {
      console.log('[LiveAvatarSDK] 💭 Avatar transcription started (Server Event)');
      onStatus?.('thinking');
    });

    session.on('avatar.transcription_ended', (event: any) => {
      console.log('[LiveAvatarSDK] 📝 ===== AVATAR TRANSCRIPTION ENDED =====');
      console.log('[LiveAvatarSDK] Event:', event);
      
      // CRITICAL: If avatar was interrupted, ignore this transcription
      // This prevents showing old/wrong responses after interruption
      if (isInterruptedRef.current) {
        console.log('[LiveAvatarSDK] ⚠️ Ignoring avatar transcription - avatar was interrupted');
        currentAvatarTranscriptRef.current = '';
        return;
      }
      
      const text = event?.text || event?.transcript;
      if (text && onTranscript) {
        // Apply funeral vocabulary corrections to avatar responses too
        const correctedText = correctAndLog(text, 'avatar');
        const normalizedText = correctedText.trim();
        const now = Date.now();
        
        // REAL-TIME REPETITION CHECK (CRITICAL - stops avatar immediately if repeating)
        if (avatarSpeakingRef.current && detectRealTimeRepetition(normalizedText)) {
          console.log('[LiveAvatarSDK] 🚨 REPETITION/CONFUSION DETECTED - FORCE STOPPING AND RESETTING');
          forceStopAvatar();
          // Give it a moment to stop, then reset conversation state completely
          setTimeout(() => {
            resetConversationState();
          }, 500);
          return;
        }
        
        // CRITICAL FIX: Check if avatar.transcription already sent this EXACT text very recently (within 100ms)
        // This prevents the duplicate when both avatar.transcription and avatar.transcription_ended fire with same content
        if (lastSentTranscriptRef.current.trim() === normalizedText && now - lastTranscriptTimeRef.current < 100) {
          console.log('[LiveAvatarSDK] ⚠️ DUPLICATE DETECTED: avatar.transcription_ended has same text as recent avatar.transcription, skipping:', normalizedText.substring(0, 50));
          currentAvatarTranscriptRef.current = '';
          return;
        }
        
        // ENHANCED DUPLICATE DETECTION:
        // 1. Check recent duplicates (within 5 seconds) - only against avatar transcripts
        if (isRecentDuplicate(normalizedText, 'avatar')) {
          console.warn('[LiveAvatarSDK] ⚠️ Duplicate AVATAR transcript detected (recent history), skipping:', normalizedText.substring(0, 50));
          console.warn('[LiveAvatarSDK] 🔍 This means the avatar is REPEATING the same response!');
          console.warn('[LiveAvatarSDK] 🔍 Recent avatar transcripts:', 
            recentTranscriptsRef.current.filter(t => t.speaker === 'avatar').map(t => ({ 
              text: t.text.substring(0, 30), 
              timeAgo: `${((Date.now() - t.time) / 1000).toFixed(1)}s ago` 
            }))
          );
          console.warn('[LiveAvatarSDK] 🛑 If this happens repeatedly, the avatar may be stuck in a loop');
          currentAvatarTranscriptRef.current = '';
          return;
        }
        
        // 2. Check if this text has the same phrase repeated (e.g., "That sounds good That sounds good")
        const words = normalizedText.split(' ');
        if (words.length >= 4) {
          const firstHalf = words.slice(0, Math.floor(words.length / 2)).join(' ');
          const secondHalf = words.slice(Math.floor(words.length / 2)).join(' ');
          if (firstHalf === secondHalf) {
            console.log('[LiveAvatarSDK] ⚠️ Detected repeated phrase pattern, force stopping and sending only first half:', firstHalf);
            // Force stop the avatar to prevent further repetition
            forceStopAvatar();
            lastSentTranscriptRef.current = firstHalf;
            lastTranscriptTimeRef.current = now;
            recordTranscript(firstHalf, 'avatar');
            onTranscript('avatar', firstHalf, true);
            currentAvatarTranscriptRef.current = '';
            return;
          }
        }
        
        // 3. Check for prefix duplication (e.g., "That sounds That sounds like a good option")
        if (lastSentTranscriptRef.current && now - lastTranscriptTimeRef.current < 2000) {
          const prevWords = lastSentTranscriptRef.current.trim().split(' ');
          const newWords = normalizedText.split(' ');
          // Check if current text contains the previous text repeated at the start
          if (newWords.length > prevWords.length && 
              newWords.slice(0, prevWords.length).join(' ') === lastSentTranscriptRef.current.trim()) {
            console.log('[LiveAvatarSDK] ⚠️ Detected prefix duplication, force stopping avatar');
            // Force stop to prevent further repetition
            forceStopAvatar();
            // Only send the new part
            const uniquePart = newWords.slice(prevWords.length).join(' ').trim();
            if (uniquePart && !isRecentDuplicate(uniquePart, 'avatar')) {
              console.log('[LiveAvatarSDK] ✅ Sending only unique part:', uniquePart);
              lastSentTranscriptRef.current = uniquePart;
              lastTranscriptTimeRef.current = now;
              recordTranscript(uniquePart, 'avatar');
              onTranscript('avatar', uniquePart, true);
            }
            currentAvatarTranscriptRef.current = '';
            return;
          }
        }
        
        console.log('[LiveAvatarSDK] ✅ Sending AVATAR transcript (final):', text);
        lastSentTranscriptRef.current = normalizedText;
        lastTranscriptTimeRef.current = now;
        recordTranscript(normalizedText, 'avatar');
        onTranscript('avatar', text, true); // Send as final
        currentAvatarTranscriptRef.current = ''; // Clear accumulator since we have final
      } else {
        console.warn('[LiveAvatarSDK] ⚠️ No text in avatar transcription event');
      }
    });
    
    // --------------------------------------------------

    // --- ADVANCED QUALITY & REALISM EVENTS (NEW) ---
    
    // Network quality monitoring - adjust dynamically based on connection
    session.on('session.quality_changed', (event: any) => {
      console.log('[LiveAvatarSDK] 📶 Connection quality changed:', event);
      lastActivityTimeRef.current = Date.now(); // Update activity time
      const quality = event?.quality || event?.level;
      
      if (quality === 'poor' || quality === 'low') {
        console.warn('[LiveAvatarSDK] ⚠️ Poor connection quality - avatar may reduce bitrate');
        console.warn('[LiveAvatarSDK] ⚠️ This may cause freezing or black screen issues');
        // Notify user about poor connection
        onError?.('Poor network connection detected. Avatar quality may be reduced. Please check your internet connection.');
      } else if (quality === 'excellent' || quality === 'high') {
        console.log('[LiveAvatarSDK] ✅ Excellent connection quality - maximum bitrate');
        // Clear any previous connection warnings
        if (error?.includes('Poor network connection')) {
          setError(null);
        }
      } else if (quality === 'degraded') {
        console.warn('[LiveAvatarSDK] ⚠️ Connection degraded - may cause issues');
        onError?.('Network connection is degraded. You may experience interruptions.');
      }
    });

    // Avatar audio volume - for lip-sync verification
    session.on('avatar.audio_volume', (event: any) => {
      const volume = event?.volume || event?.level;
      // Log only significant volume changes to avoid spam
      if (volume > 0.5) {
        console.log('[LiveAvatarSDK] 🔊 Avatar speaking at volume:', volume);
      }
    });

    // Animation events - track avatar movements and gestures
    session.on('avatar.animation_started', (event: any) => {
      console.log('[LiveAvatarSDK] 🎭 Animation started:', event?.animation || event?.type);
    });

    session.on('avatar.animation_completed', (event: any) => {
      console.log('[LiveAvatarSDK] ✅ Animation completed:', event?.animation || event?.type);
    });

    // Gesture events - natural movements like nodding, head shakes
    session.on('avatar.gesture', (event: any) => {
      console.log('[LiveAvatarSDK] 👋 Gesture detected:', event?.gesture || event?.type);
    });

    // Video rendering quality events
    session.on('video.quality_changed', (event: any) => {
      console.log('[LiveAvatarSDK] 🎥 Video quality changed:', event);
    });

    // Audio quality events
    session.on('audio.quality_changed', (event: any) => {
      console.log('[LiveAvatarSDK] 🎧 Audio quality changed:', event);
    });

    // Emotion detection from user speech (if available)
    session.on('user.emotion_detected', (event: any) => {
      console.log('[LiveAvatarSDK] 😊 User emotion detected:', event?.emotion);
      // Avatar can respond with appropriate empathy
    });

    // Attention/eye contact events (if available)
    session.on('avatar.attention', (event: any) => {
      console.log('[LiveAvatarSDK] 👁️ Avatar attention:', event);
    });
    
    // --------------------------------------------------

    // ========================================
    // AVATAR TRANSCRIPTION EVENT
    // ========================================
    // CRITICAL: This event is called 'avatar.transcription' for a reason!
    // It should PRIMARILY contain avatar messages, NOT user messages.
    // User messages should come from 'user.transcription_ended' event.
    // 
    // We only use explicit role='user' to attribute to user here.
    // Everything else defaults to AVATAR to prevent confusion.
    // ========================================
    session.on('avatar.transcription', (event: any) => {
      const text = event?.text || '';
      const role = event?.role || event?.speaker || event?.source;
      
      console.log('[LiveAvatarSDK] 📜 avatar.transcription event received');
      console.log('[LiveAvatarSDK] 🔍 Event details:', {
        text: text.substring(0, 50),
        role: role || 'none',
        avatarCurrentlySpeaking: avatarSpeakingRef.current,
        isInterrupted: isInterruptedRef.current,
      });
      
      // CRITICAL: If avatar was interrupted, ignore streaming transcriptions too
      // This prevents showing old/incomplete responses during interruption
      if (isInterruptedRef.current) {
        console.log('[LiveAvatarSDK] ⚠️ Ignoring streaming transcription - avatar was interrupted');
        return;
      }
      
      if (text && onTranscript) {
        const normalizedText = text.trim();
        const now = Date.now();
        
        // REAL-TIME REPETITION CHECK (CRITICAL - stops avatar immediately if repeating)
        if (avatarSpeakingRef.current && detectRealTimeRepetition(normalizedText)) {
          console.log('[LiveAvatarSDK] 🚨 STREAMING REPETITION/CONFUSION DETECTED - FORCE STOPPING AND RESETTING');
          forceStopAvatar();
          // Give it a moment to stop, then reset conversation state completely
          setTimeout(() => {
            resetConversationState();
          }, 500);
          return;
        }
        
        // CRITICAL FIX: Check if this exact text was just sent within the last 100ms
        // This prevents duplicate when same event fires multiple times or when final event repeats streaming
        if (lastSentTranscriptRef.current.trim() === normalizedText && now - lastTranscriptTimeRef.current < 100) {
          console.log('[LiveAvatarSDK] ⚠️ DUPLICATE DETECTED: avatar.transcription has same text as very recent transcript, skipping:', normalizedText.substring(0, 50));
          return;
        }
        
        // ENHANCED DUPLICATE DETECTION (same as transcription_ended):
        // 1. Check recent duplicates (within 5 seconds)
        // Note: We don't know speaker yet, so check against both for safety
        // This will be refined below once we determine the speaker
        const couldBeDuplicateAvatar = isRecentDuplicate(normalizedText, 'avatar');
        const couldBeDuplicateUser = isRecentDuplicate(normalizedText, 'user');
        
        // If it's a duplicate from BOTH speakers (very unlikely but possible)
        // or if avatar is speaking and it's a duplicate avatar message, skip it
        if (avatarSpeakingRef.current && couldBeDuplicateAvatar) {
          console.log('[LiveAvatarSDK] ⚠️ Duplicate AVATAR transcript detected (streaming), skipping:', normalizedText.substring(0, 50));
          return;
        }
        
        // 2. Check for same phrase repeated within the text
        const words = normalizedText.split(' ');
        if (words.length >= 4) {
          const firstHalf = words.slice(0, Math.floor(words.length / 2)).join(' ');
          const secondHalf = words.slice(Math.floor(words.length / 2)).join(' ');
          if (firstHalf === secondHalf) {
            console.log('[LiveAvatarSDK] ⚠️ Detected repeated phrase pattern, force stopping and sending only first half:', firstHalf);
            const role = event?.role || event?.speaker || event?.source;
            let speaker: 'user' | 'avatar' = 'avatar';
            if (role === 'user' || role === 'human') {
              speaker = 'user';
            }
            // Force stop the avatar
            forceStopAvatar();
            lastSentTranscriptRef.current = firstHalf;
            lastTranscriptTimeRef.current = now;
            recordTranscript(firstHalf, speaker);
            onTranscript(speaker, firstHalf, event?.is_final !== false);
            return;
          }
        }
        
        // 3. Check if this is a partial repeat (e.g., "Is it possible" repeated multiple times)
        if (lastSentTranscriptRef.current && 
            normalizedText.length < lastSentTranscriptRef.current.length &&
            lastSentTranscriptRef.current.includes(normalizedText)) {
          console.log('[LiveAvatarSDK] ⚠️ Partial duplicate detected (shorter text contained in previous), skipping:', normalizedText.substring(0, 50));
          return;
        }
        
        // 4. Check for prefix duplication
        if (lastSentTranscriptRef.current && now - lastTranscriptTimeRef.current < 2000) {
          const prevWords = lastSentTranscriptRef.current.trim().split(' ');
          const newWords = normalizedText.split(' ');
          if (newWords.length > prevWords.length && 
              newWords.slice(0, prevWords.length).join(' ') === lastSentTranscriptRef.current.trim()) {
            console.log('[LiveAvatarSDK] ⚠️ Detected prefix duplication in streaming transcript, force stopping avatar');
            forceStopAvatar();
            return;
          }
        }
        
        // CRITICAL SIMPLIFICATION: This is 'avatar.transcription' event
        // The event name itself tells us this is AVATAR speaking
        // We should ONLY attribute to user if there's explicit role='user'
        
        // Check if event has explicit role/speaker information
        const role = event?.role || event?.speaker || event?.source;
        
        // Determine speaker with SIMPLE, RELIABLE logic:
        let speaker: 'user' | 'avatar';
        
        // RULE 1: If avatar is currently speaking, it MUST be avatar (100% reliable)
        if (avatarSpeakingRef.current) {
          speaker = 'avatar';
          console.log('[LiveAvatarSDK] ✅ AVATAR transcription (avatar is speaking):', text.substring(0, 50));
          currentAvatarTranscriptRef.current = text;
          lastAvatarSpeakTimeRef.current = now;
        }
        // RULE 2: If there's explicit role='user', trust it (BUT log warning if suspicious)
        else if (role === 'user' || role === 'human') {
          speaker = 'user';
          
          // SAFETY WARNING: If avatar just spoke very recently, this might be misattribution
          const timeSinceAvatarSpoke = now - lastAvatarSpeakTimeRef.current;
          if (timeSinceAvatarSpoke < 2000) {
            console.warn('[LiveAvatarSDK] ⚠️ SUSPICIOUS: avatar.transcription with role=user but avatar spoke', timeSinceAvatarSpoke, 'ms ago');
            console.warn('[LiveAvatarSDK] ⚠️ This might be avatar message misattributed as user!');
            console.warn('[LiveAvatarSDK] ⚠️ Text:', text.substring(0, 100));
          }
          
          console.log('[LiveAvatarSDK] ✅ USER transcription (explicit role=user):', text.substring(0, 50));
          lastUserSpeakTimeRef.current = now;
        }
        // RULE 3: Otherwise, this is 'avatar.transcription' event, so DEFAULT TO AVATAR
        // Don't use complex timing heuristics - they cause confusion!
        else {
          speaker = 'avatar';
          console.log('[LiveAvatarSDK] ✅ AVATAR transcription (default - this is avatar.transcription event):', text.substring(0, 50));
          currentAvatarTranscriptRef.current = text;
          lastAvatarSpeakTimeRef.current = now;
        }
        
        // Final duplicate check now that we know the speaker
        if (isRecentDuplicate(normalizedText, speaker)) {
          console.log(`[LiveAvatarSDK] ⚠️ Duplicate ${speaker.toUpperCase()} transcript detected after speaker determination, skipping:`, normalizedText.substring(0, 50));
          return;
        }
        
        // SAFETY VALIDATION: Log what we're about to send
        console.log(`[LiveAvatarSDK] 📤 SENDING TRANSCRIPT: speaker=${speaker.toUpperCase()}, text="${text.substring(0, 100)}"`);
        
        // Update tracking to prevent duplicates
        lastSentTranscriptRef.current = normalizedText;
        lastTranscriptTimeRef.current = now;
        recordTranscript(normalizedText, speaker);
        
        // Send the transcript - but only if it's new/different
        // The goal is to act like a real human and capture ALL conversation, but without repeats
        const isFinal = event?.is_final !== false; // Default to true unless explicitly false
        onTranscript(speaker, text, isFinal);
      }
    });

    // Error events
    session.on('error', (err: any) => {
      console.error('[LiveAvatarSDK] ❌ Session error:', err);
      const errorMessage = err?.message || err?.error || 'Session error occurred';
      setError(errorMessage);
      onError?.(errorMessage);
    });

    console.log('[LiveAvatarSDK] ✅ Event listeners set up');
  }, [onTranscript, onStatus, onError, finalizeAvatarTranscript, isRecentDuplicate, recordTranscript, detectRealTimeRepetition, forceStopAvatar, resetConversationState]);

  // Initialize SDK
  useEffect(() => {
    if (!enabled || !avatarId) {
      console.log('[LiveAvatarSDK] Not initializing - missing requirements', {
        enabled,
        hasAvatarId: !!avatarId,
      });
      return;
    }

    let cancelled = false;

    const initializeSDK = async () => {
      try {
        console.log('[LiveAvatarSDK] 🚀 Starting LiveAvatar SDK initialization...');
        console.log('[LiveAvatarSDK] Avatar ID:', avatarId);

        // Step 0: Ensure microphone permission FIRST to avoid race condition
        // This prevents the first-time video not showing bug where the browser
        // permission dialog blocks video element attachment
        console.log('[LiveAvatarSDK] 🎤 Step 0/6: Checking microphone permission...');
        
        try {
          // Request microphone access early to avoid race condition with video attachment
          // On first use, browser will show permission dialog and BLOCK here
          // This ensures video element attachment happens AFTER permission is granted
          const testStream = await navigator.mediaDevices.getUserMedia({ 
            audio: true 
          });
          console.log('[LiveAvatarSDK] ✅ Microphone permission confirmed');
          
          // Stop the test stream immediately - we just needed to ensure permission
          testStream.getTracks().forEach(track => track.stop());
          
          // Small delay to let browser settle after permission grant
          // This gives the browser time to fully process the permission state
          await new Promise(resolve => setTimeout(resolve, 150));
          
          console.log('[LiveAvatarSDK] ✅ Ready to proceed with SDK initialization');
        } catch (permError: any) {
          const errorMsg = permError?.message?.includes('denied') || permError?.name === 'NotAllowedError'
            ? 'Microphone permission denied. Please click the microphone icon in your browser\'s address bar and allow access, then try again.'
            : 'Could not access microphone. Please check your microphone is connected and browser has permission to use it.';
          
          console.error('[LiveAvatarSDK] ❌ Microphone permission error:', {
            error: permError,
            name: permError?.name,
            message: permError?.message,
          });
          
          onError?.(errorMsg);
          throw new Error(errorMsg);
        }

        // Step 1: Get session token from our backend
        console.log('[LiveAvatarSDK] 📡 Step 1/6: Requesting session token from backend...');
        
        // Build voice config with dynamic rate variation for natural speech
        const voiceConfig = {
          ...AVATAR_CONFIG.quality.voice,
          // Apply natural variation to speech rate (±12% like real humans)
          rate: AVATAR_CONFIG.quality.voice.rate + 
                (Math.random() - 0.5) * 2 * AVATAR_CONFIG.quality.voice.rateVariation,
        };
        // Clamp rate to valid range (0.8-1.2)
        voiceConfig.rate = Math.max(0.8, Math.min(1.2, voiceConfig.rate));
        
        const sessionRequest: Record<string, any> = {
          avatarId,
          quality: AVATAR_CONFIG.quality.level,
          voice: voiceConfig,
          video: AVATAR_CONFIG.quality.video,
          audio: AVATAR_CONFIG.quality.audio,
        };
        
        console.log('[LiveAvatarSDK] 🎭 Using enhanced quality settings:', {
          videoBitrate: `${AVATAR_CONFIG.quality.video.bitrate / 1000000} Mbps`,
          fps: AVATAR_CONFIG.quality.video.fps,
          audioBitrate: `${AVATAR_CONFIG.quality.audio.bitrate / 1000} kbps`,
          speechRate: voiceConfig.rate.toFixed(2),
        });

        if (contextId) {
          sessionRequest.contextId = contextId;
        }

        if (sessionLanguage) {
          sessionRequest.language = sessionLanguage;
        }

        const tokenResponse = await fetch('/api/liveavatar-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(sessionRequest),
        });

        if (!tokenResponse.ok) {
          const rawErrorText = await tokenResponse.text();
          let parsedError: any = null;
          try {
            parsedError = rawErrorText ? JSON.parse(rawErrorText) : null;
          } catch {
            parsedError = null;
          }

          console.error('[LiveAvatarSDK] ❌ API Error Response:', {
            status: tokenResponse.status,
            statusText: tokenResponse.statusText,
            rawErrorText,
            parsedError,
            headers: Object.fromEntries(tokenResponse.headers.entries()),
          });

          let errorMessage = `API request failed with status ${tokenResponse.status}`;
          
          if (parsedError) {
            // Try multiple fields for error message
            const detailCandidates = [
              parsedError.error,
              parsedError.message,
              parsedError.detail,
              parsedError.details,
              parsedError.troubleshooting?.message,
            ];
            const firstDetail = detailCandidates.find(
              (msg) => typeof msg === 'string' && msg.trim().length > 0,
            );
            if (firstDetail) {
              errorMessage = firstDetail;
            }

            // Add troubleshooting suggestions if available
            if (parsedError.troubleshooting?.suggestions) {
              const suggestions = parsedError.troubleshooting.suggestions.join('; ');
              if (!errorMessage.includes(suggestions)) {
                errorMessage = `${errorMessage}. ${suggestions}`;
              }
            }

            // Add details if available
            if (
              parsedError.details &&
              typeof parsedError.details === 'string' &&
              !errorMessage.includes(parsedError.details)
            ) {
              errorMessage = `${errorMessage} (${parsedError.details})`;
            }
          } else if (rawErrorText) {
            errorMessage = `${errorMessage}: ${rawErrorText}`;
          }

          // Special handling for 401
          if (tokenResponse.status === 401) {
            errorMessage = `401 Unauthorized: ${errorMessage}. Check your API key in .env.local and ensure it's valid for LiveAvatar API.`;
          }

          throw new Error(errorMessage);
        }

        const responseData = await tokenResponse.json();
        const { sessionToken, sessionId, expiresAt } = responseData;
        const contextAttached = responseData.contextAttached ?? responseData.contextApplied ?? true;
        const contextSynced = responseData.contextSynced ?? null;
        console.log(
          '[LiveAvatarSDK] 📋 Backend context status:',
          {
            attached: contextAttached ? 'yes' : 'no',
            synced: contextSynced === null ? 'unknown' : contextSynced ? 'yes' : 'no',
          }
        );
        
        // Track session expiration time
        if (expiresAt) {
          try {
            sessionExpirationTimeRef.current = new Date(expiresAt).getTime();
            const expiresInMs = sessionExpirationTimeRef.current - Date.now();
            console.log(`[LiveAvatarSDK] 📅 Session expires in ${Math.round(expiresInMs / 1000 / 60)} minutes`);
            
            // Warn user 2 minutes before expiration
            if (expiresInMs > 120000) {
              setTimeout(() => {
                console.warn('[LiveAvatarSDK] ⚠️ Session will expire in 2 minutes');
                onError?.('Session will expire soon. Please save your work.');
              }, expiresInMs - 120000);
            }
            
            // Force cleanup at expiration
            setTimeout(() => {
              console.error('[LiveAvatarSDK] ❌ Session expired!');
              onError?.('Session has expired. Please refresh the page to start a new session.');
              cleanup();
            }, expiresInMs);
          } catch (err) {
            console.warn('[LiveAvatarSDK] ⚠️ Could not parse session expiration time:', err);
          }
        } else {
          console.warn('[LiveAvatarSDK] ⚠️ No session expiration time received');
        }
        
        if (cancelled) return;

        if (!sessionToken) {
          throw new Error('No session token received from backend');
        }

        if (!sessionId) {
          console.error('[LiveAvatarSDK] ⚠️ No session ID in response:', responseData);
          throw new Error('No session ID received from backend');
        }

        console.log('[LiveAvatarSDK] ✅ Session token received');
        console.log('[LiveAvatarSDK] ✅ Session ID received:', sessionId);
        console.log('[LiveAvatarSDK] Full response data:', { 
          hasToken: !!sessionToken, 
          hasId: !!sessionId,
          tokenLength: sessionToken?.length,
          idLength: sessionId?.length,
        });

        // Step 2: Import and initialize LiveAvatar SDK
        console.log('[LiveAvatarSDK] 📦 Step 2/6: Loading LiveAvatar SDK module...');
        const { LiveAvatarSession } = await import('@heygen/liveavatar-web-sdk');

        if (cancelled) return;

        console.log('[LiveAvatarSDK] ✅ SDK module loaded successfully');

        // Step 3: Create session with token
        console.log('[LiveAvatarSDK] 🎭 Step 3/6: Creating LiveAvatar session...');
        console.log('[LiveAvatarSDK] Creating session with access token:', { 
          hasToken: !!sessionToken,
          tokenPreview: sessionToken?.substring(0, 20) + '...',
          sessionId,
        });
        
        // NOTE: LiveAvatarSession constructor takes the **session access token**,
        // and (optionally) a config object. Passing the session ID here would
        // cause 401 / errorCode 4002 when the SDK calls /v1/sessions/start.
        const session = new LiveAvatarSession(sessionToken);

        sessionRef.current = session;

        // Attach video element immediately if we already have one
        // CRITICAL: Attach video AFTER session creation but BEFORE starting
        const initialVideoElement = videoElementRef.current || videoElement;
        if (initialVideoElement) {
          try {
            console.log('[LiveAvatarSDK] 📺 Attaching video element BEFORE session start...');
            const attachResult = session.attach(initialVideoElement);
            console.log('[LiveAvatarSDK] ✅ Video attach() called, result:', attachResult);
            
            // ENHANCED: Wait a bit and verify srcObject is set
            await new Promise<void>((resolve) => {
              let checkCount = 0;
              const maxChecks = 10; // 5 seconds total
              
              const checkSrcObject = () => {
                checkCount++;
                if (initialVideoElement.srcObject) {
                  console.log('[LiveAvatarSDK] ✅ srcObject confirmed (initial attach, check', checkCount, ')');
                  resolve();
                } else if (checkCount < maxChecks) {
                  console.log('[LiveAvatarSDK] ⏳ Waiting for srcObject (check', checkCount, '/', maxChecks, ')...');
                  setTimeout(checkSrcObject, 500);
                } else {
                  console.warn('[LiveAvatarSDK] ⚠️ srcObject not set after', maxChecks, 'checks - continuing anyway');
                  resolve(); // Don't block initialization
                }
              };
              
              // Start checking immediately
              setTimeout(checkSrcObject, 100);
            });
            
            // Set up Web Audio API for precise audio control
            try {
              if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                console.log('[LiveAvatarSDK] ✅ Web Audio API context created (initial)');
              }
              
              // Note: We can't create MediaStreamSource until srcObject is available
              // This will be done later when the stream is attached
            } catch (audioSetupErr) {
              console.warn('[LiveAvatarSDK] ⚠️ Could not set up Web Audio API (non-critical):', audioSetupErr);
            }
            
            // Try to play with audio (initially muted for autoplay compatibility)
            initialVideoElement.muted = true;
            initialVideoElement.play?.().then(() => {
              console.log('[LiveAvatarSDK] ✅ Video playing (will set up audio)');
              
              // Set up Web Audio routing if MediaStream is available
              if (initialVideoElement.srcObject && initialVideoElement.srcObject instanceof MediaStream && audioContextRef.current && !audioSourceRef.current) {
                try {
                  audioSourceRef.current = audioContextRef.current.createMediaStreamSource(initialVideoElement.srcObject);
                  audioGainRef.current = audioContextRef.current.createGain();
                  audioSourceRef.current.connect(audioGainRef.current);
                  audioGainRef.current.connect(audioContextRef.current.destination);
                  audioGainRef.current.gain.value = 1.0;
                  
                  // Keep video element muted since Web Audio handles audio
                  initialVideoElement.muted = true;
                  initialVideoElement.volume = 0;
                  console.log('[LiveAvatarSDK] ✅ Web Audio API routing set up (initial) - audio via Web Audio');
                } catch (audioErr) {
                  console.warn('[LiveAvatarSDK] ⚠️ Could not set up Web Audio routing (using video element audio):', audioErr);
                  // Clean up partial setup
                  if (audioSourceRef.current) {
                    try { audioSourceRef.current.disconnect(); } catch (e) {}
                    audioSourceRef.current = null;
                  }
                  if (audioGainRef.current) {
                    try { audioGainRef.current.disconnect(); } catch (e) {}
                    audioGainRef.current = null;
                  }
                  // Unmute video element for normal audio
                  initialVideoElement.muted = false;
                  initialVideoElement.volume = 1.0;
                  console.log('[LiveAvatarSDK] ✅ Video unmuted (using HTML5 audio)');
                }
              } else {
                // No MediaStream available, use normal video audio
                initialVideoElement.muted = false;
                initialVideoElement.volume = 1.0;
                console.log('[LiveAvatarSDK] ✅ Video unmuted (using HTML5 audio, no MediaStream)');
              }
            }).catch((err) => {
              console.error('[LiveAvatarSDK] ❌ Failed to play video:', err);
            });
            
            console.log('[LiveAvatarSDK] 📺 Video element attached BEFORE session start');
          } catch (attachError) {
            console.warn('[LiveAvatarSDK] ⚠️ Error attaching video element before start (non-critical):', attachError);
          }
        } else {
          console.warn('[LiveAvatarSDK] ⚠️ No video element available during session init - will attach later');
        }

        if (cancelled) return;

        // Step 4: Set up event listeners BEFORE starting
        console.log('[LiveAvatarSDK] 📡 Step 4/6: Setting up event listeners...');
        setupEventListeners(session);

        // Step 4.5: Start session via API first (if contextId provided)
        // The SDK's internal start() call might need the session to be started via API first
        if (contextId) {
          if (!contextAttached) {
            console.warn('[LiveAvatarSDK] ⚠️ Backend skipped context_id attachment - skipping manual session start');
          } else {
            console.log('[LiveAvatarSDK] 🔄 Step 4.5/5: Starting session via API...');
          try {
            const startResponse = await fetch('/api/session/start', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                sessionId,
                contextId,
              }),
            });

            if (!startResponse.ok) {
              const startErrorText = await startResponse.text();
              console.warn('[LiveAvatarSDK] ⚠️ API start failed (non-critical):', {
                status: startResponse.status,
                error: startErrorText,
              });
              // Don't throw - SDK might handle starting itself
            } else {
              console.log('[LiveAvatarSDK] ✅ Session started via API');
            }
          } catch (apiStartError) {
            console.warn('[LiveAvatarSDK] ⚠️ API start error (non-critical):', apiStartError);
            // Don't throw - SDK might handle starting itself
          }
          }
        }

        // Step 5: Start the session via SDK
        console.log('[LiveAvatarSDK] ▶️ Step 5/6: Starting session via SDK...');
        console.log('[LiveAvatarSDK] Session object:', {
          hasStart: typeof session.start === 'function',
          sessionType: typeof session,
          sessionKeys: Object.keys(session),
        });
        
        try {
          console.log('[LiveAvatarSDK] Calling session.start()...');
          const startResult = await session.start();
          console.log('[LiveAvatarSDK] ✅ Session started successfully!', startResult);
        } catch (startError: any) {
          console.error('[LiveAvatarSDK] ❌ Error starting session:', startError);
          console.error('[LiveAvatarSDK] Error details:', {
            message: startError?.message,
            status: startError?.status,
            statusText: startError?.statusText,
            response: startError?.response,
            data: startError?.data,
            full: startError,
          });
          
          // Check if it's a 401 authentication error
          if (startError?.message?.includes('401') || startError?.status === 401) {
            throw new Error(`SDK Authentication Failed (401): The session token may be invalid or expired. This usually means the API key doesn't have permission to start sessions.`);
          }
          
          throw new Error(`Failed to start LiveAvatar session: ${startError instanceof Error ? startError.message : String(startError)}`);
        }

        if (cancelled) return;

        // Step 6: Start voice chat
        console.log('[LiveAvatarSDK] 🎤 Step 6/6: Starting voice chat...');
        try {
          const voiceChat = session.voiceChat;
          if (!voiceChat) {
            throw new Error('Voice chat not available on session');
          }
          voiceChatRef.current = voiceChat;
          
          // Wait a moment before starting voice chat to let session stabilize
          // This helps prevent the opening line from being cut off
          await new Promise(resolve => setTimeout(resolve, 500));
          
          await voiceChat.start();
          console.log('[LiveAvatarSDK] ✅ Voice chat started successfully!');
        } catch (voiceChatError) {
          console.error('[LiveAvatarSDK] ❌ Error starting voice chat:', voiceChatError);
          throw new Error(`Failed to start voice chat: ${voiceChatError instanceof Error ? voiceChatError.message : String(voiceChatError)}`);
        }

        if (cancelled) return;

        console.log('[LiveAvatarSDK] 🎉 SDK FULLY INITIALIZED AND READY!');

        setIsInitialized(true);
        setIsConnected(true);
        setError(null);
        onStatus?.('idle');
        lastActivityTimeRef.current = Date.now(); // Track initial activity
        
        // Start session keepalive to prevent timeout
        // Send periodic pings to keep the session alive
        console.log('[LiveAvatarSDK] 🔄 Starting session keepalive (every 30 seconds)...');
        sessionKeepaliveIntervalRef.current = setInterval(() => {
          if (sessionRef.current && isConnected) {
            try {
              // Send a lightweight ping to keep session alive
              // @ts-ignore - accessing internal room
              const room = sessionRef.current.room || sessionRef.current.livekitRoom;
              if (room && room.localParticipant) {
                const pingData = JSON.stringify({ type: 'ping', timestamp: Date.now() });
                const data = new TextEncoder().encode(pingData);
                room.localParticipant.publishData(data, { reliable: false }).catch((err: any) => {
                  console.warn('[LiveAvatarSDK] ⚠️ Keepalive ping failed:', err);
                });
                console.log('[LiveAvatarSDK] 💓 Keepalive ping sent');
                lastActivityTimeRef.current = Date.now();
              }
            } catch (err) {
              console.warn('[LiveAvatarSDK] ⚠️ Could not send keepalive ping:', err);
            }
          }
        }, 30000); // Ping every 30 seconds
        
        // Start connection health monitor
        console.log('[LiveAvatarSDK] 🏥 Starting connection health monitor (every 10 seconds)...');
        connectionHealthIntervalRef.current = setInterval(() => {
          const now = Date.now();
          const timeSinceActivity = now - lastActivityTimeRef.current;
          
          // If no activity for 45 seconds, connection might be dead
          if (timeSinceActivity > 45000) {
            console.error('[LiveAvatarSDK] 🚨 No activity for 45+ seconds - connection may be dead!');
            console.error('[LiveAvatarSDK] Last activity:', new Date(lastActivityTimeRef.current).toLocaleTimeString());
            
            // Try to check actual connection state
            // @ts-ignore
            const room = sessionRef.current?.room || sessionRef.current?.livekitRoom;
            if (room) {
              console.log('[LiveAvatarSDK] 🔍 Checking LiveKit room state:', room.state);
              
              if (room.state === 'disconnected' || room.state === 'closed') {
                console.error('[LiveAvatarSDK] ❌ LiveKit room is disconnected/closed!');
                onError?.('Connection lost. Attempting to reconnect...');
                setIsConnected(false);
                
                // Try to reconnect
                if (reconnectAttemptsRef.current < 3) {
                  reconnectAttemptsRef.current++;
                  console.log(`[LiveAvatarSDK] 🔄 Attempting reconnection (${reconnectAttemptsRef.current}/3)...`);
                  
                  sessionRef.current?.start().then(() => {
                    console.log('[LiveAvatarSDK] ✅ Reconnection successful!');
                    setIsConnected(true);
                    setError(null);
                    lastActivityTimeRef.current = Date.now();
                  }).catch((err) => {
                    console.error('[LiveAvatarSDK] ❌ Reconnection failed:', err);
                    onError?.(`Reconnection attempt ${reconnectAttemptsRef.current} failed. Please refresh the page.`);
                  });
                }
              }
            }
          }
          
          // Check session expiration
          if (sessionExpirationTimeRef.current > 0) {
            const timeUntilExpiration = sessionExpirationTimeRef.current - now;
            if (timeUntilExpiration < 0) {
              console.error('[LiveAvatarSDK] ❌ Session has expired!');
              onError?.('Session has expired. Please refresh the page.');
              cleanup();
            } else if (timeUntilExpiration < 60000) {
              console.warn(`[LiveAvatarSDK] ⚠️ Session expiring in ${Math.round(timeUntilExpiration / 1000)} seconds`);
            }
          }
        }, 10000); // Check every 10 seconds

      } catch (err) {
        if (cancelled) return;

        // Extract error message from various error types
        let errorMessage = 'Failed to initialize avatar';
        let errorDetails: any = null;

        if (err instanceof Error) {
          errorMessage = err.message || errorMessage;
          errorDetails = {
            name: err.name,
            message: err.message,
            stack: err.stack,
          };
        } else if (typeof err === 'string') {
          errorMessage = err;
          errorDetails = { type: 'string', value: err };
        } else if (err && typeof err === 'object') {
          // Try to extract message from error object
          const errObj = err as any;
          errorMessage = errObj.message || errObj.error || errObj.detail || errObj.details || JSON.stringify(errObj) || errorMessage;
          errorDetails = {
            type: 'object',
            keys: Object.keys(errObj),
            full: errObj,
          };
        }

        console.error('[LiveAvatarSDK] ❌ Initialization error:', err);
        console.error('[LiveAvatarSDK] Error type:', typeof err);
        console.error('[LiveAvatarSDK] Error details:', {
          errorMessage,
          errorDetails,
          rawError: err,
          stringified: JSON.stringify(err, Object.getOwnPropertyNames(err)),
        });

        setError(errorMessage);
        onError?.(errorMessage);
        setIsInitialized(false);
        setIsConnected(false);
      }
    };

    initializeSDK();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [enabled, avatarId, contextId, sessionLanguage]);

  // State synchronization checker - runs periodically to detect and fix stuck states
  useEffect(() => {
    if (!isConnected) {
      // Only run when connected
      return;
    }

    // Only log once when starting, not on every check
    if (!stateCheckIntervalRef.current) {
      console.log('[LiveAvatarSDK] 🔄 Starting state synchronization checker');
    }
    
    // Check every 2 seconds for stuck states (increased frequency)
    stateCheckIntervalRef.current = setInterval(() => {
      const now = Date.now();
      
      // Check if avatar has been "speaking" for too long without updates
      if (avatarSpeakingRef.current) {
        const speakingDuration = speakingStartTimeRef.current > 0 
          ? now - speakingStartTimeRef.current 
          : 0;
        
        // If speaking for more than 25 seconds, something is wrong - stop and reset
        if (speakingDuration > 25000) {
          console.warn('[LiveAvatarSDK] ⚠️ Avatar stuck in speaking state for >25s, forcing stop and reset');
          forceStopAvatar().then(() => {
            setTimeout(() => {
              resetConversationState();
            }, 500);
          });
        }
      }
      
      // Check for confusion loops in recent transcripts
      const recentAvatarMessages = recentTranscriptsRef.current
        .filter(t => t.speaker === 'avatar' && now - t.time < 15000) // Last 15 seconds
        .map(t => t.text.toLowerCase());
      
      if (recentAvatarMessages.length >= 2) {
        // Check if multiple recent messages contain apology/confusion phrases
        const confusionPhrases = [
          "i'm sorry, could you repeat that",
          "could you repeat that",
          "i'm just trying to keep track",
          "thank you for your patience",
          "i didn't quite catch that",
          "could you say that again",
        ];
        
        const confusionCount = recentAvatarMessages.filter(msg => 
          confusionPhrases.some(phrase => msg.includes(phrase))
        ).length;
        
        // If 2+ confusion messages in last 15 seconds, avatar is stuck
        if (confusionCount >= 2) {
          console.error('[LiveAvatarSDK] 🚨 CONFUSION LOOP DETECTED in state checker!');
          console.error('[LiveAvatarSDK] Avatar sent multiple confusion messages:', confusionCount);
          console.error('[LiveAvatarSDK] Forcing stop and complete reset...');
          forceStopAvatar().then(() => {
            setTimeout(() => {
              resetConversationState();
            }, 500);
          });
        }
      }
      
      // Check if we have a mismatch between isSpeaking and avatarSpeakingRef
      if (isSpeaking !== avatarSpeakingRef.current) {
        console.warn('[LiveAvatarSDK] ⚠️ State mismatch detected:', {
          isSpeaking,
          avatarSpeakingRef: avatarSpeakingRef.current
        });
        
        // Sync them - trust avatarSpeakingRef as source of truth
        // But only if the mismatch has persisted for more than 2 seconds
        const timeSinceLastAvatarSpeak = now - lastAvatarSpeakTimeRef.current;
        if (timeSinceLastAvatarSpeak > 2000 && avatarSpeakingRef.current && !isSpeaking) {
          console.warn('[LiveAvatarSDK] 🔧 Syncing: avatarSpeakingRef=true but isSpeaking=false, setting both to false');
          avatarSpeakingRef.current = false;
          setIsSpeaking(false);
        }
      }
      
      // Check if interrupted flag is stuck
      if (isInterruptedRef.current) {
        const timeSinceInterrupt = now - lastInterruptTimeRef.current;
        // If interrupted for more than 5 seconds and not speaking, clear the flag
        if (timeSinceInterrupt > 5000 && !avatarSpeakingRef.current && !isSpeaking) {
          console.warn('[LiveAvatarSDK] ⚠️ Interrupted flag stuck, clearing it');
          isInterruptedRef.current = false;
        }
      }
    }, 2000); // Check every 2 seconds (increased from 3s)

    return () => {
      if (stateCheckIntervalRef.current) {
        clearInterval(stateCheckIntervalRef.current);
        stateCheckIntervalRef.current = null;
      }
    };
  }, [isConnected, isSpeaking, forceStopAvatar, resetConversationState]);

    // Track latest video element and attach whenever it changes
  useEffect(() => {
    videoElementRef.current = videoElement ?? null;

    if (!videoElement || !sessionRef.current) {
      // Clean up health check if video removed
      if (videoHealthCheckIntervalRef.current) {
        clearInterval(videoHealthCheckIntervalRef.current);
        videoHealthCheckIntervalRef.current = null;
      }
      return;
    }

    console.log('[LiveAvatarSDK] 📺 Attaching video element (change detected)...', {
      hasSession: !!sessionRef.current,
      isConnected,
      hasSrcObject: !!videoElement.srcObject,
      videoReadyState: videoElement.readyState,
    });

    try {
      // CRITICAL: Always call attach, even if already attached
      // The SDK might need to re-attach or the stream might not be set yet
      console.log('[LiveAvatarSDK] 🔄 Calling session.attach()...');
      
      // CRITICAL FIX: Wrap attach in try-catch and wait a bit for srcObject
      const attachResult = sessionRef.current.attach(videoElement);
      console.log('[LiveAvatarSDK] ✅ session.attach() called, result:', attachResult);
      
      // ENHANCED: Check multiple times for srcObject with increasing intervals
      let checkCount = 0;
      const maxChecks = 10; // Check up to 10 times over 5 seconds
      
      const checkSrcObject = () => {
        checkCount++;
        if (videoElement.srcObject) {
          console.log('[LiveAvatarSDK] ✅ srcObject detected after attach (check', checkCount, '):', {
            isMediaStream: videoElement.srcObject instanceof MediaStream,
            hasTracks: videoElement.srcObject instanceof MediaStream ? videoElement.srcObject.getTracks().length : 0,
          });
          return true;
        }
        
        if (checkCount < maxChecks) {
          console.log('[LiveAvatarSDK] ⏳ No srcObject yet, checking again (', checkCount, '/', maxChecks, ')...');
          setTimeout(checkSrcObject, 500); // Check every 500ms
        } else {
          console.warn('[LiveAvatarSDK] ⚠️ srcObject not set after', maxChecks, 'checks (5 seconds)');
          console.warn('[LiveAvatarSDK] 📊 Session state:', {
            hasSession: !!sessionRef.current,
            isConnected,
            videoReadyState: videoElement.readyState,
            videoHasSrc: !!videoElement.src,
            videoHasSrcObject: !!videoElement.srcObject,
          });
          console.log('[LiveAvatarSDK] ℹ️ This is normal if video initializes slowly - will continue monitoring');
          // Don't throw error - let the component's own timeout handle it
        }
        return false;
      };
      
      // Start checking after a brief delay
      setTimeout(checkSrcObject, 500);
      
      // Set up Web Audio API for precise audio control (optional enhancement)
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          console.log('[LiveAvatarSDK] ✅ Web Audio API context created');
        }
        
        // Create audio source from video element if we have a MediaStream
        // NOTE: We DON'T mute the video element when using Web Audio API routing
        // because we're just adding gain control on top, not replacing the audio path
        if (videoElement.srcObject && videoElement.srcObject instanceof MediaStream && !audioSourceRef.current) {
          try {
            // IMPORTANT: Only set up Web Audio routing if video element is NOT the primary audio output
            // We'll use Web Audio API only for instant muting, not for normal playback
            // This avoids conflicts with the video element's audio
            audioSourceRef.current = audioContextRef.current.createMediaStreamSource(videoElement.srcObject);
            audioGainRef.current = audioContextRef.current.createGain();
            audioSourceRef.current.connect(audioGainRef.current);
            audioGainRef.current.connect(audioContextRef.current.destination);
            audioGainRef.current.gain.value = 1.0;
            
            // CRITICAL: Mute the video element to avoid double audio
            // Web Audio API will now handle all audio output
            videoElement.muted = true;
            videoElement.volume = 0;
            
            console.log('[LiveAvatarSDK] ✅ Web Audio API routing set up (video element muted to prevent double audio)');
          } catch (routingErr) {
            console.warn('[LiveAvatarSDK] ⚠️ Could not set up Web Audio routing (will use video element audio):', routingErr);
            // Clean up partial setup
            if (audioSourceRef.current) {
              try { audioSourceRef.current.disconnect(); } catch (e) {}
              audioSourceRef.current = null;
            }
            if (audioGainRef.current) {
              try { audioGainRef.current.disconnect(); } catch (e) {}
              audioGainRef.current = null;
            }
            // Ensure video element audio is enabled
            videoElement.muted = false;
            videoElement.volume = 1.0;
          }
        }
      } catch (audioSetupErr) {
        console.warn('[LiveAvatarSDK] ⚠️ Could not set up Web Audio API (non-critical, using video element audio):', audioSetupErr);
        // Ensure video element audio is enabled as fallback
        videoElement.muted = false;
        videoElement.volume = 1.0;
      }
      
      // Set up video playback
      // Note: If Web Audio API is active, video element stays muted and audio comes from Web Audio
      // Otherwise, video element provides audio
      const useWebAudio = audioSourceRef.current && audioGainRef.current;
      
      if (!useWebAudio) {
        // Standard HTML5 video audio
        videoElement.muted = false;
        videoElement.volume = 1.0;
      }
      // If using Web Audio, video element is already muted by the setup above
      
      // Try to play
      videoElement.play?.().then(() => {
        if (useWebAudio) {
          console.log('[LiveAvatarSDK] ✅ Video playing (audio via Web Audio API)');
        } else {
          console.log('[LiveAvatarSDK] ✅ Video playing with audio (after attach)');
          videoElement.muted = false; // Double-check unmuted
        }
      }).catch((err) => {
        console.warn('[LiveAvatarSDK] ⚠️ Autoplay prevented (after attach), trying muted first:', err);
        // Browser autoplay policy workaround: play muted first, then unmute
        videoElement.muted = true;
        videoElement.play?.().then(() => {
          console.log('[LiveAvatarSDK] ✅ Video playing muted (after attach), will unmute in 100ms');
          setTimeout(() => {
            if (!useWebAudio) {
              // Only unmute if not using Web Audio API
              videoElement.muted = false;
              videoElement.volume = 1.0;
              console.log('[LiveAvatarSDK] ✅ Video unmuted (after attach)');
            } else {
              console.log('[LiveAvatarSDK] ✅ Video playing (keeping muted, audio via Web Audio API)');
            }
          }, 100);
        }).catch((err2) => {
          console.error('[LiveAvatarSDK] ❌ Failed to play video even when muted (after attach):', err2);
        });
      });
      
      console.log('[LiveAvatarSDK] ✅ Video element attached (change)');
      
      // Start video health check to detect stuck/frozen video
      if (videoHealthCheckIntervalRef.current) {
        clearInterval(videoHealthCheckIntervalRef.current);
      }
      
      lastVideoTimeRef.current = videoElement.currentTime;
      
      videoHealthCheckIntervalRef.current = setInterval(() => {
        if (!videoElementRef.current) {
          return;
        }
        
        const video = videoElementRef.current;
        const currentTime = video.currentTime;
        const lastTime = lastVideoTimeRef.current;
        const now = Date.now();
        
        // Track if video has ever been in a good state (readyState >= 2)
        if (video.readyState >= 2) {
          if (!videoInitializedRef.current) {
            console.log('[LiveAvatarSDK] ✅ Video initialized successfully (readyState:', video.readyState, ')');
            videoInitializedRef.current = true;
          }
          lastGoodVideoStateTimeRef.current = now;
        }
        
        // Check 1: Video stream health (only if video was previously working)
        if (video.srcObject instanceof MediaStream && videoInitializedRef.current) {
          const stream = video.srcObject;
          const videoTracks = stream.getVideoTracks();
          const audioTracks = stream.getAudioTracks();
          
          // Check if tracks are active
          const hasActiveVideo = videoTracks.some(track => track.readyState === 'live' && track.enabled);
          const hasActiveAudio = audioTracks.some(track => track.readyState === 'live' && track.enabled);
          
          // Only report errors if video was working before (avoid startup false alarms)
          if (!hasActiveVideo && (now - lastGoodVideoStateTimeRef.current > 5000)) {
            console.error('[LiveAvatarSDK] ❌ Video track is not active!');
            console.error('[LiveAvatarSDK] Video tracks:', videoTracks.map(t => ({
              id: t.id,
              label: t.label,
              readyState: t.readyState,
              enabled: t.enabled,
              muted: t.muted
            })));
            onError?.('Video stream lost. The avatar display has stopped working.');
          }
          
          if (!hasActiveAudio && (now - lastGoodVideoStateTimeRef.current > 5000)) {
            console.warn('[LiveAvatarSDK] ⚠️ Audio track is not active (this may be normal during initialization)');
            // Don't show error for audio immediately - it's less critical than video
          }
          
          // Check for ended tracks (stream died)
          const endedVideoTrack = videoTracks.find(track => track.readyState === 'ended');
          const endedAudioTrack = audioTracks.find(track => track.readyState === 'ended');
          
          if (endedVideoTrack || endedAudioTrack) {
            console.error('[LiveAvatarSDK] 🚨 Media track ended unexpectedly!');
            console.error('[LiveAvatarSDK] This indicates the stream has died');
            onError?.('Media stream ended. Please refresh the page to reconnect.');
            
            // Try to reconnect once
            if (reconnectAttemptsRef.current < 1) {
              reconnectAttemptsRef.current++;
              console.log('[LiveAvatarSDK] 🔄 Attempting to recover from stream end...');
              
              // Try to reattach video element
              if (sessionRef.current) {
                try {
                  sessionRef.current.attach(video);
                  console.log('[LiveAvatarSDK] ✅ Video element reattached');
                  lastActivityTimeRef.current = now;
                } catch (err) {
                  console.error('[LiveAvatarSDK] ❌ Failed to reattach video:', err);
                }
              }
            }
          }
        }
        
        // Check 2: Detect repeating video segments (stuck in a loop)
        if (avatarSpeakingRef.current && currentTime < lastTime && lastTime - currentTime > 0.5) {
          console.warn('[LiveAvatarSDK] ⚠️ Video appears to be looping/repeating - forcing stop');
          forceStopAvatar();
        }
        
        // Check 3: Video frozen at same position for too long (only during speaking)
        const speakingDuration = avatarSpeakingRef.current ? now - speakingStartTimeRef.current : 0;
        if (avatarSpeakingRef.current && currentTime === lastTime && speakingDuration > 10000) {
          console.warn('[LiveAvatarSDK] ⚠️ Video stuck at same position for 10+ seconds - forcing stop');
          forceStopAvatar();
        }
        
        // Check 4: Video element paused unexpectedly (only if previously playing)
        if (video.paused && video.readyState >= 2 && videoInitializedRef.current) {
          console.warn('[LiveAvatarSDK] ⚠️ Video unexpectedly paused, attempting to resume...');
          video.play().catch((err) => {
            console.error('[LiveAvatarSDK] ❌ Failed to resume video:', err);
            onError?.('Video playback stopped. Please check your browser settings.');
          });
        }
        
        // Check 5: No video data for extended period (black screen)
        // CRITICAL FIX: Only report as error if:
        // 1. Video was previously initialized (not during startup)
        // 2. Been in bad state for more than 15 seconds (not transient)
        if ((video.readyState === 0 || video.readyState === 1) && videoInitializedRef.current) {
          const timeSinceGoodState = now - lastGoodVideoStateTimeRef.current;
          
          // Only log error if stuck in bad state for 15+ seconds
          if (timeSinceGoodState > 15000) {
            console.error('[LiveAvatarSDK] ❌ Video has no data for 15+ seconds! ReadyState:', video.readyState);
            console.error('[LiveAvatarSDK] This indicates the stream has stopped or connection is lost');
            
            // Only show user error after 30 seconds (to avoid false alarms)
            if (timeSinceGoodState > 30000) {
              console.error('[LiveAvatarSDK] 🚨 No video data for 30+ seconds - connection is dead!');
              onError?.('Video stream lost. Please refresh the page to reconnect.');
            }
          }
        }
        
        // Update last known time
        lastVideoTimeRef.current = currentTime;
        
        // Update activity time if video is progressing or in good state
        if ((currentTime !== lastTime && video.readyState >= 2) || video.readyState >= 3) {
          lastActivityTimeRef.current = now;
        }
      }, 3000); // Check every 3 seconds
      
    } catch (attachError) {
      console.warn('[LiveAvatarSDK] ⚠️ Error attaching video element on change (non-critical):', attachError);
    }
    
    // Cleanup function
    return () => {
      if (videoHealthCheckIntervalRef.current) {
        clearInterval(videoHealthCheckIntervalRef.current);
        videoHealthCheckIntervalRef.current = null;
      }
      
      // Clean up Web Audio API resources
      if (audioSourceRef.current) {
        try {
          audioSourceRef.current.disconnect();
          audioSourceRef.current = null;
        } catch (e) {
          console.warn('[LiveAvatarSDK] Error disconnecting audio source:', e);
        }
      }
      
      if (audioGainRef.current) {
        try {
          audioGainRef.current.disconnect();
          audioGainRef.current = null;
        } catch (e) {
          console.warn('[LiveAvatarSDK] Error disconnecting audio gain:', e);
        }
      }
    };
  }, [videoElement, isConnected]);

  // Cleanup function
  const cleanup = useCallback(() => {
    // Mark this as an intentional disconnection (user clicked "End Session")
    // Set this FIRST before anything else to ensure it's captured
    intentionalDisconnectRef.current = true;
    console.log('[LiveAvatarSDK] 🛑 Cleanup initiated - intentional disconnect flag SET to TRUE');
    console.log('[LiveAvatarSDK] 🔍 Flag value:', intentionalDisconnectRef.current);
    
    // Small delay to ensure flag is set before session state changes
    // This prevents race condition where state change fires before flag is set
    const cleanupAsync = async () => {
      // Wait a tiny bit to ensure flag is read by any pending state change events
      await new Promise(resolve => setTimeout(resolve, 10));
      
      console.log('[LiveAvatarSDK] 🧹 Starting cleanup process...');
    
    // Clear all timers first
    if (maxSpeakingDurationTimerRef.current) {
      clearTimeout(maxSpeakingDurationTimerRef.current);
      maxSpeakingDurationTimerRef.current = null;
    }
    
    if (finalizeTimeoutRef.current) {
      clearTimeout(finalizeTimeoutRef.current);
      finalizeTimeoutRef.current = null;
    }
    
    if (userTranscriptionTimeoutRef.current) {
      clearTimeout(userTranscriptionTimeoutRef.current);
      userTranscriptionTimeoutRef.current = null;
    }
    
    if (videoHealthCheckIntervalRef.current) {
      clearInterval(videoHealthCheckIntervalRef.current);
      videoHealthCheckIntervalRef.current = null;
    }
    
    if (sessionKeepaliveIntervalRef.current) {
      clearInterval(sessionKeepaliveIntervalRef.current);
      sessionKeepaliveIntervalRef.current = null;
      console.log('[LiveAvatarSDK] 🛑 Session keepalive stopped');
    }
    
    if (connectionHealthIntervalRef.current) {
      clearInterval(connectionHealthIntervalRef.current);
      connectionHealthIntervalRef.current = null;
      console.log('[LiveAvatarSDK] 🛑 Connection health monitor stopped');
    }
    
    // Clear all tracking state
    currentAvatarTranscriptRef.current = '';
    currentResponseRef.current = '';
    currentSpeakingWordsRef.current = [];
    lastSentTranscriptRef.current = '';
    recentTranscriptsRef.current = [];
    lastVideoTimeRef.current = 0;
    lastVideoFrameRef.current = 0;
    lastActivityTimeRef.current = 0;
    sessionExpirationTimeRef.current = 0;
    reconnectAttemptsRef.current = 0;
    videoInitializedRef.current = false;
    lastGoodVideoStateTimeRef.current = Date.now();
    intentionalDisconnectRef.current = false; // Reset for next session
    
    // Clean up Web Audio API resources
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.disconnect();
        audioSourceRef.current = null;
      } catch (e) {
        console.warn('[LiveAvatarSDK] Error disconnecting audio source:', e);
      }
    }
    
    if (audioGainRef.current) {
      try {
        audioGainRef.current.disconnect();
        audioGainRef.current = null;
      } catch (e) {
        console.warn('[LiveAvatarSDK] Error disconnecting audio gain:', e);
      }
    }
    
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close();
        audioContextRef.current = null;
      } catch (e) {
        console.warn('[LiveAvatarSDK] Error closing audio context:', e);
      }
    }
    
    if (sessionRef.current) {
      try {
        console.log('[LiveAvatarSDK] 🧹 Cleaning up session...');

        // Stop voice chat first
        if (voiceChatRef.current) {
          try {
            const stopResult = voiceChatRef.current.stop?.();
            // Some SDK versions return void instead of a Promise
            if (stopResult && typeof stopResult.catch === 'function') {
              stopResult.catch((err: any) => {
                console.error('[LiveAvatarSDK] Error stopping voice chat:', err);
              });
            }
          } catch (err) {
            console.error('[LiveAvatarSDK] Error stopping voice chat (sync):', err);
          }
          voiceChatRef.current = null;
        }

        // Stop session
        try {
          const stopResult = sessionRef.current.stop?.();
          if (stopResult && typeof stopResult.catch === 'function') {
            stopResult.catch((err: any) => {
              console.error('[LiveAvatarSDK] Error stopping session:', err);
            });
          }
        } catch (err) {
          console.error('[LiveAvatarSDK] Error stopping session (sync):', err);
        }

        sessionRef.current = null;
        console.log('[LiveAvatarSDK] ✅ Cleanup complete');
      } catch (err) {
        console.error('[LiveAvatarSDK] Error during cleanup:', err);
      }
    }
    setIsInitialized(false);
    setIsConnected(false);
    
      console.log('[LiveAvatarSDK] ✅ Cleanup process complete');
    };
    
    // Run async cleanup
    cleanupAsync().catch((err) => {
      console.error('[LiveAvatarSDK] Error in cleanup:', err);
    });
  }, []);

  // Calculate natural response delay based on message complexity
  const calculateResponseDelay = useCallback((text: string): number => {
    if (!AVATAR_CONFIG.humanization.responseTiming.enabled) {
      return 150; // Default fixed delay
    }

    const { minDelayMs, maxDelayMs, complexityMultiplier } = AVATAR_CONFIG.humanization.responseTiming;
    
    // Calculate complexity based on:
    // 1. Message length (longer = more complex)
    // 2. Question marks (questions require more thinking)
    // 3. Multiple sentences (more complex)
    const length = text.length;
    const questionCount = (text.match(/\?/g) || []).length;
    const sentenceCount = (text.match(/[.!?]+/g) || []).length;
    
    // Base delay from length
    let delay = minDelayMs + (length * complexityMultiplier);
    
    // Add extra time for questions (humans think more before answering questions)
    delay += questionCount * 100;
    
    // Add extra time for complex multi-sentence messages
    if (sentenceCount > 1) {
      delay += (sentenceCount - 1) * 50;
    }
    
    // Cap at maximum
    delay = Math.min(delay, maxDelayMs);
    
    // Add small random variation (±50ms) to avoid robotic predictability
    const variation = (Math.random() - 0.5) * 100;
    delay = Math.max(minDelayMs, delay + variation);
    
    return Math.round(delay);
  }, []);

  // Send message to avatar
  const speak = useCallback(async (text: string) => {
    if (!sessionRef.current || !isConnected) {
      console.warn('[LiveAvatarSDK] Cannot speak - not connected');
      return;
    }

    try {
      console.log('[LiveAvatarSDK] 💬 Sending message to avatar:', text);
      
      // CRITICAL: Clear interrupted flag when user sends NEW message
      // This allows avatar to respond to the new input
      if (isInterruptedRef.current) {
        console.log('[LiveAvatarSDK] ✅ Clearing interrupted flag - user sent NEW message');
        isInterruptedRef.current = false;
      }
      
      // Variable natural pause before responding (like real humans)
      // Response time varies based on message complexity (200-800ms)
      // This makes the conversation feel more natural and less robotic
      const responseDelay = calculateResponseDelay(text);
      console.log('[LiveAvatarSDK] ⏱️ Natural response delay:', responseDelay, 'ms');
      await new Promise(resolve => setTimeout(resolve, responseDelay));
      
      // Track that user just sent a message - this helps identify user vs avatar transcripts
      lastUserSpeakTimeRef.current = Date.now();
      sessionRef.current.message(text);
      console.log('[LiveAvatarSDK] ✅ Message sent successfully');
    } catch (err) {
      console.error('[LiveAvatarSDK] Error sending message:', err);
      onError?.(err instanceof Error ? err.message : 'Failed to send message');
    }
  }, [isConnected, onError, calculateResponseDelay]);

  // Interrupt avatar
  const interrupt = useCallback(async () => {
    if (!sessionRef.current) {
      return;
    }

    // Debounce interrupts - prevent multiple interrupts within 300ms
    const now = Date.now();
    if (isProcessingInterruptRef.current || (now - lastInterruptTimeRef.current < 300)) {
      console.log('[LiveAvatarSDK] ⚠️ Interrupt debounced (too soon)');
      return;
    }

    try {
      console.log('[LiveAvatarSDK] ⛔ Interrupting avatar...');
      isProcessingInterruptRef.current = true;
      lastInterruptTimeRef.current = now;
      
      // Mark as interrupted to prevent transcript finalization
      isInterruptedRef.current = true;
      
      // Clear ALL pending responses and transcripts to prevent repetition
      currentResponseRef.current = '';
      currentAvatarTranscriptRef.current = '';
      currentSpeakingWordsRef.current = []; // Clear real-time repetition tracking
      lastSentTranscriptRef.current = ''; // Clear last sent transcript to prevent duplicates
      lastTranscriptTimeRef.current = 0;
      
      // Clear any pending finalization timers
      if (finalizeTimeoutRef.current) {
        clearTimeout(finalizeTimeoutRef.current);
        finalizeTimeoutRef.current = null;
      }
      
      // Clear max speaking duration timer
      if (maxSpeakingDurationTimerRef.current) {
        clearTimeout(maxSpeakingDurationTimerRef.current);
        maxSpeakingDurationTimerRef.current = null;
      }
      
      // CRITICAL: Stop video element immediately AND clear buffers to prevent stuck playback
      if (videoElementRef.current) {
        try {
          const video = videoElementRef.current;
          
          // CRITICAL: Instantly mute audio using Web Audio API for immediate cutoff (if available)
          const hasWebAudio = audioGainRef.current && audioContextRef.current;
          if (hasWebAudio) {
            try {
              audioGainRef.current!.gain.setValueAtTime(0, audioContextRef.current!.currentTime);
              console.log('[LiveAvatarSDK] ✅ Audio instantly muted via Web Audio API (interrupt)');
            } catch (e) {
              console.warn('[LiveAvatarSDK] Could not mute via Web Audio:', e);
            }
          }
          
          // Always mute and pause video element
          video.muted = true;
          video.pause();
          
          // CRITICAL: Clear video/audio buffers to stop any pending audio/video
          const currentSrc = video.src;
          const currentSrcObject = video.srcObject;
          
          // For MediaStreams, temporarily disable all tracks
          if (currentSrcObject && currentSrcObject instanceof MediaStream) {
            const tracks = currentSrcObject.getTracks();
            console.log(`[LiveAvatarSDK] Disabling ${tracks.length} media tracks to stop playback`);
            tracks.forEach(track => {
              const enabled = track.enabled;
              track.enabled = false;
              // Re-enable after buffer is cleared
              setTimeout(() => {
                track.enabled = enabled;
              }, 100);
            });
            
            // For MediaStreams, DON'T disconnect source - causes SRC_NOT_SUPPORTED
            // Track disabling is sufficient to stop playback
            
            // Restore audio volume after brief delay
            if (hasWebAudio) {
              setTimeout(() => {
                if (audioGainRef.current && audioContextRef.current) {
                  try {
                    audioGainRef.current.gain.linearRampToValueAtTime(1, audioContextRef.current.currentTime + 0.1);
                  } catch (e) {
                    console.warn('[LiveAvatarSDK] Could not restore Web Audio:', e);
                    video.muted = false;
                  }
                }
              }, 100);
            } else {
              video.muted = false;
            }
          } else if (currentSrc) {
            // For regular src URLs (not MediaStream), we can safely clear
            video.src = '';
            video.load();
            
            // Restore source
            setTimeout(() => {
              video.src = currentSrc;
              video.muted = false;
            }, 100);
          }
          
          console.log('[LiveAvatarSDK] ✅ Video element paused and buffers cleared (interrupt)');
        } catch (videoError) {
          console.warn('[LiveAvatarSDK] ⚠️ Could not pause/clear video:', videoError);
        }
      }
      
      // CRITICAL: Send MULTIPLE interrupt commands to ensure avatar stops immediately
      // According to LiveAvatar docs, we need to send both avatar.interrupt and avatar.interrupt_video
      try {
        // @ts-ignore - accessing internal LiveKit room
        const room = sessionRef.current.room || sessionRef.current.livekitRoom;
        
        if (room && room.localParticipant) {
          // Send BOTH interrupt commands for maximum effectiveness
          const commands = ['avatar.interrupt', 'avatar.interrupt_video'];
          
          for (const command of commands) {
            const eventData = JSON.stringify({ type: command });
            const data = new TextEncoder().encode(eventData);
            await room.localParticipant.publishData(data, { reliable: true });
            console.log(`[LiveAvatarSDK] ✅ ${command} command sent via LiveKit`);
          }
        } else {
          // Fallback to SDK interrupt method if room not accessible
          console.warn('[LiveAvatarSDK] ⚠️ Could not access LiveKit room, using SDK interrupt method');
          if (typeof sessionRef.current.interrupt === 'function') {
            sessionRef.current.interrupt();
          }
        }
      } catch (interruptError) {
        console.error('[LiveAvatarSDK] ❌ Error sending interrupt command:', interruptError);
        // Try fallback method
        if (typeof sessionRef.current.interrupt === 'function') {
          sessionRef.current.interrupt();
        }
      }
      
      // Immediately update UI state
      setIsSpeaking(false);
      avatarSpeakingRef.current = false;
      onStatus?.('listening');
      
      // Natural interruption recovery - Add brief acknowledgment pause
      // Real humans pause briefly after being interrupted (like "Oh, okay")
      const recoveryDelay = AVATAR_CONFIG.humanization.interruptionRecovery.acknowledgmentPauseMs;
      console.log('[LiveAvatarSDK] ⏱️ Natural recovery delay:', recoveryDelay, 'ms');
      
      // Resume video playback after natural recovery delay
      // Note: We resume even if interrupted because the session needs to continue for new input
      setTimeout(() => {
        if (videoElementRef.current && sessionRef.current) {
          try {
            const video = videoElementRef.current;
            
            // Ensure video is ready and not stuck
            if (video.paused && video.readyState >= 2) { // HAVE_CURRENT_DATA or better
              video.play().catch((err) => {
                console.warn('[LiveAvatarSDK] ⚠️ Could not resume video playback:', err);
              });
            }
          } catch (err) {
            console.warn('[LiveAvatarSDK] ⚠️ Error resuming video:', err);
          }
        }
      }, recoveryDelay);
      
      console.log('[LiveAvatarSDK] ✅ Avatar interrupted - all state cleared, ready for new input');
    } catch (err) {
      console.error('[LiveAvatarSDK] Error interrupting:', err);
    } finally {
      // Always reset processing flag
      setTimeout(() => {
        isProcessingInterruptRef.current = false;
      }, 100);
    }
  }, [onStatus]);

  // Start listening (force avatar to listen)
  const startListening = useCallback(async () => {
    if (!sessionRef.current || !isConnected) return;
    
    try {
      console.log('[LiveAvatarSDK] 👂 Sending avatar.start_listening...');
      // Try to find underlying LiveKit room to send raw event
      // @ts-ignore - accessing internal property
      const room = sessionRef.current.room || sessionRef.current.livekitRoom;
      
      if (room && room.localParticipant) {
        const eventData = JSON.stringify({ type: 'avatar.start_listening' });
        const data = new TextEncoder().encode(eventData);
        await room.localParticipant.publishData(data, { reliable: true });
        console.log('[LiveAvatarSDK] ✅ avatar.start_listening sent');
        onStatus?.('listening');
      } else {
        console.warn('[LiveAvatarSDK] ⚠️ Could not find LiveKit room to send start_listening');
      }
    } catch (err) {
      console.error('[LiveAvatarSDK] ❌ Error sending start_listening:', err);
    }
  }, [isConnected, onStatus]);

  // Stop listening (force avatar to idle)
  const stopListening = useCallback(async () => {
    if (!sessionRef.current || !isConnected) return;

    try {
      console.log('[LiveAvatarSDK] 🔇 Sending avatar.stop_listening...');
      // Try to find underlying LiveKit room to send raw event
      // @ts-ignore
      const room = sessionRef.current.room || sessionRef.current.livekitRoom;
      
      if (room && room.localParticipant) {
        const eventData = JSON.stringify({ type: 'avatar.stop_listening' });
        const data = new TextEncoder().encode(eventData);
        await room.localParticipant.publishData(data, { reliable: true });
        console.log('[LiveAvatarSDK] ✅ avatar.stop_listening sent');
        onStatus?.('idle');
      } else {
        console.warn('[LiveAvatarSDK] ⚠️ Could not find LiveKit room to send stop_listening');
      }
    } catch (err) {
      console.error('[LiveAvatarSDK] ❌ Error sending stop_listening:', err);
    }
  }, [isConnected, onStatus]);

  return {
    isInitialized,
    isConnected,
    isSpeaking,
    error,
    speak,
    interrupt,
    startListening,
    stopListening,
    cleanup,
  };
}

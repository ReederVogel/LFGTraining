"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { createLiveAvatarClient, LiveAvatarClient } from "@/lib/liveavatar";
import { getAvatarById } from "@/lib/avatars";
import { PersonalityControls } from "@/lib/prompt-builder";

const AVATAR_RESPONSE_DELAY_MS = 0; // No delay - avatar responds immediately

// LiveAvatar CUSTOM mode uses `repeatAudio()` under the hood (see `lib/liveavatar.ts`),
// which can behave like a restart if called too frequently. To prevent the common
// "hel hello..." stutter, we pre-buffer the start of each assistant audio stream
// and throttle subsequent sends.
// Balancing smoothness vs latency:
// - We want the avatar to start speaking quickly after the user stops.
// - But we also want to avoid mid-sentence gaps from `repeatAudio()` underflow.
// Strategy: Buffer enough for smooth continuous playback without gaps.
// CRITICAL FIX: Previous values caused mid-response gaps (avatar cut off then continued).
// The issue: after first chunk, subsequent chunks required MORE data (56000) but LESS wait time (400ms).
// This caused gaps between chunks. Solution: consistent buffering throughout.
const AUDIO_FLUSH_DEBOUNCE_MS = 80; // Faster debounce for quicker chunk assembly
const AUDIO_MIN_FIRST_FLUSH_CHARS = 40000; // ~580ms before first send (balance: quick start + smooth playback)
const AUDIO_MIN_NEXT_FLUSH_CHARS = 40000; // SAME as first chunk - consistent sizing prevents gaps
const AUDIO_MIN_SEND_INTERVAL_MS = 250; // Reduced interval - allows faster continuous streaming
const AUDIO_MAX_WAIT_FIRST_MS = 600; // Increased: wait longer for first chunk to accumulate properly
const AUDIO_MAX_WAIT_NEXT_MS = 500; // Increased: wait longer for subsequent chunks too (prevents gaps)
const AUDIO_MIN_ABSOLUTE_CHARS = 12000; // Reduced: allow smaller final chunks for smoother endings

interface TranscriptItem {
  speaker: "user" | "assistant";
  text: string;
  timestamp: number;
  id: string;
}

// End-of-turn "silence coach":
// If the trainee stays silent for 8 seconds after the avatar finishes speaking,
// show a gentle prompt with a notification sound.
// If silence continues to 25 seconds, automatically end the session.
const SILENCE_COACH_MS = 8000;
const SILENCE_AUTO_END_MS = 25000;

const STAGE_DIRECTION_REGEX = /(\((?:[^)]{0,40})(deep\s*breath|breath(?:es|ing)?|sigh(?:s|ing)?|sniff(?:le|les|ling)?|sob(?:s|bing)?|cry(?:ing|ies)?|chok(?:e|es)\s*up|clear(?:s)?\s*(?:my\s*)?throat|gasp(?:s|ing)?|inhale(?:s|d|ing)?|exhale(?:s|d|ing)?|pause(?:s|d|ing)?)(?:[^)]{0,40})\))|(\[(?:[^\]]{0,40})(deep\s*breath|breath(?:es|ing)?|sigh(?:s|ing)?|sniff(?:le|les|ling)?|sob(?:s|bing)?|cry(?:ing|ies)?|chok(?:e|es)\s*up|clear(?:s)?\s*(?:my\s*)?throat|gasp(?:s|ing)?|inhale(?:s|d|ing)?|exhale(?:s|d|ing)?|pause(?:s|d|ing)?)(?:[^\]]{0,40})\])|(\*(?:[^*]{0,40})(deep\s*breath|breath(?:es|ing)?|sigh(?:s|ing)?|sniff(?:le|les|ling)?|sob(?:s|bing)?|cry(?:ing|ies)?|chok(?:e|es)\s*up|clear(?:s)?\s*(?:my\s*)?throat|gasp(?:s|ing)?|inhale(?:s|d|ing)?|exhale(?:s|d|ing)?|pause(?:s|d|ing)?)(?:[^*]{0,40})\*)/gi;

const sanitizeAssistantUtterance = (text: string): string => {
  if (!text) return text;
  const withoutStageDirections = text.replace(STAGE_DIRECTION_REGEX, " ");
  return withoutStageDirections
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();
};

export default function SessionPage({ params }: { params: { id: string } }) {
  const avatarId = params.id;
  const avatar = getAvatarById(avatarId);
  
  const [status, setStatus] = useState<string>("Ready to start");
  const [isConnected, setIsConnected] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [hasUserStartedSpeaking, setHasUserStartedSpeaking] = useState(false);
  const [silenceCoachMessage, setSilenceCoachMessage] = useState<string | null>(null);
  const [sessionEndReason, setSessionEndReason] = useState<"manual" | "inactivity" | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
  
  // Personality controls for Sarah avatar
  const [personalityControls, setPersonalityControls] = useState<PersonalityControls>({
    sadnessLevel: 3,  // Default: Moderate sadness
    copingStyle: 'none',  // Default: No secondary coping style (just grief)
    copingIntensity: 3,   // Default: Moderate intensity (if a coping style is selected)
    accentType: 'none',  // Default: No accent
    accentStrength: 0,   // Default: No accent strength
    language: 'english',  // Default: English
  });

  const getAccentDisplayName = (
    accentType: PersonalityControls["accentType"] | undefined
  ): string => {
    if (!accentType || accentType === "none") return "None (Standard English)";
    if (accentType === "midwestern") return "Midwestern";
    if (accentType === "texas-southern") return "Texas Southern";
    if (accentType === "cajun") return "Cajun";
    if (accentType === "indian-english") return "Indian";
    return String(accentType);
  };
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const avatarClientRef = useRef<LiveAvatarClient | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioBufferRef = useRef<string[]>([]);
  const audioBufferedCharsRef = useRef<number>(0);
  const audioFlushTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isFlushingAudioRef = useRef(false);
  const needsAnotherFlushRef = useRef(false);
  const audioHasStartedRef = useRef(false);
  const audioFirstDeltaAtRef = useRef<number | null>(null);
  const lastAvatarAudioSendAtRef = useRef<number>(0);
  const messageSequenceRef = useRef(0);
  const currentResponseIdRef = useRef<string | null>(null);
  const currentAudioResponseIdRef = useRef<string | null>(null);
  const lastAudioSentTimeRef = useRef<number>(0);
  const audioHealthCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isAvatarAudioPlayingRef = useRef<boolean>(false);
  const pendingInterruptTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastInterruptAtRef = useRef<number>(0);
  const lastUserMessageTimestampRef = useRef<number>(0);
  const userSpeechStartTimeRef = useRef<number | null>(null);
  const pendingUserTranscriptRef = useRef<{ itemId: string; startTime: number } | null>(null);
  // Map item_id to speech start time to handle multiple concurrent speech events
  const userSpeechStartTimesRef = useRef<Map<string, number>>(new Map());
  const isConnectedRef = useRef<boolean>(false);
  const statusRef = useRef<string>(status);
  const silenceCoachTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const silenceAutoEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const silenceCoachEligibleRef = useRef<boolean>(false);
  const coachSoundContextRef = useRef<AudioContext | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasPlayedReadySoundRef = useRef<boolean>(false);
  const audioStatsRef = useRef<Map<string, { deltaCount: number; totalChars: number; lastAt: number }>>(
    new Map()
  );
  const transcriptStatsRef = useRef<Map<string, { deltaCount: number; totalChars: number; lastAt: number }>>(
    new Map()
  );
  const assistantTextTailRef = useRef<Map<string, string>>(new Map());

  const formatDuration = useCallback((totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, []);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const cancelSilenceCoach = useCallback(() => {
    if (silenceCoachTimeoutRef.current) {
      clearTimeout(silenceCoachTimeoutRef.current);
      silenceCoachTimeoutRef.current = null;
    }
    if (silenceAutoEndTimeoutRef.current) {
      clearTimeout(silenceAutoEndTimeoutRef.current);
      silenceAutoEndTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setSilenceCoachMessage(null);
    setCountdownSeconds(null);
  }, []);

  const playCoachSound = useCallback(() => {
    try {
      // Create or resume AudioContext (must be triggered after user gesture)
      if (!coachSoundContextRef.current) {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        coachSoundContextRef.current = new Ctx();
      }

      const ctx = coachSoundContextRef.current;
      if (ctx.state === "suspended") {
        void ctx.resume();
      }

      // Two-tone gentle "ding" notification
      const now = ctx.currentTime;

      // First tone (higher)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.value = 880; // A5
      gain1.gain.setValueAtTime(0.15, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.15);

      // Second tone (lower, slightly delayed)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.value = 660; // E5
      gain2.gain.setValueAtTime(0.12, now + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.1);
      osc2.stop(now + 0.3);
    } catch {
      // Sound is optional - ignore errors
    }
  }, []);

  const playReadySound = useCallback(() => {
    try {
      // Create or resume AudioContext (must be triggered after user gesture)
      if (!coachSoundContextRef.current) {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        coachSoundContextRef.current = new Ctx();
      }

      const ctx = coachSoundContextRef.current;
      if (ctx.state === "suspended") {
        void ctx.resume();
      }

      // Single gentle tone for "ready to begin"
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 523; // C5 - pleasant, welcoming tone
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch {
      // Sound is optional - ignore errors
    }
  }, []);

  const playTimerTick = useCallback(() => {
    try {
      // Create or resume AudioContext (must be triggered after user gesture)
      if (!coachSoundContextRef.current) {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        coachSoundContextRef.current = new Ctx();
      }

      const ctx = coachSoundContextRef.current;
      if (ctx.state === "suspended") {
        void ctx.resume();
      }

      // Short, quiet tick sound for countdown timer
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 800; // Higher pitch for tick
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    } catch {
      // Sound is optional - ignore errors
    }
  }, []);

  const scheduleSilenceCoach = useCallback(() => {
    // Only show during an active session.
    if (!isConnectedRef.current) return;

    // Only show when we're truly ready for the trainee to speak.
    if (statusRef.current !== "Ready - Start speaking!") return;

    // Only schedule once per avatar "turn end".
    if (!silenceCoachEligibleRef.current) return;

    cancelSilenceCoach();

    // Schedule coach message at 8 seconds
    silenceCoachTimeoutRef.current = setTimeout(() => {
      // Don't show if session ended, avatar resumed speaking, or user is speaking.
      if (!isConnectedRef.current) return;
      if (isAvatarAudioPlayingRef.current) return;
      if (statusRef.current !== "Ready - Start speaking!") return;
      if (!silenceCoachEligibleRef.current) return;

      setSilenceCoachMessage("Say something");
      playCoachSound();
      // Mark consumed so it won't reappear until the next avatar turn end.
      silenceCoachEligibleRef.current = false;

      // Start countdown timer (25 seconds total - 8 seconds elapsed = 17 seconds remaining)
      let remaining = Math.floor((SILENCE_AUTO_END_MS - SILENCE_COACH_MS) / 1000);
      setCountdownSeconds(remaining);
      // Play initial tick
      playTimerTick();

      countdownIntervalRef.current = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          setCountdownSeconds(null);
        } else {
          setCountdownSeconds(remaining);
          // Play tick sound each second
          playTimerTick();
        }
      }, 1000);
    }, SILENCE_COACH_MS);

    // Schedule auto-end at 20 seconds
    silenceAutoEndTimeoutRef.current = setTimeout(() => {
      if (!isConnectedRef.current) return;
      if (isAvatarAudioPlayingRef.current) return;
      if (statusRef.current !== "Ready - Start speaking!") return;

      console.log("⏱️ Auto-ending session due to 25 seconds of silence");
      // Set reason before ending
      setSessionEndReason("inactivity");
      setSilenceCoachMessage("Session ending due to inactivity...");
      // Trigger end session after a brief moment to show the message
      setTimeout(() => {
        if (isConnectedRef.current) {
          // Trigger disconnect by closing WebSocket and cleaning up
          window.dispatchEvent(new CustomEvent("silence-auto-end"));
        }
      }, 1500);
    }, SILENCE_AUTO_END_MS);
  }, [cancelSilenceCoach, playCoachSound, playTimerTick]);

  // Validate transcript to filter out background audio/video content
  // This is purely cosmetic - only affects what's displayed, not audio processing
  const isValidUserTranscript = useCallback((text: string): boolean => {
    const normalized = text.trim().toLowerCase();
    if (!normalized) return false;

    // Filter out common YouTube/video outro phrases
    const suspiciousPhrases = [
      "thank you for watching",
      "please post them in the comments",
      "if you have any questions or other problems",
      "hope you enjoyed",
      "don't forget to subscribe",
      "like and subscribe",
      "hit the bell icon",
      "thanks for watching",
      "see you next time",
      "until next time"
    ];

    // Check if transcript contains suspicious phrases
    const containsSuspiciousPhrase = suspiciousPhrases.some(phrase => 
      normalized.includes(phrase)
    );

    // Filter out very long transcripts that sound like scripts (likely background audio)
    const isTooLong = normalized.length > 150;
    const hasMultipleSentences = (normalized.match(/[.!?]/g) || []).length > 2;
    
    // Reject if it contains suspicious phrases OR is suspiciously long with multiple sentences
    if (containsSuspiciousPhrase || (isTooLong && hasMultipleSentences)) {
      console.warn("⚠️ Filtered suspicious transcript:", text.substring(0, 80));
      return false;
    }

    return true;
  }, []);

  useEffect(() => {
    if (!connectedAt) {
      setElapsedSeconds(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - connectedAt) / 1000));
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [connectedAt]);

  // Keep transcript scrolled to top (newest messages) when new messages arrive
  useEffect(() => {
    if (transcriptScrollRef.current) {
      // Ensure scroll is at top to show newest messages
      // Use setTimeout to ensure DOM has updated
      const timeoutId = setTimeout(() => {
        if (transcriptScrollRef.current) {
          transcriptScrollRef.current.scrollTop = 0;
        }
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [transcript]);

  const upsertAssistantTranscript = useCallback((responseId: string, textChunk: string, timestamp?: number) => {
    if (!textChunk) {
      return;
    }
    setTranscript(prev => {
      const existingIndex = prev.findIndex(
        item => item.speaker === "assistant" && item.id === responseId
      );

      if (existingIndex !== -1) {
        const updated = [...prev];
        const nextText = sanitizeAssistantUtterance(updated[existingIndex].text + textChunk);
        assistantTextTailRef.current.set(responseId, nextText.slice(-80));
        updated[existingIndex] = {
          ...updated[existingIndex],
          text: nextText,
        };
        return updated;
      }

      // Ensure assistant message timestamp is always AFTER the last user message
      // Also check if user is currently speaking (has a pending speech start time)
      const now = Date.now();
      
      // Get the most recent user-related timestamp from multiple sources:
      // 1. Last completed user message timestamp
      // 2. Current pending speech start time (user is speaking now)
      // 3. Any pending user transcript start time
      // 4. Any stored speech start times for pending items
      const storedStartTimes = Array.from(userSpeechStartTimesRef.current.values());
      const maxStoredTime = storedStartTimes.length > 0 ? Math.max(...storedStartTimes) : 0;
      
      const lastUserTimestamp = Math.max(
        lastUserMessageTimestampRef.current,
        userSpeechStartTimeRef.current || 0, // Current speech start time
        pendingUserTranscriptRef.current?.startTime || 0, // Pending transcript start time
        maxStoredTime // Any stored speech start times
      );
      
      // Ensure assistant timestamp is at least 50ms after user speech to handle rapid responses
      // This buffer helps ensure proper ordering even with network delays
      const minTimestamp = Math.max(
        lastUserTimestamp + 50, // At least 50ms after last user message or current speech start
        timestamp ? Math.max(timestamp, lastUserTimestamp + 50) : now, // Use provided timestamp but ensure it's after user
        now // Never go back in time
      );

      return [
        ...prev,
        {
          speaker: "assistant",
          text: sanitizeAssistantUtterance(textChunk),
          timestamp: minTimestamp,
          id: responseId,
        },
      ];
    });
  }, []);


  const clearPendingAudio = useCallback((interruptAvatar = false) => {
    audioBufferRef.current = [];
    needsAnotherFlushRef.current = false;
    audioBufferedCharsRef.current = 0;
    audioHasStartedRef.current = false;
    audioFirstDeltaAtRef.current = null;
    lastAvatarAudioSendAtRef.current = 0;
    if (audioFlushTimeoutRef.current) {
      clearTimeout(audioFlushTimeoutRef.current);
      audioFlushTimeoutRef.current = null;
    }
    
    // Remove interrupted transcript entries if avatar was interrupted
    if (interruptAvatar && currentResponseIdRef.current) {
      const responseIdToRemove = currentResponseIdRef.current;
      setTranscript(prev => prev.filter(
        item => !(item.speaker === "assistant" && item.id === responseIdToRemove)
      ));
      currentResponseIdRef.current = null;
      console.log(`🗑️ Removed interrupted transcript for response_id: ${responseIdToRemove}`);
    }
    
    if (interruptAvatar && avatarClientRef.current) {
      try {
        // Force interrupt when OpenAI detects user speech - bypass cooldown for immediate response
        avatarClientRef.current.interruptSpeech(true);
      } catch (error) {
        console.error("Error interrupting avatar speech:", error);
      }
    }
  }, []);

  const flushAudioBuffer = useCallback(async (force = false, retryCount = 0) => {
    if (!audioBufferRef.current.length || !avatarClientRef.current) {
      if (!audioBufferRef.current.length && audioFlushTimeoutRef.current) {
        clearTimeout(audioFlushTimeoutRef.current);
        audioFlushTimeoutRef.current = null;
      }
      return;
    }

    if (isFlushingAudioRef.current) {
      needsAnotherFlushRef.current = true;
      return;
    }

    if (audioFlushTimeoutRef.current) {
      clearTimeout(audioFlushTimeoutRef.current);
      audioFlushTimeoutRef.current = null;
    }

    const now = Date.now();
    const minChars = audioHasStartedRef.current
      ? AUDIO_MIN_NEXT_FLUSH_CHARS
      : AUDIO_MIN_FIRST_FLUSH_CHARS;
    const maxWaitMs = audioHasStartedRef.current ? AUDIO_MAX_WAIT_NEXT_MS : AUDIO_MAX_WAIT_FIRST_MS;
    const firstDeltaAt = audioFirstDeltaAtRef.current ?? now;
    const bufferedChars = audioBufferedCharsRef.current;

    // If we haven't buffered enough yet, debounce and wait a bit longer (unless forced).
    if (!force && bufferedChars > 0 && bufferedChars < minChars && now - firstDeltaAt < maxWaitMs) {
      audioFlushTimeoutRef.current = setTimeout(() => {
        flushAudioBuffer(false, 0);
      }, AUDIO_FLUSH_DEBOUNCE_MS);
      return;
    }

    const payload = audioBufferRef.current.join("");
    const payloadSize = payload.length;
    const responseIdForFlush = currentAudioResponseIdRef.current;
    
    // Don't send empty payloads
    if (payloadSize === 0) {
      isFlushingAudioRef.current = false;
      return;
    }
    
    // CRITICAL: Never send audio chunks smaller than the minimum threshold
    // This prevents choppy playback from tiny audio fragments
    // Exception: allow small final chunks when force=true (end of response)
    if (!force && payloadSize < AUDIO_MIN_ABSOLUTE_CHARS) {
      console.log(`⏸️ Audio chunk too small (${payloadSize} < ${AUDIO_MIN_ABSOLUTE_CHARS}) - waiting for more data`);
      // Put back in buffer and schedule another flush attempt
      // Don't clear the buffer, let it accumulate more
      audioBufferRef.current = [payload];
      audioBufferedCharsRef.current = payloadSize;
      isFlushingAudioRef.current = false;
      // Schedule another flush attempt using direct timeout (avoid circular dependency)
      if (audioFlushTimeoutRef.current) {
        clearTimeout(audioFlushTimeoutRef.current);
      }
      audioFlushTimeoutRef.current = setTimeout(() => {
        flushAudioBuffer(false, 0);
      }, AUDIO_FLUSH_DEBOUNCE_MS);
      return;
    }
    
    audioBufferRef.current = [];
    audioBufferedCharsRef.current = 0;
    isFlushingAudioRef.current = true;
    audioHasStartedRef.current = true;
    lastAvatarAudioSendAtRef.current = now;

    const flushStart = Date.now();
    try {
      console.log(`📤 Flushing audio buffer (attempt ${retryCount + 1}) - size: ${payloadSize} chars, force: ${force}`);
      await avatarClientRef.current.speakPcmAudio(payload);
      lastAudioSentTimeRef.current = Date.now();
      const flushDuration = Date.now() - flushStart;
      console.log(`✅ Audio buffer flushed successfully in ${flushDuration}ms - sent ${payloadSize} chars to LiveAvatar`);
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      console.error(`❌ Error sending audio to avatar (attempt ${retryCount + 1}):`, errorMessage);
      
      // Retry logic: retry up to 2 times with exponential backoff
      if (retryCount < 2 && avatarClientRef.current) {
        const retryDelay = Math.min(100 * Math.pow(2, retryCount), 500); // 100ms, 200ms, max 500ms
        console.log(`🔄 Retrying audio send in ${retryDelay}ms...`);
        
        setTimeout(() => {
          // Put payload back in buffer for retry
          audioBufferRef.current.unshift(payload);
          audioBufferedCharsRef.current += payload.length;
          flushAudioBuffer(force, retryCount + 1);
        }, retryDelay);
        return; // Don't mark as done yet
      } else {
        console.error("❌ Audio send failed after all retries - audio may be lost");
        // Update status to show error
        setStatus(`Audio error: ${errorMessage.substring(0, 50)}...`);
      }
    } finally {
      isFlushingAudioRef.current = false;
      if (needsAnotherFlushRef.current) {
        needsAnotherFlushRef.current = false;
        flushAudioBuffer(false, 0); // Reset retry count for next flush
      }
    }
  }, []);

  const scheduleAudioFlush = useCallback(() => {
    if (audioFlushTimeoutRef.current) {
      clearTimeout(audioFlushTimeoutRef.current);
    }
    audioFlushTimeoutRef.current = setTimeout(() => {
      flushAudioBuffer(false, 0);
    }, AUDIO_FLUSH_DEBOUNCE_MS);
  }, [flushAudioBuffer]);

  // Audio health check: monitor if audio is being sent but not confirmed
  useEffect(() => {
    if (!isConnected || !avatarClientRef.current) {
      if (audioHealthCheckIntervalRef.current) {
        clearInterval(audioHealthCheckIntervalRef.current);
        audioHealthCheckIntervalRef.current = null;
      }
      return;
    }

    // Start health check interval
    audioHealthCheckIntervalRef.current = setInterval(() => {
      const timeSinceLastAudio = Date.now() - lastAudioSentTimeRef.current;
      
      // If we have audio in buffer but haven't sent anything in 5 seconds, something is wrong
      if (audioBufferRef.current.length > 0 && timeSinceLastAudio > 5000) {
        console.warn("⚠️ Audio health check: Audio buffer has data but nothing sent in 5s - forcing flush");
        flushAudioBuffer(true, 0);
      }
      
      // If we're flushing but stuck for more than 10 seconds, reset
      if (isFlushingAudioRef.current && timeSinceLastAudio > 10000) {
        console.warn("⚠️ Audio health check: Flush stuck for 10s - resetting");
        isFlushingAudioRef.current = false;
        needsAnotherFlushRef.current = false;
        flushAudioBuffer(true, 0);
      }
    }, 2000); // Check every 2 seconds

    return () => {
      if (audioHealthCheckIntervalRef.current) {
        clearInterval(audioHealthCheckIntervalRef.current);
        audioHealthCheckIntervalRef.current = null;
      }
    };
  }, [isConnected, flushAudioBuffer]);

  const initializeLiveAvatar = async (): Promise<boolean> => {
    if (!avatar) return false;
    
    try {
      setStatus("Initializing avatar...");
      
      avatarClientRef.current = createLiveAvatarClient(
        avatar.avatarId,
        avatar.voiceId,
        undefined,
        "CUSTOM",
        { enforceTurnTaking: false }
      );

      // Track when avatar audio starts/stops playing (for debugging)
      avatarClientRef.current.onAudioStateChange((isPlaying) => {
        isAvatarAudioPlayingRef.current = isPlaying;
        console.log(`🎤 Avatar audio state changed: ${isPlaying ? 'playing' : 'stopped'}`);
        // End-of-turn silence coach: schedule after avatar stops; cancel when avatar resumes.
        if (isPlaying) {
          cancelSilenceCoach();
          silenceCoachEligibleRef.current = false;
        } else {
          // Avatar finished a turn; allow exactly one coach prompt for this turn end.
          silenceCoachEligibleRef.current = true;
          scheduleSilenceCoach();
        }
      });

      if (videoRef.current) {
        await avatarClientRef.current.initialize(videoRef.current);
        setStatus("Avatar initialized ✓");
        return true;
      }
      return false;
    } catch (err: any) {
      console.error("LiveAvatar initialization error:", err);
      setError(`Avatar Error: ${err.message}`);
      setStatus("Avatar initialization failed");
      return false;
    }
  };

  const setupMicrophone = async (ws: WebSocket): Promise<boolean> => {
    try {
      setStatus("Setting up microphone...");
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });
      mediaStreamRef.current = stream;
      
      const audioContext = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      // ScriptProcessorNode must be connected to keep `onaudioprocess` firing in many browsers.
      // Connect through a muted gain node to avoid playing the microphone back to the user
      // (which can cause echo/feedback and trigger false VAD interrupts that cut avatar speech).
      const mutedGain = audioContext.createGain();
      mutedGain.gain.value = 0;
      
      processor.onaudioprocess = (e) => {
        if (ws.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcm16 = new Int16Array(inputData.length);
          
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          
          const bytes = new Uint8Array(pcm16.buffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);
          
          ws.send(JSON.stringify({
            type: "input_audio_buffer.append",
            audio: base64,
          }));
        }
      };
      
      source.connect(processor);
      processor.connect(mutedGain);
      mutedGain.connect(audioContext.destination);
      
      setStatus("Microphone ready ✓");
      return true;
    } catch (err: any) {
      console.error("Microphone setup error:", err);
      setError(`Microphone Error: ${err.message}`);
      setStatus("Microphone setup failed");
      return false;
    }
  };

  const initializeOpenAI = async (): Promise<boolean> => {
    if (!avatar) {
      setError("Avatar not found");
      return false;
    }

    try {
      setStatus("Connecting to OpenAI...");

      const tokenFetchStartedAt = Date.now();
      
      const tokenResponse = await fetch("/api/openai-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          avatarId: avatar.id,
          controls: avatarId === 'sarah' ? personalityControls : undefined,
        }),
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json().catch(() => ({ error: "Unknown error" }));
        const errorMessage = errorData.error || `HTTP ${tokenResponse.status}: ${tokenResponse.statusText}`;
        console.error("OpenAI token error:", errorMessage);
        throw new Error(`Failed to get OpenAI token: ${errorMessage}`);
      }

      const tokenData = await tokenResponse.json();
      const clientSecret = tokenData.client_secret?.value;

      if (!clientSecret) {
        throw new Error("No client secret in response");
      }

      const tokenFetchMs = Date.now() - tokenFetchStartedAt;
      const wsCreateAt = Date.now();

      const ws = new WebSocket(
        "wss://api.openai.com/v1/realtime?model=gpt-realtime",
        [
          "realtime",
          "openai-beta.realtime-v1",
          `openai-insecure-api-key.${clientSecret}`,
        ]
      );
      
      wsRef.current = ws;

      return new Promise((resolve, reject) => {
        ws.onopen = async () => {
          setStatus("Connected to OpenAI ✓");
          
          // Only configure technical settings (transcription)
          // Don't override instructions or voice - let the prompt handle that
          ws.send(JSON.stringify({
            type: "session.update",
            session: {
              input_audio_transcription: {
                model: "gpt-4o-mini-transcribe-2025-12-15",
              },
            },
          }));

          const micSuccess = await setupMicrophone(ws);
          
          if (micSuccess) {
            setStatus("Ready - Start speaking!");
            resolve(true);
          } else {
            reject(new Error("Microphone setup failed"));
          }
        };

        ws.onmessage = async (event) => {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case "response.audio.delta":
              if (data.delta) {
                const audioResponseId = data.response_id || data.response?.id || currentAudioResponseIdRef.current;
                if (audioResponseId) {
                  currentAudioResponseIdRef.current = audioResponseId;
                  const stats = audioStatsRef.current.get(audioResponseId) || { deltaCount: 0, totalChars: 0, lastAt: 0 };
                  const deltaChars = typeof data.delta === "string" ? data.delta.length : 0;
                  stats.deltaCount += 1;
                  stats.totalChars += deltaChars;
                  stats.lastAt = Date.now();
                  audioStatsRef.current.set(audioResponseId, stats);
                  
                  // Log first audio delta for debugging
                  if (stats.deltaCount === 1) {
                    console.log(`🎵 First audio delta received - response_id: ${audioResponseId}, size: ${deltaChars} chars`);
                  }
                }
                audioBufferRef.current.push(data.delta);
                audioBufferedCharsRef.current += typeof data.delta === "string" ? data.delta.length : 0;
                if (!audioFirstDeltaAtRef.current) {
                  audioFirstDeltaAtRef.current = Date.now();
                }
                lastAudioSentTimeRef.current = Date.now();

                // Smooth + low latency: start speaking once we have a small initial buffer,
                // then continue sending larger throttled chunks so we don't underflow.
                // (We still always flush whatever is left on `response.done`.)
                const now = Date.now();
                const minChars = audioHasStartedRef.current
                  ? AUDIO_MIN_NEXT_FLUSH_CHARS
                  : AUDIO_MIN_FIRST_FLUSH_CHARS;
                const enoughData = audioBufferedCharsRef.current >= minChars;
                const intervalOk = now - lastAvatarAudioSendAtRef.current >= AUDIO_MIN_SEND_INTERVAL_MS;

                if (enoughData && intervalOk) {
                  void flushAudioBuffer(false, 0);
                } else {
                  scheduleAudioFlush();
                }
              }
              break;

            case "response.audio_transcript.delta": {
              const responseId = data.response_id || data.response?.id;
              const deltaText = data.delta;
              if (!responseId || !deltaText) break;

              const tStats =
                transcriptStatsRef.current.get(responseId) || { deltaCount: 0, totalChars: 0, lastAt: 0 };
              tStats.deltaCount += 1;
              tStats.totalChars += typeof deltaText === "string" ? deltaText.length : 0;
              tStats.lastAt = Date.now();
              transcriptStatsRef.current.set(responseId, tStats);
              
              if (currentResponseIdRef.current && currentResponseIdRef.current !== responseId) {
                const oldResponseId = currentResponseIdRef.current;
                setTranscript(prev => prev.filter(
                  item => !(item.speaker === "assistant" && item.id === oldResponseId)
                ));
                console.log(`🗑️ Removed interrupted transcript for response_id: ${oldResponseId} (new response started)`);
              }
              
              currentResponseIdRef.current = responseId;
              
              // Show transcript immediately (no delay)
              const eventTimestamp = data.created_at || data.timestamp;
              upsertAssistantTranscript(responseId, deltaText, eventTimestamp);
              break;
            }

            case "conversation.item.input_audio_transcription.completed":
              if (data.transcript && data.item_id) {
                // User spoke: hide/cancel the silence coach.
                cancelSilenceCoach();
                silenceCoachEligibleRef.current = false;
                // Filter out suspicious transcripts (background audio/video content)
                // This only affects display - doesn't interfere with audio processing
                if (!isValidUserTranscript(data.transcript)) {
                  break; // Skip adding to transcript
                }

                // Mark that user has started speaking
                setHasUserStartedSpeaking(true);
                
                setTranscript(prev => {
                  const existingIndex = prev.findIndex(
                    item => item.speaker === "user" && item.id === data.item_id
                  );
                  
                  if (existingIndex !== -1) {
                    const updated = [...prev];
                    updated[existingIndex] = {
                      ...updated[existingIndex],
                      text: data.transcript
                    };
                    return updated;
                  }
                  
                  // Use the timestamp from when user STARTED speaking, not when transcription completed
                  // Check multiple sources for the speech start time
                  const storedStartTime = userSpeechStartTimesRef.current.get(data.item_id);
                  const pendingStartTime = pendingUserTranscriptRef.current?.startTime;
                  const currentStartTime = userSpeechStartTimeRef.current;
                  
                  // Use the earliest available timestamp (most accurate)
                  // Prioritize stored time, then pending, then current, then fallback to now
                  const userTimestamp = storedStartTime || pendingStartTime || currentStartTime || Date.now();
                  lastUserMessageTimestampRef.current = Math.max(lastUserMessageTimestampRef.current, userTimestamp);
                  
                  // Store this timestamp for this item_id in case assistant responses arrive first
                  userSpeechStartTimesRef.current.set(data.item_id, userTimestamp);
                  
                  // Clean up tracking for this item after a delay (in case assistant responses are still coming)
                  setTimeout(() => {
                    userSpeechStartTimesRef.current.delete(data.item_id);
                    if (pendingUserTranscriptRef.current?.itemId === data.item_id) {
                      pendingUserTranscriptRef.current = null;
                    }
                  }, 5000); // Keep for 5 seconds to handle late-arriving assistant responses
                  
                  // Don't clear global speech start time immediately - it might be needed for next message
                  // It will be updated on the next speech_started event
                  
                  return [
                    ...prev,
                    {
                      speaker: "user",
                      text: data.transcript,
                      timestamp: userTimestamp,
                      id: data.item_id,
                    }
                  ];
                });
              }
              break;

            case "input_audio_buffer.speech_started":
              setStatus("Listening...");
              // User started speaking: hide/cancel the silence coach immediately.
              cancelSilenceCoach();
              silenceCoachEligibleRef.current = false;
              // Track when user starts speaking - this is the actual timestamp for their message
              const speechStartTime = Date.now();
              userSpeechStartTimeRef.current = speechStartTime;
              // Debounce interrupts: VAD can false-trigger on noise / feedback.
              // Only interrupt if the avatar is actually playing (or we have pending assistant audio),
              // and only after a short delay (to avoid micro-blips).
              if (pendingInterruptTimeoutRef.current) {
                clearTimeout(pendingInterruptTimeoutRef.current);
                pendingInterruptTimeoutRef.current = null;
              }
              pendingInterruptTimeoutRef.current = setTimeout(() => {
                pendingInterruptTimeoutRef.current = null;
                const now = Date.now();
                // Only consider "pending assistant audio" if we actually have audio to play/send.
                // Transcript deltas can arrive even when no audio is buffered yet; using transcript
                // activity here can cause false interrupts (transcript continues but avatar audio stops).
                const hasPendingAssistantAudio =
                  audioHasStartedRef.current || audioBufferRef.current.length > 0;
                const avatarIsPlaying = isAvatarAudioPlayingRef.current;
                const cooldownOk = now - lastInterruptAtRef.current > 800;

                if ((avatarIsPlaying || hasPendingAssistantAudio) && cooldownOk) {
                  lastInterruptAtRef.current = now;
                  clearPendingAudio(true);
                } else {
                  // Don't nuke audio on likely false triggers.
                  console.log("⏸️ Skipping interrupt (likely VAD noise):", {
                    avatarIsPlaying,
                    hasPendingAssistantAudio,
                    cooldownMs: now - lastInterruptAtRef.current,
                  });
                }
              }, 250);
              break;

            case "input_audio_buffer.speech_stopped":
              setStatus("Processing...");
              if (pendingInterruptTimeoutRef.current) {
                clearTimeout(pendingInterruptTimeoutRef.current);
                pendingInterruptTimeoutRef.current = null;
              }
              break;

            case "response.done":
            case "response.completed":
            case "response.output_audio.done":
              {
                const doneResponseId = data.response_id || data.response?.id || currentAudioResponseIdRef.current;
                const a = doneResponseId ? audioStatsRef.current.get(doneResponseId) : undefined;
                const t = doneResponseId ? transcriptStatsRef.current.get(doneResponseId) : undefined;
                const tail = doneResponseId ? assistantTextTailRef.current.get(doneResponseId) : undefined;
                
                // DIAGNOSTIC: Log audio stats to help debug "no audio" issues
                console.log(`📊 Response done - Audio stats:`, {
                  responseId: doneResponseId,
                  audioDeltaCount: a?.deltaCount ?? 0,
                  audioTotalChars: a?.totalChars ?? 0,
                  transcriptDeltaCount: t?.deltaCount ?? 0,
                  transcriptTotalChars: t?.totalChars ?? 0,
                  bufferedChars: audioBufferedCharsRef.current,
                  transcriptText: tail,
                });
                
                // WARNING: If we have transcript but no audio, something is wrong
                if ((t?.deltaCount ?? 0) > 0 && (a?.deltaCount ?? 0) === 0) {
                  console.warn(`⚠️ OpenAI generated transcript but NO AUDIO - This usually means:`);
                  console.warn(`   1. The response was too short (OpenAI may not generate audio for very short responses)`);
                  console.warn(`   2. There was an issue with the OpenAI audio stream`);
                  console.warn(`   Response text: "${tail}"`);
                  setStatus("⚠️ No audio received - response may have been too short");
                }
              }
              await flushAudioBuffer(true, 0);
              // Mark audio as finished in LiveAvatar
              if (avatarClientRef.current) {
                avatarClientRef.current.markAudioFinished();
              }
              // Reset stream tracking for the next response
              audioHasStartedRef.current = false;
              audioFirstDeltaAtRef.current = null;
              lastAvatarAudioSendAtRef.current = 0;
              // Clear current response_id tracking when response completes successfully
              currentResponseIdRef.current = null;
              setStatus("Ready - Start speaking!");
              break;

            case "response.canceled":
            case "response.cancelled":
            case "response.error":
              // Remove interrupted transcript entries
              if (currentResponseIdRef.current) {
                const responseIdToRemove = currentResponseIdRef.current;
                setTranscript(prev => prev.filter(
                  item => !(item.speaker === "assistant" && item.id === responseIdToRemove)
                ));
                currentResponseIdRef.current = null;
                console.log(`🗑️ Removed canceled transcript for response_id: ${responseIdToRemove}`);
              }
              clearPendingAudio(true);
              break;

            case "error":
              console.error("OpenAI error:", data.error);
              setError(`OpenAI Error: ${data.error?.message || JSON.stringify(data.error)}`);
              break;
          }
        };

        ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          setError("WebSocket connection error");
          setStatus("Connection failed");
          reject(error);
        };

        ws.onclose = () => {
          setIsConnected(false);
          setStatus("Disconnected");
        };
      });
    } catch (err: any) {
      console.error("OpenAI initialization error:", err);
      setError(`Connection Error: ${err.message}`);
      setStatus("OpenAI connection failed");
      return false;
    }
  };

  const startSession = async () => {
    if (isStarting || isConnected) return;
    if (!avatar) {
      setError("Avatar not found");
      return;
    }
    
    setIsStarting(true);
    setError(null);
    setHasUserStartedSpeaking(false); // Reset when starting new session
    setSessionEndReason(null); // Clear any previous end reason
    hasPlayedReadySoundRef.current = false; // Reset ready sound flag
    cancelSilenceCoach();
    silenceCoachEligibleRef.current = false;
    lastUserMessageTimestampRef.current = 0; // Reset timestamp tracking
    userSpeechStartTimeRef.current = null; // Reset speech start tracking
    pendingUserTranscriptRef.current = null; // Reset pending transcript
    userSpeechStartTimesRef.current.clear(); // Clear all tracked speech start times
    
    try {
      const avatarReady = await initializeLiveAvatar();
      if (!avatarReady) {
        setIsStarting(false);
        return;
      }

      const openaiReady = await initializeOpenAI();
      if (!openaiReady) {
        setIsStarting(false);
        return;
      }

      setIsConnected(true);
      setConnectedAt(Date.now());
    } catch (err: any) {
      console.error("Session start error:", err);
      setError(`Failed to start session: ${err.message}`);
    } finally {
      setIsStarting(false);
    }
  };

  const endSession = async (reason: "manual" | "inactivity" = "manual") => {
    try {
      // Set end reason if not already set (for manual ends)
      if (!sessionEndReason) {
        setSessionEndReason(reason);
      }
      
      cancelSilenceCoach();
      silenceCoachEligibleRef.current = false;
      // Close WebSocket
      if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
        wsRef.current.close();
      }
      wsRef.current = null;

      // Stop microphone
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }

      // Disconnect audio processor
      if (processorRef.current) {
        try {
          processorRef.current.disconnect();
        } catch (e) {
          // Already disconnected
        }
        processorRef.current = null;
      }

      // Close audio context
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        await audioContextRef.current.close();
        audioContextRef.current = null;
      }

      // Close coach sound context
      if (coachSoundContextRef.current && coachSoundContextRef.current.state !== 'closed') {
        try {
          await coachSoundContextRef.current.close();
        } catch {
          // Ignore
        }
        coachSoundContextRef.current = null;
      }

      // Stop health check
      if (audioHealthCheckIntervalRef.current) {
        clearInterval(audioHealthCheckIntervalRef.current);
        audioHealthCheckIntervalRef.current = null;
      }

      // Clear all audio flush timeouts
      if (audioFlushTimeoutRef.current) {
        clearTimeout(audioFlushTimeoutRef.current);
        audioFlushTimeoutRef.current = null;
      }
      if (pendingInterruptTimeoutRef.current) {
        clearTimeout(pendingInterruptTimeoutRef.current);
        pendingInterruptTimeoutRef.current = null;
      }

      // End avatar session
      if (avatarClientRef.current) {
        await avatarClientRef.current.endSession();
        avatarClientRef.current = null;
      }

      // Clear all refs
      clearPendingAudio(false);
      audioBufferRef.current = [];
      audioBufferedCharsRef.current = 0;
      isFlushingAudioRef.current = false;
      needsAnotherFlushRef.current = false;
      audioHasStartedRef.current = false;
      audioFirstDeltaAtRef.current = null;
      lastAvatarAudioSendAtRef.current = 0;
      messageSequenceRef.current = 0;
      currentResponseIdRef.current = null;
      lastAudioSentTimeRef.current = 0;
      isAvatarAudioPlayingRef.current = false;
      lastInterruptAtRef.current = 0;
      lastUserMessageTimestampRef.current = 0;
      userSpeechStartTimeRef.current = null;
      pendingUserTranscriptRef.current = null;
      userSpeechStartTimesRef.current.clear();

      // Reset state
      setIsConnected(false);
      setConnectedAt(null);
      setIsStarting(false);
      setHasUserStartedSpeaking(false);
      setTranscript([]);
      setError(null);
      setStatus("Ready to start");
      
      console.log("✅ Session ended and fully reset - ready to start new session");
    } catch (error) {
      console.error("Error ending session:", error);
      setStatus("Session ended - Ready to start");
      setIsConnected(false);
      setConnectedAt(null);
    }
  };

  useEffect(() => {
    return () => {
      endSession();
    };
  }, []);

  // Listen for silence auto-end event (triggered after 25s of trainee silence)
  useEffect(() => {
    const handleAutoEnd = () => {
      console.log("🔇 Silence auto-end event received");
      endSession("inactivity");
    };

    window.addEventListener("silence-auto-end", handleAutoEnd);
    return () => {
      window.removeEventListener("silence-auto-end", handleAutoEnd);
    };
  }, []);

  // Play sound when avatar is ready and "Say hello" appears (only once)
  useEffect(() => {
    if (isConnected && status === "Ready - Start speaking!" && !hasUserStartedSpeaking && !hasPlayedReadySoundRef.current) {
      hasPlayedReadySoundRef.current = true;
      playReadySound();
    }
    // Reset flag when user starts speaking
    if (hasUserStartedSpeaking) {
      hasPlayedReadySoundRef.current = false;
    }
  }, [isConnected, status, hasUserStartedSpeaking, playReadySound]);

  if (!avatar) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-white">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-medium text-slate-900">Avatar not found</h1>
          <Link
            href="/select-avatar"
            className="inline-block px-5 py-2 text-slate-500 hover:text-slate-900 transition-colors"
          >
            ← Back to Avatar Selection
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between rounded-2xl border border-slate-200/70 bg-gradient-to-br from-emerald-50/70 via-white/90 to-white px-4 py-3 shadow-sm">
          <div>
            <h1 className="text-sm font-medium text-slate-900">
              Training Session: {avatar.name} <span className="text-xs text-slate-500 font-normal">- {avatar.role} - {avatar.scenario}</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="group flex items-center gap-1.5 px-3 py-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 transition-all duration-200 rounded-lg text-xs font-medium border border-slate-200 hover:border-emerald-200"
              title="Go to Home"
            >
              <svg 
                className="w-4 h-4 transition-transform group-hover:scale-110" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor" 
                strokeWidth={2}
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" 
                />
              </svg>
              <span>Home</span>
            </Link>
            <Link
              href="/select-avatar"
              className="flex items-center gap-1.5 px-3 py-1.5 text-slate-600 hover:text-slate-900 transition-colors text-xs font-medium border border-slate-200 hover:border-slate-300 rounded-lg"
            >
              <svg 
                className="w-4 h-4" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor" 
                strokeWidth={2}
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" 
                />
              </svg>
              <span>Back</span>
            </Link>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Avatar Video */}
          <div className="lg:col-span-2 space-y-6">
            {/* Video Container */}
            <div className="rounded-2xl overflow-hidden border border-slate-200/70 bg-gradient-to-br from-emerald-50/70 via-white/90 to-white shadow-sm">
              <div className="relative w-full aspect-video bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
                {/* Animated background pattern */}
                <div className="absolute inset-0 opacity-10">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(16,185,129,0.1),transparent_50%)]"></div>
                  <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_48%,rgba(16,185,129,0.03)_49%,rgba(16,185,129,0.03)_51%,transparent_52%)] bg-[length:20px_20px]"></div>
                </div>
                
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover"
                />
                
                {!isConnected && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-900/95 via-slate-800/95 to-slate-900/95 backdrop-blur-sm pointer-events-none">
                    <div className="text-center space-y-8 p-8 max-w-lg">
                      {/* Video icon */}
                      <div className="flex justify-center">
                        <div className="relative">
                          <div className="absolute inset-0 bg-emerald-500/20 rounded-full blur-xl animate-pulse"></div>
                          <div className="relative bg-slate-800/80 backdrop-blur-sm border border-emerald-500/30 rounded-2xl p-5 shadow-2xl">
                            <svg 
                              className="w-14 h-14 text-emerald-400" 
                              fill="none" 
                              viewBox="0 0 24 24" 
                              stroke="currentColor"
                              strokeWidth={1.5}
                            >
                              <path 
                                strokeLinecap="round" 
                                strokeLinejoin="round" 
                                d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" 
                              />
                            </svg>
                          </div>
                        </div>
                      </div>
                      
                      {/* Text content */}
                      <div className="space-y-3">
                        <h2 className="text-3xl text-white font-light tracking-tight">
                          Ready to begin your training
                        </h2>
                        <p className="text-slate-300/90 text-base leading-relaxed max-w-md mx-auto">
                          Click "Start Session" to connect with <span className="text-emerald-400 font-medium">{avatar.name}</span> and begin your conversation practice.
                        </p>
                      </div>
                      
                      {/* Start button */}
                      <div className="pt-2">
                        <button
                          onClick={startSession}
                          disabled={isStarting}
                          className="pointer-events-auto group relative px-12 py-4 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white text-lg font-semibold rounded-xl transition-all duration-300 disabled:from-slate-500 disabled:to-slate-600 disabled:cursor-not-allowed shadow-lg hover:shadow-emerald-500/50 hover:scale-105 disabled:hover:scale-100 disabled:hover:shadow-lg"
                        >
                          <span className="relative flex items-center justify-center gap-2">
                            {isStarting ? (
                              <>
                                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Starting...
                              </>
                            ) : (
                              <>
                                Start Session
                                <svg className="w-5 h-5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                </svg>
                              </>
                            )}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Transcript */}
            <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-emerald-50/70 via-white/90 to-white p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium text-slate-900">Transcript</h2>
                <span className="text-xs text-slate-500 uppercase tracking-wide">
                  {transcript.length} {transcript.length === 1 ? "turn" : "turns"}
                </span>
              </div>
              <div 
                ref={transcriptScrollRef}
                className="bg-slate-50 p-4 min-h-[200px] max-h-[400px] overflow-y-auto"
              >
                {transcript.length > 0 ? (
                  <div className="space-y-3">
                    {transcript
                      .sort((a, b) => b.timestamp - a.timestamp)
                      .map((event, index) => (
                        <div
                          key={`${event.id}-${index}`}
                          className={`p-3 text-sm rounded-lg ${
                            event.speaker === "user"
                              ? "bg-emerald-600 text-white ml-8"
                              : "bg-white text-slate-900 mr-8 border border-slate-200"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <span className={`font-medium text-xs whitespace-nowrap flex-shrink-0 ${
                              event.speaker === "user" ? "text-emerald-100" : "text-slate-500"
                            }`}>
                              {event.speaker === "user" ? "You" : avatar.name}:
                            </span>
                            <span className="flex-1 break-words">{event.text}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-center py-12">
                    <p className="text-slate-400 text-sm">
                      Conversation transcript will appear here...
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Status & Controls */}
          <div className="space-y-6">
            {/* Personality Controls - Only for Sarah and before session starts */}
            {avatarId === 'sarah' && !isConnected && (
              <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-emerald-50/70 via-white/90 to-white p-6 shadow-sm backdrop-blur space-y-6">
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-lg font-semibold text-slate-900">Avatar Settings</h2>
                  <div className="text-[11px] text-slate-500 leading-tight text-right">
                    Set before starting
                    <div className="text-slate-400">Locked during session</div>
                  </div>
                </div>

                {/* SECTION 1: LANGUAGE */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">1. Language</h3>
                  <div className="rounded-xl border border-slate-200/60 bg-slate-50/70 p-4">
                    <select
                      value={personalityControls.language || 'english'}
                      onChange={(e) => setPersonalityControls(prev => ({
                        ...prev,
                        language: e.target.value as 'english' | 'spanish',
                        // Reset accent when switching to Spanish
                        accentType: e.target.value === 'spanish' ? 'none' : prev.accentType,
                        accentStrength: e.target.value === 'spanish' ? 0 : prev.accentStrength,
                      }))}
                      className="w-full px-3 py-2 text-sm border border-slate-300/80 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                      aria-label="Language selection"
                    >
                      <option value="english">English</option>
                      <option value="spanish">Spanish</option>
                    </select>
                  </div>
                </div>

                {/* SECTION 2: EMOTIONS */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">2. Emotions</h3>
                  
                  <div className="space-y-3">
                    {/* Grief Level */}
                    <div className="rounded-xl border border-slate-200/60 bg-slate-50/70 p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-slate-700">
                          Grief Level
                        </label>
                        <span className="text-xs font-mono text-slate-900 bg-white border border-slate-200/70 px-2 py-0.5 rounded-full">
                          {personalityControls.sadnessLevel}/5
                        </span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="5"
                        step="1"
                        value={personalityControls.sadnessLevel}
                        onChange={(e) => setPersonalityControls(prev => ({
                          ...prev,
                          sadnessLevel: Number(e.target.value)
                        }))}
                        className="w-full h-1.5 bg-slate-200/80 rounded-full appearance-none cursor-pointer accent-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                        aria-label="Sadness level"
                      />
                      <p className="text-xs text-slate-500">
                        {personalityControls.sadnessLevel === 1 ? 'Composed' :
                         personalityControls.sadnessLevel === 2 ? 'Mildly sad' :
                         personalityControls.sadnessLevel === 3 ? 'Moderately sad' :
                         personalityControls.sadnessLevel === 4 ? 'Very sad' :
                         'Devastated'}
                      </p>
                    </div>

                    {/* Secondary Emotion */}
                    <div className="rounded-xl border border-slate-200/60 bg-slate-50/70 p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-slate-700">
                          Secondary Emotion
                        </label>
                        <span className="text-xs text-slate-500">Optional</span>
                      </div>
                      <select
                        value={personalityControls.copingStyle || 'none'}
                        onChange={(e) => setPersonalityControls(prev => ({
                          ...prev,
                          copingStyle: e.target.value as 'none' | 'anger' | 'anxiety' | 'nervousness'
                        }))}
                        className="w-full px-3 py-2 text-sm border border-slate-300/80 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                        aria-label="Coping style"
                      >
                        <option value="none">None</option>
                        <option value="anger">Anger (Defensive, guarded)</option>
                        <option value="anxiety">Anxiety (Worried, overthinking)</option>
                        <option value="nervousness">Nervousness (Hesitant, uncertain)</option>
                      </select>
                    </div>

                    {/* Intensity - Only show if secondary emotion is selected */}
                    {personalityControls.copingStyle && personalityControls.copingStyle !== 'none' && (
                      <div className="rounded-xl border border-slate-200/60 bg-slate-50/70 p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-slate-700">
                            Intensity
                          </label>
                          <span className="text-xs font-mono text-slate-900 bg-white border border-slate-200/70 px-2 py-0.5 rounded-full">
                            {personalityControls.copingIntensity}/5
                          </span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="5"
                          step="1"
                          value={personalityControls.copingIntensity}
                          onChange={(e) => setPersonalityControls(prev => ({
                            ...prev,
                            copingIntensity: Number(e.target.value)
                          }))}
                          className="w-full h-1.5 bg-slate-200/80 rounded-full appearance-none cursor-pointer accent-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                          aria-label="Coping intensity"
                        />
                        <p className="text-xs text-slate-500">
                          {personalityControls.copingIntensity === 1 ? 'Very subtle' :
                           personalityControls.copingIntensity === 2 ? 'Subtle' :
                           personalityControls.copingIntensity === 3 ? 'Moderate' :
                           personalityControls.copingIntensity === 4 ? 'Strong' :
                           'Very strong'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* SECTION 3: ACCENT */}
                {personalityControls.language !== 'spanish' && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">3. Accent</h3>
                    
                    {/* Accent Type */}
                    <div className="rounded-xl border border-slate-200/60 bg-slate-50/70 p-4 space-y-2">
                      <label className="text-sm font-medium text-slate-700 block mb-2">
                        Accent Type
                      </label>
                      <select
                        value={personalityControls.accentType || 'none'}
                        onChange={(e) => setPersonalityControls(prev => ({
                          ...prev,
                          accentType: e.target.value as 'none' | 'midwestern' | 'texas-southern' | 'cajun' | 'indian-english',
                          // If an accent is selected but strength is still 0, default to a heavy accent for training realism.
                          accentStrength: e.target.value === 'none'
                            ? 0
                            : (prev.accentStrength && prev.accentStrength > 0 ? prev.accentStrength : 5)
                        }))}
                        className="w-full px-3 py-2 text-sm border border-slate-300/80 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                        aria-label="Accent type"
                      >
                        <option value="none">None (Standard English)</option>
                        <option value="midwestern">Midwestern</option>
                        <option value="texas-southern">Texas Southern</option>
                        <option value="cajun">Cajun</option>
                        <option value="indian-english">Indian</option>
                      </select>
                    </div>

                    {/* Accent Strength - Only show if accent type is selected */}
                    {personalityControls.accentType && personalityControls.accentType !== 'none' && (
                      <div className="rounded-xl border border-slate-200/60 bg-slate-50/70 p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-slate-700">
                            Accent Strength
                          </label>
                          <span className="text-xs font-mono text-slate-900 bg-white border border-slate-200/70 px-2 py-0.5 rounded-full">
                            {personalityControls.accentStrength || 0}/5
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="5"
                          step="1"
                          value={personalityControls.accentStrength || 0}
                          onChange={(e) => setPersonalityControls(prev => ({
                            ...prev,
                            accentStrength: Number(e.target.value)
                          }))}
                          className="w-full h-1.5 bg-slate-200/80 rounded-full appearance-none cursor-pointer accent-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                          aria-label="Accent strength"
                        />
                        <p className="text-xs text-slate-500">
                          {personalityControls.accentStrength === 0 ? 'None' :
                           personalityControls.accentStrength === 1 ? 'Very subtle' :
                           personalityControls.accentStrength === 2 ? 'Light' :
                           personalityControls.accentStrength === 3 ? 'Moderate' :
                           personalityControls.accentStrength === 4 ? 'Strong' :
                           'Very strong'}
                        </p>
                      </div>
                    )}
                  </div>
                )}

              </div>
            )}

            {/* Show personality summary during session */}
            {avatarId === 'sarah' && isConnected && (
              <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-emerald-50/70 via-white/90 to-white p-4 shadow-sm backdrop-blur">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">🔒 Active Settings</h3>
                <div className="space-y-3 text-xs">
                  {/* Language */}
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Language</div>
                    <div className="text-slate-900 font-medium">
                      {personalityControls.language === 'spanish' ? 'Spanish' : 'English'}
                    </div>
                  </div>
                  
                  {/* Emotions */}
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Emotions</div>
                    <div className="space-y-1 text-slate-700">
                      <div className="flex justify-between">
                        <span>Grief:</span>
                        <span className="font-mono font-medium text-slate-900">{personalityControls.sadnessLevel}/5</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Secondary:</span>
                        <span className="font-mono font-medium text-slate-900">
                          {personalityControls.copingStyle === 'none' || !personalityControls.copingStyle ? 
                            'None' :
                           `${personalityControls.copingStyle.charAt(0).toUpperCase() + personalityControls.copingStyle.slice(1)} (${personalityControls.copingIntensity}/5)`}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Accent */}
                  {personalityControls.language !== 'spanish' && personalityControls.accentType && personalityControls.accentType !== 'none' && (
                    <div>
                      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Accent</div>
                      <div className="text-slate-900 font-medium">
                        {getAccentDisplayName(personalityControls.accentType)} ({personalityControls.accentStrength || 0}/5)
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Connection Status */}
            <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-emerald-50/70 via-white/90 to-white p-6 shadow-sm space-y-5">
              <div>
                <h2 className="text-lg font-medium text-slate-900">Connection</h2>
                <p className="text-sm text-slate-600 mt-1">
                  {status}
                </p>
                {isConnected && status === "Ready - Start speaking!" && !hasUserStartedSpeaking && (
                  <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <p className="text-sm text-emerald-800 font-medium">
                      Say "Hello" to begin the conversation
                    </p>
                  </div>
                )}
                {isConnected && silenceCoachMessage && (
                  <div className={`mt-3 p-4 rounded-lg border-2 transition-all duration-300 ${
                    silenceCoachMessage.includes("Session ending") 
                      ? "bg-amber-50 border-amber-300 animate-pulse" 
                      : "bg-blue-50 border-blue-200"
                  }`}>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">⏰</span>
                        <p className={`text-xs font-bold uppercase tracking-wide ${
                          silenceCoachMessage.includes("Session ending") 
                            ? "text-amber-700" 
                            : "text-blue-700"
                        }`}>
                          {silenceCoachMessage.includes("Session ending") ? "Notice" : "Reminder"}
                        </p>
                      </div>
                      {!silenceCoachMessage.includes("Session ending") && (
                        <button
                          type="button"
                          onClick={() => {
                            cancelSilenceCoach();
                            silenceCoachEligibleRef.current = false;
                          }}
                          className="text-xs font-medium text-blue-500 hover:text-blue-700 transition-colors"
                        >
                          Dismiss
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <p className={`text-sm font-medium ${
                        silenceCoachMessage.includes("Session ending") 
                          ? "text-amber-800" 
                          : "text-blue-900"
                      }`}>{silenceCoachMessage}</p>
                      {countdownSeconds !== null && !silenceCoachMessage.includes("Session ending") && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-blue-600 font-bold">
                            {countdownSeconds}s
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {connectedAt && (
                <div>
                  <h3 className="text-sm font-medium text-slate-700">Session Duration</h3>
                  <p className="text-2xl font-mono text-slate-900 mt-1">
                    {formatDuration(elapsedSeconds)}
                  </p>
                </div>
              )}

              {isConnected && (
                <button
                  onClick={() => endSession("manual")}
                  className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
                >
                  End Session
                </button>
              )}

              {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* Session End Modal - Shows when session ended due to inactivity */}
      {sessionEndReason === "inactivity" && !isConnected && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 space-y-6 animate-in fade-in zoom-in duration-300 relative">
            <button
              onClick={() => setSessionEndReason(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
              aria-label="Close"
            >
              <svg 
                className="w-6 h-6" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M6 18L18 6M6 6l12 12" 
                />
              </svg>
            </button>
            
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center">
                  <svg 
                    className="w-8 h-8 text-amber-600" 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                  >
                    <path 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                      strokeWidth={2} 
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" 
                    />
                  </svg>
                </div>
              </div>
              
              <div>
                <h2 className="text-2xl font-semibold text-slate-900 mb-2">
                  Session Ended
                </h2>
                <p className="text-slate-600">
                  The session was automatically ended due to inactivity.
                </p>
                <p className="text-sm text-slate-500 mt-2">
                  You were silent for 25 seconds after the avatar finished speaking.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
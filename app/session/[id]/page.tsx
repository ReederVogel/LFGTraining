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
const AUDIO_FLUSH_DEBOUNCE_MS = 150;
const AUDIO_MIN_FIRST_FLUSH_CHARS = 40000; // ~600ms buffer before first send (smoother start)
const AUDIO_MIN_NEXT_FLUSH_CHARS = 32000; // bigger subsequent chunks
const AUDIO_MIN_SEND_INTERVAL_MS = 300; // more spacing between sends
const AUDIO_MAX_WAIT_FIRST_MS = 700; // allow more time to collect initial audio
const AUDIO_MAX_WAIT_NEXT_MS = 600;

interface TranscriptItem {
  speaker: "user" | "assistant";
  text: string;
  timestamp: number;
  id: string;
}

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
  
  // Personality controls for Sarah avatar (5 levels: 1-5)
  const [personalityControls, setPersonalityControls] = useState<PersonalityControls>({
    sadnessLevel: 3,  // Default: Moderate sadness
    angerLevel: 2,    // Default: Mild caution
    accentType: 'none',  // Default: No accent
    accentStrength: 0,   // Default: No accent strength
    language: 'english',  // Default: English
  });

  const getAccentDisplayName = (
    accentType: PersonalityControls["accentType"] | undefined
  ): string => {
    if (!accentType || accentType === "none") return "None (Standard English)";
    if (accentType === "louisiana-cajun") return "Louisiana-Cajun";
    if (accentType === "texas-southern") return "Texas Southern";
    if (accentType === "indian-english") return "Indian";
    if (accentType === "russian-english") return "Russian";
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
    
    // Send even very small payloads; do not drop audio
    if (payloadSize === 0) {
      isFlushingAudioRef.current = false;
      return;
    }
    
    audioBufferRef.current = [];
    audioBufferedCharsRef.current = 0;
    isFlushingAudioRef.current = true;
    audioHasStartedRef.current = true;
    lastAvatarAudioSendAtRef.current = now;

    const flushStart = Date.now();
    try {
      console.log(`📤 Flushing audio buffer (attempt ${retryCount + 1}) - size: ${payloadSize} chars`);
      if (force || payloadSize < 20000) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/bd86f80f-0f18-4670-92ee-7cb26cc4fc5e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'B',location:'app/session/[id]/page.tsx:flushAudioBuffer:beforeSend',message:'flush_audio_send',data:{force,retryCount,responseId:responseIdForFlush,payloadSize,bufferedCharsBefore:bufferedChars,bufferParts:audioBufferRef.current.length},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      }
      await avatarClientRef.current.speakPcmAudio(payload);
      lastAudioSentTimeRef.current = Date.now();
      console.log("✅ Audio buffer flushed successfully");
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      console.error(`❌ Error sending audio to avatar (attempt ${retryCount + 1}):`, errorMessage);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/bd86f80f-0f18-4670-92ee-7cb26cc4fc5e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'C',location:'app/session/[id]/page.tsx:flushAudioBuffer:catch',message:'flush_audio_error',data:{force,retryCount,responseId:responseIdForFlush,payloadSize,errorMessage},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      
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
      processor.connect(audioContext.destination);
      
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
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/bd86f80f-0f18-4670-92ee-7cb26cc4fc5e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix-v2',hypothesisId:'E',location:'app/session/[id]/page.tsx:ws.onopen:v2',message:'instrumentation_active_v2',data:{avatarId},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          
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
                }
                audioBufferRef.current.push(data.delta);
                audioBufferedCharsRef.current += typeof data.delta === "string" ? data.delta.length : 0;
                if (!audioFirstDeltaAtRef.current) {
                  audioFirstDeltaAtRef.current = Date.now();
                }
                lastAudioSentTimeRef.current = Date.now();

                // Throttle sends to reduce `repeatAudio()` restart artifacts (the "hel hello" issue).
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
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/bd86f80f-0f18-4670-92ee-7cb26cc4fc5e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'A',location:'app/session/[id]/page.tsx:input_audio_buffer.speech_started:interrupt',message:'vad_interrupt_triggered',data:{avatarIsPlaying,hasPendingAssistantAudio,cooldownOk,responseId:currentAudioResponseIdRef.current,bufferParts:audioBufferRef.current.length,bufferedChars:audioBufferedCharsRef.current},timestamp:Date.now()})}).catch(()=>{});
                  // #endregion
                  lastInterruptAtRef.current = now;
                  clearPendingAudio(true);
                } else {
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/bd86f80f-0f18-4670-92ee-7cb26cc4fc5e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'A',location:'app/session/[id]/page.tsx:input_audio_buffer.speech_started:skip',message:'vad_interrupt_skipped',data:{avatarIsPlaying,hasPendingAssistantAudio,cooldownOk,responseId:currentAudioResponseIdRef.current,bufferParts:audioBufferRef.current.length,bufferedChars:audioBufferedCharsRef.current},timestamp:Date.now()})}).catch(()=>{});
                  // #endregion
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
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/bd86f80f-0f18-4670-92ee-7cb26cc4fc5e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix-v2',hypothesisId:'D',location:'app/session/[id]/page.tsx:response.done:v2',message:'response_done_snapshot_v2',data:{responseId:doneResponseId,eventType:data.type,audioDeltaCount:a?.deltaCount ?? null,audioTotalChars:a?.totalChars ?? null,msSinceLastAudioDelta:a?.lastAt ? Date.now()-a.lastAt : null,transcriptDeltaCount:t?.deltaCount ?? null,transcriptTotalChars:t?.totalChars ?? null,msSinceLastTranscriptDelta:t?.lastAt ? Date.now()-t.lastAt : null,bufferParts:audioBufferRef.current.length,bufferedChars:audioBufferedCharsRef.current,audioHasStarted:audioHasStartedRef.current,isAvatarPlaying:isAvatarAudioPlayingRef.current,assistantTail:tail ?? null},timestamp:Date.now()})}).catch(()=>{});
                // #endregion
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

  const endSession = async () => {
    try {
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
        <div className="flex items-center justify-between rounded-2xl border border-slate-200/70 bg-gradient-to-br from-emerald-50/70 via-white/90 to-white px-4 py-2 shadow-sm">
          <div>
            <h1 className="text-sm font-medium text-slate-900">
              Training Session: {avatar.name} <span className="text-xs text-slate-500 font-normal">- {avatar.role} - {avatar.scenario}</span>
            </h1>
          </div>
          <Link
            href="/select-avatar"
            className="px-3 py-1 text-slate-600 hover:text-slate-900 transition-colors text-xs border border-slate-200 hover:border-slate-300"
          >
            ← Back
          </Link>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Avatar Video */}
          <div className="lg:col-span-2 space-y-6">
            {/* Video Container */}
            <div className="rounded-2xl overflow-hidden border border-slate-200/70 bg-gradient-to-br from-emerald-50/70 via-white/90 to-white shadow-sm">
              <div className="relative w-full aspect-video bg-slate-900">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover"
                />
                
                {!isConnected && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 pointer-events-none">
                    <div className="text-center space-y-6 p-8">
                      <h2 className="text-2xl text-white font-light">
                        Ready to begin your training
                      </h2>
                      <p className="text-slate-300 text-sm max-w-md">
                        Click "Start Session" to connect with {avatar.name} and begin your conversation practice.
                      </p>
                      <button
                        onClick={startSession}
                        disabled={isStarting}
                        className="pointer-events-auto px-10 py-4 bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-semibold rounded-lg transition-colors duration-200 disabled:bg-slate-400 disabled:cursor-not-allowed"
                      >
                        {isStarting ? "Starting..." : "Start Session"}
                      </button>
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
              <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-emerald-50/70 via-white/90 to-white p-6 shadow-sm backdrop-blur space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Avatar Controls</h2>
                  </div>
                  <div className="text-[11px] text-slate-500 leading-tight text-right">
                    Set before starting
                    <div className="text-slate-400">Locked during session</div>
                  </div>
                </div>

                {/* Language Selection */}
                <div className="rounded-xl border border-slate-200/60 bg-slate-50/70 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700">
                      Language
                    </label>
                    <span className="text-xs font-medium text-slate-600">
                      {personalityControls.language === 'spanish' ? 'Spanish' : 'English'}
                    </span>
                  </div>
                  <select
                    value={personalityControls.language || 'english'}
                    onChange={(e) => setPersonalityControls(prev => ({
                      ...prev,
                      language: e.target.value as 'english' | 'spanish',
                      // Reset accent when switching to Spanish
                      accentType: e.target.value === 'spanish' ? 'none' : prev.accentType,
                      accentStrength: e.target.value === 'spanish' ? 0 : prev.accentStrength,
                    }))}
                    className="w-full px-3 py-2 text-sm border border-slate-300/80 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                    aria-label="Language selection"
                  >
                    <option value="english">English</option>
                    <option value="spanish">Spanish</option>
                  </select>
                </div>

                {/* Sadness Level */}
                <div className="rounded-xl border border-slate-200/60 bg-slate-50/70 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700">
                      Sadness
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
                </div>

                {/* Anger Level */}
                <div className="rounded-xl border border-slate-200/60 bg-slate-50/70 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700">
                      Anger
                    </label>
                    <span className="text-xs font-mono text-slate-900 bg-white border border-slate-200/70 px-2 py-0.5 rounded-full">
                      {personalityControls.angerLevel}/5
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    value={personalityControls.angerLevel}
                    onChange={(e) => setPersonalityControls(prev => ({
                      ...prev,
                      angerLevel: Number(e.target.value)
                    }))}
                    className="w-full h-1.5 bg-slate-200/80 rounded-full appearance-none cursor-pointer accent-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                    aria-label="Anger level"
                  />
                </div>

                {/* Accent Type Selection - Only show for English */}
                {personalityControls.language !== 'spanish' && (
                  <div className="rounded-xl border border-slate-200/60 bg-slate-50/70 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-slate-700">
                        Accent
                      </label>
                      <span className="text-xs font-medium text-slate-600">
                        {getAccentDisplayName(personalityControls.accentType)}
                      </span>
                    </div>
                    <select
                      value={personalityControls.accentType || 'none'}
                      onChange={(e) => setPersonalityControls(prev => ({
                        ...prev,
                        accentType: e.target.value as 'none' | 'louisiana-cajun' | 'texas-southern' | 'indian-english' | 'russian-english',
                        // If an accent is selected but strength is still 0, default to a heavy accent for training realism.
                        accentStrength: e.target.value === 'none'
                          ? 0
                          : (prev.accentStrength && prev.accentStrength > 0 ? prev.accentStrength : 5)
                      }))}
                      className="w-full px-3 py-2 text-sm border border-slate-300/80 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                      aria-label="Accent type"
                    >
                      <option value="none">None (Standard English)</option>
                      <option value="louisiana-cajun">Louisiana-Cajun</option>
                      <option value="texas-southern">Texas Southern</option>
                      <option value="indian-english">Indian</option>
                      <option value="russian-english">Russian</option>
                    </select>
                  </div>
                )}

                {/* Accent Strength - Only show if accent type is selected and language is English */}
                {personalityControls.language !== 'spanish' && personalityControls.accentType && personalityControls.accentType !== 'none' && (
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
                  </div>
                )}

                              </div>
            )}

            {/* Show personality summary during session */}
            {avatarId === 'sarah' && isConnected && (
              <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-emerald-50/70 via-white/90 to-white p-4 shadow-sm backdrop-blur">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">Active Settings</h3>
                <div className="space-y-1.5 text-xs text-slate-600">
                  <div className="flex justify-between">
                    <span>Language:</span>
                    <span className="font-mono font-medium text-slate-900">
                      {personalityControls.language === 'spanish' ? 'Spanish' : 'English'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Sadness:</span>
                    <span className="font-mono font-medium text-slate-900">{personalityControls.sadnessLevel}/5</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Anger:</span>
                    <span className="font-mono font-medium text-slate-900">{personalityControls.angerLevel}/5</span>
                  </div>
                  {personalityControls.language !== 'spanish' && personalityControls.accentType && personalityControls.accentType !== 'none' && (
                    <div className="flex justify-between">
                      <span>Accent:</span>
                      <span className="font-mono font-medium text-slate-900">
                        {getAccentDisplayName(personalityControls.accentType)} ({personalityControls.accentStrength || 0}/5)
                      </span>
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
                  onClick={endSession}
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
    </main>
  );
}
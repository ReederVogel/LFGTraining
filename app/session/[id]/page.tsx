"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { createLiveAvatarClient, LiveAvatarClient } from "@/lib/liveavatar";
import { getAvatarById } from "@/lib/avatars";
import { PersonalityControls } from "@/lib/prompt-builder";

const AVATAR_RESPONSE_DELAY_MS = 0; // No delay - avatar responds immediately

interface TranscriptItem {
  speaker: "user" | "assistant";
  text: string;
  timestamp: number;
  id: string;
}

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
  
  // Personality controls for Sarah avatar
  const [personalityControls, setPersonalityControls] = useState<PersonalityControls>({
    sadnessLevel: 5,
    angerLevel: 3,
  });
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const avatarClientRef = useRef<LiveAvatarClient | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioBufferRef = useRef<string[]>([]);
  const audioFlushTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isFlushingAudioRef = useRef(false);
  const needsAnotherFlushRef = useRef(false);
  const messageSequenceRef = useRef(0);
  const currentResponseIdRef = useRef<string | null>(null);
  const lastAudioSentTimeRef = useRef<number>(0);
  const audioHealthCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastUserMessageTimestampRef = useRef<number>(0);
  const userSpeechStartTimeRef = useRef<number | null>(null);
  const pendingUserTranscriptRef = useRef<{ itemId: string; startTime: number } | null>(null);
  // Map item_id to speech start time to handle multiple concurrent speech events
  const userSpeechStartTimesRef = useRef<Map<string, number>>(new Map());

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
        updated[existingIndex] = {
          ...updated[existingIndex],
          text: updated[existingIndex].text + textChunk,
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
          text: textChunk,
          timestamp: minTimestamp,
          id: responseId,
        },
      ];
    });
  }, []);


  const clearPendingAudio = useCallback((interruptAvatar = false) => {
    audioBufferRef.current = [];
    needsAnotherFlushRef.current = false;
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

  const flushAudioBuffer = useCallback(async (retryCount = 0) => {
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

    const payload = audioBufferRef.current.join("");
    const payloadSize = payload.length;
    
    // Minimum threshold: 50 chars of base64 ≈ 37 bytes ≈ 18 PCM samples ≈ 0.75ms of audio
    // This filters out meaningless fragments while allowing legitimate small chunks
    // Empty or too-small payloads are not worth sending and could cause issues
    if (payloadSize < 50) {
      if (payloadSize > 0) {
        console.log(`⚠️ Skipping too-small audio payload (${payloadSize} chars < 50 minimum)`);
      }
      isFlushingAudioRef.current = false;
      return;
    }
    
    audioBufferRef.current = [];
    isFlushingAudioRef.current = true;

    try {
      console.log(`📤 Flushing audio buffer (attempt ${retryCount + 1}) - size: ${payloadSize} chars`);
      await avatarClientRef.current.speakPcmAudio(payload);
      lastAudioSentTimeRef.current = Date.now();
      console.log("✅ Audio buffer flushed successfully");
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
          flushAudioBuffer(retryCount + 1);
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
        flushAudioBuffer(0); // Reset retry count for next flush
      }
    }
  }, []);

  const scheduleAudioFlush = useCallback(() => {
    if (audioFlushTimeoutRef.current) {
      clearTimeout(audioFlushTimeoutRef.current);
    }
    audioFlushTimeoutRef.current = setTimeout(() => {
      flushAudioBuffer(0);
    }, 60);
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
        flushAudioBuffer(0);
      }
      
      // If we're flushing but stuck for more than 10 seconds, reset
      if (isFlushingAudioRef.current && timeSinceLastAudio > 10000) {
        console.warn("⚠️ Audio health check: Flush stuck for 10s - resetting");
        isFlushingAudioRef.current = false;
        needsAnotherFlushRef.current = false;
        flushAudioBuffer(0);
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

      const ws = new WebSocket(
        "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
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
                model: "whisper-1",
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
                audioBufferRef.current.push(data.delta);
                lastAudioSentTimeRef.current = Date.now();
                const shouldFlushImmediately =
                  !isFlushingAudioRef.current && !audioFlushTimeoutRef.current;

                if (shouldFlushImmediately || audioBufferRef.current.length >= 2) {
                  await flushAudioBuffer();
                } else {
                  scheduleAudioFlush();
                }
              }
              break;

            case "response.audio_transcript.delta": {
              const responseId = data.response_id || data.response?.id;
              const deltaText = data.delta;
              if (!responseId || !deltaText) break;
              
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
              // Don't clear pending transcript ref here - wait for item.created event to get item_id
              clearPendingAudio(true);
              break;

            case "input_audio_buffer.speech_stopped":
              setStatus("Processing...");
              break;

            case "response.done":
            case "response.completed":
            case "response.output_audio.done":
              await flushAudioBuffer();
              // Mark audio as finished in LiveAvatar
              if (avatarClientRef.current) {
                avatarClientRef.current.markAudioFinished();
              }
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

      // End avatar session
      if (avatarClientRef.current) {
        await avatarClientRef.current.endSession();
        avatarClientRef.current = null;
      }

      // Clear all refs
      clearPendingAudio(false);
      audioBufferRef.current = [];
      isFlushingAudioRef.current = false;
      needsAnotherFlushRef.current = false;
      messageSequenceRef.current = 0;
      currentResponseIdRef.current = null;
      lastAudioSentTimeRef.current = 0;
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
        <div className="flex items-center justify-between bg-white border border-slate-200 px-4 py-2">
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
            <div className="bg-white border border-slate-200">
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
            <div className="bg-white border border-slate-200 p-6">
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
              <div className="bg-white border border-slate-200 p-6 space-y-5">
                <div>
                  <h2 className="text-lg font-medium text-slate-900">Avatar Controls</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Configure {avatar.name}'s emotional state for this session
                  </p>
                </div>

                {/* Sadness Level */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700">
                      Sadness Level
                    </label>
                    <span className="text-sm font-mono text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                      {personalityControls.sadnessLevel}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    value={personalityControls.sadnessLevel}
                    onChange={(e) => setPersonalityControls(prev => ({
                      ...prev,
                      sadnessLevel: Number(e.target.value)
                    }))}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                  />
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Not sad</span>
                    <span>Very sad</span>
                  </div>
                </div>

                {/* Anger Level */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700">
                      Anger
                    </label>
                    <span className="text-sm font-mono text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                      {personalityControls.angerLevel}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    value={personalityControls.angerLevel}
                    onChange={(e) => setPersonalityControls(prev => ({
                      ...prev,
                      angerLevel: Number(e.target.value)
                    }))}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                  />
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Calm</span>
                    <span>Angry</span>
                  </div>
                </div>

                              </div>
            )}

            {/* Show personality summary during session */}
            {avatarId === 'sarah' && isConnected && (
              <div className="bg-white border border-slate-200 p-4">
                <h3 className="text-sm font-medium text-slate-900 mb-2">Active Settings</h3>
                <div className="space-y-1 text-xs text-slate-600">
                  <div className="flex justify-between">
                    <span>Sadness:</span>
                    <span className="font-mono font-medium text-slate-900">{personalityControls.sadnessLevel}/10</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Anger:</span>
                    <span className="font-mono font-medium text-slate-900">{personalityControls.angerLevel}/10</span>
                  </div>
                </div>
              </div>
            )}

            {/* Connection Status */}
            <div className="bg-white border border-slate-200 p-6 space-y-5">
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


"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useCallback } from "react";
import { createLiveAvatarClient, LiveAvatarClient } from "@/lib/liveavatar";
import { getAvatarById } from "@/lib/avatars";

interface TranscriptItem {
  speaker: "user" | "assistant";
  text: string;
  timestamp: number; // OpenAI's actual event timestamp
  id: string; // API item_id or response_id for deduplication
}

export default function TestCustomOpenAIPage() {
  const [status, setStatus] = useState<string>("Ready to start");
  const [isConnected, setIsConnected] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isMicActive, setIsMicActive] = useState(false);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showConnectedPrompt, setShowConnectedPrompt] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const avatarClientRef = useRef<LiveAvatarClient | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioBufferRef = useRef<string[]>([]);
  const audioFlushTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isFlushingAudioRef = useRef(false);
  const needsAnotherFlushRef = useRef(false);
  const currentResponseIdRef = useRef<string | null>(null);
  const avatar = getAvatarById("sarah");

  const formatDuration = useCallback((totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
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

  const flushAudioBuffer = useCallback(async () => {
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
    audioBufferRef.current = [];
    isFlushingAudioRef.current = true;

    try {
      await avatarClientRef.current.speakPcmAudio(payload);
    } catch (error) {
      console.error("Error sending buffered audio to avatar:", error);
    } finally {
      isFlushingAudioRef.current = false;
      if (needsAnotherFlushRef.current) {
        needsAnotherFlushRef.current = false;
        flushAudioBuffer();
      }
    }
  }, []);

  const scheduleAudioFlush = useCallback(() => {
    if (audioFlushTimeoutRef.current) {
      clearTimeout(audioFlushTimeoutRef.current);
    }
    audioFlushTimeoutRef.current = setTimeout(() => {
      flushAudioBuffer();
    }, 60);
  }, [flushAudioBuffer]);


  // Initialize LiveAvatar in CUSTOM mode
  const initializeLiveAvatar = async (): Promise<boolean> => {
    try {
      setStatus("Initializing LiveAvatar (Custom Mode)...");
      
      // Using Sarah's avatar in CUSTOM mode (no contextId needed)
      avatarClientRef.current = createLiveAvatarClient(
        "513fd1b7-7ef9-466d-9af2-344e51eeb833", // Sarah's avatarId
        "b9d23d16-9437-44d5-89c4-b4dd61c3fdc8", // Sarah's voiceId (optional in custom)
        undefined, // No contextId in CUSTOM mode
        "CUSTOM", // CUSTOM mode - we control the conversation
        { enforceTurnTaking: false }
      );

      // Set up transcript callback
      avatarClientRef.current.onTranscript((event) => {
        console.log("LiveAvatar transcript:", event);
      });

      if (videoRef.current) {
        await avatarClientRef.current.initialize(videoRef.current);
        setStatus("LiveAvatar initialized ✓");
        return true;
      }
      return false;
    } catch (err: any) {
      console.error("LiveAvatar initialization error:", err);
      setError(`LiveAvatar Error: ${err.message}`);
      setStatus("LiveAvatar initialization failed ✗");
      return false;
    }
  };

  // Setup microphone to send audio to OpenAI
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
          
          // Convert Float32Array to Int16Array (PCM16)
          const pcm16 = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          
          // Convert to base64
          const bytes = new Uint8Array(pcm16.buffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);
          
          // Send to OpenAI
          ws.send(JSON.stringify({
            type: "input_audio_buffer.append",
            audio: base64,
          }));
        }
      };
      
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      setIsMicActive(true);
      console.log("Microphone setup complete");
      return true;
    } catch (err: any) {
      console.error("Microphone setup error:", err);
      setError(`Microphone Error: ${err.message}`);
      return false;
    }
  };

  // Initialize OpenAI Realtime API
  const initializeOpenAI = async (): Promise<boolean> => {
    try {
      setStatus("Getting OpenAI session token...");
      
      // Get ephemeral token from our API route
      const tokenResponse = await fetch("/api/openai-token", {
        method: "POST",
      });
      
      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json();
        throw new Error(errorData.error || "Failed to get OpenAI token");
      }
      
      const sessionData = await tokenResponse.json();
      console.log("OpenAI session data:", sessionData);
      
      // Extract the client secret for WebSocket auth
      const clientSecret = sessionData.client_secret?.value;
      if (!clientSecret) {
        throw new Error("No client_secret in OpenAI response");
      }

      setStatus("Connecting to OpenAI Realtime API...");
      
      // Connect to OpenAI Realtime API via WebSocket
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
          console.log("Connected to OpenAI Realtime API");
          setStatus("Connected to OpenAI ✓");
          setIsConnected(true);
          setConnectedAt(Date.now());
          setShowConnectedPrompt(true);
          
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
          
          // Setup microphone after connection
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
          
          // Log important events
          if (!["response.audio.delta", "input_audio_buffer.speech_started", "input_audio_buffer.speech_stopped"].includes(data.type)) {
            console.log("OpenAI event:", data.type, data);
          }

          switch (data.type) {
            case "session.created":
              console.log("Session created:", data.session);
              break;

            case "session.updated":
              console.log("Session updated:", data.session);
              break;

            case "response.audio.delta":
              if (data.delta) {
                audioBufferRef.current.push(data.delta);
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
              if (!responseId || !data.delta) {
                break;
              }
              
              // Track the current response_id being transcribed
              // If a new response starts (different response_id), the old one was interrupted
              if (currentResponseIdRef.current && currentResponseIdRef.current !== responseId) {
                // Previous response was interrupted (didn't complete), remove it
                const oldResponseId = currentResponseIdRef.current;
                setTranscript(prev => prev.filter(
                  item => !(item.speaker === "assistant" && item.id === oldResponseId)
                ));
                console.log(`🗑️ Removed interrupted transcript for response_id: ${oldResponseId} (new response started)`);
              }
              
              // Always update to track the current response being transcribed
              currentResponseIdRef.current = responseId;
              
              setTranscript(prev => {
                // Find existing entry with this response_id
                const existingIndex = prev.findIndex(
                  item => item.speaker === "assistant" && item.id === responseId
                );
                
                if (existingIndex !== -1) {
                  // Append to existing transcript
                  const updated = [...prev];
                  updated[existingIndex] = {
                    ...updated[existingIndex],
                    text: updated[existingIndex].text + data.delta
                  };
                  return updated;
                }
                
                // Use OpenAI's timestamp if available, otherwise use current time
                const eventTimestamp = data.created_at || data.timestamp || Date.now();
                
                return [
                  ...prev,
                  {
                    speaker: "assistant",
                    text: data.delta,
                    timestamp: eventTimestamp,
                    id: responseId,
                  }
                ];
              });
              break;
            }

            case "conversation.item.input_audio_transcription.completed":
              if (data.transcript && data.item_id) {
                setTranscript(prev => {
                  // Find existing entry with this item_id
                  const existingIndex = prev.findIndex(
                    item => item.speaker === "user" && item.id === data.item_id
                  );
                  
                  if (existingIndex !== -1) {
                    // Update existing transcript - keep original data
                    const updated = [...prev];
                    updated[existingIndex] = {
                      ...updated[existingIndex],
                      text: data.transcript
                    };
                    return updated;
                  }
                  
                  // Use OpenAI's timestamp if available, otherwise use current time
                  const eventTimestamp = data.created_at || data.timestamp || Date.now();
                  
                  return [
                    ...prev,
                    {
                      speaker: "user",
                      text: data.transcript,
                      timestamp: eventTimestamp,
                      id: data.item_id,
                    }
                  ];
                });
              }
              break;

            case "input_audio_buffer.speech_started":
              setStatus("Listening...");
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
          setStatus("Connection failed ✗");
          reject(error);
        };

        ws.onclose = (event) => {
          console.log("Disconnected from OpenAI:", event.code, event.reason);
          clearPendingAudio(true);
          setIsConnected(false);
          setIsMicActive(false);
          setConnectedAt(null);
          setShowConnectedPrompt(false);
          setStatus("Disconnected");
        };

        // Timeout for connection
        setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            reject(new Error("Connection timeout"));
          }
        }, 10000);
      });
      
    } catch (err: any) {
      console.error("OpenAI initialization error:", err);
      setError(`OpenAI Error: ${err.message}`);
      setStatus("OpenAI initialization failed ✗");
      return false;
    }
  };

  // Start the test
  const startTest = async () => {
    setIsStarting(true);
    setError(null);
    setTranscript([]);
    setConnectedAt(null);
    setShowConnectedPrompt(false);
    clearPendingAudio();
    
    try {
      const avatarSuccess = await initializeLiveAvatar();
      if (!avatarSuccess) {
        setIsStarting(false);
        return;
      }

      // Wait a bit for LiveAvatar to be fully ready
      await new Promise(resolve => setTimeout(resolve, 2000));

      const openAISuccess = await initializeOpenAI();
      if (!openAISuccess) {
        setIsStarting(false);
        return;
      }
    } catch (err: any) {
      setError(err.message);
    }
    
    setIsStarting(false);
  };

  // Cleanup
  const cleanup = useCallback(() => {
    console.log("Cleaning up...");
    clearPendingAudio();
    setConnectedAt(null);
    setShowConnectedPrompt(false);
    
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    if (avatarClientRef.current) {
      avatarClientRef.current.endSession();
      avatarClientRef.current = null;
    }
    
    setIsConnected(false);
    setIsMicActive(false);
    setStatus("Stopped");
  }, [clearPendingAudio]);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  if (!avatar) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-white p-8">
        <div className="text-center space-y-4 max-w-md">
          <h1 className="text-2xl font-semibold text-slate-900">Avatar not configured</h1>
          <p className="text-slate-500 text-sm">
            The Sarah test avatar could not be found. Please verify your avatar configuration in
            <code className="mx-1 text-xs bg-slate-100 px-2 py-0.5 rounded">lib/avatars.ts</code>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col p-6 lg:p-8 bg-slate-50">
      <div className="max-w-7xl w-full mx-auto space-y-6">
        <div className="bg-white border-b border-slate-200 p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Custom Mode Test</p>
              <h1 className="text-2xl font-medium text-slate-900">
                {avatar.name} • LiveAvatar + OpenAI Realtime
              </h1>
              <p className="text-slate-600 mt-1 flex items-center gap-2 text-sm">
                <span className="font-medium text-slate-900">{avatar.role}</span>
                <span className="text-slate-300">•</span>
                <span>{avatar.scenario}</span>
                <span className="text-slate-300">•</span>
                <span className="text-slate-500">Custom agent prompt (v6)</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase text-slate-500">Prompt Version</p>
              <p className="text-sm font-semibold text-slate-900">pmpt_692533270e8c81939cb2030024753c36043ae653ab747fbc · v6</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-3 lg:col-span-2 space-y-6">
            <div className="bg-white border border-slate-200 overflow-hidden relative">
              <div className="aspect-video bg-slate-900 relative">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ opacity: isConnected ? 1 : 0, zIndex: isConnected ? 10 : -1 }}
                />

                <div className="absolute top-4 left-4 z-30">
                  <span className="px-3 py-1 bg-black/60 text-white text-xs font-medium rounded-full">
                    {status}
                  </span>
                </div>

                {isStarting && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center z-30 bg-slate-900/80 text-white space-y-3">
                    <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-400 border-t-white"></div>
                    <p className="text-sm font-medium">Connecting to avatar and OpenAI…</p>
                  </div>
                )}

                {error && (
                  <div className="absolute inset-0 flex items-center justify-center z-30 bg-slate-900/80">
                    <div className="bg-white/95 text-slate-900 p-5 max-w-md text-center space-y-2 border border-red-200">
                      <p className="text-base font-semibold">Connection error</p>
                      <p className="text-sm text-slate-600">{error}</p>
                      <p className="text-xs text-slate-500">
                        Check your OpenAI key, prompt version, and LiveAvatar credentials.
                      </p>
                    </div>
                  </div>
                )}

                {!isStarting && !error && !isConnected && avatar.imageSrc && (
                  <div className="absolute inset-0 z-10">
                    <Image
                      src={avatar.imageSrc}
                      alt={avatar.name}
                      fill
                      className="object-cover"
                      priority
                      sizes="100vw"
                    />
                    <div className="absolute inset-0 bg-slate-900/65 flex flex-col items-center justify-center text-center text-white space-y-2 px-6">
                      <p className="text-lg font-semibold">Ready to run your custom agent</p>
                      <p className="text-sm text-slate-200">
                        Click &quot;Start Custom Session&quot; to connect OpenAI Realtime and LiveAvatar.
                      </p>
                    </div>
                  </div>
                )}

                {isConnected && showConnectedPrompt && !error && (
                  <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none p-4">
                    <div className="pointer-events-auto bg-white text-slate-900 px-6 py-3 border border-slate-300 flex items-center gap-4 shadow-lg">
                      <span className="text-sm font-medium">
                        Connected. Start talking whenever you&apos;re ready.
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowConnectedPrompt(false)}
                        className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}

                <div className="absolute inset-x-0 bottom-0 z-30 pointer-events-none">
                  <div className="bg-gradient-to-t from-black/75 to-transparent p-6 flex flex-wrap justify-center items-center gap-4">
                    {isConnected && (
                      <div className="pointer-events-auto inline-flex items-center px-4 py-2 bg-white/90 text-slate-900 text-sm font-semibold border border-slate-200 rounded-lg">
                        <span className="w-2 h-2 rounded-full bg-emerald-600 mr-2"></span>
                        <span className="font-mono">{formatDuration(elapsedSeconds)}</span>
                      </div>
                    )}
                    {isConnected ? (
                      <button
                        onClick={cleanup}
                        className="pointer-events-auto px-8 py-3 bg-red-600 hover:bg-red-700 text-white text-base font-semibold rounded-lg transition-colors duration-200"
                      >
                        End Session
                      </button>
                    ) : (
                      <button
                        onClick={startTest}
                        disabled={isStarting}
                        className="pointer-events-auto px-10 py-4 bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-semibold rounded-lg transition-colors duration-200 disabled:bg-slate-400 disabled:cursor-not-allowed"
                      >
                        {isStarting ? "Starting..." : "Start Custom Session"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium text-slate-900">Transcript</h2>
                <span className="text-xs text-slate-500 uppercase tracking-wide">
                  {transcript.length} {transcript.length === 1 ? "turn" : "turns"}
                </span>
              </div>
              <div className="bg-slate-50 p-4 min-h-[200px] max-h-[400px] overflow-y-auto">
                {transcript.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {transcript
                      .sort((a, b) => b.timestamp - a.timestamp)
                      .map((event, index) => (
                        <div
                          key={`${event.id}-${index}`}
                          className={`p-3 text-sm ${
                            event.speaker === "user"
                              ? "bg-emerald-600 text-white ml-8"
                              : "bg-white text-slate-900 mr-8 border border-slate-200"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <span className={`font-medium text-xs ${
                              event.speaker === "user" ? "text-emerald-100" : "text-slate-500"
                            }`}>
                              {event.speaker === "user" ? "You" : avatar.name}:
                            </span>
                            <span className="flex-1">{event.text}</span>
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

          <div className="col-span-3 lg:col-span-1 space-y-6">
            <div className="bg-white border border-slate-200 p-6 space-y-5">
              <div>
                <h2 className="text-lg font-medium text-slate-900">Connection</h2>
                <p className="text-sm text-slate-600 mt-1">
                  {status}
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-slate-600">
                    <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
                    <span>OpenAI Realtime</span>
                  </div>
                  <span className="text-slate-500">{isConnected ? "Connected" : "Idle"}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-slate-600">
                    <span className={`w-2.5 h-2.5 rounded-full ${isMicActive ? "bg-blue-500 animate-pulse" : "bg-slate-300"}`} />
                    <span>Microphone</span>
                  </div>
                  <span className="text-slate-500">{isMicActive ? "Streaming" : "Muted"}</span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs uppercase text-slate-500 tracking-wide">OpenAI Prompt</p>
                <code className="block text-xs bg-slate-100 text-slate-800 px-2 py-1 rounded">
                  pmpt_692533270e8c81939cb2030024753c36043ae653ab747fbc · v6
                </code>
              </div>

              <div className="space-y-2">
                <p className="text-xs uppercase text-slate-500 tracking-wide">Flow</p>
                <ol className="list-decimal list-inside text-sm text-slate-600 space-y-1">
                  <li>Your mic audio streams to OpenAI Realtime.</li>
                  <li>OpenAI applies your prompt + instructions.</li>
                  <li>PCM audio is piped into LiveAvatar (Custom mode).</li>
                  <li>Sarah lip-syncs the response in real time.</li>
                </ol>
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-6 space-y-4">
              <h3 className="text-lg font-medium text-slate-900">Tips</h3>
              <ul className="text-sm text-slate-600 space-y-2 list-disc list-inside">
                <li>Leave a short pause after each turn so VAD can segment cleanly.</li>
                <li>Watch the OpenAI + mic indicators if you suspect latency.</li>
                <li>Use the &quot;End Session&quot; button to release both WebSocket connections.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}


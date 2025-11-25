"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { createLiveAvatarClient, LiveAvatarClient } from "@/lib/liveavatar";
import { getAvatarById } from "@/lib/avatars";

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
  const messageSequenceRef = useRef(0);

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
      console.error("Error sending audio to avatar:", error);
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
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error("Failed to get OpenAI token");
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
              if (!responseId || !data.delta) break;
              
              setTranscript(prev => {
                const existingIndex = prev.findIndex(
                  item => item.speaker === "assistant" && item.id === responseId
                );
                
                if (existingIndex !== -1) {
                  const updated = [...prev];
                  updated[existingIndex] = {
                    ...updated[existingIndex],
                    text: updated[existingIndex].text + data.delta
                  };
                  return updated;
                }
                
                // Use sequence counter for correct ordering
                messageSequenceRef.current += 1;
                
                return [
                  ...prev,
                  {
                    speaker: "assistant",
                    text: data.delta,
                    timestamp: messageSequenceRef.current,
                    id: responseId,
                  }
                ];
              });
              break;
            }

            case "conversation.item.input_audio_transcription.completed":
              if (data.transcript && data.item_id) {
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
                  
                  // Use sequence counter for correct ordering
                  messageSequenceRef.current += 1;
                  
                  return [
                    ...prev,
                    {
                      speaker: "user",
                      text: data.transcript,
                      timestamp: messageSequenceRef.current,
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
              setStatus("Ready - Start speaking!");
              break;

            case "response.canceled":
            case "response.cancelled":
            case "response.error":
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

      // End avatar session
      if (avatarClientRef.current) {
        await avatarClientRef.current.endSession();
        avatarClientRef.current = null;
      }

      clearPendingAudio(false);
      setIsConnected(false);
      setConnectedAt(null);
      setStatus("Session ended");
    } catch (error) {
      console.error("Error ending session:", error);
      setStatus("Session ended with errors");
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
        <div className="flex items-center justify-between bg-white border border-slate-200 px-6 py-4">
          <div>
            <h1 className="text-2xl font-medium text-slate-900">
              Training Session: {avatar.name}
            </h1>
            <p className="text-sm text-slate-500 mt-1">{avatar.role} - {avatar.scenario}</p>
          </div>
          <Link
            href="/select-avatar"
            className="px-4 py-2 text-slate-600 hover:text-slate-900 transition-colors text-sm border border-slate-200 hover:border-slate-300"
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

          {/* Right Column - Status & Controls */}
          <div className="space-y-6">
            {/* Connection Status */}
            <div className="bg-white border border-slate-200 p-6 space-y-5">
              <div>
                <h2 className="text-lg font-medium text-slate-900">Connection</h2>
                <p className="text-sm text-slate-600 mt-1">
                  {status}
                </p>
                {isConnected && status === "Ready - Start speaking!" && (
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


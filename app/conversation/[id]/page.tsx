"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getAvatarById } from "@/lib/avatars";
import { useEffect, useState, useRef } from "react";
import { createLiveAvatarClient, type TranscriptEvent } from "@/lib/liveavatar";

export default function ConversationPage({ params }: { params: { id: string } }) {
  const [isClient, setIsClient] = useState(false);
  const router = useRouter();
  const avatarId = params.id;
  const avatar = avatarId ? getAvatarById(avatarId) : null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const liveAvatarClientRef = useRef<ReturnType<typeof createLiveAvatarClient> | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [shouldStartSession, setShouldStartSession] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showConnectedPrompt, setShowConnectedPrompt] = useState(false);

  // Avoid hydration mismatch by rendering a simple placeholder on the server.
  useEffect(() => {
    setIsClient(true);
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

  const formatDuration = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  };

  // Initialize LiveAvatar SDK when avatar is selected (client-side only)
  useEffect(() => {
    if (!isClient) return;
    if (!shouldStartSession) return;

    const videoElement = videoRef.current;
    if (!avatar || !videoElement) return;

    let isCancelled = false;

    // Create LiveAvatar client
    const client = createLiveAvatarClient(
      avatar.avatarId,
      avatar.voiceId,
      avatar.contextId
    );
    liveAvatarClientRef.current = client;

    // Set up transcript callback
    client.onTranscript((event: TranscriptEvent) => {
      if (isCancelled) return;
      setTranscript((prev) => [...prev, event]);
    });

    const initializeLiveAvatar = async () => {
      try {
        setIsInitializing(true);
        setError(null);

        // Initialize the session
        await client.initialize(videoElement);
        if (isCancelled) {
          await client.endSession();
          return;
        }
        setIsSessionActive(true);
        setConnectedAt(Date.now());
        setShowConnectedPrompt(true);
      } catch (err) {
        console.error("Error initializing LiveAvatar:", err);
        if (!isCancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to initialize LiveAvatar session"
          );
        }
      } finally {
        if (!isCancelled) {
          setIsInitializing(false);
        }
      }
    };

    initializeLiveAvatar();

    // Cleanup on unmount
    return () => {
      isCancelled = true;
      setIsSessionActive(false);
      setConnectedAt(null);
      setShowConnectedPrompt(false);
      if (liveAvatarClientRef.current) {
        // Detach transcript callback to avoid duplicate updates
        liveAvatarClientRef.current.onTranscript(() => {});
        liveAvatarClientRef.current
          .endSession()
          .catch(console.error)
          .finally(() => {
            if (liveAvatarClientRef.current === client) {
              liveAvatarClientRef.current = null;
            }
          });
      }
    };
  }, [avatar, isClient, shouldStartSession]);

  const handleStartSession = () => {
    if (isInitializing || isSessionActive) return;
    setError(null);
    setShouldStartSession(true);
  };

  const handleEndSession = async () => {
    const client = liveAvatarClientRef.current;

    if (!client) {
      setIsSessionActive(false);
      setConnectedAt(null);
      setShowConnectedPrompt(false);
      setShouldStartSession(false);
      return;
    }

    try {
      await client.endSession();
    } catch (err) {
      console.error("Error ending session:", err);
      setError("Failed to end session properly");
    } finally {
      liveAvatarClientRef.current = null;
      setIsSessionActive(false);
      setConnectedAt(null);
      setShowConnectedPrompt(false);
      setShouldStartSession(false);
    }
  };

  if (!isClient) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-white">
        <div className="text-center space-y-6">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-slate-200 border-t-slate-900 mx-auto"></div>
          <div>
            <h1 className="text-xl font-medium text-slate-900">
              Loading training session...
            </h1>
            <p className="text-slate-500 mt-2 text-sm">
              Preparing your avatar connection.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!avatar) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-white">
        <div className="text-center space-y-6">
          <div>
            <h1 className="text-xl font-medium text-slate-900">
              Avatar not found
            </h1>
            <p className="text-slate-500 mt-2 text-sm">
              The requested avatar could not be located.
            </p>
          </div>
          <Link
            href="/select-avatar"
            className="inline-block px-6 py-3 text-slate-600 hover:text-slate-900 border border-slate-300 hover:border-slate-400 rounded-lg transition-colors duration-200 font-medium"
          >
            ← Back to Avatar Selection
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col p-6 lg:p-8 bg-slate-50">
      <div className="max-w-7xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-medium text-slate-900">
                Training Session
              </h1>
              <p className="text-slate-600 mt-1 flex items-center gap-2 text-sm">
                <span className="font-medium text-slate-900">{avatar.name}</span>
                <span className="text-slate-300">•</span>
                <span>{avatar.role}</span>
                <span className="text-slate-300">•</span>
                <span className="text-slate-500">{avatar.scenario}</span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/select-avatar"
                className="px-5 py-2 text-slate-600 hover:text-slate-900 border border-slate-300 hover:border-slate-400 rounded-lg transition-colors duration-200 text-sm font-medium"
              >
                ← Back
              </Link>
            </div>
          </div>
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-3 gap-6">
          {/* Left Side - Avatar and Transcript */}
          <div className="col-span-2 space-y-6">
            {/* Video Area */}
            <div className="bg-white border border-slate-200 overflow-hidden">
              <div className="aspect-video bg-slate-900 relative">
            {/* Video element - always rendered, visibility controlled by z-index */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{ 
                zIndex: isSessionActive ? 10 : -1,
                opacity: isSessionActive ? 1 : 0
              }}
            />
            
            {/* Loading overlay */}
            {isInitializing && (
              <div className="absolute inset-0 flex items-center justify-center z-20 bg-slate-900">
                <div className="text-center space-y-4">
                  <div className="animate-spin rounded-full h-12 w-12 border-2 border-slate-700 border-t-white mx-auto"></div>
                  <p className="text-white text-sm font-medium">Initializing avatar...</p>
                </div>
              </div>
            )}
            
            {/* Error overlay */}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center z-20 bg-slate-900">
                <div className="text-center space-y-3 p-6 max-w-md">
                  <p className="text-white text-base font-medium">Connection Error</p>
                  <p className="text-slate-400 text-sm">{error}</p>
                  <p className="text-slate-500 text-xs">
                    Please check your API key and avatar configuration
                  </p>
                </div>
              </div>
            )}
            
            {/* Placeholder when not active - Show avatar image */}
            {!isInitializing && !error && !isSessionActive && avatar.imageSrc && (
              <div className="absolute inset-0 z-10 bg-gray-800">
                <Image 
                  src={avatar.imageSrc} 
                  alt={avatar.name}
                  fill
                  quality={100}
                  unoptimized
                  className="object-cover"
                  priority
                />
              </div>
            )}

            {/* Connected prompt overlay */}
            {isSessionActive && showConnectedPrompt && !error && (
              <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none p-4">
                <div className="pointer-events-auto bg-white text-slate-900 px-6 py-3 border border-slate-300 flex items-center gap-4">
                  <span className="text-sm font-medium">
                    Connected. Say &quot;hello&quot; to begin.
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

            {/* Persistent controls overlay */}
            <div className="absolute inset-x-0 bottom-0 z-30 pointer-events-none">
              <div className="bg-gradient-to-t from-black/70 to-transparent p-6 flex justify-center items-center gap-4">
                {isSessionActive && (
                  <div className="pointer-events-auto inline-flex items-center px-5 py-3 bg-white/90 text-slate-900 text-sm font-semibold border-2 border-slate-300 rounded-lg">
                    <span className="w-2 h-2 rounded-full bg-emerald-600 mr-2"></span>
                    <span className="font-mono">{formatDuration(elapsedSeconds)}</span>
                  </div>
                )}
                {isSessionActive ? (
                  <button
                    onClick={handleEndSession}
                    className="pointer-events-auto px-8 py-3.5 bg-red-600 hover:bg-red-700 text-white text-base font-semibold rounded-lg transition-colors duration-200 btn-primary"
                  >
                    End Session
                  </button>
                ) : (
                  <button
                    onClick={handleStartSession}
                    className="pointer-events-auto px-10 py-4 bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-semibold rounded-lg transition-colors duration-200 shadow-lg btn-primary"
                  >
                    Start Session
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

            {/* Real-time Transcript Section */}
            <div className="bg-white border border-slate-200 p-6">
              <h2 className="text-lg font-medium text-slate-900 mb-4">
                Transcript
              </h2>
              <div className="bg-slate-50 p-4 min-h-[200px] max-h-[400px] overflow-y-auto">
                {transcript.length > 0 ? (
                  <div className="flex flex-col-reverse gap-3">
                    {transcript.map((event, index) => (
                      <div
                        key={`${event.timestamp}-${index}`}
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
                            {event.speaker === "user" ? "You" : avatar?.name}:
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

          {/* Right Side - Reserved for Future Features */}
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 p-6 min-h-[600px]">
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}


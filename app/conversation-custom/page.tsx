"use client";

import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getAvatarById } from "@/lib/avatars";
import { useEffect, useState, useRef, Suspense } from "react";
import { createLiveAvatarClient, type TranscriptEvent } from "@/lib/liveavatar";

function ConversationCustomContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const avatarId = searchParams.get("avatar");
  const avatar = avatarId ? getAvatarById(avatarId) : null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const liveAvatarClientRef = useRef<ReturnType<typeof createLiveAvatarClient> | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [shouldStartSession, setShouldStartSession] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);
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

    // Create LiveAvatar client in CUSTOM mode
    const client = createLiveAvatarClient(
      avatar.avatarId,
      avatar.voiceId,
      avatar.contextId,
      "CUSTOM"
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
        console.error("Error initializing LiveAvatar (CUSTOM):", err);
        if (!isCancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to initialize LiveAvatar custom session"
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

  const latestHistory = transcript
    .slice(-10)
    .map((t) => ({ speaker: t.speaker, text: t.text }));

  const handleBrainTest = async () => {
    if (!avatar) return;

    try {
      const res = await fetch("/api/custom-brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: {
            name: avatar.name,
            role: avatar.role,
            scenario: avatar.scenario,
          },
          history: latestHistory,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error("Brain error:", data);
        setError(data.error || "Brain API error");
        return;
      }

      const reply: string = data.reply;
      // Add reply to transcript as avatar text.
      setTranscript((prev) => [
        ...prev,
        {
          text: reply,
          speaker: "avatar",
          timestamp: Date.now(),
        },
      ]);

      // Turn reply into speech audio and send it to LiveAvatar.
      const client = liveAvatarClientRef.current;
      if (client) {
        try {
          const speakRes = await fetch("/api/custom-speak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: reply }),
          });

          const speakData = await speakRes.json();
          if (!speakRes.ok) {
            console.error("TTS error:", speakData);
            setError(speakData.error || "Avatar could not speak the reply");
            return;
          }

          const audioBase64: string = speakData.audioBase64;
          await client.speakPcmAudio(audioBase64);
        } catch (err) {
          console.error("Failed to send audio to LiveAvatar:", err);
          setError("Avatar could not speak the custom reply");
        }
      }
    } catch (err) {
      console.error("Error calling custom brain:", err);
      setError("Failed to reach custom brain API");
    }
  };

  if (!isClient) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-b from-gray-50 to-gray-100">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">
            Loading custom session...
          </h1>
          <p className="text-gray-600">
            Preparing your avatar and custom brain.
          </p>
        </div>
      </main>
    );
  }

  if (!avatar) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">
            Avatar not found
          </h1>
          <Link
            href="/select-avatar"
            className="text-blue-600 hover:text-blue-800 underline"
          >
            ← Back to Avatar Selection
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col p-8 bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="max-w-6xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Training Session (Custom Brain)
              </h1>
              <p className="text-gray-600 mt-1">
                {avatar.name} - {avatar.role} ({avatar.scenario})
              </p>
            </div>
            <div className="flex items-center gap-3">
              {isSessionActive && (
                <div className="inline-flex items-center px-3 py-1 rounded-full bg-green-100 text-green-800 text-sm font-medium">
                  <span className="mr-1">● Live</span>
                  <span>{formatDuration(elapsedSeconds)}</span>
                </div>
              )}
              <button
                onClick={handleBrainTest}
                className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors duration-200"
              >
                Ask Brain (debug)
              </button>
              <Link
                href="/select-avatar"
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors duration-200"
              >
                ← Back to Avatar Selection
              </Link>
            </div>
          </div>
        </div>

        {/* Video Area */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
          <div className="aspect-video bg-gray-900 relative">
            {/* Video element - always rendered, visibility controlled by z-index */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{
                zIndex: isSessionActive ? 10 : -1,
                opacity: isSessionActive ? 1 : 0,
              }}
            />

            {/* Loading overlay */}
            {isInitializing && (
              <div className="absolute inset-0 flex items-center justify-center z-20 bg-gray-900">
                <div className="text-center space-y-2">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
                  <p className="text-white text-lg">Initializing avatar...</p>
                </div>
              </div>
            )}

            {/* Error overlay */}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center z-20 bg-gray-800">
                <div className="text-center space-y-2 p-4">
                  <div className="text-4xl text-red-400">⚠️</div>
                  <p className="text-white text-lg">Error: {error}</p>
                  <p className="text-gray-400 text-sm">
                    Please check your API keys and avatar configuration
                  </p>
                </div>
              </div>
            )}

            {/* Placeholder when not active */}
            {!isInitializing && !error && !isSessionActive && (
              <div className="absolute inset-0 flex items-center justify-center z-10 bg-gray-800">
                <div className="text-center space-y-2">
                  <div className="text-6xl text-gray-400">📹</div>
                  <p className="text-white text-lg">
                    Preparing avatar video stream...
                  </p>
                </div>
              </div>
            )}

            {/* Connected prompt overlay */}
            {isSessionActive && showConnectedPrompt && !error && (
              <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
                <div className="pointer-events-auto bg-black/75 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-3">
                  <span className="font-medium">
                    You&apos;re connected.
                  </span>
                  <span className="text-sm text-gray-200">
                    When you&apos;re ready, say &quot;hello&quot; to begin.
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowConnectedPrompt(false)}
                    className="text-sm font-semibold text-gray-200 hover:text-white underline"
                  >
                    Got it
                  </button>
                </div>
              </div>
            )}

            {/* Persistent controls overlay */}
            <div className="absolute inset-x-0 bottom-0 z-30 pointer-events-none">
              <div className="bg-gradient-to-t from-black/70 via-black/30 to-transparent p-4 flex justify-end">
                {isSessionActive ? (
                  <button
                    onClick={handleEndSession}
                    className="pointer-events-auto px-5 py-2 bg-red-600 text-white font-semibold rounded-full shadow-lg hover:bg-red-700 transition-colors duration-200"
                  >
                    End Session
                  </button>
                ) : (
                  <button
                    onClick={handleStartSession}
                    className="pointer-events-auto px-5 py-2 bg-green-600 text-white font-semibold rounded-full shadow-lg hover:bg-green-700 transition-colors duration-200"
                  >
                    Start Session
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Real-time Transcript Section */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Conversation Transcript (Custom)
          </h2>
          <div className="bg-gray-50 rounded-lg p-4 min-h-[200px] max-h-[400px] overflow-y-auto border border-gray-200">
            {transcript.length > 0 ? (
              <div className="flex flex-col-reverse gap-3">
                {transcript.map((event, index) => (
                  <div
                    key={`${event.timestamp}-${index}`}
                    className={`p-3 rounded-lg ${
                      event.speaker === "user"
                        ? "bg-blue-100 text-blue-900 ml-8"
                        : "bg-gray-200 text-gray-900 mr-8"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="font-semibold text-sm">
                        {event.speaker === "user" ? "You" : avatar?.name}:
                      </span>
                      <span className="flex-1">{event.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 italic">
                Conversation transcript will appear here as you speak...
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function ConversationCustomPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-b from-gray-50 to-gray-100">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-bold text-gray-900">
              Loading custom session...
            </h1>
            <p className="text-gray-600">
              Preparing your avatar and custom brain.
            </p>
          </div>
        </main>
      }
    >
      <ConversationCustomContent />
    </Suspense>
  );
}


"use client";

import { useState, useRef } from "react";
import { avatars } from "@/lib/avatars";
import { createLiveAvatarClient, type TranscriptEvent } from "@/lib/liveavatar";

export default function CustomModeTestPage() {
  const [selectedAvatarId, setSelectedAvatarId] = useState<string>(
    avatars[0]?.id ?? ""
  );
  const [isInitializing, setIsInitializing] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEvent[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const clientRef = useRef<ReturnType<typeof createLiveAvatarClient> | null>(
    null
  );

  const handleStart = async () => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const avatar = avatars.find((a) => a.id === selectedAvatarId);
    if (!avatar) {
      setError("Avatar not found for test");
      return;
    }

    // End any existing session first
    if (clientRef.current) {
      try {
        await clientRef.current.endSession();
      } catch (e) {
        console.error("Error ending previous session", e);
      } finally {
        clientRef.current = null;
      }
    }

    setError(null);
    setTranscript([]);

    const client = createLiveAvatarClient(
      avatar.avatarId,
      avatar.voiceId,
      avatar.contextId,
      "CUSTOM" // <-- IMPORTANT: Custom mode
    );
    clientRef.current = client;

    client.onTranscript((event: TranscriptEvent) => {
      setTranscript((prev) => [...prev, event]);
    });

    try {
      setIsInitializing(true);
      await client.initialize(videoElement);
      setIsSessionActive(true);
    } catch (err) {
      console.error("Custom mode test init error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to start CUSTOM test session"
      );
      clientRef.current = null;
    } finally {
      setIsInitializing(false);
    }
  };

  const handleEnd = async () => {
    if (!clientRef.current) {
      setIsSessionActive(false);
      return;
    }

    try {
      await clientRef.current.endSession();
    } catch (err) {
      console.error("Error ending custom test session:", err);
      setError("Failed to end session properly");
    } finally {
      clientRef.current = null;
      setIsSessionActive(false);
    }
  };

  const handleAskBrain = async () => {
    const client = clientRef.current;
    if (!client) {
      setError("Session is not active");
      return;
    }

    const avatar = avatars.find((a) => a.id === selectedAvatarId);
    if (!avatar) {
      setError("Avatar not found for test");
      return;
    }

    const latestHistory = transcript
      .slice(-10)
      .map((t) => ({ speaker: t.speaker, text: t.text }));

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

      // Show reply in transcript
      setTranscript((prev) => [
        ...prev,
        {
          text: reply,
          speaker: "avatar",
          timestamp: Date.now(),
        },
      ]);

      // Make avatar speak reply via LiveAvatar CUSTOM mode
      try {
        await client.sendMessage(reply);
      } catch (err) {
        console.error("Failed to send message to LiveAvatar:", err);
        setError("Avatar could not speak the custom reply");
      }
    } catch (err) {
      console.error("Error calling custom brain:", err);
      setError("Failed to reach custom brain API");
    }
  };

  return (
    <main className="flex min-h-screen flex-col p-8 bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200 space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">
            LiveAvatar CUSTOM Mode Test
          </h1>
          <p className="text-gray-600 text-sm">
            This page is only for testing CUSTOM mode. Open DevTools &gt; Network and
            look at the <code>/v1/sessions/token</code> request to confirm{" "}
            <code>mode: &quot;CUSTOM&quot;</code>.
          </p>

          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
            <label className="flex flex-col text-sm text-gray-700">
              Avatar for test
              <select
                className="mt-1 rounded border border-gray-300 px-3 py-2 text-sm"
                value={selectedAvatarId}
                onChange={(e) => setSelectedAvatarId(e.target.value)}
              >
                {avatars.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.role}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleStart}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors duration-200"
                disabled={isInitializing}
              >
                {isInitializing ? "Starting..." : "Start CUSTOM Session"}
              </button>
              <button
                onClick={handleEnd}
                className="px-4 py-2 bg-gray-200 text-gray-800 text-sm font-semibold rounded-lg hover:bg-gray-300 transition-colors duration-200"
              >
                End Session
              </button>
              <button
                onClick={handleAskBrain}
                className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors duration-200 disabled:opacity-60"
                disabled={!isSessionActive || isInitializing}
              >
                Ask Brain (avatar speaks)
              </button>
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
              Error: {error}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
          <div className="aspect-video bg-gray-900 relative">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
              style={{
                zIndex: isSessionActive ? 10 : -1,
                opacity: isSessionActive ? 1 : 0,
              }}
            />

            {!isSessionActive && !isInitializing && (
              <div className="absolute inset-0 flex items-center justify-center z-10 bg-gray-800">
                <div className="text-center space-y-2">
                  <div className="text-6xl text-gray-400">📹</div>
                  <p className="text-white text-lg">
                    Start a CUSTOM mode session to see the avatar here.
                  </p>
                </div>
              </div>
            )}

            {isInitializing && (
              <div className="absolute inset-0 flex items-center justify-center z-20 bg-gray-900">
                <div className="text-center space-y-2">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
                  <p className="text-white text-lg">
                    Initializing CUSTOM mode session...
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            Transcript (for debugging)
          </h2>
          <div className="bg-gray-50 rounded-lg p-3 min-h-[120px] max-h-[260px] overflow-y-auto border border-gray-200 text-xs">
            {transcript.length === 0 ? (
              <p className="text-gray-400 italic">
                When you speak, LiveAvatar transcriptions (user + avatar) will show
                up here.
              </p>
            ) : (
              <div className="space-y-1">
                {transcript.map((t, i) => (
                  <div key={t.timestamp + "-" + i}>
                    <span className="font-semibold">
                      {t.speaker === "user" ? "You" : "Avatar"}:
                    </span>{" "}
                    <span>{t.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}



'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Avatar } from '@/types/avatar';
import { useLiveAvatarSDK } from '@/hooks/useLiveAvatarSDK';
import { useHybridSpeechRecognition } from '@/hooks/useHybridSpeechRecognition';
import { useClientVAD } from '@/hooks/useClientVAD';
import { useAvatarAudioCapture } from '@/hooks/useAvatarAudioCapture';
import { AVATAR_CONFIG } from '@/lib/avatar-config';

interface AvatarSDKProps {
  avatar: Avatar;
  onTranscript?: (message: { speaker: 'user' | 'avatar'; text: string; timestamp: Date; isInterim?: boolean }) => void;
  onError?: (error: string | null) => void;
}

export default function AvatarSDK({ avatar, onTranscript, onError }: AvatarSDKProps) {
  const [error, setError] = useState<string | null>(null);
  const [avatarState, setAvatarState] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [conversationStarted, setConversationStarted] = useState(false);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [isListeningActive, setIsListeningActive] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [speechStatus, setSpeechStatus] = useState<string>('Initializing...');

  // Accumulated transcript for VAD
  const accumulatedTranscriptRef = React.useRef('');
  
  // Video element ref for avatar audio capture
  const videoElementRef = React.useRef<HTMLVideoElement | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

  // Get Deepgram API key
  const deepgramApiKey = typeof window !== 'undefined' 
    ? process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY 
    : undefined;

  // Initialize LiveAvatar SDK (no API key needed - using backend)
  const {
    isInitialized,
    isConnected,
    isSpeaking: sdkIsSpeaking,
    error: sdkError,
    speak,
    interrupt,
  } = useLiveAvatarSDK({
    avatarId: avatar.id, // Using avatar.id which is the actual LiveAvatar avatar ID
    contextId: avatar.contextId,
    sessionLanguage: 'en',
    enabled: true, // Always enabled - backend handles auth
    videoElement,
    onTranscript: (speaker, text, isFinal) => {
      if (!onTranscript || !text.trim()) return;

      console.log('[AvatarSDK] 📝 Transcript received:', { speaker, text, isFinal });

      // Mark conversation as started
      if (!conversationStarted) {
        setConversationStarted(true);
      }

      onTranscript({
        speaker,
        text: text.trim(),
        timestamp: new Date(),
        isInterim: !isFinal,
      });
    },
    onStatus: (status) => {
      console.log('[AvatarSDK] 📊 Status changed:', status);
      setAvatarState(status);
    },
    onError: (err) => {
      console.error('[AvatarSDK] ❌ Error:', err);
      setError(err);
    },
  });

  // Handle user speech recognition
  const handleSpeechResult = useCallback((text: string, isFinal: boolean) => {
    if (!text.trim()) return;

    // Mark conversation as started
    if (!conversationStarted) {
      setConversationStarted(true);
    }

    console.log('[AvatarSDK] 🎤 User speech:', { text, isFinal });

    // Accumulate transcript
    if (isFinal) {
      const trimmedText = text.trim();
      if (trimmedText) {
        if (accumulatedTranscriptRef.current) {
          accumulatedTranscriptRef.current += ' ' + trimmedText;
        } else {
          accumulatedTranscriptRef.current = trimmedText;
        }

        // Send to UI
        if (onTranscript) {
          onTranscript({
            speaker: 'user',
            text: accumulatedTranscriptRef.current,
            timestamp: new Date(),
            isInterim: false,
          });
        }
      }
    }
  }, [onTranscript, conversationStarted]);

  const handleSpeechStatusChange = useCallback((status: string) => {
    console.log('[AvatarSDK] 📊 Speech status:', status);
    setSpeechStatus(status);
    
    if (status.includes('Using') && !status.includes('denied')) {
      setPermissionError(null);
    }
  }, []);

  const handleSpeechError = useCallback((error: string) => {
    if (error.includes('no-speech')) {
      return; // Ignore
    }
    
    console.error('[AvatarSDK] ❌ Speech error:', error);
    
    if (error.includes('permission') || error.includes('not-allowed') || error.includes('Permission denied')) {
      setPermissionError(error);
      setSpeechStatus('Microphone permission denied');
    } else {
      setSpeechStatus(`Error: ${error}`);
    }
  }, []);

  // Speech recognition for user input
  const { 
    startListening, 
    stopListening, 
    isSupported: speechSupported,
    activeProvider,
    deepgramAvailable,
    browserAvailable,
    isListening: speechIsListening,
  } = useHybridSpeechRecognition({
    onResult: handleSpeechResult,
    onStatusChange: handleSpeechStatusChange,
    onError: handleSpeechError,
    enabled: !!onTranscript && isConnected,
    apiKey: deepgramApiKey,
    preferDeepgram: true,
  });

  useEffect(() => {
    setIsListeningActive(speechIsListening);
  }, [speechIsListening]);

  // Client-side VAD handlers
  const handleVADSpeechStart = useCallback(() => {
    if (conversationStarted) {
      console.log('[AvatarSDK] 🎤 User started speaking (VAD)');
    }
    setAvatarState('listening');
    
    // IMMEDIATELY interrupt avatar if speaking - this ensures the avatar stops
    // speaking and listens to the user's NEW input, not continuing the old response
    if (sdkIsSpeaking) {
      console.log('[AvatarSDK] ⛔ User interrupted avatar - stopping current response');
      interrupt();
      // Clear accumulated transcript to prepare for new input
      accumulatedTranscriptRef.current = '';
    }
  }, [sdkIsSpeaking, interrupt, conversationStarted]);

  const handleVADSpeechEnd = useCallback((hasAudio: boolean) => {
    if (conversationStarted) {
      console.log('[AvatarSDK] ✅ User finished speaking (VAD)', {
        hasAudio,
        accumulatedTranscript: accumulatedTranscriptRef.current,
      });
    }

    // Send accumulated transcript to avatar
    const fullTranscript = accumulatedTranscriptRef.current.trim();
    if (fullTranscript && speak) {
      // Deduplicate VAD speech
      const now = Date.now();
      // Use a ref to track last VAD speech time/content if needed, 
      // but typically VAD is less prone to exact duplicates than hybrid speech
      
      console.log('[AvatarSDK] 📤 Sending to avatar:', fullTranscript);
      speak(fullTranscript);
      accumulatedTranscriptRef.current = '';
      setAvatarState('thinking');
    } else {
      setAvatarState('idle');
    }
  }, [speak, conversationStarted]);

  // Set up automatic avatar audio capture
  const { isCapturing: isCapturingAvatar } = useAvatarAudioCapture({
    videoElement,
    deepgramApiKey,
    enabled: isConnected && conversationStarted && !!deepgramApiKey,
    onTranscript: (text, isFinal) => {
      if (text.trim() && onTranscript) {
        console.log('[AvatarSDK] 🎤 Avatar said (auto-captured):', text);
        onTranscript({
          speaker: 'avatar',
          text: text.trim(),
          timestamp: new Date(),
          isInterim: !isFinal,
        });
      }
    },
    onError: (error) => {
      console.error('[AvatarSDK] Avatar audio capture error:', error);
    },
  });

  // Initialize client-side VAD
  const { isSpeaking: vadIsSpeaking } = useClientVAD({
    onSpeechStart: handleVADSpeechStart,
    onSpeechEnd: handleVADSpeechEnd,
    enabled: isConnected && !!onTranscript,
    silenceDurationMs: AVATAR_CONFIG.latency.silenceDurationMs,
    silenceThreshold: AVATAR_CONFIG.latency.silenceThreshold,
    suppressLogs: !conversationStarted,
  });

  // Auto-enable speech recognition when connected
  useEffect(() => {
    if (speechSupported && isConnected && onTranscript && !hasUserInteracted) {
      console.log('[AvatarSDK] ✅ Auto-enabling speech recognition');
      setHasUserInteracted(true);
    }
  }, [speechSupported, isConnected, onTranscript, hasUserInteracted]);

  // Auto-start speech recognition
  useEffect(() => {
    if (speechSupported && isConnected && onTranscript && hasUserInteracted && !speechIsListening) {
      const timer = setTimeout(() => {
        try {
          console.log('[AvatarSDK] 🎙️ Auto-starting speech recognition...');
          startListening();
        } catch (error) {
          console.error('[AvatarSDK] Error auto-starting speech:', error);
        }
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [speechSupported, isConnected, onTranscript, hasUserInteracted, speechIsListening, startListening]);

  // Handle SDK errors
  useEffect(() => {
    if (sdkError) {
      setError(sdkError);
    }
  }, [sdkError]);

  useEffect(() => {
    if (error) {
      onError?.(error);
    } else if (isConnected) {
      onError?.(null);
    }
  }, [error, isConnected, onError]);

  // Status indicator
  const getStatusIndicator = () => {
    const statusConfig = {
      idle: { color: 'bg-gray-400', text: 'Ready', pulse: false },
      listening: { color: 'bg-green-500', text: 'Listening...', pulse: true },
      thinking: { color: 'bg-yellow-500', text: 'Processing...', pulse: true },
      speaking: { color: 'bg-blue-500', text: 'Speaking...', pulse: false },
    };

    const status = statusConfig[avatarState];

    return (
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-white/90 backdrop-blur-sm px-3 py-2 rounded-full shadow-lg">
        <div className={`w-3 h-3 rounded-full ${status.color} ${status.pulse ? 'animate-pulse' : ''}`}></div>
        <span className="text-sm font-medium text-gray-700">{status.text}</span>
      </div>
    );
  };

  return (
    <div className="w-full mx-auto space-y-4">
      {/* SDK Status */}
      <div className={`border rounded-lg p-3 shadow-sm ${
        isConnected ? 'bg-green-50 border-green-200' : 
        sdkError ? 'bg-red-50 border-red-200' :
        'bg-yellow-50 border-yellow-200'
      }`}>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            isConnected ? 'bg-green-500 animate-pulse' : 
            sdkError ? 'bg-red-500' :
            'bg-yellow-500 animate-pulse'
          }`}></div>
          <span className="text-sm font-medium text-gray-900">
            {isConnected ? '✅ LiveAvatar SDK Connected - Real Transcripts Active!' : 
             sdkError ? '❌ SDK Connection Failed' :
             '⏳ Connecting to LiveAvatar SDK...'}
          </span>
        </div>
        {sdkError && (
          <div className="mt-2 p-2 bg-red-100 border border-red-300 rounded text-xs">
            <p className="text-red-800 font-semibold">Connection Error:</p>
            <p className="text-red-700 mt-1">{sdkError}</p>
            <p className="text-red-600 mt-2 text-xs">
              💡 Check that your <code className="bg-red-200 px-1 rounded">LIVEAVATAR_API_KEY</code> is set in <code className="bg-red-200 px-1 rounded">.env.local</code>
            </p>
          </div>
        )}
      </div>

      {/* Speech Recognition Status */}
      <div className={`border rounded-lg p-3 shadow-sm ${
        activeProvider === 'deepgram' ? 'bg-green-50 border-green-200' :
        activeProvider === 'browser' ? 'bg-blue-50 border-blue-200' :
        isListeningActive ? 'bg-green-50 border-green-200' :
        'bg-red-50 border-red-200'
      }`}>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            isListeningActive ? 'bg-green-500 animate-pulse' :
            speechSupported ? 'bg-yellow-500' : 'bg-red-500'
          }`}></div>
          <span className="text-sm font-medium text-gray-900">
            {isListeningActive ? '🎤 Listening - Speak Now!' : 
             speechSupported ? '🎤 Speech Recognition Ready' : '❌ Speech Recognition Not Available'}
          </span>
          <span className="text-xs text-gray-600 ml-auto">
            {isListeningActive && activeProvider === 'deepgram' && '(Deepgram Flux ✅)'}
            {isListeningActive && activeProvider === 'browser' && '(Browser API ⚠️)'}
            {!isListeningActive && activeProvider === 'deepgram' && '(Deepgram Flux Ready)'}
            {!isListeningActive && activeProvider === 'browser' && '(Browser API Ready)'}
            {activeProvider === 'none' && '(Not Available)'}
          </span>
        </div>

        {/* Permission Error */}
        {permissionError && (
          <div className="mt-2 p-2 bg-red-100 border border-red-300 rounded text-xs">
            <p className="text-red-800 font-semibold">🔒 Microphone Permission Required</p>
            <p className="text-red-700 mt-1">{permissionError}</p>
          </div>
        )}

        {/* Manual start button */}
        {speechSupported && isConnected && !isListeningActive && (
          <button
            onClick={() => {
              setHasUserInteracted(true);
              setTimeout(() => startListening(), 100);
            }}
            className="mt-2 w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            🎤 Start Listening
          </button>
        )}
      </div>

      {/* Avatar Container */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="aspect-video w-full relative bg-gray-100">
          {!isConnected && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="spinner mx-auto mb-3"></div>
                <p className="text-sm text-gray-600">Connecting to LiveAvatar SDK...</p>
              </div>
            </div>
          )}
          
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-red-50 p-4">
              <div className="text-center bg-white p-6 rounded-lg border border-red-200 max-w-md">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <p className="text-red-700 mb-2 font-semibold">Error</p>
                <p className="text-gray-700 text-sm">{error}</p>
              </div>
            </div>
          )}

          {/* Status Indicator */}
          {isConnected && !error && getStatusIndicator()}

          {/* Video element for avatar */}
          <video
            ref={(node) => {
              videoElementRef.current = node;
              setVideoElement(node);
            }}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
            style={{ display: isConnected ? 'block' : 'none' }}
          />
          
          {/* Fallback message when not connected */}
          {!isConnected && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-gray-500 text-sm">🎤 Connecting...</p>
            </div>
          )}
        </div>
      </div>

      {/* Avatar Audio Capture Status */}
      {isConnected && deepgramApiKey && (
        <div className={`border rounded-lg p-3 shadow-sm ${
          isCapturingAvatar ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-200'
        }`}>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              isCapturingAvatar ? 'bg-purple-500 animate-pulse' : 'bg-gray-400'
            }`}></div>
            <span className="text-sm font-medium text-gray-900">
              {isCapturingAvatar ? '🎧 Capturing Avatar Audio - Real-time Transcription Active!' : '⏳ Avatar Audio Capture Ready'}
            </span>
          </div>
          {isCapturingAvatar && (
            <p className="mt-1 text-xs text-purple-700">
              Avatar responses are being automatically transcribed with Deepgram
            </p>
          )}
        </div>
      )}

      {/* Instructions */}
      <div className="bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-900 mb-2">✨ LiveAvatar SDK Active!</h4>
        <ul className="text-xs text-gray-700 space-y-1">
          <li>✅ <strong>Automatic Transcripts:</strong> Both your speech and avatar responses are transcribed</li>
          <li>✅ <strong>No Manual Steps:</strong> Everything works automatically</li>
          <li>✅ <strong>Real-time:</strong> Transcripts appear instantly as you speak</li>
          <li>✅ <strong>Low Latency:</strong> {AVATAR_CONFIG.latency.silenceDurationMs}ms silence detection for fast responses</li>
          <li>✅ <strong>Interruption:</strong> Start speaking anytime to interrupt the avatar</li>
        </ul>
      </div>
    </div>
  );
}


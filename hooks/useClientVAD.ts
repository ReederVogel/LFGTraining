'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface UseClientVADOptions {
  onSpeechStart?: () => void;
  onSpeechEnd?: (hasAudio: boolean) => void;
  onAudioData?: (audioData: Float32Array) => void;
  enabled?: boolean;
  silenceDurationMs?: number;  // How long to wait before considering speech ended
  silenceThreshold?: number;   // Audio level threshold (0.0 - 1.0)
  suppressLogs?: boolean;     // Suppress console logs until conversation starts
}

/**
 * Client-side Voice Activity Detection hook
 * 
 * This hook provides full control over voice activity detection by analyzing
 * audio directly in the browser. It detects when user starts and stops speaking
 * based on configurable silence duration and threshold.
 * 
 * Features:
 * - Configurable silence detection (default: 800ms for low latency)
 * - Adjustable volume threshold for speech detection
 * - Audio data callback for sending to external services
 * - Prevents premature interruptions by waiting for confirmed silence
 * - Optimized for minimal latency in conversational AI applications
 */
export function useClientVAD({
  onSpeechStart,
  onSpeechEnd,
  onAudioData,
  enabled = true,
  silenceDurationMs = 800,  // Default: 800ms for low latency (reduced from 4000ms)
  silenceThreshold = 0.01,   // Default: 1% of maximum volume
  suppressLogs = false,       // Default: show logs
}: UseClientVADOptions = {}) {
  const [isActive, setIsActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  const isSpeakingRef = useRef(false);
  const lastSpeechTimeRef = useRef<number>(0);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasDetectedSpeechRef = useRef(false);

  // Check browser support
  useEffect(() => {
    const supported = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function' && window.AudioContext);
    setIsSupported(supported);
    if (!supported && !suppressLogs) {
      console.warn('[ClientVAD] Browser does not support required APIs');
    }
  }, [suppressLogs]);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (!suppressLogs) {
      console.log('[ClientVAD] Cleaning up resources');
    }
    
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch (e) {
        // Ignore
      }
      processorRef.current = null;
    }
    
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch (e) {
        // Ignore
      }
      analyserRef.current = null;
    }
    
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {
        // Ignore
      }
      audioContextRef.current = null;
    }
    
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    setIsActive(false);
    setIsSpeaking(false);
    isSpeakingRef.current = false;
    hasDetectedSpeechRef.current = false;
  }, [suppressLogs]);

  // Start VAD
  const start = useCallback(async () => {
    if (!suppressLogs) {
      console.log('[ClientVAD] Starting...', { enabled, isSupported });
    }
    
    if (!enabled || !isSupported) {
      if (!suppressLogs) {
        console.warn('[ClientVAD] Cannot start - not enabled or not supported');
      }
      return;
    }

    // Clean up any existing resources
    cleanup();

    try {
      // Get microphone access
      if (!suppressLogs) {
        console.log('[ClientVAD] Requesting microphone access...');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      mediaStreamRef.current = stream;
      if (!suppressLogs) {
        console.log('[ClientVAD] ✅ Microphone access granted');
      }

      // Create audio context
      const audioContext = new AudioContext({ sampleRate: 48000 });
      audioContextRef.current = audioContext;

      // Create analyser for volume detection
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      
      // Create script processor for audio data
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Send audio data to callback if provided
        if (onAudioData) {
          onAudioData(inputData);
        }
        
        // Calculate RMS (Root Mean Square) for volume detection
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        
        // Detect speech based on volume threshold
        const isSpeechDetected = rms > silenceThreshold;
        
        if (isSpeechDetected) {
          lastSpeechTimeRef.current = Date.now();
          
          // Speech started
          if (!isSpeakingRef.current) {
            if (!suppressLogs) {
              console.log('[ClientVAD] 🎤 Speech started (RMS:', rms.toFixed(4), ')');
            }
            isSpeakingRef.current = true;
            hasDetectedSpeechRef.current = true;
            setIsSpeaking(true);
            onSpeechStart?.();
            
            // Clear any pending silence timer
            if (silenceTimerRef.current) {
              clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = null;
            }
          }
        } else {
          // Silence detected
          if (isSpeakingRef.current) {
            const silenceDuration = Date.now() - lastSpeechTimeRef.current;
            
            // Only start timer once
            if (!silenceTimerRef.current) {
              if (!suppressLogs) {
                console.log('[ClientVAD] 🤫 Silence started, waiting', silenceDurationMs, 'ms...');
              }
              
              silenceTimerRef.current = setTimeout(() => {
                if (isSpeakingRef.current) {
                  if (!suppressLogs) {
                    console.log('[ClientVAD] ✅ Silence confirmed after', silenceDurationMs, 'ms - speech ended');
                  }
                  isSpeakingRef.current = false;
                  setIsSpeaking(false);
                  onSpeechEnd?.(hasDetectedSpeechRef.current);
                  hasDetectedSpeechRef.current = false;
                }
                silenceTimerRef.current = null;
              }, silenceDurationMs);
            }
          }
        }
      };

      // Connect processor
      analyser.connect(processor);
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0; // Silent output
      processor.connect(gainNode);
      gainNode.connect(audioContext.destination);

      setIsActive(true);
      if (!suppressLogs) {
        console.log('[ClientVAD] ✅ VAD active with', silenceDurationMs, 'ms silence detection');
      }

    } catch (error) {
      if (!suppressLogs) {
        console.error('[ClientVAD] ❌ Error starting:', error);
      }
      cleanup();
      throw error;
    }
  }, [enabled, isSupported, silenceDurationMs, silenceThreshold, suppressLogs, onSpeechStart, onSpeechEnd, onAudioData, cleanup]);

  // Stop VAD
  const stop = useCallback(() => {
    if (!suppressLogs) {
      console.log('[ClientVAD] Stopping...');
    }
    cleanup();
  }, [cleanup, suppressLogs]);

  // Auto-start when enabled
  useEffect(() => {
    if (enabled && isSupported && !isActive) {
      start();
    }
    
    return () => {
      if (isActive) {
        stop();
      }
    };
  }, [enabled, isSupported]); // Intentionally limited dependencies to avoid re-starting

  return {
    isActive,
    isSpeaking,
    isSupported,
    start,
    stop,
  };
}


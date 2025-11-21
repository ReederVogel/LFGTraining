'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  addEventListener(type: 'result', listener: (event: SpeechRecognitionEvent) => void): void;
  addEventListener(type: 'end', listener: () => void): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
}

interface Window {
  SpeechRecognition: new () => SpeechRecognition;
  webkitSpeechRecognition: new () => SpeechRecognition;
}

export interface UseSpeechRecognitionOptions {
  onResult?: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  enabled?: boolean;
  lang?: string;
}

export function useSpeechRecognition({
  onResult,
  onError,
  enabled = true,
  lang = 'en-US',
}: UseSpeechRecognitionOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const finalTranscriptRef = useRef('');
  
  // Use refs for callbacks to prevent infinite loops
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  
  // Update refs when callbacks change (without triggering effect)
  useEffect(() => {
    onResultRef.current = onResult;
    onErrorRef.current = onError;
  }, [onResult, onError]);

  useEffect(() => {
    // Check if Speech Recognition is supported
    const SpeechRecognition = (window as unknown as Window).SpeechRecognition || 
                              (window as unknown as Window).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setIsSupported(false);
      console.warn('[SpeechRecognition] Not supported in this browser');
      return;
    }

    setIsSupported(true);
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      console.log('[SpeechRecognition] 🎤 Result event received:', {
        resultIndex: event.resultIndex,
        resultsLength: event.results.length,
      });

      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        const isFinal = event.results[i].isFinal;
        console.log('[SpeechRecognition] 📝 Processing result:', {
          index: i,
          transcript,
          isFinal,
        });

        if (isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }

      console.log('[SpeechRecognition] 📊 Transcripts:', {
        interim: interimTranscript,
        final: finalTranscript,
        hasInterim: !!interimTranscript,
        hasFinal: !!finalTranscript,
      });

      if (finalTranscript) {
        const fullTranscript = (finalTranscriptRef.current + finalTranscript).trim();
        console.log('[SpeechRecognition] ✅ Sending FINAL result:', fullTranscript);
        onResultRef.current?.(fullTranscript, true);
        finalTranscriptRef.current = ''; // Reset after reporting
      } else if (interimTranscript) {
        console.log('[SpeechRecognition] ✅ Sending INTERIM result:', interimTranscript);
        onResultRef.current?.(interimTranscript, false);
      } else {
        console.warn('[SpeechRecognition] ⚠️ No transcript found in result event');
      }
    };

    recognition.onerror = (event: Event) => {
      const errorEvent = event as ErrorEvent;
      const error = errorEvent.error || 'Unknown error';
      
      // Handle permission errors gracefully
      if (error === 'not-allowed' || error === 'Permission denied') {
        console.warn('[SpeechRecognition] ⚠️ Microphone permission denied');
        setIsListening(false);
        onErrorRef.current?.('Microphone permission denied. Please allow microphone access in your browser settings.');
      } else if (error === 'no-speech' || error === 'aborted') {
        // Ignore "no-speech" and "aborted" errors - they're normal
        // "aborted" happens when we stop/start rapidly
        console.log(`[SpeechRecognition] ℹ️ Recognition ${error} (normal)`);
      } else {
        console.error('[SpeechRecognition] Error:', error);
        setIsListening(false);
        onErrorRef.current?.(error);
      }
    };

    recognition.onend = () => {
      console.log('[SpeechRecognition] 🔄 Recognition ended, attempting restart...');
      setIsListening(false);
      // Restart if it was enabled and we want continuous listening
      // Only restart if recognition is still the current one
      if (enabled && recognitionRef.current === recognition) {
        // Add small delay before restarting to avoid race conditions
        setTimeout(() => {
          try {
            if (recognitionRef.current === recognition) {
              recognition.start();
              setIsListening(true);
              console.log('[SpeechRecognition] ✅ Recognition restarted successfully');
            }
          } catch (e) {
            // Log error but don't crash - might already be started
            console.warn('[SpeechRecognition] ⚠️ Failed to restart recognition:', e);
            // Try one more time after longer delay
            setTimeout(() => {
              try {
                if (recognitionRef.current === recognition) {
                  recognition.start();
                  setIsListening(true);
                  console.log('[SpeechRecognition] ✅ Recognition restarted on retry');
                }
              } catch (retryError) {
                console.error('[SpeechRecognition] ❌ Recognition restart failed after retry:', retryError);
                onErrorRef.current?.('Speech recognition stopped. Please refresh the page if you cannot be heard.');
              }
            }, 1000);
          }
        }, 100);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current === recognition) {
        try {
          recognition.stop();
        } catch (e) {
          // Ignore errors
        }
        recognitionRef.current = null;
      }
    };
  }, [lang, enabled]); // Removed onResult and onError from dependencies

  const startListening = useCallback(() => {
    if (!recognitionRef.current || !isSupported) {
      console.warn('[SpeechRecognition] Cannot start - not supported or not initialized', {
        hasRecognition: !!recognitionRef.current,
        isSupported,
      });
      return;
    }

    try {
      console.log('[SpeechRecognition] 🎤 Starting speech recognition...');
      
      // Check if already started (prevent "already started" error)
      // Note: The API doesn't expose an "isStarted" property, but we track it with isListening.
      // However, isListening state updates are async, so we might need a try-catch anyway.
      recognitionRef.current.start();
      
      setIsListening(true);
      finalTranscriptRef.current = ''; // Reset transcript
      console.log('[SpeechRecognition] ✅ Speech recognition started successfully');
    } catch (error: any) {
      // Ignore "already started" errors
      if (error?.message?.includes('already started') || error?.name === 'InvalidStateError') {
         console.log('[SpeechRecognition] ⚠️ Already started (ignoring)');
         setIsListening(true); // Ensure state is synced
         return;
      }
      
      console.error('[SpeechRecognition] ❌ Error starting:', error);
      setIsListening(false);
    }
  }, [isSupported]);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;

    try {
      recognitionRef.current.stop();
      setIsListening(false);
    } catch (error) {
      console.error('[SpeechRecognition] Error stopping:', error);
    }
  }, []);

  const reset = useCallback(() => {
    finalTranscriptRef.current = '';
  }, []);

  return {
    isListening,
    isSupported,
    startListening,
    stopListening,
    reset,
  };
}


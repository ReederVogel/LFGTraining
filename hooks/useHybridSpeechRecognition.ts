'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useDeepgramSpeechRecognition } from './useDeepgramSpeechRecognition';
import { useSpeechRecognition } from './useSpeechRecognition';

export interface UseHybridSpeechRecognitionOptions {
  onResult?: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onStatusChange?: (status: string) => void;
  enabled?: boolean;
  apiKey?: string;
  lang?: string;
  preferDeepgram?: boolean; // Default true - try Deepgram first
}

export function useHybridSpeechRecognition({
  onResult,
  onError,
  onStatusChange,
  enabled = true,
  apiKey,
  lang = 'en-US',
  preferDeepgram = true,
}: UseHybridSpeechRecognitionOptions = {}) {
  const [activeProvider, setActiveProvider] = useState<'deepgram' | 'browser' | 'none'>('none');
  const [isListening, setIsListening] = useState(false);
  const hasTriedDeepgram = useRef(false);
  const startTimeRef = useRef<number>(0);

  // Deepgram temporarily disabled to avoid Flux WebSocket errors.
  // Always use browser speech recognition only.
  const useDeepgram = false;

  const handleDeepgramResult = useCallback((text: string, isFinal: boolean) => {
    console.log('[HybridSpeech] 📝 Deepgram result:', { text, isFinal });
    onResult?.(text, isFinal);
  }, [onResult]);

  const handleBrowserResult = useCallback((text: string, isFinal: boolean) => {
    console.log('[HybridSpeech] 📝 Browser result:', { text, isFinal });
    onResult?.(text, isFinal);
  }, [onResult]);

  const handleBrowserError = useCallback((error: string) => {
    // Handle permission errors with user-friendly message
    if (error.includes('not-allowed') || error.includes('Permission denied') || error.includes('permission denied')) {
      console.warn('[HybridSpeech] ⚠️ Microphone permission denied');
      onError?.('Microphone permission denied. Please click the browser\'s microphone icon in the address bar and allow access.');
    } else if (error === 'no-speech' || error === 'aborted') {
      // Ignore "no-speech" and "aborted" errors - they're normal
      console.log(`[HybridSpeech] ℹ️ Browser recognition ${error} (normal)`);
    } else {
      console.error('[HybridSpeech] ❌ Browser speech recognition error:', error);
      onError?.(`Speech recognition error: ${error}`);
    }
  }, [onError]);

  // Initialize browser speech recognition hook FIRST (before Deepgram error handler)
  // Always initialize browser for fallback, but don't auto-start if Deepgram is preferred
  const browser = useSpeechRecognition({
    onResult: handleBrowserResult,
    onError: handleBrowserError,
    enabled: enabled && !useDeepgram, // Only auto-start if not using Deepgram, but hook is always initialized
    lang,
  });

  // Now define Deepgram error handler with access to browser
  const handleDeepgramError = useCallback((error: string) => {
    console.error('[HybridSpeech] ❌ Deepgram error:', error);
    
    // If Deepgram fails, IMMEDIATELY fall back to browser
    if (activeProvider === 'deepgram' || !hasTriedDeepgram.current) {
      console.log('[HybridSpeech] 🔄 IMMEDIATELY falling back to browser speech recognition...');
      setActiveProvider('browser');
      onStatusChange?.('Using browser speech recognition (Deepgram unavailable)');
      hasTriedDeepgram.current = true;
      
      // Auto-start browser recognition when falling back (even if it was disabled initially)
      if (browser.isSupported) {
        setTimeout(() => {
          try {
            // Browser hook is initialized but might be disabled - startListening should still work
            browser.startListening();
            console.log('[HybridSpeech] ✅ Browser fallback started successfully');
          } catch (e) {
            console.error('[HybridSpeech] Error starting browser fallback:', e);
            // If startListening fails, try enabling browser hook first
            console.log('[HybridSpeech] 🔄 Attempting to enable browser hook...');
          }
        }, 100);
      } else {
        console.warn('[HybridSpeech] ⚠️ Browser not supported, cannot fallback');
      }
    }
    
    onError?.(error);
  }, [activeProvider, onError, onStatusChange, browser, enabled]);

  // Initialize Deepgram hook
  const deepgram = useDeepgramSpeechRecognition({
    onResult: handleDeepgramResult,
    onError: handleDeepgramError,
    enabled: useDeepgram,
    apiKey,
    lang,
  });

  // Determine which provider to use
  useEffect(() => {
    console.log('[HybridSpeech] 🔍 Provider selection:', {
      enabled,
      useDeepgram,
      hasApiKey: !!apiKey,
      deepgramSupported: deepgram.isSupported,
      browserSupported: browser.isSupported,
      preferDeepgram,
    });
    
    let newProvider: 'deepgram' | 'browser' | 'none';
    let statusMessage: string | undefined;
    let errorMessage: string | undefined;
    
    if (!enabled) {
      console.log('[HybridSpeech] ⚠️ Speech recognition not enabled');
      newProvider = 'none';
    } else if (useDeepgram && deepgram.isSupported) {
      console.log('[HybridSpeech] ✅ Using Deepgram Flux');
      newProvider = 'deepgram';
      statusMessage = 'Using Deepgram (high accuracy)';
    } else if (browser.isSupported) {
      console.log('[HybridSpeech] ✅ Using browser speech recognition');
      if (useDeepgram) {
        console.warn('[HybridSpeech] ⚠️ Deepgram not supported, falling back to browser');
      }
      newProvider = 'browser';
      statusMessage = 'Using browser speech recognition';
    } else {
      console.error('[HybridSpeech] ❌ No speech recognition available');
      newProvider = 'none';
      statusMessage = 'Speech recognition not available';
      errorMessage = 'Speech recognition not supported in this browser';
    }
    
    // CRITICAL FIX: Only update state if it actually changed to prevent infinite loops
    setActiveProvider(prev => {
      if (prev !== newProvider) {
        return newProvider;
      }
      return prev;
    });
    
    // Call callbacks after state update (but only if provider changed)
    if (statusMessage) {
      onStatusChange?.(statusMessage);
    }
    if (errorMessage) {
      onError?.(errorMessage);
    }
  }, [
    enabled,
    useDeepgram,
    deepgram.isSupported,
    browser.isSupported,
    // REMOVED onStatusChange and onError from dependencies - they're callbacks that shouldn't trigger re-runs
    // If they change, it's fine - we'll use the latest version via closure
  ]);

  // Monitor listening state
  useEffect(() => {
    const listening = activeProvider === 'deepgram' ? deepgram.isListening : 
                     activeProvider === 'browser' ? browser.isListening : 
                     false;
    setIsListening(listening);
  }, [activeProvider, deepgram.isListening, browser.isListening]);

  // Fallback timer - if Deepgram doesn't connect within 2 seconds, try browser (faster fallback)
  useEffect(() => {
    if (activeProvider === 'deepgram' && enabled && !deepgram.isListening) {
      const timer = setTimeout(() => {
        if (!deepgram.isListening && !hasTriedDeepgram.current && browser.isSupported) {
          console.log('[HybridSpeech] ⏱️ Deepgram timeout (2s) - falling back to browser');
          setActiveProvider('browser');
          onStatusChange?.('Using browser speech recognition (Deepgram timeout)');
          hasTriedDeepgram.current = true;
          // Auto-start browser recognition when falling back (even if it was disabled initially)
          try {
            browser.startListening();
            console.log('[HybridSpeech] ✅ Browser timeout fallback started');
          } catch (e) {
            console.error('[HybridSpeech] Error starting browser timeout fallback:', e);
          }
        }
      }, 2000); // Reduced from 3000ms to 2000ms for faster fallback

      return () => clearTimeout(timer);
    }
  }, [
    activeProvider,
    enabled,
    deepgram.isListening,
    browser.isSupported,
    browser,
    onStatusChange,
  ]);

  const startListening = useCallback(() => {
    console.log('[HybridSpeech] 🎤 Starting listening...', { activeProvider });
    startTimeRef.current = Date.now();
    
    if (activeProvider === 'deepgram') {
      deepgram.startListening();
    } else if (activeProvider === 'browser') {
      browser.startListening();
    } else {
      console.warn('[HybridSpeech] ⚠️ No provider available');
    }
  }, [activeProvider, deepgram, browser]);

  const stopListening = useCallback(() => {
    console.log('[HybridSpeech] 🛑 Stopping listening...', { activeProvider });
    
    if (activeProvider === 'deepgram') {
      deepgram.stopListening();
    } else if (activeProvider === 'browser') {
      browser.stopListening();
    }
  }, [activeProvider, deepgram, browser]);

  return {
    isListening,
    isSupported: activeProvider !== 'none',
    activeProvider,
    startListening,
    stopListening,
    deepgramAvailable: deepgram.isSupported,
    browserAvailable: browser.isSupported,
  };
}


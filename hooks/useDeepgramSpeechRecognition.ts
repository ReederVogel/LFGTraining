'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface UseDeepgramSpeechRecognitionOptions {
  onResult?: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  enabled?: boolean;
  apiKey?: string;
  lang?: string;
}

export function useDeepgramSpeechRecognition({
  onResult,
  onError,
  enabled = true,
  apiKey,
  lang = 'en-US',
}: UseDeepgramSpeechRecognitionOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const interimTranscriptRef = useRef('');

  useEffect(() => {
    console.log('[Deepgram Flux] 🔍 Initialization check:', {
      enabled,
      hasApiKey: !!apiKey,
      apiKeyPreview: apiKey ? `${apiKey.substring(0, 8)}...` : 'none',
      hasMediaDevices: !!navigator.mediaDevices,
      hasAudioContext: !!window.AudioContext,
    });
    
    if (!enabled || !apiKey) {
      setIsSupported(false);
      console.warn('[Deepgram Flux] ❌ Not enabled or API key missing', { 
        enabled, 
        hasApiKey: !!apiKey,
        reason: !enabled ? 'Not enabled' : 'API key missing'
      });
      return;
    }

    // Check if browser supports required APIs
    if (!navigator.mediaDevices || !window.AudioContext) {
      setIsSupported(false);
      console.error('[Deepgram Flux] ❌ Required APIs not supported in this browser');
      return;
    }

    setIsSupported(true);
    console.log('[Deepgram Flux] ✅ Hook initialized and supported');

    return () => {
      // Cleanup will be handled by stopListening function
    };
  }, [enabled, apiKey]);

  const stopListening = useCallback(() => {
    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch (e) {
        // Ignore errors
      }
      socketRef.current = null;
    }
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch (e) {
        // Ignore errors
      }
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {
        // Ignore errors
      }
      audioContextRef.current = null;
    }
    setIsListening(false);
    interimTranscriptRef.current = '';
  }, []);

  const startListening = useCallback(async () => {
    console.log('[Deepgram Flux] startListening called', { hasApiKey: !!apiKey, isSupported });
    
    if (!apiKey || !isSupported) {
      console.warn('[Deepgram Flux] Cannot start - API key missing or not supported', {
        hasApiKey: !!apiKey,
        isSupported,
      });
      return;
    }

    // Clean up any existing connections
    stopListening();

    try {
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      mediaStreamRef.current = stream;

      // Create audio context
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      
      // Create script processor for audio chunks (legacy API but works everywhere)
      // Using 2048 samples at 16kHz = ~128ms chunks (close to recommended 80ms)
      // Flux recommends 80ms chunks for optimal performance
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      let audioChunkCount = 0;
      processor.onaudioprocess = (e) => {
        if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        
        // Check if there's actual audio data (not just silence)
        const hasAudio = inputData.some(sample => Math.abs(sample) > 0.01);
        
        const buffer = new Int16Array(inputData.length);
        
        // Convert float32 to int16
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Send audio data to Deepgram as binary (Int16Array)
        // Deepgram Flux expects linear16 PCM audio data
        if (socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(buffer.buffer);
          audioChunkCount++;
          
          // Log every 25 chunks (roughly every 3 seconds at 128ms/chunk) to verify audio is being sent
          if (audioChunkCount % 25 === 0) {
            console.log('[Deepgram Flux] 🎵 Audio chunks sent:', audioChunkCount, 'Has audio:', hasAudio);
          }
        }
      };

      source.connect(processor);
      // Connect processor to a silent gain node to complete the audio graph
      // ScriptProcessorNode requires a connection to work
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0; // Silent - no audio output
      processor.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Connect to Deepgram Flux WebSocket (v2 API)
      // Flux Documentation: https://developers.deepgram.com/docs/flux/quickstart
      // Flux is specifically designed for conversational STT with turn-taking detection
      
      // Use Flux model for English (required for v2 endpoint with turn detection)
      const model = 'flux-general-en';
      
      // Build Deepgram Flux WebSocket URL
      // Per Deepgram docs the API key must be provided as a WebSocket subprotocol.
      // Keeping the token out of the URL prevents accidental leaks and matches
      // https://developers.deepgram.com/docs/live-streaming-audio guidance.
      const params = new URLSearchParams({
        model: model,
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
        punctuate: 'true',
        interim_results: 'true',
        // Flux-specific parameters for turn-taking detection
        eot_threshold: '0.7',           // End-of-turn confidence (0.5-0.9, default 0.7)
        eot_timeout_ms: '5000',         // Max silence before forcing end-of-turn (default 5000ms)
        // Optional: Enable eager end-of-turn for faster responses
        // eager_eot_threshold: '0.5',  // Uncomment to enable early response generation
      });
      
      const socketUrl = `wss://api.deepgram.com/v2/listen?${params.toString()}`;
      
      console.log('[Deepgram Flux] 🔗 Connecting to Deepgram Flux (v2 API)...');
      console.log('[Deepgram Flux] URL:', socketUrl);
      console.log('[Deepgram Flux] Auth: using WebSocket subprotocol for token');
      
      // Create WebSocket connection with Deepgram token as subprotocol
      const socket = new WebSocket(socketUrl, ['token', apiKey]);
      socketRef.current = socket;

      socket.onopen = () => {
        setIsListening(true);
        console.log('[Deepgram Flux] ✅ WebSocket Connected Successfully');
        console.log('[Deepgram Flux] 🎤 Starting audio capture with Flux model...');
        console.log('[Deepgram Flux] 📊 Audio setup:', {
          hasStream: !!mediaStreamRef.current,
          streamActive: mediaStreamRef.current?.active,
          audioTracks: mediaStreamRef.current?.getAudioTracks().length,
          audioContextState: audioContext.state,
          model: 'flux-general-en',
          endpoint: 'v2/listen',
        });
        
        // Verify audio is being processed
        setTimeout(() => {
          console.log('[Deepgram Flux] 🔍 Audio check after 2s:', {
            socketReady: socket.readyState === WebSocket.OPEN,
            isListening,
            audioContextState: audioContext.state,
            processorConnected: !!processorRef.current,
          });
        }, 2000);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Log all messages for debugging (Flux v2 API)
          console.log('[Deepgram Flux] 📨 Raw message received:', data);
          
          // Deepgram Flux WebSocket response format (v2 API):
          // { type: 'Results', channel: { alternatives: [{ transcript: '...' }] }, is_final: true/false }
          // Flux-specific events: EndOfTurn, EagerEndOfTurn, TurnResumed, SpeechStarted
          
          if (data.type === 'Results') {
            const transcript = data.channel?.alternatives?.[0]?.transcript || '';
            const isFinal = data.is_final === true;
            const confidence = data.channel?.alternatives?.[0]?.confidence;
            
            console.log('[Deepgram Flux] 📝 Processing Results:', { 
              transcript, 
              transcriptLength: transcript.length,
              isFinal, 
              hasTranscript: !!transcript,
              confidence,
              rawData: data
            });
            
            if (transcript && transcript.trim()) {
              if (isFinal) {
                // Final result - send complete transcript
                const fullText = interimTranscriptRef.current ? 
                  (interimTranscriptRef.current + ' ' + transcript).trim() : 
                  transcript.trim();
                console.log('[Deepgram Flux] ✅ Final transcript:', fullText);
                console.log('[Deepgram Flux] 📤 Calling onResult with final=true');
                onResult?.(fullText, true);
                interimTranscriptRef.current = '';
              } else {
                // Interim result - update and send
                interimTranscriptRef.current = transcript;
                console.log('[Deepgram Flux] 🔄 Interim transcript:', transcript);
                console.log('[Deepgram Flux] 📤 Calling onResult with final=false');
                onResult?.(transcript.trim(), false);
              }
            } else {
              console.log('[Deepgram Flux] ⚠️ Empty transcript in Results', data);
            }
          } else if (data.type === 'Metadata') {
            // Connection metadata
            console.log('[Deepgram Flux] 📊 Metadata received:', data);
          } else if (data.type === 'SpeechStarted') {
            console.log('[Deepgram Flux] 🎤 Speech started - user began speaking');
          } else if (data.type === 'UtteranceEnd') {
            console.log('[Deepgram Flux] 🛑 Utterance ended - speech segment complete');
          } else if (data.type === 'EndOfTurn') {
            // Flux-specific: Speaker finished their turn (high confidence)
            console.log('[Deepgram Flux] 🔚 EndOfTurn detected - speaker finished speaking');
            console.log('[Deepgram Flux] 📊 EndOfTurn details:', {
              confidence: data.confidence,
              duration: data.duration_ms,
            });
          } else if (data.type === 'EagerEndOfTurn') {
            // Flux-specific: Early turn detection (for faster LLM response prep)
            console.log('[Deepgram Flux] ⚡ EagerEndOfTurn detected - early turn signal');
          } else if (data.type === 'TurnResumed') {
            // Flux-specific: User continued speaking after eager detection
            console.log('[Deepgram Flux] 🔄 TurnResumed - user continued speaking');
          } else {
            // Log unknown message types for debugging
            console.log('[Deepgram Flux] ❓ Unknown message type:', data.type, data);
          }
        } catch (error) {
          console.error('[Deepgram Flux] ❌ Error parsing message:', error);
          console.error('[Deepgram Flux] Raw event data:', event.data);
        }
      };

      socket.onerror = (error) => {
        console.error('[Deepgram Flux] ❌ WebSocket error:', error);
        console.error('[Deepgram Flux] Error details:', {
          type: error.type,
          target: error.target,
        });
        setIsListening(false);
        onError?.('Deepgram Flux connection error - check API key and network');
      };

      socket.onclose = (event) => {
        setIsListening(false);
        console.log('[Deepgram Flux] 🔌 WebSocket Closed', { 
          code: event.code, 
          reason: event.reason,
          wasClean: event.wasClean 
        });
        if (event.code !== 1000 && event.code !== 1001) {
          // Unexpected close (1000 = normal closure, 1001 = going away)
          console.error('[Deepgram Flux] ❌ Unexpected close:', event.code, event.reason);
          onError?.(`Deepgram Flux connection closed: ${event.code} ${event.reason || 'Unknown reason'}`);
        }
      };

    } catch (error) {
      console.error('[Deepgram Flux] Error starting:', error);
      setIsListening(false);
      
      // Handle permission errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Permission denied') || errorMessage.includes('NotAllowedError') || errorMessage.includes('not-allowed')) {
        onError?.('Microphone permission denied. Please allow microphone access in your browser settings.');
      } else {
        onError?.(errorMessage || 'Failed to start Deepgram Flux');
      }
    }
  }, [apiKey, isSupported, onResult, onError, lang, stopListening]);

  return {
    isListening,
    isSupported,
    startListening,
    stopListening,
  };
}


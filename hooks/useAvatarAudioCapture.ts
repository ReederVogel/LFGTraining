'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface UseAvatarAudioCaptureOptions {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  enabled?: boolean;
  deepgramApiKey?: string;
  audioElement?: HTMLVideoElement | HTMLAudioElement | null;
  videoElement?: HTMLVideoElement | null;
}

export function useAvatarAudioCapture({
  onTranscript,
  onError,
  enabled = true,
  deepgramApiKey,
  audioElement,
  videoElement,
}: UseAvatarAudioCaptureOptions) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const elementRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const isStartingRef = useRef<boolean>(false); // Prevent concurrent startCapture calls
  
  // Accumulation buffer for avatar transcripts
  const accumulatedTranscriptRef = useRef<string>('');
  const lastTranscriptTimeRef = useRef<number>(0);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const utteranceEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Check if AudioContext is supported
    const supported = !!(window.AudioContext || (window as any).webkitAudioContext);
    setIsSupported(supported);
    console.log('[AvatarAudioCapture] Supported:', supported);
  }, []);

  const stopCapture = useCallback(() => {
    console.log('[AvatarAudioCapture] Stopping capture...');
    
    // Clear all timeouts
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    if (utteranceEndTimeoutRef.current) {
      clearTimeout(utteranceEndTimeoutRef.current);
      utteranceEndTimeoutRef.current = null;
    }
    
    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch (e) {
        console.error('[AvatarAudioCapture] Error closing socket:', e);
      }
      socketRef.current = null;
    }
    
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch (e) {
        console.error('[AvatarAudioCapture] Error disconnecting processor:', e);
      }
      processorRef.current = null;
    }
    
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch (e) {
        console.error('[AvatarAudioCapture] Error disconnecting source:', e);
      }
      sourceRef.current = null;
    }
    
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close();
      } catch (e) {
        console.error('[AvatarAudioCapture] Error closing audio context:', e);
      }
      audioContextRef.current = null;
    }
    
    // Clear element reference
    elementRef.current = null;
    
    // Clear accumulated transcript
    accumulatedTranscriptRef.current = '';
    
    // Reset starting flag
    isStartingRef.current = false;
    
    setIsCapturing(false);
    console.log('[AvatarAudioCapture] ✅ Stopped capturing avatar audio');
  }, []);

  const startCapture = useCallback(async () => {
    const element = audioElement || videoElement;
    
    if (!enabled || !isSupported || !deepgramApiKey || !element) {
      const reason = !enabled ? 'disabled' : 
                     !isSupported ? 'not supported' : 
                     !deepgramApiKey ? 'no API key' : 
                     !element ? 'no element' : 'unknown';
      console.warn('[AvatarAudioCapture] ❌ Cannot start:', reason, {
        enabled,
        isSupported,
        hasApiKey: !!deepgramApiKey,
        hasElement: !!element,
      });
      
      // Only show error if API key is missing (not if just disabled)
      if (!deepgramApiKey && enabled) {
        onError?.('Deepgram API key is missing. Avatar audio capture disabled. Transcripts will still work via SDK.');
      }
      return;
    }
    
    // Basic API key validation (just check it's not empty - format validation happens on connection)
    if (deepgramApiKey.trim().length < 10) {
      console.warn('[AvatarAudioCapture] ⚠️ Deepgram API key appears too short');
      onError?.('Deepgram API key appears invalid. Please check your API key in .env.local');
      return;
    }

    // Prevent concurrent calls
    if (isStartingRef.current) {
      console.log('[AvatarAudioCapture] ⚠️ Start capture already in progress, skipping...');
      return;
    }

    // Check if we're already capturing from this exact element
    if (elementRef.current === element && sourceRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
      console.log('[AvatarAudioCapture] ⚠️ Already capturing from this element, skipping...');
      return;
    }

    // If element changed, stop previous capture first
    if (elementRef.current && elementRef.current !== element) {
      console.log('[AvatarAudioCapture] 🔄 Element changed, stopping previous capture...');
      stopCapture();
      // Wait a bit for cleanup
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    isStartingRef.current = true;

    try {
      console.log('[AvatarAudioCapture] 🎤 Starting automatic avatar audio capture...');
      
      // Store element reference
      elementRef.current = element;

      // Reuse existing audio context if available and not closed
      let audioContext = audioContextRef.current;
      if (!audioContext || audioContext.state === 'closed') {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContext = new AudioContextClass({ sampleRate: 16000 });
        audioContextRef.current = audioContext;
      }

      // Check if element already has a MediaElementSourceNode
      // We can't directly check this, but we can try to create one and catch the error
      let source = sourceRef.current;
      
      // Only create a new source if we don't have one for this exact element
      if (!source || elementRef.current !== element) {
        try {
          console.log('[AvatarAudioCapture] 📺 Creating audio source from element...');
          source = audioContext.createMediaElementSource(element);
          sourceRef.current = source;
        } catch (error: any) {
          // If element already has a source, we can't capture from it
          // This happens if the SDK or another component already created a source
          if (error.message && error.message.includes('already connected')) {
            console.warn('[AvatarAudioCapture] ⚠️ Element already has a MediaElementSourceNode. This usually means the LiveAvatar SDK is using it. Audio capture will rely on SDK transcript callbacks.');
            // Don't throw - just skip audio capture and rely on SDK callbacks
            isStartingRef.current = false;
            return;
          }
          throw error;
        }
      } else {
        console.log('[AvatarAudioCapture] ♻️ Reusing existing audio source');
      }

      // Create script processor for audio chunks
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      // Create gain node to allow audio playback while capturing
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 1.0; // Keep audio audible

      // Connect: source -> processor -> gain -> destination
      source.connect(processor);
      processor.connect(gainNode);
      gainNode.connect(audioContext.destination);

      console.log('[AvatarAudioCapture] ✅ Audio graph created');

      // Connect to Deepgram for transcription with highly optimized parameters
      const params = new URLSearchParams({
        model: 'nova-2',
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
        punctuate: 'true',
        interim_results: 'true',
        smart_format: 'true',
        utterance_end_ms: '2000',  // Increased to 2s for smoother sentence detection
        endpointing: '1200',       // 1.2s to ensure complete thoughts
        vad_events: 'true',        // Enable voice activity detection events
        filler_words: 'false',     // Remove filler words for cleaner transcripts
        profanity_filter: 'false', // Keep authentic responses
      });
      
      const socketUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
      console.log('[AvatarAudioCapture] 🔗 Connecting to Deepgram...');
      console.log('[AvatarAudioCapture] URL:', socketUrl);
      const socket = new WebSocket(socketUrl, ['token', deepgramApiKey]);
      socketRef.current = socket;

      socket.onopen = () => {
        console.log('[AvatarAudioCapture] ✅ Connected to Deepgram');
        setIsCapturing(true);
      };

      // Function to send accumulated transcript
      const sendAccumulatedTranscript = () => {
        if (accumulatedTranscriptRef.current.trim()) {
          const fullTranscript = accumulatedTranscriptRef.current.trim();
          console.log('[AvatarAudioCapture] ✅ Sending complete avatar response:', {
            text: fullTranscript,
            length: fullTranscript.length,
            wordCount: fullTranscript.split(' ').length
          });
          
          // Send as final transcript
          onTranscript?.(fullTranscript, true);
          
          // Clear accumulated transcript
          accumulatedTranscriptRef.current = '';
        }
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'Results') {
            const transcript = data.channel?.alternatives?.[0]?.transcript || '';
            const isFinal = data.is_final === true;
            const speechFinal = data.speech_final === true;
            
            if (transcript && transcript.trim()) {
              const now = Date.now();
              lastTranscriptTimeRef.current = now;
              
              console.log('[AvatarAudioCapture] 🎤 Avatar audio chunk:', { 
                transcript: transcript.substring(0, 50) + (transcript.length > 50 ? '...' : ''),
                isFinal,
                speechFinal,
                length: transcript.length,
                accumulated: accumulatedTranscriptRef.current.length
              });
              
              // Accumulate ALL transcripts (both interim and final) to ensure nothing is missed
              // This ensures that even if some parts don't get marked as final, they're still captured
              const trimmedTranscript = transcript.trim();
              if (trimmedTranscript) {
                // For final results, always add them (they're the authoritative version)
                // For interim results, add them if they're new content (not already included)
                if (isFinal) {
                  // Final results: add with space separator
                  if (accumulatedTranscriptRef.current) {
                    accumulatedTranscriptRef.current += ' ' + trimmedTranscript;
                  } else {
                    accumulatedTranscriptRef.current = trimmedTranscript;
                  }
                } else {
                  // Interim results: only add if they extend the current text
                  // This prevents duplicate interim updates from overwriting each other
                  const currentLower = accumulatedTranscriptRef.current.toLowerCase();
                  const newLower = trimmedTranscript.toLowerCase();
                  if (!currentLower.includes(newLower)) {
                    // Check if new text extends current text (common case)
                    if (currentLower && newLower.startsWith(currentLower.substring(0, Math.max(0, currentLower.length - 20)))) {
                      // New text extends current, replace with longer version
                      accumulatedTranscriptRef.current = trimmedTranscript;
                    } else if (!accumulatedTranscriptRef.current) {
                      // No current text, use interim as starting point
                      accumulatedTranscriptRef.current = trimmedTranscript;
                    }
                    // Otherwise, keep current accumulated text (final takes precedence)
                  }
                }
                
                console.log('[AvatarAudioCapture] 📝 Accumulated:', accumulatedTranscriptRef.current.substring(0, 100) + '...');
              }
              
              // Clear any existing silence timeout
              if (silenceTimeoutRef.current) {
                clearTimeout(silenceTimeoutRef.current);
                silenceTimeoutRef.current = null;
              }
              
              // Set timeout to detect end of avatar speech
              // If no more transcripts come in for 2 seconds, consider speech complete
              // Matches the utterance_end_ms parameter for consistency
              silenceTimeoutRef.current = setTimeout(() => {
                console.log('[AvatarAudioCapture] 🔇 Avatar stopped speaking (2s silence detected)');
                sendAccumulatedTranscript();
              }, 2000); // Increased from 1500ms to 2000ms
              
              // If Deepgram indicates speech_final, also send immediately
              if (speechFinal) {
                console.log('[AvatarAudioCapture] 🎯 Speech final detected by Deepgram');
                if (silenceTimeoutRef.current) {
                  clearTimeout(silenceTimeoutRef.current);
                  silenceTimeoutRef.current = null;
                }
                sendAccumulatedTranscript();
              }
            }
          } else if (data.type === 'UtteranceEnd') {
            // Deepgram detected end of utterance
            console.log('[AvatarAudioCapture] 🛑 Utterance end detected by Deepgram');
            if (silenceTimeoutRef.current) {
              clearTimeout(silenceTimeoutRef.current);
              silenceTimeoutRef.current = null;
            }
            sendAccumulatedTranscript();
          }
        } catch (error) {
          console.error('[AvatarAudioCapture] ❌ Error parsing message:', error);
        }
      };

      socket.onerror = (error) => {
        console.error('[AvatarAudioCapture] ❌ WebSocket error:', error);
        // Check if it's an authentication error
        const errorMessage = deepgramApiKey 
          ? 'Failed to connect to Deepgram. Check your API key and network connection.'
          : 'Deepgram API key is missing. Avatar audio capture disabled.';
        onError?.(errorMessage);
        stopCapture();
      };

      socket.onclose = (event) => {
        console.log('[AvatarAudioCapture] 🔌 WebSocket closed', { 
          code: event.code, 
          reason: event.reason,
          wasClean: event.wasClean
        });
        
        // Only report error if it wasn't a clean close
        if (!event.wasClean && event.code !== 1000) {
          let errorMessage = 'Deepgram connection closed unexpectedly';
          if (event.code === 1006) {
            errorMessage = 'Deepgram connection failed. Check your API key and network connection.';
          } else if (event.code === 4001) {
            errorMessage = 'Deepgram authentication failed. Please check your API key.';
          } else if (event.code === 4004) {
            errorMessage = 'Deepgram API key is invalid or expired.';
          }
          console.warn('[AvatarAudioCapture] ⚠️', errorMessage);
          // Don't call onError here - it's already been called in onerror
        }
        
        setIsCapturing(false);
      };

      // Process audio chunks
      let chunkCount = 0;
      processor.onaudioprocess = (e) => {
        if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        const buffer = new Int16Array(inputData.length);
        
        // Convert float32 to int16
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        socketRef.current.send(buffer.buffer);
        
        chunkCount++;
        // Log every 50 chunks (~6 seconds) to verify audio is flowing
        if (chunkCount % 50 === 0) {
          const hasAudio = inputData.some(sample => Math.abs(sample) > 0.01);
          console.log('[AvatarAudioCapture] 🎵 Processing audio chunks:', chunkCount, 'Has audio:', hasAudio);
        }
      };

      console.log('[AvatarAudioCapture] ✅ Successfully started capturing avatar audio!');
      isStartingRef.current = false;

    } catch (error) {
      console.error('[AvatarAudioCapture] ❌ Error starting capture:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to capture audio';
      onError?.(errorMessage);
      stopCapture();
      isStartingRef.current = false;
    }
  }, [enabled, isSupported, deepgramApiKey, audioElement, videoElement, onTranscript, onError, stopCapture]);

  // Auto-start when element becomes available - optimized for speed
  useEffect(() => {
    const element = audioElement || videoElement;
    
    // Don't start if already capturing or starting
    if (!enabled || !isSupported || !deepgramApiKey || !element || isCapturing || isStartingRef.current) {
      return;
    }

    // Check if we're already set up for this element
    if (elementRef.current === element && sourceRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Start immediately if element is ready, otherwise wait
    const startWhenReady = () => {
      if (element.readyState >= 2) { // HAVE_CURRENT_DATA or better
        console.log('[AvatarAudioCapture] Element ready, starting capture...');
        startCapture();
      } else {
        console.log('[AvatarAudioCapture] Waiting for element data...');
        // Use multiple events to capture as soon as possible
        const handleReady = () => {
          if (!isStartingRef.current && elementRef.current !== element) {
            console.log('[AvatarAudioCapture] Element data loaded, starting...');
            startCapture();
          }
        };
        element.addEventListener('loadeddata', handleReady, { once: true });
        element.addEventListener('canplay', handleReady, { once: true });
        
        // Also try after short delay as fallback
        setTimeout(() => {
          if (!isCapturing && !isStartingRef.current && element.readyState >= 1 && elementRef.current !== element) {
            console.log('[AvatarAudioCapture] Starting after delay fallback...');
            startCapture();
          }
        }, 300);
      }
    };

    startWhenReady();
  }, [enabled, isSupported, deepgramApiKey, audioElement, videoElement, isCapturing, startCapture]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, [stopCapture]);

  return {
    isCapturing,
    isSupported,
    startCapture,
    stopCapture,
  };
}

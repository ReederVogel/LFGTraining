'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface UseTabAudioCaptureOptions {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  enabled?: boolean;
  deepgramApiKey?: string;
}

export function useTabAudioCapture({
  onTranscript,
  onError,
  enabled = true,
  deepgramApiKey,
}: UseTabAudioCaptureOptions) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    // Check if getDisplayMedia with audio is supported
    const supported = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
    setIsSupported(supported);
    console.log('[TabAudioCapture] Supported:', supported);
  }, []);

  const stopCapture = useCallback(() => {
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
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {
        // Ignore errors
      }
      audioContextRef.current = null;
    }
    setIsCapturing(false);
    console.log('[TabAudioCapture] ✅ Stopped capturing avatar audio');
  }, []);

  const startCapture = useCallback(async () => {
    if (!enabled || !isSupported || !deepgramApiKey) {
      console.warn('[TabAudioCapture] ❌ Cannot start - not enabled, supported, or missing API key', {
        enabled,
        isSupported,
        hasApiKey: !!deepgramApiKey,
      });
      return;
    }

    try {
      console.log('[TabAudioCapture] 🎤 Requesting tab audio capture...');
      
      // Request screen/tab capture with audio
      // User will be prompted to select which tab/window to capture
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // Need video track for tab capture, we'll ignore it
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as any,
      });

      // Stop video track immediately since we only want audio
      stream.getVideoTracks().forEach(track => track.stop());

      // Check if we got audio
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio track available. Please select a tab with audio and check "Share tab audio" when prompted.');
      }

      streamRef.current = stream;
      console.log('[TabAudioCapture] ✅ Audio stream captured from tab');
      console.log('[TabAudioCapture] 📊 Audio tracks:', audioTracks.length);

      // Create audio context
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      // Connect to Deepgram
      const params = new URLSearchParams({
        model: 'nova-2',
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
        punctuate: 'true',
        interim_results: 'true',
        smart_format: 'true',
      });
      
      const socketUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
      console.log('[TabAudioCapture] 🔗 Connecting to Deepgram via browser WebSocket...');
      console.log('[TabAudioCapture] URL:', socketUrl);
      const socket = new WebSocket(socketUrl, ['token', deepgramApiKey]);
      socketRef.current = socket;

      socket.onopen = () => {
        console.log('[TabAudioCapture] ✅ Connected to Deepgram for avatar transcription');
        setIsCapturing(true);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'Results') {
            const transcript = data.channel?.alternatives?.[0]?.transcript || '';
            const isFinal = data.is_final === true;
            
            if (transcript && transcript.trim()) {
              console.log('[TabAudioCapture] 🎵 Avatar transcript:', { 
                transcript, 
                isFinal,
                length: transcript.length 
              });
              onTranscript?.(transcript, isFinal);
            }
          }
        } catch (error) {
          console.error('[TabAudioCapture] ❌ Error parsing message:', error);
        }
      };

      socket.onerror = (error) => {
        console.error('[TabAudioCapture] ❌ WebSocket error:', error);
        onError?.('Failed to connect to Deepgram for avatar transcription');
        stopCapture();
      };

      socket.onclose = (event) => {
        console.log('[TabAudioCapture] 🔌 WebSocket closed', { 
          code: event.code, 
          reason: event.reason 
        });
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
        // Log every 25 chunks (~3 seconds) to verify audio is flowing
        if (chunkCount % 25 === 0) {
          const hasAudio = inputData.some(sample => Math.abs(sample) > 0.01);
          console.log('[TabAudioCapture] 🎵 Sending audio chunks:', chunkCount, 'Has audio:', hasAudio);
        }
      };

      source.connect(processor);
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0; // Silent - no audio output
      processor.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Auto-stop if user stops sharing
      stream.getTracks().forEach(track => {
        track.onended = () => {
          console.log('[TabAudioCapture] ⚠️ User stopped sharing tab audio');
          stopCapture();
        };
      });

      console.log('[TabAudioCapture] ✅ Successfully started capturing avatar audio!');

    } catch (error) {
      console.error('[TabAudioCapture] ❌ Error starting capture:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to capture audio';
      onError?.(errorMessage);
      stopCapture();
    }
  }, [enabled, isSupported, deepgramApiKey, onTranscript, onError, stopCapture]);

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


/**
 * Server-side avatar audio capture using Puppeteer + Deepgram
 * This service captures audio from LiveAvatar iframe and transcribes it in real-time
 */

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';

export interface AudioCaptureOptions {
  avatarUrl: string;
  deepgramApiKey: string;
  onTranscript: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
}

export class AvatarAudioCapture {
  private deepgramClient: any;
  private isCapturing = false;

  constructor(private apiKey: string) {
    this.deepgramClient = createClient(apiKey);
  }

  async start(options: AudioCaptureOptions): Promise<void> {
    if (this.isCapturing) {
      throw new Error('Already capturing audio');
    }

    try {
      console.log('[AvatarAudioCapture] Starting audio capture...');
      this.isCapturing = true;

      // Connect to Deepgram real-time transcription
      const connection = this.deepgramClient.listen.live({
        model: 'nova-2',
        language: 'en',
        punctuate: true,
        interim_results: true,
        smart_format: true,
        endpointing: 300, // End of speech detection
      });

      // Handle Deepgram events
      connection.on(LiveTranscriptionEvents.Open, () => {
        console.log('[AvatarAudioCapture] Deepgram connection opened');
      });

      connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        const transcript = data.channel.alternatives[0].transcript;
        const isFinal = data.is_final;

        if (transcript && transcript.trim()) {
          console.log('[AvatarAudioCapture] Transcript:', { transcript, isFinal });
          options.onTranscript(transcript, isFinal);
        }
      });

      connection.on(LiveTranscriptionEvents.Error, (error: any) => {
        console.error('[AvatarAudioCapture] Deepgram error:', error);
        options.onError?.(error.message || 'Deepgram error');
      });

      connection.on(LiveTranscriptionEvents.Close, () => {
        console.log('[AvatarAudioCapture] Deepgram connection closed');
        this.isCapturing = false;
      });

      // TODO: Implement Puppeteer audio capture here
      // This requires running headless Chrome to capture the iframe audio
      // For now, this is a framework - full implementation requires server setup

      console.log('[AvatarAudioCapture] ⚠️ Note: Full audio capture requires server deployment');
      console.log('[AvatarAudioCapture] ⚠️ Puppeteer audio capture needs additional setup');

    } catch (error) {
      console.error('[AvatarAudioCapture] Error:', error);
      this.isCapturing = false;
      throw error;
    }
  }

  stop(): void {
    this.isCapturing = false;
    console.log('[AvatarAudioCapture] Stopped');
  }

  isActive(): boolean {
    return this.isCapturing;
  }
}














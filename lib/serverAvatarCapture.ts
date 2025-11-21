/**
 * Server-side Avatar Audio Capture
 * 
 * This service runs on the server and captures avatar audio automatically
 * without requiring user interaction. Uses Server-Sent Events (SSE) to
 * stream transcripts back to the client in real-time.
 */

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';

export interface ServerCaptureOptions {
  avatarUrl: string;
  sessionId: string;
  deepgramApiKey: string;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
}

/**
 * Create an SSE connection for receiving real-time transcripts
 * from the server-side audio capture service
 */
export function createServerCaptureConnection(
  sessionId: string,
  onTranscript: (text: string, isFinal: boolean) => void,
  onError?: (error: string) => void
): EventSource {
  const url = `/api/capture-avatar-audio?sessionId=${encodeURIComponent(sessionId)}`;
  const eventSource = new EventSource(url);

  eventSource.addEventListener('transcript', (event) => {
    try {
      const data = JSON.parse(event.data);
      onTranscript(data.text, data.isFinal);
    } catch (error) {
      console.error('[ServerCapture] Error parsing transcript:', error);
    }
  });

  eventSource.addEventListener('error', (event) => {
    console.error('[ServerCapture] SSE error:', event);
    onError?.('Server capture connection failed');
  });

  eventSource.addEventListener('open', () => {
    console.log('[ServerCapture] ✅ Connected to server capture service');
  });

  return eventSource;
}

/**
 * Alternative: WebSocket-based capture for lower latency
 */
export function createWebSocketCaptureConnection(
  sessionId: string,
  onTranscript: (text: string, isFinal: boolean) => void,
  onError?: (error: string) => void
): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/api/capture-avatar-audio-ws?sessionId=${encodeURIComponent(sessionId)}`;
  
  const ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[ServerCapture] ✅ WebSocket connected');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'transcript') {
        onTranscript(data.text, data.isFinal);
      } else if (data.type === 'error') {
        onError?.(data.message);
      }
    } catch (error) {
      console.error('[ServerCapture] Error parsing message:', error);
    }
  };

  ws.onerror = (error) => {
    console.error('[ServerCapture] WebSocket error:', error);
    onError?.('WebSocket connection failed');
  };

  ws.onclose = () => {
    console.log('[ServerCapture] WebSocket closed');
  };

  return ws;
}


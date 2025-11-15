'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Avatar } from '@/types/avatar';

interface AvatarEmbedProps {
  avatar: Avatar;
}

interface ContextData {
  code: number;
  data: {
    name: string;
    prompt: string;
    opening_text: string;
    id: string;
  };
}

export default React.memo(function AvatarEmbed({ avatar }: AvatarEmbedProps) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [contextData, setContextData] = useState<ContextData | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Memoize avatar identifiers to prevent unnecessary re-fetches
  const avatarKey = useMemo(() => `${avatar.id}-${avatar.contextId}`, [avatar.id, avatar.contextId]);

  // Parallel fetch for context and session token
  useEffect(() => {
    if (!avatar.contextId) {
      setError('No context ID provided');
      setIsLoading(false);
      return;
    }

    // Reset state when avatar changes
    setError(null);
    setIsLoading(true);
    setContextData(null);
    setSessionToken(null);

    let cancelled = false;

    // Fetch both context and token in parallel for better performance
    const fetchData = async () => {
      try {
        const [contextResponse, tokenResponse] = await Promise.allSettled([
          fetch(`/api/context/${avatar.contextId}`, { 
            cache: 'default', // Use browser cache with server-side revalidation
          }),
          fetch('/api/embed-token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              avatarId: avatar.id,
              embedId: avatar.embedId,
              contextId: avatar.contextId,
            }),
          }),
        ]);

        if (cancelled) return;

        // Handle context response
        if (contextResponse.status === 'fulfilled' && contextResponse.value.ok) {
          const data: ContextData = await contextResponse.value.json();
          if (!cancelled) {
            setContextData(data);
          }
        } else {
          const errorData = contextResponse.status === 'fulfilled' 
            ? await contextResponse.value.json().catch(() => ({ error: `HTTP ${contextResponse.value.status}` }))
            : { error: 'Failed to fetch context' };
          if (!cancelled) {
            setError(errorData.error || 'Failed to load context');
            setIsLoading(false);
          }
          return;
        }

        // Handle token response (non-blocking)
        if (tokenResponse.status === 'fulfilled' && tokenResponse.value.ok) {
          const tokenData = await tokenResponse.value.json();
          if (!cancelled && tokenData.session_token) {
            setSessionToken(tokenData.session_token);
          }
        }
        // Token failure is non-critical, so we don't set error here

        if (!cancelled) {
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Error fetching data:', err);
          setError('Failed to load. Please check your configuration.');
          setIsLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [avatarKey, avatar.id, avatar.embedId, avatar.contextId]);

  // Memoized callback for sending token to iframe
  const sendTokenToIframe = useCallback(() => {
    if (!sessionToken || !iframeRef.current?.contentWindow) return;
    
    try {
      iframeRef.current.contentWindow.postMessage(
        {
          type: 'session_token',
          session_token: sessionToken,
          context_id: avatar.contextId,
        },
        'https://embed.liveavatar.com'
      );
    } catch (e) {
      // Silently fail - iframe may not be ready
    }
  }, [sessionToken, avatar.contextId]);

  // Send session token to iframe after it loads
  useEffect(() => {
    if (!sessionToken) return;
    
    sendTokenToIframe();
    const timer = setTimeout(sendTokenToIframe, 1000);
    return () => clearTimeout(timer);
  }, [sessionToken, sendTokenToIframe]);

  // Optimized message handler with debouncing
  useEffect(() => {
    let disconnectTimeout: NodeJS.Timeout | null = null;
    let hasConnected = false;
    let errorCount = 0;

    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from LiveAvatar domain
      if (!event.origin.includes('liveavatar.com')) {
        return;
      }

      // Handle different message types from LiveAvatar
      if (event.data?.type === 'error' || event.data?.error) {
        const errorMessage = event.data.message || event.data.error || 'An error occurred';
        
        // Don't show 403 errors - they're authentication issues that might be normal
        if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
          errorCount++;
          if (errorCount > 5 && !hasConnected) {
            setError('Authentication failed. Please check LiveAvatar dashboard configuration.');
            setIsLoading(false);
          }
          return;
        }
        
        // Only show other errors if they're critical
        if (!errorMessage.toLowerCase().includes('initializing') && 
            !errorMessage.toLowerCase().includes('connecting')) {
          setError(errorMessage);
          setIsLoading(false);
        }
      } else if (
        event.data?.type === 'session_disconnected' || 
        event.data?.event === 'disconnected'
      ) {
        if (hasConnected) {
          if (disconnectTimeout) clearTimeout(disconnectTimeout);
          disconnectTimeout = setTimeout(() => {
            setError('Session disconnected. Please refresh the page.');
            setIsLoading(false);
          }, 3000);
        }
      } else if (
        event.data?.type === 'session_ready' || 
        event.data?.status === 'ready' || 
        event.data?.event === 'ready' ||
        event.data?.type === 'connected' || 
        event.data?.event === 'connected'
      ) {
        hasConnected = true;
        setIsLoading(false);
        setError(null);
        errorCount = 0;
        if (disconnectTimeout) {
          clearTimeout(disconnectTimeout);
          disconnectTimeout = null;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      if (disconnectTimeout) clearTimeout(disconnectTimeout);
    };
  }, []);

  // Send context_id to iframe after it loads
  useEffect(() => {
    if (!contextData || !avatar.contextId) return;
    
    const timer = setTimeout(() => {
      if (iframeRef.current?.contentWindow) {
        try {
          iframeRef.current.contentWindow.postMessage(
            { type: 'set_context', context_id: avatar.contextId },
            'https://embed.liveavatar.com'
          );
        } catch (e) {
          // Silently fail - iframe may not be ready
        }
      }
    }, 1000);
    
    return () => clearTimeout(timer);
  }, [contextData, avatar.contextId]);

  // Memoized iframe URL to prevent unnecessary re-renders
  const iframeUrl = useMemo(() => {
    const baseUrl = `https://embed.liveavatar.com/v1/${avatar.embedId}`;
    const params = new URLSearchParams();
    
    if (avatar.contextId) {
      params.append('context_id', avatar.contextId);
    }
    
    if (sessionToken) {
      params.append('session_token', sessionToken);
    }
    
    return params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl;
  }, [avatar.embedId, avatar.contextId, sessionToken]);

  // Memoized handlers to prevent re-renders
  const handleIframeLoad = useCallback(() => {
    // Delay hiding loading to allow embed initialization
    setTimeout(() => {
      setIsLoading(false);
    }, 1500);
  }, []);

  const handleIframeError = useCallback(() => {
    setError('Failed to load avatar. Please check your connection and try again.');
    setIsLoading(false);
  }, []);

  return (
    <div className="w-full mx-auto">
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="aspect-video w-full relative" ref={containerRef}>
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
              <div className="text-center">
                <div className="spinner mx-auto mb-3"></div>
                <p className="text-sm text-gray-600">
                  {contextData ? 'Initializing...' : 'Loading...'}
                </p>
              </div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-red-50 z-10 p-4" style={{ zIndex: 20 }}>
              <div className="text-center bg-white p-6 rounded-lg border border-red-200 max-w-md w-full">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <p className="text-red-700 mb-4 font-semibold">Error</p>
                <p className="text-gray-700 mb-4 text-sm">{error}</p>
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={() => {
                      setError(null);
                      setIsLoading(true);
                      setContextData(null);
                      window.location.reload();
                    }}
                    className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Reload
                  </button>
                  <button
                    onClick={() => {
                      setError(null);
                    }}
                    className="px-4 py-2 text-sm font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors border border-gray-300"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}
          {contextData && (
            <iframe
              ref={iframeRef}
              key={avatarKey}
              src={iframeUrl}
              allow="microphone; camera"
              allowFullScreen
              title="LiveAvatar Embed"
              className="w-full h-full border-0 rounded-xl sm:rounded-2xl"
              style={{ aspectRatio: '16/9' }}
              loading="eager"
              onLoad={handleIframeLoad}
              onError={handleIframeError}
            />
          )}
        </div>
      </div>
    </div>
  );
});

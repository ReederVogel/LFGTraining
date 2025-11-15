import { NextRequest, NextResponse } from 'next/server';

// Ensure this route is recognized by Next.js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // Maximum execution time

// GET handler for route discovery and debugging
export async function GET() {
  return NextResponse.json(
    { 
      message: 'Embed token API endpoint',
      method: 'Use POST to create a session token',
      endpoint: '/api/embed-token'
    },
    { status: 200 }
  );
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.NEXT_PUBLIC_LIVEAVATAR_API_KEY || process.env.LIVEAVATAR_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'API key not configured' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { avatarId, embedId, contextId } = body;

    if (!avatarId) {
      return NextResponse.json(
        { error: 'Avatar ID is required' },
        { status: 400 }
      );
    }

    if (!embedId) {
      return NextResponse.json(
        { error: 'Embed ID is required' },
        { status: 400 }
      );
    }

    console.log('Creating session token for avatar:', avatarId);
    console.log('Using avatar_id:', avatarId);
    console.log('Embed ID:', embedId);
    
    // Create session token using avatarId (the actual avatar ID, not embed ID)
    // Using correct endpoint: /v1/sessions/token (not /v1/sessions/create-token)
    const requestBody = {
      avatar_id: avatarId,
    };
    
    console.log('Requesting session token from LiveAvatar API:', {
      endpoint: 'https://api.liveavatar.com/v1/sessions/token',
      body: requestBody,
      hasApiKey: !!apiKey
    });
    
    let tokenResponse = await fetch(
      'https://api.liveavatar.com/v1/sessions/token',
      {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
          'accept': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    );

    console.log('LiveAvatar API response:', {
      status: tokenResponse.status,
      statusText: tokenResponse.statusText,
      ok: tokenResponse.ok,
      headers: Object.fromEntries(tokenResponse.headers.entries())
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      // Use warn for 422 (validation errors) since embed can still work
      const logMethod = tokenResponse.status === 422 ? console.warn : console.error;
      logMethod('LiveAvatar API Error:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        errorText: errorText || 'Empty response body',
        requestBody: requestBody,
        requestUrl: 'https://api.liveavatar.com/v1/sessions/token',
        hasApiKey: !!apiKey,
        note: tokenResponse.status === 422 ? 'This is usually non-critical - embed can authenticate directly' : undefined
      });
      
      // Try to parse error as JSON if possible
      let errorMessage = errorText || `HTTP ${tokenResponse.status}: ${tokenResponse.statusText}`;
      let errorDetails: any = {};
      
      try {
        const errorJson = JSON.parse(errorText);
        errorDetails = errorJson;
        // If empty object or no meaningful error message, use status info
        if (errorJson && Object.keys(errorJson).length > 0) {
          errorMessage = errorJson.detail || errorJson.error || errorJson.message || JSON.stringify(errorJson);
        } else {
          errorMessage = `HTTP ${tokenResponse.status}: ${tokenResponse.statusText}`;
        }
      } catch {
        // Not JSON, use text or status info
        if (!errorText || !errorText.trim()) {
          errorMessage = `HTTP ${tokenResponse.status}: ${tokenResponse.statusText}`;
        }
      }
      
      return NextResponse.json(
        { 
          error: `Failed to create session token: ${errorMessage}`,
          status: tokenResponse.status,
          details: errorText || 'No error details available',
          errorDetails: errorDetails,
          requestBody: requestBody
        },
        { status: tokenResponse.status }
      );
    }

    const tokenData = await tokenResponse.json();
    console.log('Session token response data:', {
      hasSessionId: !!(tokenData.session_id || tokenData.data?.session_id),
      hasSessionToken: !!(tokenData.session_token || tokenData.data?.session_token),
      responseKeys: Object.keys(tokenData),
      fullResponse: tokenData
    });
    
    const sessionId = tokenData.session_id || tokenData.data?.session_id;
    const sessionToken = tokenData.session_token || tokenData.data?.session_token;

    if (!sessionId || !sessionToken) {
      console.error('Invalid session token response - missing required fields:', {
        sessionId: sessionId || 'MISSING',
        sessionToken: sessionToken || 'MISSING',
        fullResponse: tokenData
      });
      return NextResponse.json(
        { 
          error: 'Invalid session token response',
          details: 'Missing session_id or session_token',
          response: tokenData
        },
        { status: 500 }
      );
    }

    // If contextId is provided, start the session with context
    let sessionStarted = false;
    let sessionStartError = null;
    
    if (contextId) {
      console.log('Starting session with context:', contextId);
      try {
        const startResponse = await fetch(
          `https://api.liveavatar.com/v1/sessions/${sessionId}/start`,
          {
            method: 'POST',
            headers: {
              'X-API-KEY': apiKey,
              'Content-Type': 'application/json',
              'accept': 'application/json',
            },
            body: JSON.stringify({
              context_id: contextId,
            }),
          }
        );

        if (startResponse.ok) {
          sessionStarted = true;
          console.log('Session started successfully with context');
        } else {
          const errorText = await startResponse.text();
          console.error('Failed to start session:', {
            status: startResponse.status,
            statusText: startResponse.statusText,
            errorText: errorText || 'Empty response'
          });
          
          // Try to parse error
          try {
            const errorJson = JSON.parse(errorText);
            sessionStartError = errorJson.error || errorJson.message || errorText;
          } catch {
            sessionStartError = errorText || `HTTP ${startResponse.status}: ${startResponse.statusText}`;
          }
          
          console.warn('Session token created but start failed. Token may still work.');
        }
      } catch (err) {
        console.error('Error starting session:', err);
        sessionStartError = err instanceof Error ? err.message : 'Unknown error';
      }
    }

    return NextResponse.json({
      session_token: sessionToken,
      session_id: sessionId,
      session_started: sessionStarted,
      ...(sessionStartError && { session_start_error: sessionStartError }),
    });
  } catch (error) {
    console.error('Error creating embed token:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: errorMessage,
        details: error instanceof Error ? error.stack : String(error)
      },
      { status: 500 }
    );
  }
}


import { NextRequest, NextResponse } from 'next/server';

/**
 * API endpoint to fetch avatar transcript from LiveAvatar session
 * This retrieves the conversation history including avatar responses
 */
export async function POST(req: NextRequest) {
  try {
    const { sessionId } = await req.json();

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.LIVEAVATAR_API_KEY || process.env.NEXT_PUBLIC_LIVEAVATAR_API_KEY;
    
    if (!apiKey) {
      console.error('[Avatar Transcript API] API key not configured');
      return NextResponse.json(
        { error: 'LiveAvatar API key not configured' },
        { status: 500 }
      );
    }

    console.log('[Avatar Transcript API] Fetching transcript for session:', sessionId);

    // Fetch conversation history from LiveAvatar API
    const response = await fetch(`https://api.liveavatar.com/v1/sessions/${sessionId}/messages`, {
      method: 'GET',
      headers: {
        'X-API-KEY': apiKey,
        'accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Avatar Transcript API] Failed to fetch transcript:', {
        status: response.status,
        error: errorText,
      });
      
      // Try alternative endpoint
      const altResponse = await fetch(`https://api.liveavatar.com/v1/sessions/${sessionId}`, {
        method: 'GET',
        headers: {
          'X-API-KEY': apiKey,
          'accept': 'application/json',
        },
      });

      if (!altResponse.ok) {
        return NextResponse.json(
          { 
            error: 'Failed to fetch transcript',
            details: errorText,
            messages: [],
          },
          { status: response.status }
        );
      }

      const altData = await altResponse.json();
      return NextResponse.json({
        messages: altData.messages || altData.data?.messages || [],
        sessionData: altData,
      });
    }

    const data = await response.json();
    console.log('[Avatar Transcript API] ✅ Transcript fetched successfully');

    return NextResponse.json({
      messages: data.messages || data.data?.messages || data.results || [],
      raw: data,
    });

  } catch (error) {
    console.error('[Avatar Transcript API] Error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
        messages: [],
      },
      { status: 500 }
    );
  }
}

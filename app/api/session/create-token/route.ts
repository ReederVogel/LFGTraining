import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const apiKey = process.env.NEXT_PUBLIC_LIVEAVATAR_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'API key not configured' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { avatarId } = body;

    if (!avatarId) {
      return NextResponse.json(
        { error: 'Avatar ID is required' },
        { status: 400 }
      );
    }

    console.log('Creating session token with avatar_id:', avatarId);
    const requestBody = {
      avatar_id: avatarId,
    };
    console.log('Request body:', JSON.stringify(requestBody));

    // Create session token
    // Using correct endpoint: /v1/sessions/token (not /v1/sessions/create-token)
    const response = await fetch(
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

    console.log('LiveAvatar API response status:', response.status);
    console.log('LiveAvatar API response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('LiveAvatar API error response:', {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText,
        errorTextLength: errorText.length
      });
      
      // Try to parse as JSON to get structured error
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { detail: errorText || `HTTP ${response.status}: ${response.statusText}` };
      }
      
      return NextResponse.json(
        { 
          error: `Failed to create session token: ${errorText}`,
          detail: errorData.detail || errorData.error || errorText,
          ...errorData
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error creating session token:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}


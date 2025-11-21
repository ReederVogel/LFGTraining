import { NextRequest, NextResponse } from 'next/server';

export async function PUT(request: NextRequest) {
  const apiKey = process.env.NEXT_PUBLIC_LIVEAVATAR_API_KEY || process.env.LIVEAVATAR_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'API key not configured' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { contextId, name, prompt, opening_text } = body;

    if (!contextId) {
      return NextResponse.json(
        { error: 'contextId is required' },
        { status: 400 }
      );
    }

    // Update context using LiveAvatar API
    const response = await fetch(
      `https://api.liveavatar.com/v1/contexts/${contextId}`,
      {
        method: 'PUT',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
          'accept': 'application/json',
        },
        body: JSON.stringify({
          ...(name && { name }),
          ...(prompt && { prompt }),
          ...(opening_text && { opening_text }),
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('LiveAvatar API error:', errorText);
      return NextResponse.json(
        { error: `Failed to update context: ${errorText}` },
        { status: response.status }
      );
    }

    const context = await response.json();
    return NextResponse.json(context);
  } catch (error) {
    console.error('Error updating context:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}


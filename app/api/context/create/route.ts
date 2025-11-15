import { NextRequest, NextResponse } from 'next/server';

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
    const { name, prompt, opening_text } = body;

    if (!name || !prompt || !opening_text) {
      return NextResponse.json(
        { error: 'name, prompt, and opening_text are required' },
        { status: 400 }
      );
    }

    // Create context using LiveAvatar API
    const response = await fetch(
      'https://api.liveavatar.com/v1/contexts',
      {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
          'accept': 'application/json',
        },
        body: JSON.stringify({
          name,
          prompt,
          opening_text,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('LiveAvatar API error:', errorText);
      return NextResponse.json(
        { error: `Failed to create context: ${errorText}` },
        { status: response.status }
      );
    }

    const context = await response.json();
    return NextResponse.json(context);
  } catch (error) {
    console.error('Error creating context:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}


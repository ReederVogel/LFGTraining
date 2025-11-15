import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const apiKey = process.env.NEXT_PUBLIC_LIVEAVATAR_API_KEY || process.env.LIVEAVATAR_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'API key not configured' },
      { status: 500 }
    );
  }

  // Return API key (it's already public via NEXT_PUBLIC_ prefix)
  // This allows the client to pass it to the embed if needed
  return NextResponse.json({
    apiKey: apiKey,
  });
}


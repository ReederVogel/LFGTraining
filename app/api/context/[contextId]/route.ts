import { NextRequest, NextResponse } from 'next/server';

// Cache configuration for better performance
export const dynamic = 'force-dynamic'; // Allow dynamic rendering but cache responses

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ contextId: string }> }
) {
  const { contextId } = await params;
  
  // Try both with and without NEXT_PUBLIC_ prefix
  const apiKey = process.env.NEXT_PUBLIC_LIVEAVATAR_API_KEY || process.env.LIVEAVATAR_API_KEY;

  if (!apiKey) {
    const debugInfo = {
      hasNextPublicKey: !!process.env.NEXT_PUBLIC_LIVEAVATAR_API_KEY,
      hasRegularKey: !!process.env.LIVEAVATAR_API_KEY,
      envKeys: Object.keys(process.env).filter(k => k.includes('LIVEAVATAR') || k.includes('API')),
    };
    console.error('API Key check failed:', debugInfo);
    return NextResponse.json(
      { 
        error: 'API key not configured. Please check your .env.local file and restart the server.',
        debug: debugInfo
      },
      { status: 500 }
    );
  }

  if (!contextId) {
    return NextResponse.json(
      { error: 'Context ID is required' },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(
      `https://api.liveavatar.com/v1/contexts/${contextId}`,
      {
        method: 'GET',
        headers: {
          'X-API-KEY': apiKey,
          'accept': 'application/json',
        },
        next: { revalidate: 300 }, // Cache for 5 minutes
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Failed to fetch context: ${errorText}` },
        { status: response.status }
      );
    }

    const context = await response.json();
    
    // Return with cache headers
    return NextResponse.json(context, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Error fetching context:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}


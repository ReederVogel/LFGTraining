import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const apiKey = process.env.NEXT_PUBLIC_LIVEAVATAR_API_KEY || process.env.LIVEAVATAR_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { 
        error: 'API key not found',
        hasNextPublicKey: !!process.env.NEXT_PUBLIC_LIVEAVATAR_API_KEY,
        hasRegularKey: !!process.env.LIVEAVATAR_API_KEY,
      },
      { status: 500 }
    );
  }

  // Test the API key by fetching user contexts
  try {
    const response = await fetch(
      'https://api.liveavatar.com/v1/contexts',
      {
        method: 'GET',
        headers: {
          'X-API-KEY': apiKey,
          'accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { 
          error: 'API key test failed',
          status: response.status,
          statusText: response.statusText,
          errorDetails: errorText,
          apiKeyPrefix: apiKey.substring(0, 8) + '...'
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      success: true,
      message: 'API key is valid',
      apiKeyPrefix: apiKey.substring(0, 8) + '...',
      contextsFound: data.data?.length || 0,
      contexts: data.data || []
    });
  } catch (error) {
    return NextResponse.json(
      { 
        error: 'Failed to test API key',
        details: error instanceof Error ? error.message : 'Unknown error',
        apiKeyPrefix: apiKey.substring(0, 8) + '...'
      },
      { status: 500 }
    );
  }
}


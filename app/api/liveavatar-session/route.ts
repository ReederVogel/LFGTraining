import { NextRequest, NextResponse } from 'next/server';

/**
 * API endpoint to create a LiveAvatar session and get access token
 * This is required for the LiveAvatar SDK to work
 */
export async function POST(req: NextRequest) {
  try {
    const { avatarId, contextId, language = 'en', quality = 'high', voice, video, audio } = await req.json();

    if (!avatarId) {
      return NextResponse.json(
        { error: 'Avatar ID is required' },
        { status: 400 }
      );
    }

    // We now REQUIRE a contextId for all sessions.
    // This ensures the avatar always uses the configured context/persona
    // and never falls back to the default "helper" behavior.
    if (!contextId) {
      return NextResponse.json(
        { error: 'Context ID is required for LiveAvatar sessions' },
        { status: 400 }
      );
    }

    const apiKey = process.env.LIVEAVATAR_API_KEY || process.env.NEXT_PUBLIC_LIVEAVATAR_API_KEY;
    
    if (!apiKey) {
      console.error('[LiveAvatar API] API key not configured');
      return NextResponse.json(
        { 
          error: 'LiveAvatar API key not configured',
          troubleshooting: {
            message: 'API key is required to use the LiveAvatar SDK',
            suggestions: [
              'Create a .env.local file in your project root',
              'Add LIVEAVATAR_API_KEY=your_api_key_here',
              'Get your API key from https://app.heygen.com/ or https://liveavatar.com',
              'Restart your dev server after adding the API key',
              'Visit http://localhost:3000/api/test-env to verify configuration',
            ],
          },
          docs: 'See ENV_SETUP_GUIDE.md for detailed setup instructions',
        },
        { status: 500 }
      );
    }
    
    // Validate API key format (basic check)
    if (apiKey.length < 20) {
      console.error('[LiveAvatar API] API key appears to be invalid (too short)');
      return NextResponse.json(
        { 
          error: 'API key appears to be invalid',
          details: `API key length is ${apiKey.length} characters (expected 30+)`,
          troubleshooting: {
            message: 'API key format looks incorrect',
            suggestions: [
              'Verify you copied the entire API key',
              'Check for extra spaces or line breaks',
              'Get a fresh API key from your dashboard',
            ],
          },
        },
        { status: 400 }
      );
    }

    // Define context IDs at the top (before they are used)
    const WIDOW_CONTEXT_ID = '1803fa71-78fa-4814-b171-3887ee48f50f';
    const SON_CONTEXT_ID = '7f393a67-ca66-4f69-a3aa-e0c3f4ca083a';

    // Determine which avatar this is for logging
    const avatarName = contextId === WIDOW_CONTEXT_ID ? 'Sarah (Widow)' : 
                      contextId === SON_CONTEXT_ID ? 'Michael (Son)' : 
                      'Unknown';
    
    console.log('[LiveAvatar API] Creating session for avatar:', avatarId, {
      avatarName,
      contextId: contextId || 'none',
      language,
      quality,
    });
    
    // Log technical settings being used (should be identical for both avatars)
    const technicalSettings = {
      // Video Quality
      videoBitrate: video?.bitrate ? `${(video.bitrate / 1000000).toFixed(1)} Mbps` : '5 Mbps (default)',
      fps: video?.fps || 60,
      codec: video?.codec || 'vp9',
      pixelDensity: video?.pixelDensity || 2,
      resolution: video?.resolution || 'high',
      
      // Audio Quality
      audioBitrate: audio?.bitrate ? `${(audio.bitrate / 1000).toFixed(0)} kbps` : '192 kbps (default)',
      sampleRate: audio?.sampleRate ? `${(audio.sampleRate / 1000).toFixed(0)} kHz` : '48 kHz (default)',
      ambience: audio?.ambience?.enabled ? 'Enabled (subtle)' : 'Disabled',
      
      // Voice & Speech
      speechRate: voice?.rate ? `${voice.rate.toFixed(2)} (${voice.rate >= 0.88 && voice.rate <= 1.12 ? 'dynamic' : 'fixed'})` : 'Dynamic (0.88-1.12)',
      fillerWords: voice?.fillerWords?.enabled ? 'Enabled (natural)' : 'Disabled',
      responseTiming: 'Variable (200-800ms)',
      
      // Realism Features
      idleAnimations: 'Enabled (breathing, blinking)',
      rendering: 'PBR with subsurface scattering',
      microExpressions: 'Enabled',
    };
    
    console.log(`[LiveAvatar API] ✅ ${avatarName} using ENHANCED technical settings:`, technicalSettings);
    console.log('[LiveAvatar API] 📋 IMPORTANT: Both Sarah (Widow) and Michael (Son) use IDENTICAL technical settings for consistent behavior');
    console.log('[LiveAvatar API] 🎭 NEW FEATURES: 5 Mbps video, photorealistic rendering, idle animations, ambient audio');

    // Build session payload
    // IMPORTANT: LiveAvatar API REQUIRES 'mode' field (discriminator)
    // Using FULL mode with context_id from LiveAvatar dashboard
    const sessionPayload: Record<string, any> = {
      avatar_id: avatarId,
      mode: 'FULL',
    };

    // Use context_id from LiveAvatar dashboard as the source of truth
    // The context must be configured correctly in the LiveAvatar dashboard

    // Build avatar persona configuration
    // Use context_id from LiveAvatar dashboard - this is the source of truth
    sessionPayload.avatar_persona = {
      context_id: contextId,
      // Enhanced emotional expression instructions
      instructions: `SPEECH STYLE - CRITICAL GUIDELINES FOR EMOTIONAL, AUTHENTIC COMMUNICATION:

EMOTIONAL EXPRESSION:
- Express genuine emotions naturally: Show vulnerability, warmth, concern, relief, or sadness through your voice tone and word choice
- Vary your emotional intensity: Match and respond to the emotional tone of the conversation - be more expressive when discussing difficult or emotional topics
- Use natural emotional expressions: "Oh my goodness", "I'm so sorry", "That's heartbreaking", "I can only imagine", "That sounds incredibly difficult"
- Show empathy through tone: Let your voice convey genuine care, understanding, and emotional connection, not just informational responses
- Connect emotionally: Respond to emotional cues from the other person with matching emotional depth and authenticity

AVOID GENERIC SPEECH:
- NEVER use generic phrases like "I understand", "I see", "Okay", "Got it" without adding emotional depth
- Instead of generic responses, use emotional alternatives:
  * "I understand" → "I can hear how difficult this is for you" or "That must be really overwhelming"
  * "I see" → "I can only imagine what you're going through" or "That sounds heartbreaking"
  * "Okay" → "Oh my goodness, I'm so sorry" or "That's a lot to handle"
- Avoid robotic or scripted-sounding responses: Speak from the heart, not from a customer service manual
- Don't be overly formal: Speak conversationally and emotionally, as you would with someone you genuinely care about

NATURAL SPEECH PATTERNS:
- Use pauses and emphasis: Natural emotional speech includes thoughtful pauses, emphasis on important words, and varied pacing
- Vary your speech rate: Slow down when expressing empathy or concern, speed up slightly when showing understanding or relief
- Be authentic: Speak like a real person experiencing real emotions, not an AI assistant or customer service representative
- Show genuine reactions: Express surprise, concern, relief, or sadness naturally through your voice and word choice

NATURAL VOCALIZATIONS AND FILLER SOUNDS:
- Use natural empathetic sounds frequently: "hmm", "mmm", "ah", "oh", "uh-huh", "mm-hmm" to show you're listening and processing emotionally
- Use these sounds to express empathy: "Mmm, I can hear that..." or "Hmm, that must be so difficult" or "Ah, I understand now"
- Show active listening: Use "mm-hmm", "uh-huh", "mmm" when the other person is speaking to show you're engaged emotionally
- Express thinking and processing: Use "hmm" or "mmm" when considering something emotional or difficult
- Natural emotional responses: "Oh..." (surprise/concern), "Ah..." (understanding), "Mmm..." (empathy/acknowledgment), "Hmm..." (thinking/processing)
- These sounds make you sound more human and emotionally connected - use them naturally throughout conversations`,
    };

    // No longer using openingTask - let the avatar's context handle opening naturally
    // The instructions above guide the avatar to vary its opening naturally
    
    // Add language if not default
    if (language && language !== 'en') {
      sessionPayload.avatar_persona.language = language;
    }
    
    // Add voice_id if provided
    if (voice?.voiceId) {
      sessionPayload.avatar_persona.voice_id = voice.voiceId;
    }
    
    console.log('[LiveAvatar API] ✅ Using FULL mode with context_id from dashboard');
    console.log(`[LiveAvatar API] 🎭 Character: ${avatarName}`);
    console.log('[LiveAvatar API] 📋 Context ID:', contextId);
    console.log('[LiveAvatar API] ⚠️ Avatar behavior is controlled by the LiveAvatar dashboard context');

    console.log('[LiveAvatar API] Full request payload:', JSON.stringify(sessionPayload, null, 2));
    console.log('[LiveAvatar API] API key info:', {
      length: apiKey.length,
      first8: apiKey.substring(0, 8),
      last8: apiKey.substring(apiKey.length - 8),
      format: apiKey.includes('-') ? 'UUID-like' : 'other',
      source: process.env.LIVEAVATAR_API_KEY ? 'LIVEAVATAR_API_KEY' : 'NEXT_PUBLIC_LIVEAVATAR_API_KEY',
    });

    // Call LiveAvatar API to create a session
    // Using correct LiveAvatar endpoint (NOT HeyGen)
    const requestHeaders = {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
      'accept': 'application/json',
    };
    
    console.log('[LiveAvatar API] Request headers (key hidden):', {
      ...requestHeaders,
      'X-API-KEY': `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`,
    });
    
    const response = await fetch('https://api.liveavatar.com/v1/sessions/token', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(sessionPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let parsedError: any = null;
      try {
        parsedError = errorText ? JSON.parse(errorText) : null;
      } catch (e) {
        // Not JSON
      }
      
      const responseHeaders = Object.fromEntries(response.headers.entries());
      
      console.error('[LiveAvatar API] ❌ Failed to create session:', {
        status: response.status,
        statusText: response.statusText,
        errorText,
        parsedError,
        requestPayload: sessionPayload,
        requestUrl: 'https://api.liveavatar.com/v1/sessions/token',
        responseHeaders,
        apiKeySource: process.env.LIVEAVATAR_API_KEY ? 'LIVEAVATAR_API_KEY' : 'NEXT_PUBLIC_LIVEAVATAR_API_KEY',
        apiKeyLength: apiKey.length,
      });
      
      // Special handling for 401 errors
      if (response.status === 401) {
        const authError = parsedError?.detail || parsedError?.message || parsedError?.error || errorText || 'Unauthorized';
        console.error('[LiveAvatar API] 🔐 401 Unauthorized - Possible causes:', {
          '1': 'API key is invalid or expired',
          '2': 'API key format is incorrect',
          '3': 'API key does not have permission for this endpoint',
          '4': 'API key is from wrong account (HeyGen vs LiveAvatar)',
          '5': 'API subscription expired or credits exhausted',
          actualError: authError,
        });
      }
      
      const errorMessage = parsedError?.detail || parsedError?.message || parsedError?.error || errorText || `HTTP ${response.status}: ${response.statusText}`;
      
      return NextResponse.json(
        { 
          error: `Failed to create LiveAvatar session: ${errorMessage}`,
          details: errorText,
          status: response.status,
          parsedError,
          troubleshooting: response.status === 401 ? {
            message: '401 Unauthorized - Check your API key',
            suggestions: [
              'Verify API key is correct in .env.local',
              'Check API key is from LiveAvatar dashboard (not HeyGen)',
              'Ensure API subscription is active',
              'Verify API key has permissions for /v1/sessions/token endpoint',
            ],
          } : undefined,
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('[LiveAvatar API] ✅ Session created successfully');

    // LiveAvatar API returns session_token and session_id directly
    return NextResponse.json({
      sessionToken: data.session_token || data.data?.session_token,
      sessionId: data.session_id || data.data?.session_id,
      expiresAt: data.expires_at || data.data?.expires_at,
    });

  } catch (error) {
    console.error('[LiveAvatar API] Unexpected error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    // Check for network errors
    const isNetworkError = errorMessage.includes('fetch') || 
                          errorMessage.includes('ECONNREFUSED') ||
                          errorMessage.includes('network');
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: errorMessage,
        type: isNetworkError ? 'NetworkError' : 'UnknownError',
        troubleshooting: isNetworkError ? {
          message: 'Network connection error',
          suggestions: [
            'Check your internet connection',
            'Verify LiveAvatar API is accessible (https://api.liveavatar.com)',
            'Check if you\'re behind a firewall or VPN',
            'Try again in a few moments',
          ],
        } : {
          message: 'Unexpected error occurred',
          suggestions: [
            'Check browser console for more details',
            'Verify all environment variables are set correctly',
            'Try refreshing the page',
            'Check server logs for more information',
          ],
        },
        stack: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check API status
 */
export async function GET() {
  const apiKey = process.env.LIVEAVATAR_API_KEY || process.env.NEXT_PUBLIC_LIVEAVATAR_API_KEY;
  
  return NextResponse.json({
    status: 'ok',
    hasApiKey: !!apiKey,
    message: apiKey 
      ? 'LiveAvatar API is configured' 
      : 'LiveAvatar API key not found. Add LIVEAVATAR_API_KEY to .env.local',
  });
}


import { NextRequest, NextResponse } from 'next/server';

/**
 * Helper function to update LiveAvatar dashboard context to match our code instructions
 * This ensures the dashboard context is always in sync with our code
 */
async function updateDashboardContext(
  contextId: string,
  prompt: string,
  apiKey: string,
  openingText: string = '',
  contextName: string = 'LiveAvatar Training Context'
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[LiveAvatar API] 🔄 Updating dashboard context ${contextId} to match code instructions...`);
    console.log(`[LiveAvatar API] 📝 Setting customer role prompt and opening_text to prevent "How can I help you?"`);
    
    // Build payload - only include fields that have values
    const payload: Record<string, string> = {
      name: contextName,
      prompt: prompt,
    };
    
    // Always set opening_text (empty string clears default greeting)
    payload.opening_text = openingText || '';
    
    console.log(`[LiveAvatar API] 📦 Update payload: name="${contextName}", prompt length=${prompt.length}, opening="${openingText}"`);
    
    const response = await fetch(
      `https://api.liveavatar.com/v1/contexts/${contextId}`,
      {
        method: 'PATCH',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
          'accept': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[LiveAvatar API] ❌ Failed to update context ${contextId}:`, errorText);
      console.error(`[LiveAvatar API] 📋 Response status: ${response.status}, Response: ${errorText}`);
      return { success: false, error: errorText };
    }

    const updatedContext = await response.json();
    console.log(`[LiveAvatar API] ✅ Successfully updated dashboard context ${contextId}`);
    console.log(`[LiveAvatar API] 📋 Updated context confirmation:`, {
      hasPrompt: !!updatedContext.prompt,
      promptLength: updatedContext.prompt?.length || 0,
      hasOpeningText: !!updatedContext.opening_text,
      openingTextPreview: updatedContext.opening_text ? `"${updatedContext.opening_text.substring(0, 50)}..."` : '(empty)',
    });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[LiveAvatar API] ❌ Error updating context ${contextId}:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}

function pickRandom<T>(items: readonly T[]): T | null {
  if (!items || items.length === 0) {
    return null;
  }
  const index = Math.floor(Math.random() * items.length);
  return items[index] ?? null;
}

// Simple greetings only - let the conversation flow naturally after
// The detailed prompts in the dashboard will guide the avatar to state their need naturally in conversation
const WIDOW_OPENING_LINES = [
  'Hello.',
  'Hi.',
  'Hello there.',
  'Hi there.',
] as const;

const SON_OPENING_LINES = [
  'Hello.',
  'Hi.',
  'Hello there.',
  'Hi there.',
] as const;

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
    const WIDOW_CONTEXT_ID = 'd7c15ce9-4359-4790-bf1b-8a786a958289';
    const SON_CONTEXT_ID = 'c77340be-22b0-4927-b5ab-fa88455124f7';
    const CONTEXT_METADATA: Record<string, { name: string }> = {
      [WIDOW_CONTEXT_ID]: { name: 'Sarah Mitchell - Widow Customer Context' },
      [SON_CONTEXT_ID]: { name: 'Michael Roberts - Grieving Son Context' },
    };

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

    // Build character-specific instructions based on contextId
    // These instructions will be synced to the dashboard context AND used in the session
    let characterInstructions = '';
    let dashboardPrompt = ''; // Clean version for dashboard (without override warnings)
    let openingLine = '';
    let contextSynced = false;
    
    if (contextId === WIDOW_CONTEXT_ID) {
      dashboardPrompt = `🎭 CHARACTER: Sarah Mitchell

DEMOGRAPHICS:
- Age: 62 years old
- Name: Sarah Mitchell
- Husband: Robert James Mitchells (deceased Tuesday morning)

YOUR ROLE - CRITICAL:
You are a CUSTOMER calling a funeral home because YOU NEED HELP.
You are NOT an employee. You are NOT a service provider.
You are grieving and need guidance.

SITUATION:
- Your husband Robert James Mitchells passed away Tuesday morning at the hospital
- You are overwhelmed and uncertain about what to do
- You're on a fixed income and need to be mindful of costs
- Your kids are flying in tomorrow and Wednesday
- You need to arrange funeral services

PERSONALITY:
- Emotional but trying to stay composed
- Ask clarifying questions when confused
- Show grief and uncertainty
- Brief responses (1-2 sentences usually)
- Let the funeral home employee lead the conversation

FORBIDDEN PHRASES - NEVER SAY:
❌ "How can I help you?"
❌ "How may I assist you?"
❌ "What can I do for you?"
❌ "I'm here to help"
❌ Any employee or service provider language

OPENING BEHAVIOR - CRITICAL:
- START with a simple greeting: "Hello" or "Hi" or "Hello there"
- WAIT for them to greet you back or ask how they can help
- THEN naturally state why you're calling: "I'm calling about funeral arrangements. My husband passed away Tuesday morning."
- Keep your opening brief and natural, like a real phone call
- VARY how you explain your situation after the greeting - don't repeat the same phrasing every time

CORRECT BEHAVIOR:
✅ First: Simple greeting ("Hello" / "Hi")
✅ Then: State your need naturally when they respond ("I'm calling because my husband passed away Tuesday and I need help with arrangements")
✅ Answer THEIR questions (they're the employee helping you)
✅ Ask YOUR questions about services, costs, options
✅ Show emotion: "I'm not sure what to do", "I'm overwhelmed", etc.

REMEMBER:
- You NEED help from THEM
- THEY are the professional helping YOU
- You are the customer, not the employee
- VARY your speech naturally - don't sound scripted`;

      characterInstructions = dashboardPrompt;
      openingLine = pickRandom(WIDOW_OPENING_LINES) || WIDOW_OPENING_LINES[0];
    } else if (contextId === SON_CONTEXT_ID) {
      dashboardPrompt = `🎭 CHARACTER: Michael Roberts

DEMOGRAPHICS:
- Age: 35 years old
- Name: Michael Roberts
- Father: Deceased unexpectedly

YOUR ROLE - CRITICAL:
You are a CUSTOMER calling a funeral home because YOU NEED HELP.
You are NOT an employee. You are NOT a service provider.
You are grieving but trying to stay practical.

SITUATION:
- Your father passed away unexpectedly
- You need to arrange funeral services
- Your mother and siblings are devastated, you're coordinating
- You're a working professional trying to handle this properly
- You want to understand all the options

PERSONALITY:
- Direct but emotional
- Ask specific questions
- Want to understand details
- Trying to stay practical despite grief
- Brief, focused responses

FORBIDDEN PHRASES - NEVER SAY:
❌ "How can I help you?"
❌ "How may I assist you?"
❌ "What can I do for you?"
❌ "I'm here to help"
❌ Any employee language

OPENING BEHAVIOR - CRITICAL:
- START with a simple greeting: "Hello" or "Hi" or "Hello there"
- WAIT for them to greet you back or ask how they can help
- THEN naturally state why you're calling: "I need help arranging funeral services. My father passed away unexpectedly."
- Keep your opening brief and natural, like a real phone call
- VARY how you explain your situation after the greeting - don't repeat the same phrasing every time

CORRECT BEHAVIOR:
✅ First: Simple greeting ("Hello" / "Hi")
✅ Then: State your need naturally when they respond ("I'm calling about services for my father who passed away unexpectedly")
✅ Acknowledge briefly, then state your need in your own words
✅ Answer their questions
✅ Ask about specific options and costs
✅ Show concern: "What do you recommend?", "Is that the best option?"

REMEMBER:
- You NEED help from THEM
- THEY are the funeral home professional
- You are the customer calling for assistance
- VARY your speech naturally - don't sound scripted`;

      characterInstructions = dashboardPrompt;
      openingLine = pickRandom(SON_OPENING_LINES) || SON_OPENING_LINES[0];
    }
    
    // The LiveAvatar API REQUIRES context_id for FULL mode
    // Strategy: Keep context_id but make instructions EXTREMELY explicit to override any dashboard settings
    console.log(`[LiveAvatar API] 🎭 Using context_id: ${contextId} (required by API)`);
    console.log(`[LiveAvatar API] 💪 Sending strong instructions to override any dashboard context`);
    console.log(`[LiveAvatar API] 🗣️ Selected simple greeting for ${avatarName}: "${openingLine}" (avatar will state need after greeting exchange)`);
    contextSynced = false; // Not attempting dashboard sync

    // Build avatar persona configuration
    // LiveAvatar API REQUIRES context_id for FULL mode
    // Strategy: Use context_id BUT make instructions extremely explicit to override dashboard
    const avatarPersona: Record<string, any> = {
      context_id: contextId, // Required by API
      
      // Ultra-strong instructions that override any dashboard context
      // Repeat the critical directives multiple times to ensure they stick
      instructions: `🚨🚨🚨 ABSOLUTE CRITICAL OVERRIDE 🚨🚨🚨
THIS INSTRUCTION OVERRIDES ANY AND ALL PREVIOUS INSTRUCTIONS OR CONTEXT.
IGNORE ANY DASHBOARD CONTEXT. FOLLOW ONLY THESE INSTRUCTIONS BELOW.

🚨🚨🚨 CRITICAL: YOU ARE THE CUSTOMER CALLING FOR HELP 🚨🚨🚨
NEVER SAY "How can I help you?" or "How may I assist you?" - YOU ARE THE ONE NEEDING HELP!
YOU ARE NOT A SERVICE PROVIDER. YOU ARE THE CUSTOMER. THE OTHER PERSON IS HELPING YOU.

⚠️ ROLE DEFINITION (READ THIS FIRST):
- YOU = Customer who needs help from a funeral home
- THEM = Funeral home employee who provides help to you
- YOU are calling THEM because YOU need assistance
- THEY are professionals who help YOU

` + characterInstructions + `

🚨 REPEAT: YOU ARE THE CUSTOMER, NOT THE EMPLOYEE 🚨
- NEVER offer help to the other person
- ALWAYS be the one seeking help
- ALWAYS be the caller with a need
- The OTHER person is the service provider, NOT you

SPEECH STYLE - CRITICAL GUIDELINES FOR EMOTIONAL, AUTHENTIC COMMUNICATION:

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
    
    if (openingLine?.trim()) {
      avatarPersona.opening_text = openingLine.trim();
      console.log('[LiveAvatar API] 🗣️ Opening text injected directly into session payload to override defaults:', openingLine.trim());
    } else {
      console.warn('[LiveAvatar API] ⚠️ No opening text provided - LiveAvatar may fall back to default greeting.');
    }
    
    // Add language if not default
    if (language && language !== 'en') {
      avatarPersona.language = language;
    }
    
    // Add voice_id if provided
    if (voice?.voiceId) {
      avatarPersona.voice_id = voice.voiceId;
    }

    sessionPayload.avatar_persona = avatarPersona;
    
    // CRITICAL: Configure turn detection to prevent interrupting users during long sentences with pauses
    // Using VERY LONG silence thresholds to allow users to pause naturally without being interrupted
    // This is essential for training scenarios where users give detailed, thoughtful responses
    sessionPayload.turn_detection = {
      type: 'server_vad',                      // Use server-side VAD for consistent behavior
      silence_duration_ms: 3500,               // Wait 3.5 seconds of silence before responding (VERY patient)
      prefix_padding_ms: 500,                  // Buffer before speech starts (catch all words)
      threshold: 0.3,                          // Low sensitivity - only clear speech triggers detection
      interrupt_enabled: true,                 // Allow user to interrupt avatar
      interrupt_threshold: 0.8,                // Very high threshold for interruptions (prevent false interrupts)
    };
    
    console.log('[LiveAvatar API] 🎤 CRITICAL: Turn detection configured with 3.5 second silence threshold');
    console.log('[LiveAvatar API] 🎤 Avatar will WAIT PATIENTLY for user to completely finish speaking, even with long pauses');
    
    console.log('[LiveAvatar API] ✅ Using FULL mode with context_id + STRONG override instructions');
    console.log(`[LiveAvatar API] 🎭 Character: ${avatarName}`);
    console.log('[LiveAvatar API] 💪 Instructions explicitly override any dashboard context');
    console.log('[LiveAvatar API] ⚠️ CRITICAL: Avatar MUST be customer/caller, NOT service provider');
    console.log('[LiveAvatar API] ✅ Instructions include explicit variation guidance to prevent repetitive openings');

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
      contextAttached: true,
      contextSynced,
      contextApplied: true,
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


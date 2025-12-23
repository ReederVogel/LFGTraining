import { NextResponse } from "next/server";
import { getAvatarById } from "@/lib/avatars";
import { buildDynamicPrompt, PersonalityControls } from "@/lib/prompt-builder";

// This route must always run dynamically (no static optimization) because it
// pulls secrets and calls external APIs.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      // Log error server-side only (not exposed to client)
      if (process.env.NODE_ENV === 'development') {
        console.error("OPENAI_API_KEY is not set in environment variables");
      }
      return NextResponse.json(
        { error: "Server configuration error. Please contact support." },
        { status: 500 }
      );
    }

    // Get avatar ID and personality controls from request body
    const body = await request.json();
    const avatarId = body.avatarId;
    const controls: PersonalityControls | undefined = body.controls;

    if (!avatarId) {
      return NextResponse.json(
        { error: "avatarId is required" },
        { status: 400 }
      );
    }

    // Get avatar configuration
    const avatar = getAvatarById(avatarId);
    
    if (!avatar) {
      return NextResponse.json(
        { error: "Avatar not found" },
        { status: 404 }
      );
    }

    // Validate personality controls if provided (for avatars with custom persona support)
    if (avatar.supportsCustomPersona && controls) {
      // Validate sadness level (1-5)
      if (controls.sadnessLevel < 1 || controls.sadnessLevel > 5) {
        return NextResponse.json(
          { error: "sadnessLevel must be between 1 and 5" },
          { status: 400 }
        );
      }
      
      // Validate coping intensity if coping style is set
      if (controls.copingStyle && controls.copingStyle !== 'none') {
        if (controls.copingIntensity < 1 || controls.copingIntensity > 5) {
          return NextResponse.json(
            { error: "copingIntensity must be between 1 and 5 when copingStyle is set" },
            { status: 400 }
          );
        }
      }
      
      // Validate accent strength if accent type is set
      if (controls.accentType) {
        if (controls.accentStrength < 0 || controls.accentStrength > 5) {
          return NextResponse.json(
            { error: "accentStrength must be between 0 and 5 when accentType is set" },
            { status: 400 }
          );
        }
      }
    }

    // Build session configuration based on avatar and controls
    // Select voice based on avatar: "ash" for son (Michael), "shimmer" for widow (Sarah)
    const voice = avatar.id === "michael" ? "ash" : "shimmer";
    let sessionConfig: any = {
      model: "gpt-realtime",
      voice: voice
    };
    
    if (avatar.supportsCustomPersona && controls) {
      // Use dynamic instructions with personality controls
      
      // Ensure characterName is set (use avatar's name if not provided)
      const controlsWithName = {
        ...controls,
        characterName: controls.characterName || avatar.name,
        relationshipType: controls.relationshipType || avatar.relationshipType,
        character: controls.character || avatar.defaultCharacter,
        backstory: controls.backstory || avatar.defaultBackstory,
        conversationGoal: controls.conversationGoal || avatar.defaultGoal,
      };
      
      const dynamicPrompt = buildDynamicPrompt(controlsWithName);
      sessionConfig.instructions = dynamicPrompt;
    } else if (avatar.openaiPromptId) {
      // Use dashboard prompt for other avatars or if no controls
      sessionConfig.prompt = {
        id: avatar.openaiPromptId,
        version: avatar.openaiPromptVersion || "1"
      };
    } else {
      return NextResponse.json(
        { error: "No prompt configuration available for this avatar" },
        { status: 400 }
      );
    }

    // Create ephemeral token for OpenAI Realtime API
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1",
      },
      body: JSON.stringify(sessionConfig),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorJson.error || errorText || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      // Log error server-side only (not exposed to client)
      if (process.env.NODE_ENV === 'development') {
        console.error("OpenAI API error:", {
          status: response.status,
          statusText: response.statusText,
          error: errorMessage
        });
      }
      // Don't expose internal error details to client
      const clientMessage = response.status === 401 
        ? "Authentication failed. Please check API configuration."
        : response.status === 429
        ? "Rate limit exceeded. Please try again later."
        : "Failed to initialize session. Please try again.";
      
      return NextResponse.json(
        { error: clientMessage },
        { status: response.status >= 500 ? 500 : response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
    
  } catch (error: any) {
    // Log error server-side only (not exposed to client)
    if (process.env.NODE_ENV === 'development') {
      console.error("Error creating OpenAI token:", error);
    }
    // Don't expose internal error details to client
    return NextResponse.json(
      { error: "Failed to initialize session. Please try again." },
      { status: 500 }
    );
  }
}


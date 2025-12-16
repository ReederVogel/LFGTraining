import { NextResponse } from "next/server";
import { getAvatarById } from "@/lib/avatars";
import { buildSarahPrompt, PersonalityControls } from "@/lib/prompt-builder";

// This route must always run dynamically (no static optimization) because it
// pulls secrets and calls external APIs.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      console.error("OPENAI_API_KEY is not set in environment variables");
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured. Please check your .env.local file and restart the dev server." },
        { status: 500 }
      );
    }
    
    console.log("OpenAI API key found:", apiKey.substring(0, 10) + "...");

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

    // Build session configuration based on avatar and controls
    let sessionConfig: any = {
      model: "gpt-realtime",
      voice: "shimmer" // Female voice for Sarah (warm, natural)
    };
    
    if (avatarId === 'sarah' && controls) {
      // Use dynamic instructions for Sarah with personality controls
      console.log("Using dynamic instructions for Sarah with controls:", controls);
      const dynamicPrompt = buildSarahPrompt(controls);
      sessionConfig.instructions = dynamicPrompt;
    } else if (avatar.openaiPromptId) {
      // Use dashboard prompt for other avatars or if no controls
      console.log("Using dashboard prompt ID:", avatar.openaiPromptId);
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
      console.error("OpenAI API error:", {
        status: response.status,
        statusText: response.statusText,
        error: errorMessage
      });
      return NextResponse.json(
        { error: `Failed to create OpenAI session: ${errorMessage}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
    
  } catch (error: any) {
    console.error("Error creating OpenAI token:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}


import { NextResponse } from "next/server";
import { getAvatarById } from "@/lib/avatars";

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured" },
        { status: 500 }
      );
    }

    // Get avatar ID from request body
    const body = await request.json();
    const avatarId = body.avatarId;

    if (!avatarId) {
      return NextResponse.json(
        { error: "avatarId is required" },
        { status: 400 }
      );
    }

    // Get avatar configuration
    const avatar = getAvatarById(avatarId);
    
    if (!avatar || !avatar.openaiPromptId) {
      return NextResponse.json(
        { error: "Avatar not found or OpenAI prompt not configured" },
        { status: 404 }
      );
    }

    // Create ephemeral token for OpenAI Realtime API
    // Using the avatar's pre-configured prompt from platform.openai.com
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1",
      },
      body: JSON.stringify({
        prompt: {
          id: avatar.openaiPromptId,
          version: avatar.openaiPromptVersion || "1"
        }
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("OpenAI API error:", error);
      return NextResponse.json(
        { error: `Failed to create OpenAI session: ${error}` },
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


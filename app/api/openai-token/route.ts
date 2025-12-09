import { NextResponse } from "next/server";
import { getAvatarById } from "@/lib/avatars";

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


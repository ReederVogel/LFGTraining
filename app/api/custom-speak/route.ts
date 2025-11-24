import { NextRequest, NextResponse } from "next/server";

// <SECURITY_REVIEW>
// - Uses OpenAI TTS to generate short speech audio from text.
// - API key is read from env only.
// - We return base64-encoded PCM; client sends it to LiveAvatar via AVATAR_SPEAK_AUDIO.
// - Keep text length modest to control latency and cost.
// </SECURITY_REVIEW>

type SpeakRequest = {
  text: string;
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  let body: SpeakRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const rawText = (body.text || "").trim();
  if (!rawText) {
    return NextResponse.json(
      { error: "Text is required." },
      { status: 400 }
    );
  }

  // Keep utterances short for latency and more natural grieving speech.
  const text = rawText.slice(0, 400);

  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: text,
        format: "pcm", // 24kHz mono PCM, ideal for LiveAvatar's AVATAR_SPEAK_AUDIO
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `OpenAI TTS error: ${response.status} ${errText}` },
        { status: 500 }
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const audioBase64 = buffer.toString("base64");

    return NextResponse.json({ audioBase64 });
  } catch (error) {
    console.error("Error calling OpenAI TTS:", error);
    return NextResponse.json(
      { error: "Failed to call OpenAI TTS." },
      { status: 500 }
    );
  }
}



import { NextRequest, NextResponse } from "next/server";

// <SECURITY_REVIEW>
// - Never log raw user audio/text or secrets.
// - OpenAI key must come from env, not hardcoded.
// - This is a simple text-only brain for now; later you can plug in vector DB.
// </SECURITY_REVIEW>

const SYSTEM_PROMPT = `
You are a grieving family member speaking with a funeral director trainee.
Stay strictly in character as the persona described.
Speak in short, natural, emotionally realistic sentences (max 20–30 words).
Do not give professional advice or mention AI, prompts, or training.
`;

type BrainRequestBody = {
  persona: {
    name: string;
    role: string;
    scenario: string;
  };
  history: Array<{ speaker: "user" | "avatar"; text: string }>;
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  let body: BrainRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { persona, history } = body;

  if (!persona || !history || !Array.isArray(history)) {
    return NextResponse.json(
      { error: "Missing persona or history in request body." },
      { status: 400 }
    );
  }

  const kbSnippet = `
Training focus:
- Empathy over efficiency
- Gentle questions, not interrogation
- Never lead the conversation; respond after the trainee speaks
- Avoid repeating the same sentences.
`;

  const messages = [
    {
      role: "system" as const,
      content: `${SYSTEM_PROMPT}

Persona:
- Name: ${persona.name}
- Role: ${persona.role}
- Scenario: ${persona.scenario}

Knowledge:
${kbSnippet}
`,
    },
    ...history.map((h) => ({
      role: h.speaker === "user" ? ("user" as const) : ("assistant" as const),
      content: h.text,
    })),
  ];

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.7,
        max_tokens: 120,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `OpenAI error: ${response.status} ${text}` },
        { status: 500 }
      );
    }

    const data = await response.json();
    const reply =
      data.choices?.[0]?.message?.content?.trim() ??
      "I’m feeling a bit overwhelmed right now. Could you maybe ask that again a little more gently?";

    return NextResponse.json({ reply });
  } catch (error) {
    console.error("Error calling OpenAI:", error);
    return NextResponse.json(
      { error: "Failed to call OpenAI." },
      { status: 500 }
    );
  }
}



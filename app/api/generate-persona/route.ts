import { NextResponse } from "next/server";
import OpenAI from "openai";
import { DEFAULT_CHARACTER, DEFAULT_BACKSTORY, DEFAULT_CONVERSATION_GOAL } from "@/lib/prompt-builder";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    const { field, input, context } = await request.json();

    if (!input || typeof input !== "string" || !input.trim()) {
      return NextResponse.json(
        { error: "Input text is required" },
        { status: 400 }
      );
    }

    if (!["character", "backstory", "conversationGoal"].includes(field)) {
      return NextResponse.json(
        { error: "Invalid field type. Must be 'character', 'backstory', or 'conversationGoal'" },
        { status: 400 }
      );
    }

    const systemPrompt = getSystemPrompt(field, context);
    
    // GPT-5 models work best with the Responses API.
    // Use it first, and fall back to Chat Completions if needed.
    let formattedText: string | null = null;

    try {
      const response = await openai.responses.create({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: input.trim() },
        ],
        max_output_tokens: 1500,
      } as any);

      formattedText =
        typeof (response as any)?.output_text === "string"
          ? (response as any).output_text.trim()
          : null;
    } catch (e) {
      // Fallback path: some environments/accounts may not have Responses enabled.
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: input.trim() },
        ],
        max_completion_tokens: 1500,
      } as any);

      const content = (response as any)?.choices?.[0]?.message?.content;
      formattedText =
        typeof content === "string"
          ? content.trim()
          : Array.isArray(content)
            ? content
                .map((part: any) => part?.text ?? part?.content ?? "")
                .join("")
                .trim()
            : null;
    }

    if (!formattedText) {
      return NextResponse.json(
        { error: "Failed to generate formatted text" },
        { status: 500 }
      );
    }

    return NextResponse.json({ formatted: formattedText });
  } catch (error: any) {
    // Log error server-side only (not exposed to client)
    if (process.env.NODE_ENV === 'development') {
      console.error("Error generating persona:", error);
    }
    // Don't expose internal error details to client
    return NextResponse.json(
      { error: "Failed to generate persona. Please try again." },
      { status: 500 }
    );
  }
}

function getSystemPrompt(field: string, context?: { character?: string; backstory?: string; conversationGoal?: string }): string {
  const baseContext = `You are helping format persona information for a funeral home training simulator. The trainee practices conversations with AI-powered grieving family members. Write in THIRD PERSON (describing the character, not "you").`;

  // Build context message if other fields exist
  let contextMessage = '';
  if (context) {
    if (field === 'backstory' && context.character) {
      contextMessage = `\n\nIMPORTANT CONTEXT - Use this character information to ensure consistency:\n${context.character}\n\n`;
    }
    if (field === 'conversationGoal') {
      if (context.character) {
        contextMessage += `\n\nIMPORTANT CONTEXT - Character:\n${context.character}\n\n`;
      }
      if (context.backstory) {
        contextMessage += `IMPORTANT CONTEXT - Backstory:\n${context.backstory}\n\n`;
      }
    }
  }

  if (field === "character") {
    return `${baseContext}

Your task: Take rough notes (even if just a few sentences or one sentence) about a character and create a complete, well-formatted CHARACTER description that matches the style and format of the example below.

EXAMPLE FORMAT (use this exact style):
${DEFAULT_CHARACTER}

CRITICAL REQUIREMENTS:
- ALWAYS create a complete, well-structured character description matching the example format
- Even if input is minimal (one sentence or a few sentences), expand it into a full character profile
- Fill in reasonable, realistic details that are consistent with the provided information
- Include: name, age, location/background, relationship to deceased, family context, values/beliefs, and any relevant personality traits
- Match the tone, structure, and level of detail from the example above
- Use the same paragraph breaks and formatting style
- Write in third person throughout (she/he, not "you")
- Use the same sentence structure and flow
- Make it feel authentic and appropriate for a funeral home training scenario

EXPANSION GUIDELINES:
- If only a name is given, create a realistic age, location, and background
- If only relationship is mentioned, develop a full character profile around that relationship
- If only basic info is provided, add appropriate values, beliefs, and personality traits
- Ensure all details are consistent and realistic for the context

Output ONLY the formatted character description, no explanations or extra text.`;
  }

  if (field === "backstory") {
    return `${baseContext}${contextMessage}

Your task: Take rough notes (even if just a few sentences or one sentence) and create a complete, well-formatted BACKSTORY description that matches the style and format of the example below.

EXAMPLE FORMAT (use this exact style):
${DEFAULT_BACKSTORY}

CRITICAL REQUIREMENTS:
- ALWAYS create a complete backstory matching the example format, even from minimal input
- Expand sparse input into a full, coherent backstory with multiple paragraphs
- Include: current situation (death/illness status), why they're meeting now, their emotional state, what they want from the funeral, and how they share information
- Match the tone, structure, and level of detail from the example above
- Use the same paragraph breaks and formatting style
- Write in third person (she/he, not "you")
- Use the same sentence structure and flow
- Make it feel authentic and emotionally appropriate for a grieving family member
- CRITICAL: If character context is provided above, use the EXACT same character name, age, location, and details from that context. Do not create new names or change existing details.

EXPANSION GUIDELINES:
- If only basic facts are given, develop the emotional context and motivations
- If only the death/illness is mentioned, add details about timing, their approach to planning, and their mindset
- If minimal context is provided, create a realistic scenario that fits funeral home training
- Ensure all details are consistent with the character description provided above
- Use the character's name, age, location, and other details from the character context if provided

Output ONLY the formatted backstory, no explanations or extra text.`;
  }

  // conversationGoal
  return `${baseContext}${contextMessage}

Your task: Take rough notes (even if just a few sentences or one sentence) and create a complete, well-formatted CONVERSATION GOAL that matches the style and format of the example below.

EXAMPLE FORMAT (use this exact style):
${DEFAULT_CONVERSATION_GOAL}

CRITICAL REQUIREMENTS:
- ALWAYS create a complete conversation goal matching the example format, even from minimal input
- Expand sparse input into a full list of 4-6 specific, realistic goals
- Include: practical goals (budget, service type, arrangements), emotional goals (honoring the deceased, feeling confident), and communication preferences
- Match the tone, structure, and level of detail from the example above
- Use bullet points with the same format (- [goal])
- Write in third person
- ALWAYS include a closing statement about their mindset (like "She is not browsing. She is making serious, personal decisions.")
- Make goals specific and appropriate for a funeral home training scenario
- CRITICAL: If character/backstory context is provided above, use the EXACT same character name and details from that context. Do not create new names or change existing details.

EXPANSION GUIDELINES:
- If only one goal is mentioned, expand into multiple related goals covering different aspects
- If only vague intentions are given, create specific, actionable goals
- If minimal input is provided, infer realistic goals based on typical funeral planning needs
- Ensure goals are consistent with the character and backstory provided above
- Use the character's name and details from the context if provided

Output ONLY the formatted conversation goal, no explanations or extra text.`;
}


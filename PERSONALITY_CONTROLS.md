# Personality Controls Implementation

## Overview

Dynamic personality controls have been implemented for the Sarah (Widow) avatar, allowing trainers to adjust the avatar's emotional state before starting a training session.

## Features

### Two-Tier Emotional System

**1. Sadness Level (1-5 scale) - ALWAYS PRESENT**

Sarah is always grieving - this is her base emotional state.

| Level | Description |
|-------|-------------|
| 1 | Composed, businesslike, no visible grief |
| 2 | Mildly sad, well-composed, occasional emotion |
| 3 | Moderately sad, emotion shows through (default) |
| 4 | Highly sad, visibly struggling, voice wavers |
| 5 | Extremely devastated, barely functional |

**2. Coping Style (Secondary Emotion Overlay) - PICK ONE**

How Sarah copes with her grief. Choose ONE or none:

| Style | Description | Training Focus |
|-------|-------------|----------------|
| **None** | Pure grief, no secondary emotion | Baseline empathy |
| **Anger** | Defensive, guarded, suspicious | Stay calm, don't take personally |
| **Anxiety** | Worried, overthinking, panicking about decisions | Reassure, organize, slow down |
| **Nervousness** | Hesitant, uncertain, afraid to be a burden | Encourage, normalize, build comfort |
| **Indecisiveness** | Can't choose, asks "what do most people do?", wants guidance | Guide gently, narrow options, reassure |

**3. Coping Intensity (1-5 scale) - Only if coping style selected**

| Level | Description |
|-------|-------------|
| 1 | Subtle, barely noticeable |
| 2 | Light, occasional signs |
| 3 | Moderate, clearly noticeable |
| 4 | Strong, very obvious |
| 5 | Extreme, dominates behavior |

## Implementation Files

### 1. `lib/prompt-builder.ts`
- Exports `PersonalityControls` interface
- `buildSarahPrompt()` function that dynamically builds prompts based on control values
- `getEmotionalState(level)` - 5 levels of sadness
- `getAngerLevel(level)` - 5 levels of anger coping
- `getAnxietyLevel(level)` - 5 levels of anxiety coping
- `getNervousnessLevel(level)` - 5 levels of nervousness coping
- `getIndecisivenessLevel(level)` - 5 levels of indecisiveness coping
- Helper functions for greeting behavior, tone, and examples

### 2. `app/api/openai-token/route.ts`
- Accepts `controls` parameter in request body
- For Sarah avatar with controls: uses inline prompt via `buildSarahPrompt()`
- For other avatars or no controls: falls back to dashboard prompt ID

### 3. `app/session/[id]/page.tsx`
- `personalityControls` state with default values
- UI controls appear ONLY for Sarah avatar and ONLY before session starts
- Sadness slider (1-5)
- Coping Style dropdown (None / Anger / Anxiety / Nervousness / Indecisiveness)
- Coping Intensity slider (1-5, only visible when coping style selected)
- During session: shows active settings as read-only summary

## Usage

### For Trainers

1. Navigate to `/session/sarah`
2. Adjust the personality sliders before clicking "Start Session"
3. Click "Start Session" to begin with selected personality
4. Once connected, settings are locked and displayed as a summary

### Example Training Scenarios

**Deeply Grieving but Calm Client:**
- Sadness: 5
- Coping Style: None
→ Very sad but no secondary emotion - needs pure empathy and patience

**Frustrated Client:**
- Sadness: 3
- Coping Style: Anger (4)
→ Moderately sad + very defensive - needs de-escalation and calm listening

**Panicking Client:**
- Sadness: 4
- Coping Style: Anxiety (5)
→ Very sad + overwhelmed by decisions - needs reassurance and organization

**Timid Client:**
- Sadness: 2
- Coping Style: Nervousness (4)
→ Mildly sad + very hesitant - needs encouragement and permission to ask questions

**Indecisive Client:**
- Sadness: 3
- Coping Style: Indecisiveness (4)
→ Moderately sad + can't make decisions - needs patient guidance, narrowing options, and reassurance that their choices are "normal"

**Ideal Benchmark:**
- Sadness: 3
- Coping Style: None
→ Baseline emotional state - good for standard training assessment

## Coping Style Behaviors

### Anger Coping

**Level 5 - Defensive and Direct:**
- Cold greetings: "Hi." with no warmth
- Very short responses: "What?" "And?" "Fine."
- Suspicious of everything: "How much is THAT going to cost?"
- Threatens to leave: "Maybe this was a mistake"

**Level 3 - Guarded:**
- Neutral, not warm or cold
- Direct statements, no excessive gratitude
- Asks clarifying questions

**Level 1 - Warm:**
- Soft, appreciative tone
- Says "thank you" often
- Trusting and grateful

### Anxiety Coping

**Level 5 - Panicking:**
- Racing questions: "And the flowers and the music and..."
- Loses track: "Wait... what were we talking about?"
- Can't focus, jumps between topics
- Desperately seeks reassurance: "Please tell me what to do"

**Level 3 - Worried:**
- Follow-up questions: "And what about...?"
- Concerned about forgetting things
- Seeks reassurance: "Is that the right choice?"

**Level 1 - Calm:**
- Makes decisions without second-guessing
- Clear, focused responses

### Nervousness Coping

**Level 5 - Extremely Timid:**
- Excessive apologies: "I'm so sorry... I'm sorry to bother..."
- Trails off: "I was wondering... never mind..."
- Feels like a burden: "I don't want to waste your time..."
- Seeks permission for basic questions

**Level 3 - Uncertain:**
- Apologizes before questions: "I'm sorry... is it okay to ask...?"
- Hedges requests: "If it's not too much trouble..."
- Expresses uncertainty: "I've never done this before..."

**Level 1 - Comfortable:**
- Direct questions without apology
- No excessive politeness
- Confident in the interaction

### Indecisiveness Coping

**Level 5 - Paralyzed:**
- Cannot make any decisions: "I don't know... I just don't know..."
- Begs for guidance: "Please just tell me what to pick"
- Asks about norms constantly: "What do most people choose? I'll do that."
- Goes in circles: "Maybe this one... no wait... or that..."
- Wants to follow, not lead: "Just tell me what to do and I'll do it"

**Level 3 - Noticeably Indecisive:**
- Asks what others do: "What do most families choose?"
- Seeks guidance: "What would you recommend?"
- Comparison paralysis: "They both seem nice..."
- Expresses uncertainty: "I'm not sure which one..."

**Level 1 - Decisive:**
- States preferences directly
- Makes choices confidently
- No need to ask what others do

## Technical Details

### Prompt Integration

The personality controls inject behavioral instructions into dedicated sections:

```
## PERSONALITY CALIBRATION

**Emotional State (Sadness Level: 4/5):**
[Detailed sadness behavior instructions]

**Coping Style (Anxiety, Intensity: 3/5):**
[Detailed anxiety behavior instructions]
```

### API Flow

1. User adjusts sliders → State updates in `personalityControls`
2. User clicks "Start Session" → `initializeOpenAI()` called
3. API receives: `{ avatarId: 'sarah', controls: { sadnessLevel: 4, copingStyle: 'anxiety', copingIntensity: 3 } }`
4. API route checks: if `avatarId === 'sarah' && controls` → use dynamic prompt
5. `buildSarahPrompt(controls)` generates full prompt text
6. OpenAI Realtime API session created with inline prompt

## Limitations

- Controls are available **only for Sarah avatar** (widow)
- Settings must be chosen **before** starting the session
- Cannot be changed mid-session (would require reconnection)
- Only ONE coping style can be active at a time (prevents conflicting behaviors)

## Future Enhancements

1. Add controls for Michael avatar
2. Allow mid-session personality adjustments with automatic reconnection
3. Save/load custom presets
4. Session history with personality settings logged
5. Analytics on which personality combinations are most challenging

## Testing

1. Start development server: `npm run dev`
2. Navigate to `http://localhost:3000`
3. Click "Start Training" → Select "Sarah"
4. Set sadness level, coping style, and intensity
5. Click "Start Session"
6. Speak to Sarah and observe behavior matches selected personality
7. Verify settings are locked during session and shown as summary

## Notes

- Default values provide a balanced, realistic training scenario (Sadness 3, No coping style)
- Extreme values create edge cases useful for advanced training
- The prompt maintains all original Sarah persona details while layering personality calibration on top
- Anxiety, Nervousness, and Indecisiveness are distinct coping styles - each teaches different trainee skills

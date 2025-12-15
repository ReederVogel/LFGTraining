# Personality Controls Implementation

## Overview

Dynamic personality controls have been implemented for the Sarah (Widow) avatar, allowing trainers to adjust the avatar's emotional state before starting a training session.

## Features

### Two Personality Controls (0-10 scale)

1. **Sadness Level**
   - 0-3: Mostly composed, rare tears, subdued grief
   - 4-6: Quietly sad, occasional tears, manageable grief (default: 5)
   - 7-10: Deeply grieving, overwhelming sadness, frequent emotional moments

2. **Anger**
   - 0-3: Patient and understanding, calm responses
   - 4-6: Slight anger when pushed, may withdraw (default: 3)
   - 7-10: Easily frustrated, defensive, may snap back

## Implementation Files

### 1. `lib/prompt-builder.ts` (NEW)
- Exports `PersonalityControls` interface
- `buildSarahPrompt()` function that dynamically builds prompts based on control values
- Maps each control level to specific behavioral descriptions
- Integrates personality calibration into the full Sarah prompt

### 2. `app/api/openai-token/route.ts` (MODIFIED)
- Accepts `controls` parameter in request body
- For Sarah avatar with controls: uses inline prompt via `buildSarahPrompt()`
- For other avatars or no controls: falls back to dashboard prompt ID
- Supports both prompt modes seamlessly

### 3. `app/session/[id]/page.tsx` (MODIFIED)
- Added `personalityControls` state with default values
- UI controls appear ONLY for Sarah avatar and ONLY before session starts
- Two sliders for sadness and anger dimensions
- During session: shows active settings as read-only summary
- Passes controls to API when initializing OpenAI connection

## Usage

### For Trainers

1. Navigate to `/session/sarah`
2. Adjust the personality sliders before clicking "Start Session"
3. Click "Start Session" to begin with selected personality
4. Once connected, settings are locked and displayed as a summary

### Example Combinations

**Deeply Grieving but Patient Client:**
- Sadness: 8
- Anger: 2
→ Very sad but patient - needs empathy and compassion

**Frustrated Client:**
- Sadness: 4
- Anger: 8
→ Moderately sad but irritated - needs de-escalation and active listening

**Ideal Benchmark:**
- Sadness: 3
- Anger: 2
→ Accepting, calm - good for baseline skill assessment

## Technical Details

### Prompt Integration

The personality controls are injected into a dedicated "PERSONALITY CALIBRATION" section of the prompt:

```
## PERSONALITY CALIBRATION (Current Session Settings)

**Emotional State (Sadness Level: 5/10):**
You are quietly sad and emotional but controlled. You may tear up occasionally when discussing Robert. Your grief is evident but manageable.

**Anger Level: 3/10:**
You may show slight anger if pushed too hard or upsold...
```

### API Flow

1. User adjusts sliders → State updates in `personalityControls`
2. User clicks "Start Session" → `initializeOpenAI()` called
3. API receives: `{ avatarId: 'sarah', controls: { sadnessLevel: 5, angerLevel: 3 } }`
4. API route checks: if `avatarId === 'sarah' && controls` → use dynamic prompt
5. `buildSarahPrompt(controls)` generates full prompt text
6. OpenAI Realtime API session created with inline prompt

## Limitations

- Controls are available **only for Sarah avatar** (widow)
- Settings must be chosen **before** starting the session
- Cannot be changed mid-session (would require reconnection)
- Michael avatar still uses dashboard prompt ID

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
4. Adjust personality sliders
5. Click "Start Session"
6. Speak to Sarah and observe behavior matches selected personality
7. Verify settings are locked during session and shown as summary

## Notes

- Default values provide a balanced, realistic training scenario
- Extreme values (0 or 10) create edge cases useful for advanced training
- The prompt maintains all original Sarah persona details while layering personality calibration on top
- No user ID is required for testing; can be added later when authentication is implemented



# Avatar Response Length Fix

## Issue Identified
The user reported that the avatar's responses "look like same word count" - essentially being too robotic in their consistency of length (around 20-30 words every time).

## Root Cause
A previous fix (documented in `INTERRUPTION_FIX.md`) introduced strict constraints to prevent verbosity:
- "Keep responses SHORT and CONCISE (1-2 sentences max)"
- "Keep responses under 30 words"

These constraints were too rigid, causing the unnatural uniformity in response length.

## Fix Applied
Updated `app/api/liveavatar-session/route.ts` to relax these constraints while maintaining conciseness.

**Old Instructions:**
```typescript
'RESPONSE LENGTH: Keep responses SHORT and CONCISE (1-2 sentences max). Only provide essential information.\n\n' +
'CONVERSATION STYLE:\n' +
'- Keep responses under 30 words\n'
```

**New Instructions:**
```typescript
'RESPONSE LENGTH: Vary your response length naturally. Some responses should be very short (just a few words), others can be 1-3 sentences if needed. Avoid keeping every response the same length.\n\n' +
'CONVERSATION STYLE:\n'
// Removed "- Keep responses under 30 words"
```

## Expected Result
The avatar should now:
- Vary response length naturally based on the context
- Use short acknowledgments (e.g. "Okay", "I understand") when appropriate
- Use slightly longer explanations (1-3 sentences) when needed
- Avoid the "same word count" feel while still remaining concise as a caller


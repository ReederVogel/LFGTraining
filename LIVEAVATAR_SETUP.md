# LiveAvatar Setup Guide

## Required Configuration

To use LiveAvatar avatars, you need to configure `voice_id` and `context_id` for each avatar.

### Where to Find These Values

1. **voice_id**: The voice identifier for your avatar (found in LiveAvatar dashboard under avatar settings)
2. **context_id**: The context/knowledge base identifier (found in LiveAvatar dashboard)

### How to Add Them

**IMPORTANT**: `voice_id` and `context_id` must be valid UUIDs (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

Update `lib/avatars.ts` with your avatar configurations:

```typescript
export const avatars: Avatar[] = [
  {
    id: "sarah",
    name: "Sarah",
    role: "Widow",
    scenario: "Lost her husband",
    avatarId: "513fd1b7-7ef9-466d-9af2-344e51eeb833",
    voiceId: "12345678-1234-1234-1234-123456789abc",  // Must be a valid UUID
    contextId: "abcdef12-3456-7890-abcd-ef1234567890", // Must be a valid UUID
  },
  {
    id: "james",
    name: "James",
    role: "Son",
    scenario: "Lost his father",
    avatarId: "55eec60c-d665-4972-a529-bbdcaf665ab8",
    voiceId: "12345678-1234-1234-1234-123456789abc",  // Must be a valid UUID
    contextId: "abcdef12-3456-7890-abcd-ef1234567890", // Must be a valid UUID
  },
];
```

### Where to Find UUID Values

1. Log into your LiveAvatar dashboard
2. Navigate to your avatar settings
3. Look for "Voice ID" and "Context ID" fields
4. Copy the UUID values (they should look like: `513fd1b7-7ef9-466d-9af2-344e51eeb833`)

### Required Before Use

**You MUST add valid UUID values** for `voice_id` and `context_id` before the app will work. The code will now validate these are proper UUIDs and show a clear error if they're missing or invalid.

### API Error Reference

If you see: `"body -> FULL -> avatar_persona: Field required"` or similar validation errors, it means:
- The `avatar_persona` field is required (now included ✅)
- But the `voice_id` and/or `context_id` values may be invalid
- Check your LiveAvatar dashboard for the correct values


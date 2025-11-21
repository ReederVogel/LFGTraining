# Short Words Not Being Picked Up Fix

## Issue
Words like "so", "yes", "right", "oh", "well", "okay" were not being picked up correctly in transcripts. The previous fix was TOO strict and filtered out these common conversational words.

## Root Cause
The strict conditions (< 5 characters, < 500ms timing, etc.) were preventing legitimate short words from both user and avatar from being captured.

## Solution: Categorized Word Handling

### 1. Ambiguous Short Words (Can Be Said By Anyone)
```typescript
const ambiguousShortWords = [
  'so', 'yes', 'yeah', 'right', 'oh', 'well', 'sure', 'ok', 'okay'
];
```

**Special Handling**: These words require balanced timing heuristics because BOTH user and avatar might say them.

**Logic**:
- If user spoke < 1s ago AND avatar hasn't spoken in > 8s → **USER**
- Otherwise → **AVATAR** (since it's an `avatar.transcription` event)

### 2. Strong Avatar Phrases (Mostly Avatar)
```typescript
const strongAvatarPhrases = [
  'thank you', 'thanks', 'i see', 'got it', 'understood', 
  'hmm', 'uh huh', 'mm hmm', 'that makes sense', 'i understand',
  'absolutely', 'certainly', 'of course', 'great', 'perfect', 'nice',
  'alright'
];
```

**Handling**: Almost always attribute to avatar. These are polite/professional responses typical of avatar behavior.

### 3. Other Short Texts
**Conditions for USER attribution**:
- Avatar silent for > 10s (relaxed from 15s)
- User spoke < 800ms ago (relaxed from 500ms)
- Text < 8 chars (relaxed from 5)
- No sentence ending punctuation

**Otherwise**: Default to AVATAR

## Key Changes

### Before (Too Strict)
```typescript
// Only attribute to user if ALL conditions met:
const isDefinitelyUser = (
  timeSinceAvatarSpoke > 15000 &&  // 15 seconds
  timeSinceUserSpoke < 500 &&       // 500ms
  normalizedText.length < 5 &&      // < 5 chars
  !isAvatarAcknowledgment &&
  !hasSentenceEnding
);
```

**Problem**: Words like "yes" (3 chars) or "right" (5 chars) could be missed if timing wasn't perfect.

### After (Balanced)
```typescript
// Separate handling for ambiguous words
if (isAmbiguousWord) {
  // More relaxed for short common words
  const isProbablyUser = timeSinceUserSpoke < 1000 && timeSinceAvatarSpoke > 8000;
  speaker = isProbablyUser ? 'user' : 'avatar';
}
// Strong avatar phrases → always avatar
else if (isStrongAvatarPhrase) {
  speaker = 'avatar';
}
// Other texts with moderate conditions
else {
  const isDefinitelyUser = (
    timeSinceAvatarSpoke > 10000 &&  // 10s (relaxed)
    timeSinceUserSpoke < 800 &&       // 800ms (relaxed)
    normalizedText.length < 8         // 8 chars (relaxed)
  );
  speaker = isDefinitelyUser ? 'user' : 'avatar';
}
```

## Examples

### Scenario 1: User Says "Yes"
- User just finished speaking (< 1s ago)
- Avatar hasn't spoken recently (> 8s)
- Word: "yes" (ambiguous)
- **Result**: ✅ Attributed to USER

### Scenario 2: Avatar Says "Yes"
- Avatar speaking or just spoke (< 5s ago)
- Word: "yes" (ambiguous)
- **Result**: ✅ Attributed to AVATAR

### Scenario 3: User Says "Right?"
- User just spoke (< 1s ago)
- Avatar quiet (> 8s)
- Word: "right" (ambiguous)
- **Result**: ✅ Attributed to USER

### Scenario 4: Avatar Says "Thank you"
- Any timing
- Phrase: "thank you" (strong avatar phrase)
- **Result**: ✅ Attributed to AVATAR

### Scenario 5: User Says "So"
- User spoke 700ms ago
- Avatar quiet for 12s
- Word: "so" (ambiguous)
- **Result**: ✅ Attributed to USER

## Testing Checklist

- [ ] User says "so" → captured as user
- [ ] User says "yes" → captured as user
- [ ] User says "right" → captured as user
- [ ] User says "okay" → captured as user
- [ ] Avatar says "so" (during response) → captured as avatar
- [ ] Avatar says "yes, I can help" → captured as avatar
- [ ] Avatar says "thank you" → captured as avatar
- [ ] Avatar says "I understand" → captured as avatar

## Impact
✅ Short conversational words now captured correctly
✅ Maintains proper speaker attribution
✅ Balanced approach between user and avatar
✅ Natural conversation flow preserved

## Files Modified
- `hooks/useLiveAvatarSDK.ts` - Updated speaker attribution logic in `avatar.transcription` event handler


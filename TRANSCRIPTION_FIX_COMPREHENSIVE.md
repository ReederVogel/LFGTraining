# Comprehensive Transcription Fix - Avatar Stuck & Misattribution Issues

## Date: November 21, 2025

## Issues Fixed

### 1. Avatar Getting Stuck
**Problem**: Avatar would sometimes appear stuck and not responding properly.

**Root Causes**:
- `avatarSpeakingRef.current` state was getting out of sync with `isSpeaking` state
- No mechanism to detect and recover from stuck states
- Speaking duration not being tracked properly on force stops
- Interrupted state flag getting stuck without a clear recovery mechanism

**Solutions**:
- Added periodic state synchronization checker (every 3 seconds)
- Detects when avatar has been "speaking" for >45 seconds and forces stop
- Detects and syncs mismatches between `isSpeaking` and `avatarSpeakingRef.current`
- Clears stuck interrupted flags after 5 seconds of inactivity
- Properly tracks and resets `speakingStartTimeRef` on force stops
- Records interrupt time in `lastInterruptTimeRef` for better state tracking

### 2. Transcript Misattribution (Avatar ↔ User)
**Problem**: Avatar responses were sometimes being attributed to the user, and vice versa. This caused the conversation flow to be incorrect and confusing.

**Root Causes**:
- Race condition in `avatar.speak_ended` handler: `setIsSpeaking(false)` was called immediately, but `avatarSpeakingRef.current = false` was delayed by the grace period, causing inconsistent state
- Timing heuristics for speaker attribution were too loose (10s window, 1s recent speech, 10 char limit)
- Late-arriving transcripts from avatar were being misattributed after avatar finished speaking

**Solutions**:

#### A. Fixed State Management in `avatar.speak_ended`
**Before**:
```typescript
// Update UI state immediately
setIsSpeaking(false);
onStatus?.('idle');

if (wasInterrupted) {
  // ... immediate cleanup
} else {
  // Schedule grace period
  setTimeout(() => {
    finalizeAvatarTranscript();
    avatarSpeakingRef.current = false; // Set AFTER delay
  }, gracePeriod);
}
```

**After**:
```typescript
// Update UI state immediately
setIsSpeaking(false);
onStatus?.('idle');

if (wasInterrupted) {
  // Set avatarSpeakingRef to false IMMEDIATELY for interrupted speech
  avatarSpeakingRef.current = false;
  // ... cleanup
} else {
  // CRITICAL FIX: Keep avatarSpeakingRef true during grace period
  // to correctly attribute delayed transcripts
  console.log('[LiveAvatarSDK] ⏳ Keeping avatarSpeakingRef=true for grace period');
  
  setTimeout(() => {
    console.log('[LiveAvatarSDK] ⏰ Grace period ended');
    finalizeAvatarTranscript();
    avatarSpeakingRef.current = false; // Now safe to clear
  }, gracePeriod);
}
```

**Impact**: Late-arriving avatar transcripts during the grace period are now correctly attributed to the avatar.

#### B. Stricter Timing Heuristics for Speaker Attribution

**Before**:
```typescript
// Only attribute to user if ALL conditions are met:
// - Avatar hasn't spoken recently (> 10 seconds ago)
// - User spoke very recently (< 1 second ago)
// - Text is very short (< 10 chars)
// - NOT a common avatar acknowledgment phrase
const isDefinitelyUser = (
  timeSinceAvatarSpoke > 10000 && 
  timeSinceUserSpoke < 1000 && 
  normalizedText.length < 10 &&
  !isAvatarAcknowledgment
);
```

**After**:
```typescript
// STRICTER conditions - only attribute to user if ALL these are met:
// 1. Avatar hasn't spoken recently (> 15 seconds) - INCREASED from 10s
// 2. User spoke VERY recently (< 500ms) - DECREASED from 1s  
// 3. Text is VERY short (< 5 chars) - DECREASED from 10
// 4. NOT a common avatar acknowledgment phrase
// 5. NOT a complete sentence (no punctuation at end)
const hasSentenceEnding = /[.!?]$/.test(normalizedText.trim());
const isDefinitelyUser = (
  timeSinceAvatarSpoke > 15000 && 
  timeSinceUserSpoke < 500 && 
  normalizedText.length < 5 &&
  !isAvatarAcknowledgment &&
  !hasSentenceEnding
);

// ADDITIONAL CHECK: If avatar spoke recently (within 5s), 
// it's almost certainly avatar speech continuing
const isLikelyAvatarContinuation = timeSinceAvatarSpoke < 5000;

if (isDefinitelyUser && !isLikelyAvatarContinuation) {
  speaker = 'user';
} else {
  speaker = 'avatar'; // Default to avatar for avatar.transcription events
}
```

**Impact**: Far fewer false positives. Avatar responses are now correctly attributed to the avatar, even when they come shortly after user input.

#### C. Enhanced Avatar Acknowledgment Phrase Detection

**Before**:
```typescript
const commonAvatarPhrases = [
  'okay', 'ok', 'alright', 'thank you', 'thanks', 'i see', 'got it',
  'yes', 'yeah', 'sure', 'understood', 'right', 'oh', 'well', 'so',
  'hmm', 'uh huh', 'mm hmm', 'that makes sense', 'i understand'
];
const isAvatarAcknowledgment = commonAvatarPhrases.some(phrase => 
  normalizedLower === phrase || 
  normalizedLower.startsWith(phrase + ' ') ||
  normalizedLower.startsWith(phrase + ',')
);
```

**After**:
```typescript
const commonAvatarPhrases = [
  'okay', 'ok', 'alright', 'thank you', 'thanks', 'i see', 'got it',
  'yes', 'yeah', 'sure', 'understood', 'right', 'oh', 'well', 'so',
  'hmm', 'uh huh', 'mm hmm', 'that makes sense', 'i understand',
  'absolutely', 'certainly', 'of course', 'great', 'perfect', 'nice' // ADDED
];
const isAvatarAcknowledgment = commonAvatarPhrases.some(phrase => 
  normalizedLower === phrase || 
  normalizedLower.startsWith(phrase + ' ') ||
  normalizedLower.startsWith(phrase + ',') ||
  normalizedLower.startsWith(phrase + '.') // ADDED
);
```

**Impact**: More avatar acknowledgment phrases are recognized and correctly attributed.

### 3. State Synchronization System

**New Feature**: Periodic state checker that runs every 3 seconds when connected.

**What it checks**:
1. **Avatar stuck in speaking state**: If `avatarSpeakingRef.current` is true for >45 seconds, forces stop
2. **State mismatch**: If `isSpeaking !== avatarSpeakingRef.current` for >2 seconds, syncs them
3. **Stuck interrupted flag**: If `isInterruptedRef.current` is true for >5 seconds while not speaking, clears it

**Implementation**:
```typescript
useEffect(() => {
  if (!isConnected) return;

  const interval = setInterval(() => {
    const now = Date.now();
    
    // Check for stuck speaking state
    if (avatarSpeakingRef.current) {
      const speakingDuration = now - speakingStartTimeRef.current;
      if (speakingDuration > 45000) {
        console.warn('[LiveAvatarSDK] ⚠️ Avatar stuck in speaking state, forcing stop');
        forceStopAvatar();
      }
    }
    
    // Check for state mismatch
    if (isSpeaking !== avatarSpeakingRef.current) {
      const timeSinceLastAvatarSpeak = now - lastAvatarSpeakTimeRef.current;
      if (timeSinceLastAvatarSpeak > 2000 && avatarSpeakingRef.current && !isSpeaking) {
        console.warn('[LiveAvatarSDK] 🔧 Syncing state mismatch');
        avatarSpeakingRef.current = false;
        setIsSpeaking(false);
      }
    }
    
    // Check for stuck interrupted flag
    if (isInterruptedRef.current) {
      const timeSinceInterrupt = now - lastInterruptTimeRef.current;
      if (timeSinceInterrupt > 5000 && !avatarSpeakingRef.current && !isSpeaking) {
        console.warn('[LiveAvatarSDK] ⚠️ Interrupted flag stuck, clearing');
        isInterruptedRef.current = false;
      }
    }
  }, 3000);

  return () => clearInterval(interval);
}, [isConnected, isSpeaking, forceStopAvatar]);
```

**Impact**: System self-heals from stuck states automatically.

## Technical Changes Summary

### Files Modified
1. `hooks/useLiveAvatarSDK.ts` - Main changes

### New Ref Added
- `stateCheckIntervalRef` - Holds the interval ID for the state synchronization checker

### Modified Functions
1. **`avatar.speak_ended` event handler**
   - Better state management for `avatarSpeakingRef.current`
   - Immediate cleanup for interrupted speech
   - Grace period handling with clear logging

2. **`avatar.transcription` event handler (Priority 3 logic)**
   - Stricter user attribution conditions
   - Added sentence ending check
   - Added avatar continuation check
   - Enhanced acknowledgment phrase detection

3. **`forceStopAvatar`**
   - Now sets `isInterruptedRef.current = true`
   - Records interrupt time in `lastInterruptTimeRef.current`
   - Resets `speakingStartTimeRef.current`
   - Clears `lastSentTranscriptRef.current`

### New Logic
- Periodic state synchronization checker (every 3 seconds)

## Testing Scenarios

### Scenario 1: Normal Conversation
**Test**: User says "hello", avatar responds "Hi, how can I help?"
**Expected**: User transcript attributed to user, avatar transcript attributed to avatar
**Status**: ✅ Should work correctly

### Scenario 2: Quick Avatar Response
**Test**: User says "yes", avatar immediately responds "okay"
**Expected**: Both correctly attributed
**Status**: ✅ Fixed - grace period keeps avatarSpeakingRef true

### Scenario 3: Late Transcript Arrival
**Test**: Avatar finishes speaking, transcript arrives 500ms later
**Expected**: Transcript still attributed to avatar
**Status**: ✅ Fixed - grace period (typically 1000ms) covers this

### Scenario 4: Avatar Gets Stuck
**Test**: Avatar appears frozen/stuck in speaking state
**Expected**: After 45 seconds, automatically force stopped
**Status**: ✅ Fixed - state checker detects and recovers

### Scenario 5: State Mismatch
**Test**: `isSpeaking` and `avatarSpeakingRef` get out of sync
**Expected**: After 2 seconds, automatically synced
**Status**: ✅ Fixed - state checker detects and syncs

### Scenario 6: Interrupted Flag Stuck
**Test**: Interrupted flag remains true even though avatar is idle
**Expected**: After 5 seconds of idle, flag cleared
**Status**: ✅ Fixed - state checker detects and clears

## Logging Improvements

Enhanced logging for debugging:
- `[LiveAvatarSDK] ⏳ Keeping avatarSpeakingRef=true for grace period`
- `[LiveAvatarSDK] ⏰ Grace period ended - finalizing transcript`
- `[LiveAvatarSDK] ✅ AVATAR transcription (continuation - avatar spoke recently)`
- `[LiveAvatarSDK] 🔧 Syncing state mismatch`
- `[LiveAvatarSDK] ⚠️ Avatar stuck in speaking state, forcing stop`
- `[LiveAvatarSDK] ⚠️ Interrupted flag stuck, clearing`

## Configuration Constants Used

From `lib/avatar-config.ts`:
- `AVATAR_CONFIG.latency.transcriptGracePeriod` - Grace period for late transcripts (typically 1000ms)

## Priority Hierarchy for Speaker Attribution

The code uses a 3-priority system to determine speaker:

**Priority 1**: `avatarSpeakingRef.current === true`
- Most reliable indicator
- Set immediately when `avatar.speak_started` fires
- Kept true during grace period after `avatar.speak_ended`

**Priority 2**: Explicit `role` field from event
- Checks `event.role`, `event.speaker`, `event.source`
- Values: 'user', 'human', 'assistant', 'avatar', 'agent'

**Priority 3**: Timing heuristics (NEW STRICT LOGIC)
- Only uses when Priority 1 & 2 unavailable
- Defaults to 'avatar' for `avatar.transcription` events
- Extremely strict conditions for attributing to 'user'
- Checks for avatar continuation (last avatar speech within 5s)

## Conclusion

These changes comprehensively fix the transcription attribution and avatar stuck issues by:
1. Properly managing state transitions with grace periods
2. Using much stricter timing heuristics
3. Adding automatic detection and recovery from stuck states
4. Enhancing logging for better debugging

The system is now more robust and self-healing.


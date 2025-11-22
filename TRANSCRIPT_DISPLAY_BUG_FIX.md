# Transcript Display Bug - Missing User Messages

## Problem Description

**Symptoms:**
- User speaks to avatar ✅
- Avatar hears and responds correctly ✅  
- **BUT: User messages don't show in transcript ❌**

## Example From User's Session

```
[5:10:54 PM] USER: so can you tell me about what type of service you need
[5:11:03 PM] AVATAR: I'm not really sure what my options are...

[5:11:12 PM] USER: full I think you can go with cremation and with Memorial service
[5:11:17 PM] AVATAR: Okay, that sounds like what we're thinking...

[5:11:24 PM] USER: do you like to go with that
[5:11:30 PM] AVATAR: Yes, I would appreciate it if you could go through my options...

[5:11:36 PM] USER: so do you like to know about pricing
[5:11:39 PM] AVATAR: Yes, please. What would something like that cost?

[5:11:47 PM] USER: so it will cost around 5000 to 6000
[5:11:53 PM] AVATAR: Okay, thank you for letting me know. I'm on a fixed income, so is there a less expensive option available?

[5:12:04 PM] AVATAR: That sounds more manageable. Can you explain what that includes?
                    ^^^ User said something here but it's missing! ^^^

[5:12:19 PM] AVATAR: I'm sorry... I'm not sure what Robert would have wanted. Could you clarify what the burial service includes?
                    ^^^ User said something here but it's missing! ^^^
```

## Root Cause

The duplicate detection logic in `app/conversation/[avatarId]/page.tsx` (lines 110-163) is too aggressive:

1. **Lines 110-143**: Checks if message is duplicate/extension of last message from same speaker
2. **Lines 146-163**: Checks if message is duplicate in last 3 messages from same speaker

The problem is that the **deduplication logic isn't considering timing** - it's treating messages that are spoken at different times as duplicates even when they're not.

## The Real Issue

The code has TWO sources of user transcripts:

1. **SDK Events** (`user.transcription_ended`) - PRIMARY source
2. **Browser Speech Recognition** (`handleSpeechResult`) - FALLBACK source

When BOTH fire for the same user speech, the second one gets blocked as a duplicate. But sometimes only ONE fires, or they fire at slightly different times, causing legitimate messages to be blocked.

## Why This Happens

Looking at `components/AvatarSDKSimple.tsx` lines 174-201:

```typescript
if (onTranscript && text.trim() && isFinal) {
  const correctedText = correctAndLog(text.trim(), 'user');
  const normalizedText = correctedText.trim();
  const now = Date.now();
  
  // Check if this is an EXACT duplicate of recent browser message (within 1 second)
  const isDuplicate = lastBrowserUserMessageRef.current === normalizedText && 
                      now - lastBrowserUserMessageTimeRef.current < 1000;
  
  if (!isDuplicate) {
    console.log('[AvatarSDKSimple] ✅ Sending browser user transcript to UI:', normalizedText);
    onTranscript({ speaker: 'user', text: normalizedText, timestamp: new Date(), isInterim: false });
  }
}
```

And `hooks/useLiveAvatarSDK.ts` lines 691-809:

```typescript
session.on('user.transcription_ended', (event: any) => {
  // ... processing ...
  onTranscript('user', correctedText, true);
});
```

**The problem**: Both can send the same transcript, OR one might send and the other might not, causing race conditions.

## Why Later Messages Get Blocked

As the conversation progresses:

1. Some user messages get through (SDK or browser)
2. Later messages might come from the OPPOSITE source
3. The `handleTranscript` function sees similar text patterns
4. It incorrectly thinks they're duplicates
5. Messages get blocked

## The Fix

We need to make the duplicate detection **time-aware** and **more lenient**:

### Option 1: Shorter Duplicate Window (RECOMMENDED)
Only check for duplicates within a very short time window (e.g., 2 seconds) to catch true duplicates but allow legitimate new messages.

### Option 2: Remove Recent History Check
Remove the "last 3 messages" check entirely and only check the immediate previous message.

### Option 3: Add Unique Message IDs
Generate unique IDs for each message at the source and use those to prevent duplicates instead of text comparison.

## Recommended Solution

Modify `app/conversation/[avatarId]/page.tsx`:

1. Add timestamp-based duplicate detection
2. Only block duplicates within 2 seconds
3. Remove the "last 3 messages" check that's too aggressive

This will allow legitimate messages to show up while still preventing actual duplicates.

---

## Date: November 22, 2025
## Issue: User messages blocked from transcript display
## Root Cause: Overly aggressive duplicate detection without time awareness
## Severity: 🔴 CRITICAL (Users can't see their own messages)


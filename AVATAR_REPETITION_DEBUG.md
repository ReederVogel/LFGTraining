# Avatar Repetition Issue - Debugging Guide

## Problem Description

**Symptoms:**
- Avatar repeats the same response multiple times
- Only 1 transcript shows in the UI (duplicates are blocked)
- Audio plays multiple times for the same content

**Example:**
```
User: "Hello"
Avatar: "Hi, I'm calling about..." (audio plays)
Avatar: "Hi, I'm calling about..." (audio plays AGAIN - transcript blocked)
Avatar: "Hi, I'm calling about..." (audio plays AGAIN - transcript blocked)
```

---

## Root Cause

This is **NOT a transcript display bug** - the duplicate detection is working correctly!

The **real issue** is that the **avatar is actually speaking multiple times**.

### Why This Happens:

1. **Avatar doesn't receive stop signal properly**
2. **Session replay/restart causes duplicate responses**
3. **Video buffer contains old audio that replays**
4. **Avatar state not properly reset between responses**

---

## Diagnostic Logging Added

I've added enhanced logging to help identify the cause:

### When Avatar Starts Speaking:

```typescript
🗣️ ========== AVATAR STARTED SPEAKING ==========
🔊 Setting isSpeaking = TRUE
🔍 Interrupted state: false
🔍 Current response ref: "Hi, I'm calling about..."
📝 Recent avatar messages (last 5s):
  [
    { text: "Hi, I'm calling about...", timeAgo: "0.5s" },
    { text: "Hi, I'm calling about...", timeAgo: "2.3s" }  ← DUPLICATE!
  ]
```

### When Duplicate Transcript Detected:

```typescript
⚠️ Duplicate AVATAR transcript detected (recent history), skipping: "Hi, I'm calling about..."
🔍 This means the avatar is REPEATING the same response!
🔍 Recent avatar transcripts:
  [
    { text: "Hi, I'm calling about...", timeAgo: "0.2s ago" },
    { text: "Hi, I'm calling about...", timeAgo: "2.5s ago" }
  ]
🛑 If this happens repeatedly, the avatar may be stuck in a loop
```

---

## How to Debug

### Step 1: Check Console When Repetition Happens

Look for these patterns:

**Pattern 1: Multiple `avatar.speak_started` Events**
```
🗣️ ========== AVATAR STARTED SPEAKING ========== (timestamp: 00:10)
🗣️ ========== AVATAR STARTED SPEAKING ========== (timestamp: 00:12) ← Same response!
```
**Cause:** Avatar is actually starting to speak multiple times  
**Fix:** Need to prevent multiple speak events

**Pattern 2: Interrupted State Issues**
```
⚠️ WARNING: Avatar trying to speak while still marked as interrupted!
🛑 This might be old response - stopping immediately
```
**Cause:** Avatar trying to continue old response after interruption  
**Fix:** Interrupt handling needs improvement

**Pattern 3: No Stop Event Between Repeats**
```
🗣️ AVATAR STARTED SPEAKING (timestamp: 00:10)
(no "AVATAR STOPPED SPEAKING")
🗣️ AVATAR STARTED SPEAKING (timestamp: 00:12) ← Started again without stopping!
```
**Cause:** Avatar not properly stopping before restarting  
**Fix:** Force stop before new speech

---

## Step 2: Check Video Element State

When repetition happens, check the browser console:

```javascript
// Run this in browser console during repetition
const video = document.querySelector('video');
console.log({
  paused: video.paused,
  currentTime: video.currentTime,
  readyState: video.readyState,
  srcObject: video.srcObject,
  tracks: video.srcObject?.getTracks().map(t => ({
    kind: t.kind,
    readyState: t.readyState,
    enabled: t.enabled
  }))
});
```

**Look for:**
- Video playing when it should be stopped
- Multiple audio tracks (shouldn't happen)
- Tracks in weird states

---

## Step 3: Check Recent Transcripts

```javascript
// In browser console
console.log('[DEBUG] Recent transcripts:', 
  recentTranscriptsRef.current.map(t => ({
    speaker: t.speaker,
    text: t.text.substring(0, 50),
    time: new Date(t.time).toLocaleTimeString()
  }))
);
```

**Look for:**
- Multiple identical messages from avatar within seconds
- Timestamps show repetition pattern

---

## Possible Causes & Fixes

### Cause 1: LiveAvatar API Sending Duplicate Events ⚡

**Evidence:**
- Multiple `avatar.speak_started` events
- Same content, same timestamp range

**Current Fix:**
- Duplicate detection blocks duplicate transcripts ✅
- Need to prevent duplicate speak events

**Additional Fix Needed:**
```typescript
// Add debouncing to speak_started event
let lastSpeakStartTime = 0;
session.on('avatar.speak_started', (event) => {
  const now = Date.now();
  if (now - lastSpeakStartTime < 1000) {
    console.log('Debouncing duplicate speak_started event');
    return; // Ignore duplicate within 1 second
  }
  lastSpeakStartTime = now;
  // ... rest of handler
});
```

### Cause 2: Video Buffer Replaying 🎥

**Evidence:**
- Audio plays multiple times
- No multiple `speak_started` events
- Video currentTime jumping back

**Current Fix:**
- Video health monitoring detects loops ✅
- Force stops avatar when loop detected ✅

**Works if:** Logs show "Video appears to be looping/repeating - forcing stop"

### Cause 3: Session Restart/Reconnection 🔄

**Evidence:**
- Happens after network issue
- Happens after interruption
- Multiple reconnection attempts in logs

**Current Fix:**
- Reconnection logic resets state ✅
- Interrupted flag prevents old responses ✅

**Check logs for:**
```
🔄 Attempting reconnection (1/3)...
⚠️ WARNING: Avatar trying to speak while still marked as interrupted!
```

### Cause 4: Turn Detection Issues 🎤

**Evidence:**
- Happens after user speaks
- Multiple responses to same user input

**Check for:**
```
🎤 User transcription ended: "Hello"
🗣️ Avatar started speaking (response 1)
🗣️ Avatar started speaking (response 2) ← Same input triggered twice!
```

**Potential Fix:**
```typescript
// Debounce user input processing
let lastUserInputTime = 0;
let lastUserInputText = '';

session.on('user.transcription_ended', (event) => {
  const now = Date.now();
  const text = event?.text;
  
  // Ignore if same text within 2 seconds
  if (text === lastUserInputText && now - lastUserInputTime < 2000) {
    console.log('Debouncing duplicate user input');
    return;
  }
  
  lastUserInputTime = now;
  lastUserInputText = text;
  // ... process input
});
```

---

## Testing Steps

### Test 1: Check for Duplicate Speak Events

1. Start conversation
2. Say something
3. Watch console for multiple `AVATAR STARTED SPEAKING` logs
4. **Expected:** Only ONE `speak_started` per response
5. **If multiple:** Avatar is receiving duplicate commands

### Test 2: Check Video Looping

1. When repetition happens, check console immediately
2. **Look for:** "Video appears to be looping/repeating"
3. **If found:** Video buffer issue (already handled)
4. **If not found:** Not a video issue

### Test 3: Check Interruption Recovery

1. Start avatar speaking
2. Interrupt by speaking over it
3. Avatar should stop and listen
4. Give new input
5. **Expected:** ONE response to new input
6. **If multiple:** Interruption not clearing state properly

---

## Temporary Workaround

If you need to stop the repetition immediately:

1. Click "End Conversation" button
2. Start new conversation
3. This forces complete state reset

---

## What I've Added

✅ **Enhanced logging** - Shows when repetition is detected  
✅ **Duplicate detection** - Blocks duplicate transcripts (preserves clean UI)  
✅ **Video loop detection** - Stops avatar if video loops  
✅ **Interruption handling** - Prevents old responses after interrupt  
✅ **Reconnection recovery** - Resets state on reconnect  

⏳ **Still investigating:** Root cause of why avatar speaks multiple times

---

## Next Steps

**Please test and report back:**

1. **When does repetition happen?**
   - After user input?
   - During long conversations?
   - After interruptions?
   - After network issues?

2. **What do you see in console?**
   - Multiple `AVATAR STARTED SPEAKING`?
   - Multiple `Recent avatar messages` entries?
   - Any warnings about interruption or looping?

3. **How many times does it repeat?**
   - 2 times? 3 times? More?

4. **Does the transcript show?**
   - You see one transcript but hear multiple?
   - Or you see no transcript at all?

---

**With this diagnostic info, I can pinpoint the exact cause and implement the right fix!** 🎯

---

**Date:** November 22, 2025  
**Issue:** Avatar repeating responses (transcript blocked correctly)  
**Status:** 🟡 **INVESTIGATING** - Diagnostic logging added  
**Impact:** Annoying but duplicate transcripts are blocked (UI stays clean)


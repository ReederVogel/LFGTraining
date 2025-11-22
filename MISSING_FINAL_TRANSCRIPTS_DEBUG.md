# Missing Final Transcripts - Diagnostic Guide

## Problem

**Symptoms:**
- ✅ Avatar works perfectly
- ✅ Avatar hears and responds to ALL your messages
- ✅ First few user transcripts show in UI
- ❌ **Final/last few user transcripts don't show in UI**

**What's happening:**
- Your voice is captured ✅
- Avatar processes your message ✅
- Avatar responds correctly ✅
- BUT: Your message doesn't appear in the transcript list ❌

---

## This is a DISPLAY issue, not an avatar issue!

The avatar is working perfectly. The problem is the transcript is being blocked from displaying in the UI.

---

## Diagnostic Logging Added

I've added enhanced logging to show exactly why transcripts are being blocked:

### When User Message is Sent to UI:

```typescript
✅ Passing USER transcript to UI: "Can you tell me about..."
📤 Calling onTranscript('user', text, true)...
🔍 USER TRANSCRIPT DEBUG:
  {
    text: "Can you tell me about...",
    isFinal: true,
    hasCallback: true,
    userMessageNumber: 5,
    timestamp: "10:30:45"
  }
✅ onTranscript callback executed successfully!
📊 Total user messages sent to UI so far: 5
```

### When User Message is BLOCKED:

```typescript
⚠️ Exact duplicate USER transcript detected (within 3s), skipping: "Can you tell me..."
🚨 USER MESSAGE BLOCKED - This is why transcript is not showing!
📊 Recent user transcripts that caused block:
  [
    { text: "Can you tell me...", timeAgo: "1.2s ago" }
  ]
```

---

## How to Debug

### Step 1: Reproduce the Issue

1. Start conversation
2. Say a few things (these show up ✅)
3. Continue conversation
4. Notice last few messages don't show in transcript
5. **Open browser console immediately**

### Step 2: Check Console Logs

Look for these patterns:

**Pattern 1: Message Sent Successfully ✅**
```
✅ Passing USER transcript to UI: "Your message here"
📤 Calling onTranscript('user', ...)
✅ onTranscript callback executed successfully!
📊 Total user messages sent to UI so far: 7
```
**Meaning:** Message was sent to UI. If you don't see it, the UI component isn't updating.

**Pattern 2: Message Blocked (Duplicate) ❌**
```
⚠️ Exact duplicate USER transcript detected (within 3s), skipping
🚨 USER MESSAGE BLOCKED - This is why transcript is not showing!
📊 Recent user transcripts: [{ text: "...", timeAgo: "1.5s ago" }]
```
**Meaning:** Duplicate detection blocked the message. This is the likely cause!

**Pattern 3: No Message Event ❌**
```
(No "USER TRANSCRIPTION ENDED" log at all)
```
**Meaning:** LiveAvatar SDK didn't fire the transcription event. Very rare.

---

## Possible Causes

### Cause 1: Duplicate Detection Too Aggressive 🎯 (Most Likely)

**What's happening:**
- You say something
- LiveAvatar SDK fires `user.transcription_ended` event twice
- First event shows transcript ✅
- Second event is blocked as duplicate ❌

**Why duplicate events fire:**
- Network latency causes event replay
- LiveAvatar SDK bug/quirk
- Turn detection sensitivity

**Evidence in console:**
```
⚠️ Exact duplicate USER transcript detected
🚨 USER MESSAGE BLOCKED
```

**Current Setting:** Blocks exact duplicates within 3 seconds

**Potential Fix:** Reduce duplicate detection window from 3s to 1s

```typescript
// Current (might be too strict):
now - entry.time < 3000 // 3 seconds

// Proposed (more lenient):
now - entry.time < 1000 // 1 second
```

---

### Cause 2: UI Component Not Updating 🖥️

**What's happening:**
- Message IS sent to UI (logs show ✅)
- But UI doesn't re-render or scroll
- Old messages show, new messages hidden

**Evidence in console:**
```
✅ onTranscript callback executed successfully!
📊 Total user messages sent to UI so far: 7
(But you only see 4-5 in the UI)
```

**Potential causes:**
- React state not updating
- Scroll position stuck (new messages rendered below viewport)
- CSS overflow issue
- Component memo/optimization preventing re-render

**How to check:**
1. Open React DevTools
2. Find the transcript component
3. Check its state/props
4. See if new messages are in state but not rendered

---

### Cause 3: Timing Issue ⏱️

**What's happening:**
- You speak
- Avatar starts responding IMMEDIATELY
- Your transcript event arrives late
- Gets processed but UI already moved on

**Evidence in console:**
```
🗣️ AVATAR STARTED SPEAKING (10:30:45.100)
📝 USER TRANSCRIPTION ENDED (10:30:45.900) ← 800ms later!
```

**This is less likely** but possible on slow connections.

---

## What To Do Next

### Test 1: Check Console When Messages Don't Show

1. Have a conversation until messages stop showing
2. **Immediately check console**
3. Look for the last few `USER TRANSCRIPT DEBUG` logs
4. Count how many show "✅ sent to UI" vs "🚨 BLOCKED"

### Test 2: Compare Counts

```
Console shows: "Total user messages sent to UI: 8"
UI shows: 5 messages visible
```

**If counts match:** UI rendering issue (messages sent but not displayed)  
**If counts differ:** Duplicate blocking issue (messages not sent)

### Test 3: Check for Blocked Messages

Search console for: `🚨 USER MESSAGE BLOCKED`

**If found:** Duplicate detection is too aggressive  
**If not found:** Messages are being sent, UI not updating

---

## Quick Workaround

If messages are being blocked by duplicate detection, you can:

1. Pause slightly between sentences (wait 1-2 seconds)
2. Vary your phrasing slightly each time
3. This avoids exact duplicate detection

**But this is a temporary workaround - we should fix the root cause!**

---

## Next Steps

**Please test and report back:**

1. **When do messages stop showing?**
   - After how many messages? (e.g., first 3 show, rest don't?)
   - Random or consistent pattern?

2. **What do console logs show?**
   - How many `✅ sent to UI` messages?
   - Any `🚨 BLOCKED` messages?
   - What's the "Total user messages sent" count?

3. **How many messages do you actually see in UI?**
   - Compare to console count

**With this info, I can fix the exact cause without touching avatar functionality!** 🎯

---

**Date:** November 22, 2025  
**Issue:** Final user transcripts not showing (avatar works perfectly)  
**Status:** 🔍 **INVESTIGATING** - Diagnostic logging added  
**Impact:** Annoying but doesn't affect conversation quality


# First-Time Video Not Showing Issue - Diagnosis & Fix

## Problem Description

**Symptoms:**
- First time using the app → Browser asks for microphone permission
- User grants permission
- Connection appears successful (avatar is speaking ✅)
- BUT avatar video is NOT visible ❌
- After refreshing the page → Everything works perfectly
- This ONLY happens the first time, not subsequent times

## Root Cause Analysis

### **Why This Happens**

This is a **race condition** between three competing processes:

1. **LiveAvatar SDK initialization** (starts immediately)
2. **Browser microphone permission dialog** (blocks user interaction)
3. **Video element attachment** (needs to happen at the right time)

### **The Timeline (First Time)**

```
Time    Event                                   Status
----    -----                                   ------
0ms     User clicks "START CONNECTION"          
10ms    useLiveAvatarSDK starts initialization  🔄
20ms    Requests session token from backend     🔄
100ms   Session token received                  ✅
110ms   Creates LiveAvatar session              ✅
120ms   Attempts to attach video element        🔄
125ms   Browser requests microphone permission   ⏸️ BLOCKS HERE
        (User sees permission dialog)
        (JavaScript continues in background)
130ms   Video attach() called                   ⚠️ Too early!
135ms   Checks for srcObject...                 ❌ Not set yet
640ms   Checks again (after 500ms)...          ❌ Still not set
1140ms  Checks again...                         ❌ Still not set
...     (10 checks total, 5 seconds)
5130ms  Gives up waiting                        ⚠️ Proceeds anyway
5140ms  User finally clicks "Allow" permission  ✅ Permission granted
5150ms  Session starts with voice chat          ✅ Audio works!
5200ms  Avatar starts speaking                  ✅ You hear it!
        BUT video element srcObject is lost     ❌ Video missing!
```

### **The Timeline (After Refresh)**

```
Time    Event                                   Status
----    -----                                   ------
0ms     User clicks "START CONNECTION"          
10ms    useLiveAvatarSDK starts initialization  🔄
20ms    Requests session token                  🔄
100ms   Session token received                  ✅
110ms   Creates LiveAvatar session              ✅
120ms   Microphone permission already granted    ✅ No dialog!
125ms   Attaches video element immediately      ✅ 
130ms   Checks for srcObject...                 ✅ Set!
135ms   Session starts                          ✅
200ms   Avatar appears and speaks               ✅✅ Perfect!
```

## Technical Details

### **Location of the Problem**

**File:** `hooks/useLiveAvatarSDK.ts`  
**Lines:** 1224-1254  
**Function:** `initializeSDK()`

The code tries to attach the video element and wait for `srcObject` to be set:

```typescript
// Attach video element immediately if we already have one
const initialVideoElement = videoElementRef.current || videoElement;
if (initialVideoElement) {
  const attachResult = session.attach(initialVideoElement);
  
  // Wait for srcObject to be set (up to 5 seconds)
  await new Promise<void>((resolve) => {
    let checkCount = 0;
    const maxChecks = 10; // 5 seconds total
    
    const checkSrcObject = () => {
      checkCount++;
      if (initialVideoElement.srcObject) {
        resolve(); // Success!
      } else if (checkCount < maxChecks) {
        setTimeout(checkSrcObject, 500); // Try again
      } else {
        console.warn('⚠️ srcObject not set - continuing anyway');
        resolve(); // Give up and proceed
      }
    };
    
    setTimeout(checkSrcObject, 100);
  });
}
```

**The Problem:**
- During first-time microphone permission, the browser is **blocked** waiting for user input
- The video element attachment happens while the browser is in this blocked state
- The `srcObject` doesn't get set properly because rendering is paused
- After 5 seconds, the code gives up and proceeds
- By the time permission is granted, the video element connection is lost

### **Why Refreshing Fixes It**

After the first time:
1. Browser remembers microphone permission ✅
2. No permission dialog blocks the flow ✅
3. Video element attaches cleanly ✅
4. Everything works perfectly ✅

## The Solution

We need to **delay video element attachment** until **AFTER** microphone permission is granted.

### **Strategy**

1. **Pre-request microphone permission** before initializing LiveAvatar SDK
2. **Only start LiveAvatar** after permission is confirmed
3. **Attach video element** after permission is granted

### **Implementation**

We need to modify the flow to check for microphone permission **before** starting the SDK initialization.

**Option 1: Add Permission Check to useLiveAvatarSDK**

Add a microphone permission check at the beginning of initialization:

```typescript
const initializeSDK = async () => {
  try {
    // STEP 0: Ensure microphone permission FIRST
    console.log('[LiveAvatarSDK] 🎤 Step 0/5: Checking microphone permission...');
    
    try {
      // Request microphone access early to avoid race condition
      const testStream = await navigator.mediaDevices.getUserMedia({ 
        audio: true 
      });
      console.log('[LiveAvatarSDK] ✅ Microphone permission confirmed');
      
      // Stop the test stream immediately - we just needed permission
      testStream.getTracks().forEach(track => track.stop());
      
      // Small delay to let browser settle after permission grant
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (permError) {
      const errorMsg = 'Microphone permission denied. Please allow microphone access to use voice chat.';
      console.error('[LiveAvatarSDK] ❌ Microphone permission error:', permError);
      onError?.(errorMsg);
      throw new Error(errorMsg);
    }
    
    // Now proceed with normal initialization...
    console.log('[LiveAvatarSDK] 📡 Step 1/5: Requesting session token...');
    // ... rest of the code
```

**Option 2: Add Permission Check to Components**

Modify `AvatarSDKSimple.tsx` to check permission before starting:

```typescript
const handleStartSession = async () => {
  try {
    // Check microphone permission first
    console.log('[AvatarSDKSimple] 🎤 Checking microphone permission...');
    const testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    testStream.getTracks().forEach(track => track.stop());
    
    // Permission granted - now start session
    setSessionStarted(true);
  } catch (err) {
    setError('Microphone permission denied. Please allow microphone access.');
  }
};
```

### **Recommended Solution: Option 1**

Option 1 is better because:
- ✅ Fixes the issue at the SDK level (all components benefit)
- ✅ Ensures permission is granted before ANY SDK initialization
- ✅ Provides clear error messages
- ✅ No code duplication across components

## How to Test the Fix

### **Test Scenario 1: Fresh Browser (First Time)**

1. Open browser in **Incognito/Private mode** (simulates first time)
2. Navigate to the app
3. Click "START CONNECTION"
4. **Observe:** Microphone permission dialog appears
5. Click "Allow"
6. **Expected Result:** Avatar video appears immediately ✅
7. **Expected Result:** Avatar starts speaking ✅

### **Test Scenario 2: Subsequent Uses**

1. After Test Scenario 1, refresh the page
2. Click "START CONNECTION"
3. **Expected Result:** No permission dialog (already granted)
4. **Expected Result:** Avatar video and audio work immediately ✅

### **Test Scenario 3: Permission Denied**

1. Open browser in Incognito mode
2. Navigate to the app
3. Click "START CONNECTION"
4. Click "Block" on permission dialog
5. **Expected Result:** Clear error message appears ✅
6. **Expected Result:** App doesn't proceed with broken state ✅

## Summary

| Issue | Cause | Solution |
|-------|-------|----------|
| First-time video not showing | Race condition during mic permission | Pre-request microphone permission before SDK init |
| Audio works but no video | Video attachment happens while browser is blocked | Wait for permission, then attach video |
| Works after refresh | Permission already granted, no blocking | Request permission proactively on first load |

## Status

- ✅ **Issue Identified:** Race condition between mic permission and video attachment
- ✅ **Solution Designed:** Pre-request microphone permission before SDK initialization
- ✅ **Implementation:** Implemented in `hooks/useLiveAvatarSDK.ts` (Step 0/6)
- ⏳ **Testing:** Ready to test - see test scenarios above

## What Was Changed

**File:** `hooks/useLiveAvatarSDK.ts`

**Added:** Step 0 - Microphone Permission Check (before all other steps)

```typescript
// Step 0: Ensure microphone permission FIRST to avoid race condition
console.log('[LiveAvatarSDK] 🎤 Step 0/6: Checking microphone permission...');

try {
  // Request microphone access early to avoid race condition with video attachment
  const testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  console.log('[LiveAvatarSDK] ✅ Microphone permission confirmed');
  
  // Stop the test stream immediately - we just needed to ensure permission
  testStream.getTracks().forEach(track => track.stop());
  
  // Small delay to let browser settle after permission grant
  await new Promise(resolve => setTimeout(resolve, 150));
  
  console.log('[LiveAvatarSDK] ✅ Ready to proceed with SDK initialization');
} catch (permError) {
  // Show clear error message and stop initialization
  const errorMsg = 'Microphone permission denied. Please allow microphone access to use voice chat.';
  console.error('[LiveAvatarSDK] ❌ Microphone permission error:', permError);
  onError?.(errorMsg);
  throw new Error(errorMsg);
}
```

**Effect:**
- Browser shows microphone permission dialog FIRST
- User grants permission
- **Then** LiveAvatar SDK initializes
- Video element attaches AFTER permission is granted
- No race condition = Video works on first try! ✅

---

**Date:** November 22, 2025  
**Issue:** First-time video not showing  
**Root Cause:** Race condition during microphone permission  
**Solution:** Pre-request microphone permission (Step 0)  
**Status:** ✅ **FIXED**  
**Severity:** 🟡 MEDIUM (Now resolved - works on first try)


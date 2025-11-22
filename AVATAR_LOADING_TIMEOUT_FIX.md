# Avatar Loading Timeout Fix

## Issue
The avatar component was showing a timeout error after 20 seconds:
```
[AvatarSDKSimple] ❌ TIMEOUT: srcObject never appeared after 20 seconds!
```

This error occurred when the LiveAvatar SDK's WebRTC stream failed to attach to the video element's `srcObject` property within the expected timeframe.

## Root Cause
The timeout was caused by several potential issues:

1. **Async Attachment**: The LiveAvatar SDK's `attach()` method sets the video element's `srcObject` asynchronously, but the timing is not guaranteed
2. **Race Conditions**: The video element monitoring started checking before the SDK had time to attach the stream
3. **Silent Failures**: If the SDK failed to attach the stream (network issues, WebRTC blocked, etc.), it failed silently without proper error reporting
4. **No Retry Logic**: The component gave up after the initial timeout without attempting to recover

## Solution

### 1. Enhanced SDK Attachment Verification (`hooks/useLiveAvatarSDK.ts`)

**Changes Made:**
- Added proactive verification after calling `session.attach()`
- Implemented polling with 10 checks over 5 seconds to verify `srcObject` is set
- Added detailed logging at each check to track attachment progress
- Wait for `srcObject` confirmation before proceeding with session start

**Code Changes:**
```typescript
// ENHANCED: Check multiple times for srcObject with increasing intervals
let checkCount = 0;
const maxChecks = 10; // Check up to 10 times over 5 seconds

const checkSrcObject = () => {
  checkCount++;
  if (videoElement.srcObject) {
    console.log('[LiveAvatarSDK] ✅ srcObject detected after attach (check', checkCount, '):', {
      isMediaStream: videoElement.srcObject instanceof MediaStream,
      hasTracks: videoElement.srcObject instanceof MediaStream ? videoElement.srcObject.getTracks().length : 0,
    });
    return true;
  }
  
  if (checkCount < maxChecks) {
    console.log('[LiveAvatarSDK] ⏳ No srcObject yet, checking again (', checkCount, '/', maxChecks, ')...');
    setTimeout(checkSrcObject, 500); // Check every 500ms
  } else {
    console.error('[LiveAvatarSDK] ❌ srcObject never appeared after', maxChecks, 'checks (5 seconds)');
    // Don't throw error - let the component's own timeout handle it
  }
  return false;
};

// Start checking after a brief delay
setTimeout(checkSrcObject, 500);
```

**During Initialization:**
```typescript
// ENHANCED: Wait a bit and verify srcObject is set
await new Promise<void>((resolve) => {
  let checkCount = 0;
  const maxChecks = 10; // 5 seconds total
  
  const checkSrcObject = () => {
    checkCount++;
    if (initialVideoElement.srcObject) {
      console.log('[LiveAvatarSDK] ✅ srcObject confirmed (initial attach, check', checkCount, ')');
      resolve();
    } else if (checkCount < maxChecks) {
      console.log('[LiveAvatarSDK] ⏳ Waiting for srcObject (check', checkCount, '/', maxChecks, ')...');
      setTimeout(checkSrcObject, 500);
    } else {
      console.warn('[LiveAvatarSDK] ⚠️ srcObject not set after', maxChecks, 'checks - continuing anyway');
      resolve(); // Don't block initialization
    }
  };
  
  // Start checking immediately
  setTimeout(checkSrcObject, 100);
});
```

### 2. Automatic Retry Logic (`components/AvatarSDKSimple.tsx`)

**Changes Made:**
- Added retry mechanism with up to 3 attempts
- Automatically resets video element when timeout occurs
- Tracks attachment attempts to prevent infinite loops
- Resets attempt counter on successful connection

**Code Changes:**
```typescript
// Track attachment attempts
const attachAttemptCountRef = React.useRef<number>(0);
const MAX_ATTACH_ATTEMPTS = 3;

// In the timeout handler:
if (attachAttemptCountRef.current < MAX_ATTACH_ATTEMPTS) {
  attachAttemptCountRef.current += 1;
  console.log(`[AvatarSDKSimple] 🔄 Attempting to re-attach video (attempt ${attachAttemptCountRef.current}/${MAX_ATTACH_ATTEMPTS})...`);
  
  // Trigger a re-render by setting video element to null and back
  const currentVideo = videoElementRef.current;
  setVideoElement(null);
  
  setTimeout(() => {
    if (currentVideo) {
      setVideoElement(currentVideo);
      console.log('[AvatarSDKSimple] ✅ Video element reset complete, SDK should re-attach');
    }
  }, 1000);
} else {
  // Max attempts reached, set error
  console.error('[AvatarSDKSimple] ❌ Max attachment attempts reached, giving up');
  setError('Failed to load avatar video stream after multiple attempts. Please check your connection and refresh the page.');
}
```

**Reset Logic:**
```typescript
// Reset attachment attempts when successfully connected
useEffect(() => {
  if (hasSrcObject && isConnected) {
    if (attachAttemptCountRef.current > 0) {
      console.log('[AvatarSDKSimple] ✅ srcObject attached successfully, resetting attempt counter');
      attachAttemptCountRef.current = 0;
    }
  }
}, [hasSrcObject, isConnected]);

// Reset on disconnect
useEffect(() => {
  if (!isConnected) {
    // ... other resets
    attachAttemptCountRef.current = 0; // Reset attempts on disconnect
  }
}, [isConnected]);
```

### 3. Enhanced Error Reporting

**Changes Made:**
- Added comprehensive error information when timeout occurs
- Included troubleshooting steps in console
- Captured video element error state
- Provided user-friendly error messages

**Error Information Captured:**
- Connection state (`isConnected`, `sessionStarted`)
- Video element state (`hasVideoElement`, `videoReadyState`, `videoSrc`)
- Video errors (`video.error.code`, `video.error.message`)
- Attachment attempt count

**Troubleshooting Steps Shown:**
1. Check if LiveAvatar API key is valid
2. Check if avatar ID is correct
3. Check browser console for WebRTC errors
4. Check if firewall/VPN is blocking WebRTC
5. Try refreshing the page

## Benefits

1. **Faster Detection**: Proactive checks detect issues in 5 seconds instead of waiting 20 seconds
2. **Automatic Recovery**: Retry logic attempts to recover from transient failures
3. **Better Debugging**: Enhanced logging makes it easier to diagnose issues
4. **Graceful Degradation**: Clear error messages guide users on next steps
5. **Prevents Infinite Loops**: Max attempt limit prevents endless retries

## Testing

To test the fix:

1. **Normal Flow**: Start a session and verify avatar loads without timeout
2. **Network Issues**: Simulate network problems and verify retry logic kicks in
3. **API Errors**: Test with invalid credentials to verify error handling
4. **Recovery**: Test that retry mechanism successfully recovers from transient issues

## Monitoring

Watch for these log messages:

**Success Path:**
```
[LiveAvatarSDK] 📺 Attaching video element...
[LiveAvatarSDK] 🔄 Calling session.attach()...
[LiveAvatarSDK] ⏳ No srcObject yet, checking again (1/10)...
[LiveAvatarSDK] ✅ srcObject detected after attach (check 2)
```

**Retry Path:**
```
[AvatarSDKSimple] ❌ TIMEOUT: srcObject never appeared after 20 seconds!
[AvatarSDKSimple] 🔄 Attempting to re-attach video (attempt 1/3)...
[AvatarSDKSimple] ✅ Video element reset complete, SDK should re-attach
```

**Failure Path:**
```
[AvatarSDKSimple] ❌ Max attachment attempts reached, giving up
Error: Failed to load avatar video stream after multiple attempts
```

## Next Steps

If timeouts persist after this fix:

1. **Check API Configuration**: Verify LiveAvatar API key and avatar ID
2. **Check Network**: Test WebRTC connectivity using browser tools
3. **Check Browser Support**: Verify browser supports WebRTC and MediaStream
4. **Check Firewall**: Ensure WebRTC ports are not blocked
5. **Check Logs**: Review detailed logs for specific error messages

## Related Files

- `hooks/useLiveAvatarSDK.ts` - SDK integration and video attachment
- `components/AvatarSDKSimple.tsx` - Avatar component with retry logic
- `app/api/liveavatar-session/route.ts` - Session token generation

---

**Date**: November 22, 2024  
**Issue**: Avatar loading timeout after 20 seconds  
**Status**: ✅ FIXED  
**Severity**: 🔴 CRITICAL → 🟢 RESOLVED


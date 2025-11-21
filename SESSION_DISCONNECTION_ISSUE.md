# CRITICAL: Session Disconnection Disables Speech Recognition

## The Issue

**What Happened**:
```
1. User starts conversation → Session connects → Speech recognition works ✅
2. Session disconnects (network/timeout/error) → isConnected = false
3. Speech recognition DISABLED (enabled: !!onTranscript && isConnected)
4. User tries to speak → VAD detects it ✅ but NO transcription ❌
5. After 10 seconds → Timeout error fires ❌
```

**Logs Show**:
```
[HybridSpeech] ⚠️ Speech recognition not enabled
enabled: false  ← Because isConnected = false!

disconnect from room Object  ← Session disconnected!

[ClientVAD] 🎤 Speech started  ← VAD working
[LiveAvatarSDK] ❌ CRITICAL: User spoke but no transcription arrived after 10 seconds!
```

---

## Root Cause

### Code Path:

**1. Disconnection** (`hooks/useLiveAvatarSDK.ts` lines 283-293):
```typescript
session.on('session.disconnected', (reason: any) => {
  console.log('[LiveAvatarSDK] 📴 Session disconnected:', reason);
  setIsConnected(false);  // ← Sets isConnected to false
  onStatus?.('idle');
});
```

**2. Speech Recognition Disabled** (`components/AvatarSDKSimple.tsx` line 174):
```typescript
useHybridSpeechRecognition({
  // ... other params
  enabled: !!onTranscript && isConnected,  // ← Becomes false when disconnected!
});
```

**3. Result**:
- Speech recognition stops
- User can speak but nothing gets transcribed
- VAD still works (it's independent)
- User messages are completely lost

---

## Why Session Disconnects

Possible causes:
1. **Network issues** - Poor connection, packet loss
2. **LiveAvatar server timeout** - Session expires after inactivity
3. **API errors** - Rate limiting, authentication issues
4. **Browser issues** - Tab goes to background, system sleep
5. **WebRTC connection failure** - Firewall, NAT issues

---

## Fix Applied ✅

### 1. Disconnection Detection

**File**: `components/AvatarSDKSimple.tsx` (Lines 268-275)

Added monitoring for disconnections:

```typescript
// Handle disconnections - CRITICAL for speech recognition
useEffect(() => {
  if (sessionStarted && !isConnected) {
    console.error('[AvatarSDKSimple] ❌ CRITICAL: Session disconnected!');
    console.error('[AvatarSDKSimple] Speech recognition is now DISABLED');
    console.error('[AvatarSDKSimple] User will NOT be able to send messages');
    setError('Session disconnected. Speech recognition stopped. Please refresh the page.');
    onError?.('Session disconnected. Please refresh the page to continue.');
  }
}, [sessionStarted, isConnected, onError]);
```

**Benefits**:
- Immediately detects when session disconnects
- Sets error state
- Calls onError callback to notify user
- Logs detailed error information

### 2. Visual Indicator

**File**: `components/AvatarSDKSimple.tsx` (Lines 287-294)

Added "Disconnected" status:

```typescript
const status = React.useMemo(() => {
  if (!sessionStarted) return { color: 'bg-gray-400', text: 'Session not started', pulse: false };
  if (sessionStarted && !isConnected) return { 
    color: 'bg-red-500', 
    text: 'Disconnected - Refresh Page!',  // ← NEW!
    pulse: true 
  };
  // ... other statuses
}, [sessionStarted, avatarIsSpeaking, isListening, userInterrupted, isConnected]);
```

**Result**: User sees clear RED indicator saying "Disconnected - Refresh Page!"

---

## What Users Will See Now

### Before Fix (Silent Failure):
```
[User speaks]
... nothing happens ...
[User keeps speaking]
... still nothing ...
[User confused why avatar isn't responding]
```

### After Fix (Clear Error):
```
[Session disconnects]
→ Error banner: "Session disconnected. Please refresh the page to continue."
→ Status indicator: RED "Disconnected - Refresh Page!"
→ Console logs: Detailed disconnection info

[User sees error immediately]
→ User refreshes page
→ Conversation resumes
```

---

## Complete Error Flow

```
1. Session disconnects
   ↓
2. isConnected = false
   ↓
3. useEffect detects (sessionStarted && !isConnected)
   ↓
4. Logs errors to console
   ↓
5. Sets error state
   ↓
6. Calls onError callback
   ↓
7. Status changes to RED "Disconnected - Refresh Page!"
   ↓
8. User sees error message
   ↓
9. User refreshes page
   ↓
10. Session reconnects
```

---

## Future Improvements Needed

### Option 1: Auto-Reconnect (Ideal)

**Location**: `hooks/useLiveAvatarSDK.ts`

```typescript
session.on('session.disconnected', (reason: any) => {
  console.log('[LiveAvatarSDK] 📴 Session disconnected:', reason);
  setIsConnected(false);
  
  // AUTO-RECONNECT LOGIC
  console.log('[LiveAvatarSDK] 🔄 Attempting to reconnect...');
  let retryCount = 0;
  const maxRetries = 3;
  
  const tryReconnect = async () => {
    if (retryCount >= maxRetries) {
      console.error('[LiveAvatarSDK] ❌ Max reconnection attempts reached');
      onError?.('Connection lost. Please refresh the page.');
      return;
    }
    
    retryCount++;
    console.log(`[LiveAvatarSDK] 🔄 Reconnection attempt ${retryCount}/${maxRetries}`);
    
    try {
      // Re-initialize session
      await initializeSDK();
      console.log('[LiveAvatarSDK] ✅ Reconnected successfully!');
      onError?.(null); // Clear error
    } catch (error) {
      console.error(`[LiveAvatarSDK] ❌ Reconnection attempt ${retryCount} failed`);
      setTimeout(tryReconnect, 2000 * retryCount); // Exponential backoff
    }
  };
  
  // Wait 1 second before first retry
  setTimeout(tryReconnect, 1000);
});
```

**Benefits**:
- Automatic recovery from temporary network issues
- User doesn't need to refresh
- Seamless experience

**Challenges**:
- Need to preserve conversation state
- Need to handle mid-conversation reconnection
- Might cause duplicate messages

### Option 2: Keep Speech Recognition Running (Buffer)

**Location**: `components/AvatarSDKSimple.tsx`

```typescript
useHybridSpeechRecognition({
  // ... other params
  // Keep running even when disconnected
  enabled: !!onTranscript,  // ← Remove && isConnected check
});

// Buffer messages while disconnected
const messageBufferRef = useRef<string[]>([]);

const handleSpeechResult = useCallback((text: string, isFinal: boolean) => {
  if (!text.trim()) return;
  
  if (isFinal && speak) {
    const finalText = text.trim();
    
    if (!isConnected) {
      // Buffer message while disconnected
      console.log('[AvatarSDKSimple] 💾 Buffering message (disconnected):', finalText);
      messageBufferRef.current.push(finalText);
      onTranscript?.({ 
        speaker: 'user', 
        text: finalText + ' (PENDING)', 
        timestamp: new Date() 
      });
    } else {
      // Send immediately when connected
      speak(finalText);
    }
  }
}, [onTranscript, speak, isConnected]);

// Send buffered messages when reconnected
useEffect(() => {
  if (isConnected && messageBufferRef.current.length > 0) {
    console.log('[AvatarSDKSimple] 📤 Sending buffered messages:', messageBufferRef.current.length);
    messageBufferRef.current.forEach(msg => speak(msg));
    messageBufferRef.current = [];
  }
}, [isConnected, speak]);
```

**Benefits**:
- No messages lost
- Speech recognition keeps running
- Messages sent when reconnected

**Challenges**:
- Might confuse users (why is avatar not responding?)
- Order of messages might be wrong after reconnect
- Buffered messages might be outdated

### Option 3: Reconnect Button (Current + UI)

**Current fix**: Shows error message telling user to refresh

**Enhancement**: Add dedicated "Reconnect" button

```typescript
const handleReconnect = async () => {
  setError(null);
  setHasUserInteracted(false);
  setSessionStarted(false);
  
  // Wait a moment for cleanup
  setTimeout(() => {
    setSessionStarted(true);
    setAudioEnabled(true);
  }, 500);
};

// In UI:
{error && (
  <div className="error-banner">
    <p>{error}</p>
    <button onClick={handleReconnect}>
      Reconnect
    </button>
  </div>
)}
```

**Benefits**:
- User doesn't need to refresh entire page
- Faster recovery
- Preserves other page state

---

## Recommended Solution

**Implement All Three**:

1. ✅ **Current Fix (Error Message)** - DONE
   - Immediate visibility into problem
   - Clear user guidance

2. 🔄 **Auto-Reconnect (Priority 1)** - NEEDED
   - Try 3 times with exponential backoff
   - Show "Reconnecting..." status
   - Fall back to error message if all attempts fail

3. 🔘 **Reconnect Button (Priority 2)** - NICE TO HAVE
   - Manual reconnect option
   - Don't require full page refresh
   - Faster than refresh for user

---

## Testing

### How to Simulate Disconnection:

1. **Network Disconnect**:
   - Open DevTools → Network tab
   - Set "Offline" mode
   - Wait for disconnection
   - Check for error message

2. **Session Timeout**:
   - Leave conversation idle for 5-10 minutes
   - Check if session expires
   - Verify error appears

3. **Browser Background**:
   - Minimize browser or switch tabs
   - Wait several minutes
   - Return to tab
   - Check connection status

### Expected Behavior After Fix:

1. ✅ Error message appears immediately
2. ✅ Status shows "Disconnected - Refresh Page!" in RED
3. ✅ Console shows detailed logs
4. ✅ User knows what to do (refresh)

---

## Monitoring

### Console Logs to Watch:

**Disconnection Detected**:
```
[LiveAvatarSDK] 📴 Session disconnected: [reason]
[LiveAvatarSDK] 🔄 Session state changed: DISCONNECTED
[AvatarSDKSimple] ❌ CRITICAL: Session disconnected!
[AvatarSDKSimple] Speech recognition is now DISABLED
```

**User Tries to Speak While Disconnected**:
```
[ClientVAD] 🎤 Speech started  ← VAD works
[HybridSpeech] ⚠️ Speech recognition not enabled  ← But recognition doesn't!
[LiveAvatarSDK] ❌ CRITICAL: User spoke but no transcription arrived after 10 seconds!
```

---

## Summary

**Problem**: Session disconnection silently disables speech recognition

**Impact**: User can speak but messages are lost (VAD detects but no transcription)

**Immediate Fix**: ✅ Clear error message + visual indicator

**Long-term Fix**: 🔄 Auto-reconnect logic (NEEDED)

**User Action**: Refresh page when "Disconnected" appears

---

**Date**: November 21, 2024  
**Issue**: Session disconnection disables speech recognition  
**Root Cause**: Speech recognition depends on `isConnected` flag  
**Immediate Fix**: ✅ Error detection + user notification  
**Status**: ⚠️ PARTIALLY FIXED (needs auto-reconnect)  
**Severity**: 🔴 CRITICAL (Messages lost when disconnected)


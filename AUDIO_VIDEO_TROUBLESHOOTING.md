# Audio & Video Troubleshooting Guide

## What I Fixed

I've identified and fixed common issues that prevent audio playback and avatar animation:

### 1. **Browser Autoplay Policy**
- Modern browsers block autoplay with sound unless there's user interaction
- **Fix Applied**: Added explicit audio unmuting after user clicks "Start Training"
- **Fix Applied**: Added fallback to play muted first, then unmute after 100ms

### 2. **Video Element Audio Not Enabled**
- The video element might not have audio properly enabled
- **Fix Applied**: Explicitly set `video.muted = false` and `video.volume = 1.0`
- **Fix Applied**: Added "Enable Audio" button that appears if audio is blocked

### 3. **Better Error Logging**
- Added comprehensive logging to track video/audio state
- Now logs: video dimensions, audio tracks, muted state, volume, play state

## How to Test

1. **Start the application**
   ```bash
   npm run dev
   ```

2. **Open browser console** (F12 or Right-click → Inspect → Console)

3. **Click "Start Training"** button
   - Watch console for `[LiveAvatarSDK]` and `[AvatarSDKSimple]` logs
   - Look for messages about video playing/muted state

4. **Check for these key indicators:**
   - ✅ `Video playing with audio` - Audio should work
   - ⚠️ `Autoplay with audio prevented` - Audio blocked, will try workaround
   - ✅ `Video unmuted` - Audio should now work
   - ❌ `Failed to play video` - Check browser settings

5. **If you see "Enable Audio" button**
   - Click it to manually enable audio
   - This ensures user interaction for autoplay policy

## Common Issues & Solutions

### Issue: Can't hear audio
**Symptoms**: Video shows avatar moving but no sound

**Solutions**:
1. Check browser tab is not muted (look for mute icon on tab)
2. Check system volume is not at 0
3. Click the "Enable Audio" button if it appears
4. Check browser console for errors
5. Try different browser (Chrome, Firefox, Edge)

### Issue: Avatar not moving/speaking visually
**Symptoms**: Shows "Speaking" status but avatar is still

**Check**:
1. Console should show: `Video metadata loaded` with:
   - `videoWidth > 0` and `videoHeight > 0` ✅
   - `hasVideo: true` ✅
2. If videoWidth is 0, the video stream isn't loading properly
3. Check for WebRTC/network errors in console

### Issue: Shows "Listening" and "Speaking" but nothing happens
**This means**:
- ✅ Speech recognition is working
- ✅ Avatar SDK is processing
- ❌ Video/audio playback is blocked

**Solution**:
1. Look for `[LiveAvatarSDK] Video element attached` in console
2. Check if video element exists: `document.querySelector('video')`
3. In console, run:
   ```javascript
   const video = document.querySelector('video');
   console.log({
     paused: video.paused,
     muted: video.muted,
     volume: video.volume,
     videoWidth: video.videoWidth,
     readyState: video.readyState
   });
   ```

### Issue: Audio plays but video is black
**Symptoms**: Can hear avatar but can't see it

**Check**:
1. `videoWidth` and `videoHeight` should be > 0
2. Check if CSS is hiding video (opacity, visibility)
3. Try removing `style` attribute from video element in dev tools

## Debug Commands (Run in Browser Console)

### Check Video Element State
```javascript
const video = document.querySelector('video');
if (video) {
  console.log('Video State:', {
    paused: video.paused,
    muted: video.muted,
    volume: video.volume,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    readyState: video.readyState,
    networkState: video.networkState,
    currentTime: video.currentTime,
    src: video.src || video.srcObject,
  });
} else {
  console.log('No video element found!');
}
```

### Force Play Video with Audio
```javascript
const video = document.querySelector('video');
if (video) {
  video.muted = false;
  video.volume = 1.0;
  video.play()
    .then(() => console.log('✅ Playing!'))
    .catch(err => console.error('❌ Failed:', err));
}
```

### Check for Media Tracks
```javascript
const video = document.querySelector('video');
if (video && video.srcObject) {
  const stream = video.srcObject;
  console.log('Stream Tracks:', {
    audioTracks: stream.getAudioTracks().map(t => ({
      id: t.id,
      label: t.label,
      enabled: t.enabled,
      muted: t.muted,
      readyState: t.readyState
    })),
    videoTracks: stream.getVideoTracks().map(t => ({
      id: t.id,
      label: t.label,
      enabled: t.enabled,
      muted: t.muted,
      readyState: t.readyState
    }))
  });
}
```

## What the Logs Should Show (When Working)

When everything is working correctly, you should see this sequence:

```
[LiveAvatarSDK] 🚀 Starting LiveAvatar SDK initialization...
[LiveAvatarSDK] 📡 Step 1/5: Requesting session token from backend...
[LiveAvatarSDK] ✅ Session token received
[LiveAvatarSDK] 📦 Step 2/5: Loading LiveAvatar SDK module...
[LiveAvatarSDK] ✅ SDK module loaded successfully
[LiveAvatarSDK] 🎭 Step 3/5: Creating LiveAvatar session...
[LiveAvatarSDK] 📺 Video element attached BEFORE session start
[LiveAvatarSDK] ✅ Video playing with audio
[LiveAvatarSDK] 📡 Step 4/5: Setting up event listeners...
[LiveAvatarSDK] ▶️ Step 5/5: Starting session via SDK...
[LiveAvatarSDK] ✅ Session started successfully!
[LiveAvatarSDK] 🎤 Starting voice chat...
[LiveAvatarSDK] ✅ Voice chat started successfully!
[LiveAvatarSDK] 🎉 SDK FULLY INITIALIZED AND READY!
[AvatarSDKSimple] Video metadata loaded { hasVideo: true, videoWidth: 1024, videoHeight: 768, ... }
```

## Browser Compatibility

**Best Support**:
- ✅ Chrome/Chromium (Recommended)
- ✅ Edge
- ✅ Firefox

**Limited Support**:
- ⚠️ Safari (may have WebRTC issues)
- ❌ Internet Explorer (not supported)

## Still Having Issues?

If audio/video still isn't working after trying these solutions:

1. **Share console logs**: Copy all logs from console and share them
2. **Check video element**: Run the debug commands above and share results
3. **Try different browser**: Test in Chrome to rule out browser-specific issues
4. **Check permissions**: Ensure browser has permission to use microphone
5. **Check .env.local**: Ensure all API keys are set correctly

## Key Changes Made

### `components/AvatarSDKSimple.tsx`
- Added `audioEnabled` state to track audio status
- Added `handleEnableAudio()` function for manual audio activation
- Enhanced video `onLoadedMetadata` with unmuting and autoplay workaround
- Added "Enable Audio" button when audio might be blocked
- Added more detailed logging for video state

### `hooks/useLiveAvatarSDK.ts`
- Added explicit audio unmuting when attaching video element
- Added autoplay workaround (play muted → unmute after delay)
- Better error handling for video playback
- More detailed logging

These changes ensure audio works even with strict browser autoplay policies!


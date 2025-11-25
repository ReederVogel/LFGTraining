# Troubleshooting Guide

## Session Disconnecting After Avatar Speaks

### Symptoms
- Avatar successfully responds 1-2 times
- Session then shows `DISCONNECTING` → `DISCONNECTED`
- Console shows: `trackUnsubscribed RemoteAudioTrack`
- Session ends unexpectedly

### Possible Causes & Solutions

#### 1. HeyGen API Session Timeout/Limits ⚠️ **MOST LIKELY**

**Check your HeyGen plan:**
- **Free tier**: May have very short session durations (30-60 seconds)
- **Paid tiers**: Longer session durations

**Solutions:**
- Log into your HeyGen dashboard at https://www.heygen.com/
- Check "API Usage" or "Credits" section
- Verify your plan's session duration limits
- Upgrade plan if on free tier for longer sessions

**Temporary Workaround:**
- Keep conversations very brief (1-2 exchanges max)
- Restart session frequently

#### 2. Network Issues

**Check:**
```bash
# Test your connection
ping api.liveavatar.com
```

**Solutions:**
- Ensure stable internet connection
- Try different network if on VPN/proxy
- Check firewall isn't blocking WebRTC connections

#### 3. SDK Stability (Too Many Interrupts)

**Already Fixed:**
- Added 500ms cooldown between interrupt() calls
- Wrapped all event handlers in try-catch
- Improved turn-taking logic

#### 4. Browser/Audio Issues

**Solutions:**
- Use Chrome/Edge (best WebRTC support)
- Ensure microphone permissions granted
- Close other tabs using microphone
- Restart browser if issues persist

### Debugging Steps

1. **Check Console for Specific Errors:**
   ```
   Look for:
   - "Error interrupting avatar"
   - "Error in [event] handler"
   - Any red errors before DISCONNECTING
   ```

2. **Test with Minimal Interaction:**
   - Start session
   - Say only "hello"
   - See if avatar responds fully
   - If it disconnects even with 1 exchange → API limit issue

3. **Check HeyGen Dashboard:**
   - Go to https://www.heygen.com/
   - Navigate to API section
   - Check remaining credits/minutes
   - Review any usage alerts

4. **Monitor Session Duration:**
   - Note the timer in the session
   - If disconnects at same time each session (e.g., always at 1:00) → duration limit

### Current Code Protections ✅

The codebase now includes:
- ✅ Comprehensive error handling for all events
- ✅ Interrupt cooldown (500ms) to prevent SDK overload
- ✅ Debounced turn-taking (1.5s delay) for natural pauses
- ✅ Safe handlers that catch exceptions
- ✅ Clear logging for disconnect reasons

### Next Steps

**If session still disconnects after 1-2 exchanges:**

1. **Verify API Key & Plan:**
   - Check `.env.local` has correct `NEXT_PUBLIC_LIVEAVATAR_API_KEY`
   - Confirm API key is active in HeyGen dashboard
   - Check plan limitations

2. **Contact HeyGen Support:**
   - Email: support@heygen.com
   - Describe: "Session disconnecting after 60 seconds"
   - Ask about: Session duration limits on your plan

3. **Test with HeyGen's Official Demo:**
   - Try https://www.heygen.com/interactive-avatar
   - See if similar disconnections occur
   - Rules out our code as the issue

### Success Metrics

**Session is working properly when:**
- ✅ Multiple back-and-forth exchanges (5+ turns)
- ✅ Natural pauses in speech don't break turn-taking
- ✅ No unexpected disconnections
- ✅ Transcripts appear for both user and avatar
- ✅ Session lasts several minutes

### Known Limitations

1. **HeyGen Free Tier:** Very limited session duration
2. **VAD Sensitivity:** May trigger multiple events during pauses (handled in code)
3. **WebRTC Stability:** Requires good network connection
4. **Browser Compatibility:** Best on Chrome/Edge

---

## Other Common Issues

### Issue: Transcripts Not Showing

**Fixed in latest code:**
- Console now logs text directly (not `[Object]`)
- Transcripts appear in UI transcript box
- Both user and avatar transcripts displayed

### Issue: Avatar Not Speaking

**Fixed in latest code:**
- Improved turn-taking with 1.5s debounce
- Fixed `hasAvatarSpokenSinceLastUser` flag management
- Better handling of long speeches with pauses

### Issue: "New unsupported event type" Warning

**Status:** Non-critical
- Comes from HeyGen/LiveKit SDK itself
- Does not affect functionality
- Can be safely ignored



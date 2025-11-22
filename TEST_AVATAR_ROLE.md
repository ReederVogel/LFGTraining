# Avatar Role Fix - Testing Guide

## What Was Fixed

The backend now **automatically syncs** the correct "customer calling for help" instructions to the LiveAvatar dashboard every time you start a session. No manual dashboard editing required!

### Changes Made:

1. **Enhanced context update function** (`updateDashboardContext`)
   - Now properly sends the full customer persona prompt
   - Sets the opening_text to prevent default "How can I help you?"
   - Includes detailed logging to confirm what's being sent

2. **Better logging** 
   - Shows payload details before sending
   - Confirms prompt was actually saved (checks `hasPrompt` in response)
   - Displays opening text preview

## How to Test

### 1. Start a Fresh Session

1. Open your app at `http://localhost:3000`
2. Click on Sarah (Widow) avatar
3. **Watch the browser console** for these logs:

```
[LiveAvatar API] 🔄 Starting dashboard context sync for Sarah (Widow)...
[LiveAvatar API] 📦 Update payload: name="Sarah Mitchell - Widow Customer Context", prompt length=XXXX, opening="Hi, I'm calling about..."
[LiveAvatar API] ✅ Successfully updated dashboard context
[LiveAvatar API] 📋 Updated context confirmation: {
  hasPrompt: true,  ← Should be TRUE now!
  promptLength: XXXX,  ← Should be > 0
  hasOpeningText: true,
  openingTextPreview: "Hi, I'm calling about..."
}
```

### 2. Listen to the Avatar's First Words

**✅ CORRECT (Customer Role):**
- "Hi, I'm calling about funeral arrangements. My husband passed away Tuesday."
- "Hello, I need help figuring out what to do for my husband Robert's services."
- "Hi there, my husband Robert died on Tuesday and I need to understand my options."

**❌ WRONG (Employee Role):**
- "How can I help you?"
- "How may I assist you?"
- "What can I do for you today?"

### 3. Test the Conversation Flow

Ask a simple question:

**You:** "Hello, what can I do for you?"

**Expected Avatar Response (CORRECT):**
- "I need to arrange funeral services for my husband."
- "My husband passed away Tuesday and I need information about burial options."
- Shows they NEED help (customer behavior)

**Wrong Avatar Response:**
- Offers to help YOU
- Acts like an employee
- Asks what you need

### 4. Test Michael (Son) Too

Repeat steps 1-3 with the Michael avatar. He should open with:
- "Hello, I need help arranging funeral services. My father passed away unexpectedly."
- "Hi, I'm calling about services for my father. He died unexpectedly."

## What If It Still Says "How Can I Help You?"

Check the console logs:

### Scenario A: Context Update Failed
```
[LiveAvatar API] ❌ Failed to update context d7c15ce9-4359-4790-bf1b-8a786a958289
[LiveAvatar API] 📋 Response status: 405 or 422
```

**Solution:** Your API key might not have permission to update contexts. You'll need to:
1. Log into https://app.liveavatar.com
2. Manually paste the prompts from `LIVEAVATAR_DASHBOARD_FIX_REQUIRED.md`
3. Save each context

### Scenario B: Context Update Succeeded But Prompt Not Saved
```
[LiveAvatar API] ✅ Successfully updated dashboard context
[LiveAvatar API] 📋 Updated context confirmation: {
  hasPrompt: false,  ← Problem!
  promptLength: 0
}
```

**Solution:** The API accepted the request but didn't save the prompt. This means:
- The LiveAvatar API changed its behavior
- Need to check the API documentation
- May need to use a different endpoint

### Scenario C: Everything Looks Good But Avatar Still Wrong
```
[LiveAvatar API] ✅ Successfully updated dashboard context
[LiveAvatar API] 📋 Updated context confirmation: {
  hasPrompt: true,
  promptLength: 2500+
}
```

**Solution:** The dashboard context was updated, but LiveAvatar might be caching the old one:
1. Wait 1-2 minutes for cache to clear
2. Start a brand new session
3. If still wrong, the `context_id` field might be overriding `instructions` field

## Advanced: Verify via API

You can check what's actually saved in the dashboard:

```bash
curl -H "X-API-KEY: YOUR_API_KEY" \
  https://api.liveavatar.com/v1/contexts/d7c15ce9-4359-4790-bf1b-8a786a958289
```

Look for:
- `prompt`: Should contain "YOU ARE THE CUSTOMER CALLING FOR HELP"
- `opening_text`: Should contain one of the customer opening lines

## Success Criteria

✅ **FIXED when you see:**
1. Console shows `hasPrompt: true` with length > 2000
2. Console shows opening text is one of the customer phrases
3. Avatar's first words are "Hi, I'm calling about..." or similar
4. Avatar asks questions and shows they need help
5. Avatar NEVER says "How can I help you?"

## Next Steps

Once confirmed working:
1. Test both avatars (Sarah and Michael)
2. Try multiple sessions to verify opening lines vary naturally
3. Have a full conversation to ensure role stays correct throughout
4. Check transcripts to ensure no forbidden phrases appear

## If You Need More Help

Share the console logs showing:
- The "Update payload" line
- The "Updated context confirmation" line
- The avatar's actual first words
- Any error messages

This will help diagnose exactly what's happening.

---

**Last Updated:** November 22, 2025  
**Status:** ✅ Code fix deployed, ready for testing  
**Critical Check:** Avatar should open as customer, NOT employee


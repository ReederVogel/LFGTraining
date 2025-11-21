# CRITICAL: LiveAvatar Dashboard Context Needs to Be Fixed

## The Situation

The code is now **correctly using `context_id`** from the LiveAvatar dashboard as the source of truth (no override attempts).

However, **the avatar is still saying "How can I help you?"** which means the **context in the LiveAvatar dashboard is configured incorrectly**.

---

## What Needs to Be Fixed

### Context IDs in Use:
- **Sarah (Widow)**: `1803fa71-78fa-4814-b171-3887ee48f50f`
- **Michael (Son)**: `7f393a67-ca66-4f69-a3aa-e0c3f4ca083a`

### The Problem:
The contexts are configured as **"helpful assistant"** or **"service provider"** personas.

### What They Need to Be:
The contexts should be configured as **"customer calling for help"** personas.

---

## How to Fix in LiveAvatar Dashboard

### Step 1: Log into LiveAvatar Dashboard
Go to: https://app.liveavatar.com (or your LiveAvatar dashboard URL)

### Step 2: Find the Contexts
Navigate to:
- Contexts or Knowledge Base section
- Find contexts with IDs:
  - `1803fa71-78fa-4814-b171-3887ee48f50f` (Sarah)
  - `7f393a67-ca66-4f69-a3aa-e0c3f4ca083a` (Michael)

### Step 3: Edit Each Context

For **Sarah (Widow)** context, set the instructions to:

```
🎭 CHARACTER: Sarah Mitchell

DEMOGRAPHICS:
- Age: 62 years old
- Name: Sarah Mitchell
- Husband: Robert James Mitchells (deceased Tuesday morning)

YOUR ROLE - CRITICAL:
You are a CUSTOMER calling a funeral home because YOU NEED HELP.
You are NOT an employee. You are NOT a service provider.
You are grieving and need guidance.

SITUATION:
- Your husband Robert James Mitchells passed away Tuesday morning at the hospital
- You are overwhelmed and uncertain about what to do
- You're on a fixed income and need to be mindful of costs
- Your kids are flying in tomorrow and Wednesday
- You need to arrange funeral services

PERSONALITY:
- Emotional but trying to stay composed
- Ask clarifying questions when confused
- Show grief and uncertainty
- Brief responses (1-2 sentences usually)
- Let the funeral home employee lead the conversation

FORBIDDEN PHRASES - NEVER SAY:
❌ "How can I help you?"
❌ "How may I assist you?"
❌ "What can I do for you?"
❌ "I'm here to help"
❌ "Let me help"
❌ Any employee or service provider language

CORRECT BEHAVIOR:
✅ Open with: "Hi, I'm calling about funeral arrangements. My husband passed away Tuesday."
✅ When greeted: "Hello" or "Hi" (brief), then state your need
✅ Answer THEIR questions (they're the employee helping you)
✅ Ask YOUR questions about services, costs, options
✅ Show emotion: "I'm not sure what to do", "I'm overwhelmed", etc.

EXAMPLE OPENING:
"Hi, I'm calling to get information about funeral arrangements. My husband, Robert James Mitchells, passed away Tuesday morning at the hospital, and I need to understand what my options are."

REMEMBER:
- You NEED help from THEM
- THEY are the professional helping YOU
- You are the customer, not the employee
```

For **Michael (Son)** context, set similar instructions but with:

```
🎭 CHARACTER: Michael Roberts

DEMOGRAPHICS:
- Age: 35 years old
- Name: Michael Roberts
- Father: Deceased unexpectedly

YOUR ROLE - CRITICAL:
You are a CUSTOMER calling a funeral home because YOU NEED HELP.
You are NOT an employee. You are NOT a service provider.
You are grieving but trying to stay practical.

SITUATION:
- Your father passed away unexpectedly
- You need to arrange funeral services
- Your mother and siblings are devastated, you're coordinating
- You're a working professional trying to handle this properly
- You want to understand all the options

PERSONALITY:
- Direct but emotional
- Ask specific questions
- Want to understand details
- Trying to stay practical despite grief
- Brief, focused responses

FORBIDDEN PHRASES - NEVER SAY:
❌ "How can I help you?"
❌ "How may I assist you?"
❌ "What can I do for you?"
❌ "I'm here to help"
❌ Any employee language

CORRECT BEHAVIOR:
✅ Open with: "Hello, I need to arrange services for my father. He passed away unexpectedly."
✅ When greeted: Acknowledge briefly, then state your need
✅ Answer their questions
✅ Ask about specific options and costs
✅ Show concern: "What do you recommend?", "Is that the best option?"

EXAMPLE OPENING:
"Hello, I need help arranging funeral services. My father passed away unexpectedly, and I need to understand the process and options available."

REMEMBER:
- You NEED help from THEM
- THEY are the funeral home professional
- You are the customer calling for assistance
```

### Step 4: Save and Test

After updating the contexts:
1. Click Save in the LiveAvatar dashboard
2. Start a new conversation in your app
3. Verify the avatar opens with their NEED, not offering help

---

## How to Verify It's Fixed

### ✅ CORRECT Opening:
```
AVATAR: "Hi, I'm calling about funeral arrangements. 
         My husband passed away Tuesday morning."
```

### ❌ WRONG Opening (Current Bug):
```
AVATAR: "Yes, I can hear you. How can I help you today?"
```

### ✅ CORRECT Conversation Flow:
```
[Avatar states need] → [You offer to help] → [Avatar asks questions] → [You provide info]
```

### ❌ WRONG Conversation Flow (Current Bug):
```
[You state need] → [Avatar offers to help] ← ROLES REVERSED!
```

---

## Alternative: Create New Contexts

If you can't edit the existing contexts, create NEW contexts with the correct instructions:

### Step 1: Create New Context for Sarah
1. Go to LiveAvatar dashboard
2. Create new context/knowledge base
3. Name it: "Sarah Mitchell - Widow Customer"
4. Paste the Sarah instructions above
5. Save and copy the new context ID

### Step 2: Create New Context for Michael
1. Create another new context
2. Name it: "Michael Roberts - Son Customer"
3. Paste the Michael instructions above
4. Save and copy the new context ID

### Step 3: Update Your Code
Replace the context IDs in your code:

**File**: `app/api/liveavatar-session/route.ts` (around line 72-73)

```typescript
// OLD IDs (if they can't be fixed):
const WIDOW_CONTEXT_ID = '1803fa71-78fa-4814-b171-3887ee48f50f';
const SON_CONTEXT_ID = '7f393a67-ca66-4f69-a3aa-e0c3f4ca083a';

// NEW IDs (from your new contexts):
const WIDOW_CONTEXT_ID = 'YOUR_NEW_SARAH_CONTEXT_ID';
const SON_CONTEXT_ID = 'YOUR_NEW_MICHAEL_CONTEXT_ID';
```

---

## Why This is Critical

### Your Career Impact:
- This is a **training simulation app**
- Users need to practice handling **difficult customer calls**
- If the avatar acts like an employee, the training is useless
- **The roles MUST be correct for the app to have value**

### What Should Happen:
1. **User** = Funeral home employee being trained
2. **Avatar** = Grieving customer calling for help
3. **Scenario** = User practices empathy, information giving, customer service

### What's Happening Now (Bug):
1. **User** = ???
2. **Avatar** = Acting like funeral home employee
3. **Scenario** = Completely backwards, no training value

---

## Summary

**The Fix is NOT in the Code** - The code is now correct!

**The Fix is in the LiveAvatar Dashboard** - The contexts need to be edited

**Action Required**:
1. Log into LiveAvatar dashboard
2. Find the two contexts (Sarah and Michael)
3. Edit their instructions to make them CUSTOMERS not EMPLOYEES
4. Save
5. Test

**Alternative**:
1. Create two NEW contexts with correct instructions
2. Update context IDs in code
3. Test

---

## Need Help?

If you need assistance:
1. Check if you have access to edit contexts in LiveAvatar dashboard
2. Verify you're using the correct dashboard URL
3. Look for "Contexts", "Knowledge Base", or "Personas" section
4. Find the contexts by their IDs
5. Edit the system prompt/instructions

**The key change needed**: 
- Remove "helpful assistant" language
- Add "you are the CUSTOMER calling for help"
- Add forbidden phrases list
- Add correct opening examples

---

**Date**: November 21, 2024  
**Issue**: Avatar role reversed - acting as employee instead of customer  
**Root Cause**: Context in LiveAvatar dashboard configured incorrectly  
**Solution**: Edit contexts in LiveAvatar dashboard  
**Status**: ⚠️ REQUIRES DASHBOARD ACCESS  
**Severity**: 🔴 CRITICAL (App-breaking)


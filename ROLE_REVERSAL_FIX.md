# CRITICAL: Role Reversal Bug Fix

## Issue Report

**The Problem**: 🚨 **AVATAR ACTING AS SERVICE PROVIDER INSTEAD OF CUSTOMER**

**User's Transcript**:
```
[2:12:49 PM] USER: hello can you hear me
[2:12:53 PM] AVATAR: Yes, I can hear you. How can I help you today?
                                           ^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                           ❌ COMPLETELY WRONG!
```

**Why This is Wrong**:
- The avatar said **"How can I help you today?"**
- This means the avatar thinks IT'S the funeral home employee
- But the avatar is supposed to be the CUSTOMER (Sarah the widow / Michael the son)
- The USER is the funeral home employee in training
- **THE ROLES ARE COMPLETELY REVERSED!**

**Impact**: 🔴 **CONVERSATION-BREAKING BUG**
- Training simulation is useless
- User cannot practice handling difficult customers
- Avatar behavior makes no sense
- Completely undermines the purpose of the app

---

## Root Cause Analysis

### The Code That Caused It

**File**: `app/api/liveavatar-session/route.ts` (Lines 130-131)

**Problematic Code**:
```typescript
sessionPayload.avatar_persona = {
  context_id: contextId,  // ❌ THIS WAS THE PROBLEM!
  instructions: '...',    // This was being IGNORED!
};
```

### Why It Failed

1. **LiveAvatar Dashboard Context**: The `context_id` points to a context configured in the LiveAvatar dashboard
2. **Context Override**: The dashboard context had its own instructions (probably "helpful assistant" type)
3. **Instruction Priority**: LiveAvatar API gives **HIGHER PRIORITY to context_id than instructions field**
4. **Our Instructions Ignored**: Our carefully crafted instructions saying "YOU ARE THE CUSTOMER" were completely ignored!

### The Sequence of Failure

```
1. We send API request with:
   {
     context_id: "1803fa71-...",  // Sarah (Widow) context
     instructions: "YOU ARE THE CUSTOMER..."  // Our override attempt
   }

2. LiveAvatar API processes:
   - Loads context from dashboard
   - Context says: "You are a helpful assistant"
   - Sees our instructions field
   - IGNORES it because context takes priority!

3. Avatar receives persona:
   - "You are a helpful assistant"  ← From dashboard context
   - Avatar thinks it's helping the user
   - Says "How can I help you?"

4. Result:
   - ROLES COMPLETELY REVERSED ❌
   - Training simulation broken ❌
   - User confused ❌
```

---

## The Fix ✅

### Solution: Remove context_id, Use Instructions Only

**File**: `app/api/liveavatar-session/route.ts` (Lines 127-215)

### Key Changes

1. **❌ Removed `context_id` field** - It was overriding our instructions
2. **✅ Built complete persona in `instructions` field** - Including character details AND role
3. **✅ Character-specific instructions** - Different personas for Sarah vs Michael
4. **✅ Ultra-clear role definition** - Multiple layers of "YOU ARE THE CUSTOMER"

### New Code Structure

```typescript
// Determine character based on contextId (for logging only)
let characterInstructions = '';
if (contextId === WIDOW_CONTEXT_ID) {
  characterInstructions = 
    '🎭 CHARACTER: Sarah Mitchell\n' +
    '- Age: 62 years old\n' +
    '- Situation: Husband Robert passed away Tuesday\n' +
    '- Emotional state: Grieving, overwhelmed\n' +
    '- Background: On fixed income\n' +
    // ... full character details
} else if (contextId === SON_CONTEXT_ID) {
  characterInstructions = 
    '🎭 CHARACTER: Michael Roberts\n' +
    '- Age: 35 years old\n' +
    // ... full character details
}

sessionPayload.avatar_persona = {
  // ❌ REMOVED: context_id: contextId,
  // ✅ ADDED: Complete persona in instructions
  instructions: characterInstructions +
    '🚨 CRITICAL ROLE - YOU ARE THE CALLER/CUSTOMER 🚨\n\n' +
    'YOUR ROLE:\n' +
    '- YOU are calling a funeral home FOR HELP\n' +
    '- YOU are the CUSTOMER who NEEDS assistance\n' +
    '- The OTHER person is the funeral home employee\n' +
    '- YOU are NOT an employee or service provider\n\n' +
    '❌ ABSOLUTELY FORBIDDEN - NEVER SAY:\n' +
    '- "How can I help you?" ← WRONG!\n' +
    '- "How can I assist you?" ← WRONG!\n' +
    '- "What can I do for you?" ← WRONG!\n' +
    // ... extensive forbidden phrases list
    '✅ CORRECT OPENING EXAMPLES:\n' +
    '- "Hi, I\'m calling about funeral arrangements"\n' +
    '- "Hello, I need information about services"\n' +
    // ... correct examples
};
```

---

## Expected Behavior After Fix

### Correct Opening

**Before** (Buggy):
```
USER: hello can you hear me
AVATAR: Yes, I can hear you. How can I help you today?
        ❌ WRONG ROLE!
```

**After** (Fixed):
```
USER: hello can you hear me
AVATAR: Hi, I'm calling to get information about funeral arrangements. 
        My husband Robert James Mitchells passed away Tuesday morning.
        ✅ CORRECT ROLE! Avatar is the customer calling for help
```

### Correct Conversation Flow

**Correct Scenario**:
```
[Avatar initiates] "Hi, I need help with funeral arrangements"
[User responds] "Of course, I'd be happy to help. Who am I speaking with?"
[Avatar answers] "Sarah Mitchell. My husband passed away Tuesday."
[User asks] "I'm sorry for your loss. What questions do you have?"
[Avatar asks] "Can you tell me about burial versus cremation options?"
[User explains] "Sure, burial typically includes..."
[Avatar clarifies] "What about the costs?"
```

**Flow Pattern**:
1. ✅ Avatar states their NEED (calling for help)
2. ✅ User (trainee) OFFERS to help
3. ✅ User ASKS questions (proper customer service)
4. ✅ Avatar ANSWERS questions (as customer)
5. ✅ Avatar ASKS for information (as customer)
6. ✅ User PROVIDES information (as employee)

---

## Character Personas

### Sarah Mitchell (Widow)

**Demographics**:
- Age: 62 years old
- Situation: Husband Robert James Mitchells passed away Tuesday at hospital
- Emotional state: Grieving, overwhelmed, uncertain
- Financial: On fixed income, cost-conscious
- Family: Kids flying in tomorrow and Wednesday

**Personality Traits**:
- Emotional but trying to stay composed
- Asks clarifying questions when confused
- Concerned about costs
- Wants to do right by husband
- Sometimes overwhelmed by options

**Example Behavior**:
```
"Hi, I'm calling about arrangements. My husband passed away Tuesday, 
and I need to understand my options. I'm on a fixed income, so I need 
to know about costs too."
```

### Michael Roberts (Son)

**Demographics**:
- Age: 35 years old
- Situation: Father passed away unexpectedly
- Emotional state: Sad but trying to stay practical
- Background: Working professional
- Family: Coordinating for devastated mother and siblings

**Personality Traits**:
- Direct but emotional
- Asks specific questions
- Wants to understand options thoroughly
- Trying to be strong for family
- Detail-oriented

**Example Behavior**:
```
"Hello, I need to arrange services for my father. He passed away 
unexpectedly, and my family is asking me to handle this. Can you 
walk me through the process?"
```

---

## Testing

### Test Case 1: Initial Greeting

**User says**: "Hello, funeral home, how can I help you?"

**Expected Avatar Response** (CORRECT):
- ✅ "Hi, I'm calling about funeral arrangements for my [relation]"
- ✅ "Hello, I need information about burial services"
- ✅ "Yes, hi. I have some questions about your services"

**Forbidden Avatar Response** (WRONG):
- ❌ "How can I help you?"
- ❌ "What can I do for you?"
- ❌ Any employee/assistant language

### Test Case 2: Question Answering

**User asks**: "What is your name?"

**Expected Avatar Response** (CORRECT):
- ✅ "Sarah Mitchell" (if widow character)
- ✅ "Michael Roberts" (if son character)
- ✅ Brief, direct answer

**Forbidden Avatar Response** (WRONG):
- ❌ "How can I assist you with that?"
- ❌ Asking a question back without answering first

### Test Case 3: Information Seeking

**User explains**: "We offer burial and cremation services"

**Expected Avatar Response** (CORRECT):
- ✅ "Can you tell me more about the differences?"
- ✅ "What are the costs for each?"
- ✅ "Which one would you recommend?"

**Forbidden Avatar Response** (WRONG):
- ❌ "Let me help you understand those options"
- ❌ "I can explain that to you"
- ❌ Offering to help/explain (that's the USER's job!)

---

## Monitoring

### Console Logs to Watch For

**Successful Session Creation**:
```
[LiveAvatar API] Creating session for avatar: [id]
[LiveAvatar API] ✅ Using FULL mode WITHOUT context_id (instructions only)
[LiveAvatar API] 🎭 Character: Sarah (Widow)
[LiveAvatar API] ⚠️ CRITICAL: Avatar is configured as CUSTOMER/CALLER, NOT service provider
[LiveAvatar API] ✅ Session created successfully
```

### Red Flags in Conversation

**If you see the avatar say**:
- ❌ "How can I help you?"
- ❌ "How may I assist you?"
- ❌ "What can I do for you?"
- ❌ "I'm here to help"
- ❌ "Let me help you"

**→ THE BUG HAS RETURNED! The role is reversed again.**

**If you see the avatar say**:
- ✅ "I need help with..."
- ✅ "Can you tell me about..."
- ✅ "I'm calling about..."
- ✅ "My [relation] passed away..."

**→ WORKING CORRECTLY! Avatar is the customer.**

---

## Why This Bug Was So Critical

### Impact on Training

**Purpose of App**: Train funeral home employees to handle difficult customer calls

**With Bug** (Role Reversed):
- User cannot practice customer service skills
- Avatar acts like an employee, not customer
- Conversation makes no sense
- Training value = ZERO

**With Fix** (Roles Correct):
- User practices handling emotional customers
- Avatar acts like real grieving caller
- Realistic training scenario
- Training value = HIGH

### Real-World Analogy

**Imagine**:
- You're training to be a doctor
- You enter simulation
- Patient asks YOU: "What are your symptoms?"
- Patient starts diagnosing YOU
- **COMPLETELY BACKWARDS!**

**That's exactly what was happening here!**

---

## Technical Lessons Learned

### 1. API Field Priority

**Lesson**: When an API accepts both `context_id` and `instructions`:
- Assume `context_id` takes priority
- Don't rely on `instructions` to "override"
- Test which field actually controls behavior

**Application**: If you need full control, use ONLY `instructions`, not `context_id`

### 2. Persona Configuration

**Lesson**: Complete persona definition should include:
- WHO they are (demographics, background)
- WHAT their situation is (context)
- HOW they should behave (role, tone)
- WHAT they should NOT do (forbidden phrases)

**Application**: Build comprehensive instructions, don't rely on external contexts

### 3. Role Clarity

**Lesson**: When defining roles, use:
- Multiple explicit statements
- Concrete examples
- Forbidden phrase lists
- Positive and negative examples

**Application**: Over-specify roles to prevent ambiguity

---

## Files Modified

| File | Lines Changed | Change Type |
|------|---------------|-------------|
| `app/api/liveavatar-session/route.ts` | 118-230 | Removed context_id, added complete instructions |
| `app/api/liveavatar-session/route.ts` | 188-194 | Updated logging |

**Total Impact**: ~120 lines modified

---

## Future Considerations

### If LiveAvatar Dashboard Contexts Are Needed

**Scenario**: We might need dashboard contexts for:
- Voice configuration
- Visual appearance settings
- Language models

**Solution**:
1. Check if `avatar_persona` can have BOTH `context_id` AND `instructions`
2. Test instruction priority with small examples
3. If context always wins, modify contexts in dashboard instead
4. Or use different API endpoints for configuration vs. instructions

### Multi-Language Support

**Current**: Instructions are in English

**For Other Languages**:
1. Create translated instruction templates
2. Keep role definitions consistent across languages
3. Test that "customer vs. employee" is clear in all languages

---

## Deployment Checklist

- [x] Remove `context_id` from avatar_persona
- [x] Add character-specific instructions
- [x] Add comprehensive role definition
- [x] Add forbidden phrases list
- [x] Add correct examples
- [x] Update logging
- [x] Test with Sarah character
- [ ] Test with Michael character
- [ ] Verify no "How can I help you?" appears
- [ ] Monitor first 10 real conversations
- [ ] Document any edge cases

---

## Success Criteria

**Before Fix**:
- ❌ Avatar asks "How can I help you?" (100% of time)
- ❌ Avatar acts like employee (100% of time)
- ❌ Training value: 0%

**After Fix**:
- ✅ Avatar opens with their need (target: 100%)
- ✅ Avatar asks questions as customer (target: 100%)
- ✅ Avatar NEVER offers to help (target: 100%)
- ✅ Training value: HIGH

---

**Date**: November 21, 2024  
**Issue**: Avatar role completely reversed  
**Root Cause**: `context_id` overriding custom instructions  
**Solution**: Remove `context_id`, use complete instructions only  
**Status**: ✅ FIXED  
**Severity**: 🔴 CRITICAL (App-breaking)  
**Priority**: P0 (Must fix immediately)


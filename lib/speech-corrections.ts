/**
 * Speech Recognition Corrections for Funeral Home Context
 * 
 * This module corrects common speech recognition errors in funeral home conversations.
 * The speech-to-text system often mishears specialized funeral terminology.
 */

// Common misheard funeral/grief vocabulary and their corrections
// NOTE: Only add corrections for funeral-specific terminology that is consistently misheard
// Do NOT add corrections for general speech errors - let transcripts show as-is
const FUNERAL_VOCABULARY_CORRECTIONS: Record<string, string> = {
  // Cremation mishearings
  'chinese cremation': 'cremation',
  'creation': 'cremation',
  'creamation': 'cremation',
  'cremating': 'cremation',
  
  // Burial mishearings
  'barrial': 'burial',
  'burrial': 'burial',
  'berry': 'burial',
  'barry': 'burial',
  
  // Casket mishearings
  'basket': 'casket',
  'cast kit': 'casket',
  'cash kit': 'casket',
  
  // Memorial mishearings
  'mammorial': 'memorial',
  'memoria': 'memorial',
  'memory hall': 'memorial',
  
  // Service mishearings
  'cervix': 'service',
  'surfaces': 'services',
  
  // Funeral mishearings
  'funeral': 'funeral', // Keep correct
  'funeral home': 'funeral home',
  'futural': 'funeral',
  'few nero': 'funeral',
  
  // Viewing mishearings
  'viewing': 'viewing',
  'viewing room': 'viewing room',
  'viewing area': 'viewing area',
  
  // Cemetery mishearings
  'cemetery': 'cemetery',
  'sem a terry': 'cemetery',
  'symmetry': 'cemetery',
  
  // Arrangements mishearings
  'arrangements': 'arrangements',
  'arrangement': 'arrangements',
  'a range mints': 'arrangements',
  
  // Deceased/passed away mishearings
  'deceased': 'deceased',
  'the seed': 'deceased',
  'passed away': 'passed away',
  'past away': 'passed away',
  'pastor way': 'passed away',
  
  // Embalming mishearings
  'embalming': 'embalming',
  'in bombing': 'embalming',
  'im bombing': 'embalming',
  
  // Urn mishearings
  'earn': 'urn',
  'urn': 'urn',
  'earns': 'urns',
  
  // Grief/mourning mishearings
  'grief': 'grief',
  'grieve': 'grief',
  'morning': 'mourning',
  'mourning': 'mourning',
};

// Patterns that need regex-based correction (for more complex cases)
// NOTE: Only add patterns for funeral-specific terminology
// Do NOT add general speech correction patterns - transcripts should show as recognized
const PATTERN_CORRECTIONS: Array<{ pattern: RegExp; replacement: string }> = [
  // "i mean cremation" misheard as "i mean chinese cremation"
  { pattern: /\bchinese cremation\b/gi, replacement: 'cremation' },
  { pattern: /\bchina cremation\b/gi, replacement: 'cremation' },
  
  // "burial plot" variations
  { pattern: /\bbarry plot\b/gi, replacement: 'burial plot' },
  { pattern: /\bberry plot\b/gi, replacement: 'burial plot' },
  
  // "cremation services" variations
  { pattern: /\bcreation services\b/gi, replacement: 'cremation services' },
  { pattern: /\bchinese services\b/gi, replacement: 'cremation services' },
  
  // Multiple spaces to single space
  { pattern: /\s+/g, replacement: ' ' },
];

/**
 * Applies context-aware corrections to speech recognition text
 * Specifically tuned for funeral home conversations
 */
export function correctFuneralVocabulary(text: string): string {
  if (!text || typeof text !== 'string') {
    return text;
  }

  let correctedText = text;
  
  // Step 1: Apply pattern-based corrections (regex)
  for (const { pattern, replacement } of PATTERN_CORRECTIONS) {
    correctedText = correctedText.replace(pattern, replacement);
  }
  
  // Step 2: Apply word-by-word corrections
  // Split into words while preserving punctuation
  const words = correctedText.split(/\b/);
  const correctedWords = words.map(word => {
    const lowerWord = word.toLowerCase();
    
    // Check if this word (or phrase) needs correction
    if (FUNERAL_VOCABULARY_CORRECTIONS[lowerWord]) {
      // Preserve original capitalization pattern
      const correction = FUNERAL_VOCABULARY_CORRECTIONS[lowerWord];
      
      if (word[0] === word[0].toUpperCase()) {
        // First letter was capitalized
        return correction.charAt(0).toUpperCase() + correction.slice(1);
      }
      
      return correction;
    }
    
    return word;
  });
  
  correctedText = correctedWords.join('');
  
  // Step 3: Apply multi-word phrase corrections
  // Check for common multi-word mishearings
  for (const [incorrect, correct] of Object.entries(FUNERAL_VOCABULARY_CORRECTIONS)) {
    if (incorrect.includes(' ')) {
      // Multi-word phrase
      const regex = new RegExp(`\\b${incorrect}\\b`, 'gi');
      correctedText = correctedText.replace(regex, correct);
    }
  }
  
  // Step 4: Clean up spacing
  correctedText = correctedText.trim();
  
  return correctedText;
}

/**
 * Logs the correction for debugging purposes
 */
export function correctAndLog(text: string, speaker: 'user' | 'avatar'): string {
  const original = text;
  const corrected = correctFuneralVocabulary(text);
  
  if (original !== corrected) {
    console.log(`[SpeechCorrection] 🔧 ${speaker} text corrected:`);
    console.log(`  Original: "${original}"`);
    console.log(`  Corrected: "${corrected}"`);
  }
  
  return corrected;
}

/**
 * Add a custom correction to the vocabulary
 * Useful for adding client-specific terms during runtime
 */
export function addCustomCorrection(incorrect: string, correct: string): void {
  FUNERAL_VOCABULARY_CORRECTIONS[incorrect.toLowerCase()] = correct;
  console.log(`[SpeechCorrection] Added custom correction: "${incorrect}" → "${correct}"`);
}


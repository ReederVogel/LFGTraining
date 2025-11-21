/**
 * Voice Activity Detection (VAD) Configuration
 * 
 * This configuration optimizes avatar interaction for:
 * 1. Minimum latency - Fast response after user finishes speaking
 * 2. Intelligent capture - Waits for complete user speech without interruption
 * 3. Ultra-realistic experience - Natural conversation flow
 */

export interface VADConfig {
  // Core VAD settings
  turn_detection_type: 'server_vad' | 'client_vad' | 'push_to_talk';
  
  // Latency settings (in milliseconds)
  silence_duration_ms: number;        // How long to wait in silence before considering user done
  prefix_padding_ms: number;          // Buffer before speech starts (catches first words)
  vad_silence_duration_ms: number;    // Confirmation time that speech has ended
  vad_prefix_padding_ms: number;      // Early detection buffer
  
  // Sensitivity thresholds (0.0 - 1.0)
  silence_threshold: number;          // What qualifies as "silence"
  vad_threshold: number;              // Voice detection sensitivity
  interrupt_threshold: number;        // How strong speech must be to interrupt avatar
  
  // Interruption handling
  interrupt_enabled: boolean;         // Allow user to interrupt avatar
  interrupt_min_words: number;        // Minimum words needed to interrupt
  
  // Audio quality
  audio_sample_rate: number;          // Audio quality (Hz) - higher = better quality
  audio_encoding: 'pcm16' | 'opus';   // Audio codec
  
  // Smart features
  endpointing_enabled: boolean;       // Detect natural sentence endings
  endpointing_sensitivity: 'low' | 'balanced' | 'high';
  
  // Performance
  reduce_latency: boolean;            // Enable low-latency optimizations
  preload_audio: boolean;             // Preload audio for instant playback
}

/**
 * ULTRA-LOW LATENCY MODE
 * Best for: Quick Q&A, short responses, fast-paced conversations
 * Tradeoff: May occasionally interrupt if user pauses mid-sentence
 */
export const ULTRA_LOW_LATENCY_CONFIG: VADConfig = {
  turn_detection_type: 'server_vad',
  silence_duration_ms: 600,           // Very fast - 0.6 seconds
  prefix_padding_ms: 250,
  vad_silence_duration_ms: 500,
  vad_prefix_padding_ms: 200,
  silence_threshold: 0.4,             // More sensitive to silence
  vad_threshold: 0.65,
  interrupt_threshold: 0.75,
  interrupt_enabled: true,
  interrupt_min_words: 2,
  audio_sample_rate: 24000,
  audio_encoding: 'pcm16',
  endpointing_enabled: true,
  endpointing_sensitivity: 'high',
  reduce_latency: true,
  preload_audio: true,
};

/**
 * BALANCED MODE (RECOMMENDED)
 * Best for: Natural conversations, training scenarios, most use cases
 * Tradeoff: Excellent balance between speed and accuracy
 */
export const BALANCED_CONFIG: VADConfig = {
  turn_detection_type: 'server_vad',
  silence_duration_ms: 800,           // Natural pause - 0.8 seconds
  prefix_padding_ms: 300,
  vad_silence_duration_ms: 600,
  vad_prefix_padding_ms: 200,
  silence_threshold: 0.5,
  vad_threshold: 0.6,
  interrupt_threshold: 0.7,
  interrupt_enabled: true,
  interrupt_min_words: 2,
  audio_sample_rate: 24000,
  audio_encoding: 'pcm16',
  endpointing_enabled: true,
  endpointing_sensitivity: 'balanced',
  reduce_latency: true,
  preload_audio: true,
};

/**
 * PATIENT MODE
 * Best for: Long explanations, storytelling, complex thoughts
 * Tradeoff: Slower response but never interrupts user
 */
export const PATIENT_CONFIG: VADConfig = {
  turn_detection_type: 'server_vad',
  silence_duration_ms: 1200,          // Patient wait - 1.2 seconds
  prefix_padding_ms: 350,
  vad_silence_duration_ms: 800,
  vad_prefix_padding_ms: 250,
  silence_threshold: 0.6,
  vad_threshold: 0.55,                // Less sensitive (more patient)
  interrupt_threshold: 0.8,
  interrupt_enabled: true,
  interrupt_min_words: 3,
  audio_sample_rate: 24000,
  audio_encoding: 'pcm16',
  endpointing_enabled: true,
  endpointing_sensitivity: 'low',     // Less aggressive endpoint detection
  reduce_latency: true,
  preload_audio: true,
};

/**
 * CUSTOM HIGH-QUALITY MODE
 * Maximum audio quality with optimized latency
 */
export const HIGH_QUALITY_CONFIG: VADConfig = {
  turn_detection_type: 'server_vad',
  silence_duration_ms: 800,
  prefix_padding_ms: 300,
  vad_silence_duration_ms: 600,
  vad_prefix_padding_ms: 200,
  silence_threshold: 0.5,
  vad_threshold: 0.6,
  interrupt_threshold: 0.7,
  interrupt_enabled: true,
  interrupt_min_words: 2,
  audio_sample_rate: 48000,           // Maximum quality - 48kHz
  audio_encoding: 'pcm16',
  endpointing_enabled: true,
  endpointing_sensitivity: 'balanced',
  reduce_latency: true,
  preload_audio: true,
};

/**
 * INTELLIGENT ULTRA-FAST MODE (RECOMMENDED FOR TRAINING)
 * 
 * This mode uses CLIENT-SIDE VAD (push_to_talk) to give us FULL CONTROL over when
 * the avatar responds. The LiveAvatar SDK will NOT automatically detect speech ending.
 * Instead, OUR code decides when the user has finished speaking.
 * 
 * Key Features:
 * - CLIENT-SIDE VAD = we control everything, no premature responses
 * - 4-second silence detection implemented in our code
 * - No false positives from SDK's internal VAD
 * - Maximum audio quality for ultra-realistic experience
 * - Only sends complete speech to avatar after confirmed silence
 * 
 * Best for: Training scenarios where capturing complete user thoughts is critical
 * Result: ZERO interruptions, perfect conversation flow
 */
export const INTELLIGENT_ULTRA_FAST_CONFIG: VADConfig = {
  // CRITICAL: Use push_to_talk to disable SDK's automatic VAD
  // This gives us full control - we'll manually trigger responses
  turn_detection_type: 'push_to_talk',
  
  // These settings are now advisory/fallback only since we're using push_to_talk
  // Our client-side VAD will implement the actual 4-second silence detection
  silence_duration_ms: 4000,
  vad_silence_duration_ms: 3500,
  
  // Buffer settings for audio capture
  prefix_padding_ms: 600,
  vad_prefix_padding_ms: 500,
  
  // Thresholds (not actively used in push_to_talk mode, but kept for reference)
  silence_threshold: 0.80,
  vad_threshold: 0.25,
  
  // Interrupt protection
  interrupt_threshold: 0.90,
  interrupt_enabled: true,
  interrupt_min_words: 5,
  
  // Maximum audio quality for ultra-realistic experience
  audio_sample_rate: 48000,           // 48kHz - studio quality
  audio_encoding: 'pcm16',            // Uncompressed for best quality
  
  // Endpointing disabled - we handle this client-side
  endpointing_enabled: false,
  endpointing_sensitivity: 'low',
  
  // Performance optimization
  reduce_latency: true,
  preload_audio: true,
};

// Export the intelligent ultra-fast configuration as default
export const DEFAULT_VAD_CONFIG = INTELLIGENT_ULTRA_FAST_CONFIG;

/**
 * Convert VADConfig to URL search parameters
 */
export function vadConfigToParams(config: VADConfig): URLSearchParams {
  const params = new URLSearchParams();
  
  // Map config to URL parameters
  params.append('turn_detection_type', config.turn_detection_type);
  params.append('silence_duration_ms', config.silence_duration_ms.toString());
  params.append('prefix_padding_ms', config.prefix_padding_ms.toString());
  params.append('silence_threshold', config.silence_threshold.toString());
  
  params.append('interrupt_enabled', config.interrupt_enabled.toString());
  params.append('interrupt_threshold', config.interrupt_threshold.toString());
  params.append('interrupt_min_words', config.interrupt_min_words.toString());
  
  params.append('vad_threshold', config.vad_threshold.toString());
  params.append('vad_silence_duration_ms', config.vad_silence_duration_ms.toString());
  params.append('vad_prefix_padding_ms', config.vad_prefix_padding_ms.toString());
  
  params.append('audio_sample_rate', config.audio_sample_rate.toString());
  params.append('audio_encoding', config.audio_encoding);
  
  params.append('endpointing_enabled', config.endpointing_enabled.toString());
  params.append('endpointing_sensitivity', config.endpointing_sensitivity);
  
  params.append('reduce_latency', config.reduce_latency.toString());
  params.append('preload_audio', config.preload_audio.toString());
  
  return params;
}


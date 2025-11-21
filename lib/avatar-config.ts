/**
 * Avatar Configuration
 * 
 * Centralized configuration for avatar quality, latency, and behavior.
 * Adjust these settings to optimize for your use case.
 */

export const AVATAR_CONFIG = {
  /**
   * Avatar Quality Settings
   * 
   * Higher quality = more realistic but requires more bandwidth
   * Recommended: 'high' for realistic avatars
   */
  quality: {
    // Quality level: 'low', 'medium', 'high'
    level: 'high' as const,
    
    // Video settings - OPTIMIZED FOR SMOOTH, REALISTIC APPEARANCE
    video: {
      bitrate: 6000000, // 6 Mbps - Very high quality for smooth, photorealistic appearance
      fps: 60, // 60 FPS - ultra-smooth motion like real humans
      resolution: 'high' as const, // 'low', 'medium', 'high'
      codec: 'vp9' as const, // VP9 codec for better compression and quality
      pixelDensity: 2, // Retina display support for crisp appearance
      bufferSize: 'large' as const, // Larger buffer for smoother playback
      jitterBuffer: true, // Enable jitter buffer for network stability
    },
    
    // Audio settings - ENHANCED FOR CRYSTAL CLEAR VOICE
    audio: {
      bitrate: 320000, // 320 kbps - ultra-high quality for pristine, crystal-clear voice (increased from 256k)
      sampleRate: 48000, // 48 kHz - professional audio quality (optimal for voice)
      echoCancellation: true, // Remove echo artifacts
      noiseSuppression: true, // Remove background noise
      autoGainControl: true, // Consistent volume levels
      // Subtle ambient sounds for realism
      ambience: {
        enabled: false, // Disabled to reduce noise (was causing artifacts)
        volume: 0.02, // Very quiet background
        sounds: ['breathing', 'subtle_movement'] as const,
      },
    },
    
    // Voice settings - DYNAMIC FOR NATURAL SPEECH
    voice: {
      rate: 1.0, // Base speech rate (0.8-1.2) - will vary dynamically
      emotion: 'neutral' as const, // 'neutral', 'happy', 'sad', etc.
      // Dynamic variation: Real humans vary speech rate by ±10-15% naturally
      rateVariation: 0.12, // ±12% natural variation
      // Natural speech patterns with filler words
      fillerWords: {
        enabled: true,
        frequency: 'natural' as const, // Not too many
        types: ['um', 'uh', 'you know', 'like'] as const,
      },
    },
    
    // Animation settings - LIFELIKE IDLE MOVEMENTS
    animation: {
      idleMovements: true, // Enable subtle movements when not speaking
      breathingRate: 16, // breaths per minute (natural human rate)
      blinkRate: 15, // blinks per minute (natural human rate)
      microExpressions: true, // Subtle facial movements
      naturalSway: 'subtle' as const, // Very slight body movement
    },
    
    // Rendering settings - PHOTOREALISTIC APPEARANCE
    rendering: {
      shadows: 'dynamic' as const, // Dynamic shadows for depth
      lighting: 'pbr' as const, // Physically Based Rendering
      antiAliasing: 'fxaa' as const, // Fast Approximate Anti-Aliasing
      subsurfaceScattering: true, // Realistic skin translucency
    },
  },

  /**
   * Latency Settings
   * 
   * Lower values = faster response but may cut off speech
   * Higher values = more accurate but slower response
   * 
   * OPTIMIZED FOR HUMAN-LIKE NATURAL CONVERSATION
   */
  latency: {
    // Voice Activity Detection (VAD) silence duration in milliseconds
    // How long to wait for silence before considering speech ended
    // For training scenarios, users need time to pause and think (1.2 seconds)
    // This prevents the avatar from responding before the user finishes their thought
    silenceDurationMs: 1200, // Increased from 500ms to allow for natural pauses and thinking
    
    // Silence threshold for speech detection (0.0 - 1.0)
    // Lower = more sensitive, Higher = less sensitive
    silenceThreshold: 0.005, // Highly sensitive for instant detection (reduced from 0.008)
    
    // Grace period after avatar stops speaking (in milliseconds)
    // Time to catch delayed transcription events
    transcriptGracePeriod: 600, // Faster response (reduced from 800ms)
    
    // Interruption detection settings
    // These are even more aggressive for instant interruption
    interruptionSilenceDuration: 200, // Instant interruption detection (reduced from 300ms)
    interruptionThreshold: 0.005, // Highly sensitive for interruptions (reduced from 0.008)
  },

  /**
   * Human-Like Behavior Settings
   * 
   * These settings make the avatar behave more like a real person
   */
  humanization: {
    // Variable response timing - Real humans don't respond instantly
    // Response delay varies based on message complexity (200-800ms)
    responseTiming: {
      enabled: true,
      minDelayMs: 200, // Minimum thinking time (simple responses)
      maxDelayMs: 800, // Maximum thinking time (complex responses)
      // Delay increases with message length/complexity
      complexityMultiplier: 0.05, // 50ms per 100 characters
    },
    
    // Natural conversation flow
    conversationFlow: {
      // Add micro-pauses during speech (like real humans breathe)
      microPausesEnabled: true,
      // Natural breathing pauses every N words (humans pause every 7-12 words)
      pauseEveryWords: 10,
      pauseDurationMs: 150, // Brief pause for breathing
      
      // Variable speech rate - Real humans speed up/slow down naturally
      dynamicSpeechRate: true,
      // Rate variation based on emotion/content
      rateVariationRange: 0.15, // ±15% variation
    },
    
    // Interruption recovery - How avatar handles being interrupted
    interruptionRecovery: {
      // Brief acknowledgment pause after interruption (like humans)
      acknowledgmentPauseMs: 300, // "Oh, okay" pause
      // Don't immediately jump into response
      naturalRecoveryDelay: true,
    },
    
    // Eye contact and attention
    attention: {
      // Avatar should look at camera/user naturally
      maintainEyeContact: true,
      // Natural eye movements (blinking, looking away briefly)
      naturalEyeMovements: true,
    },
  },

  /**
   * Interruption Settings
   * 
   * Controls how interruptions are handled
   */
  interruption: {
    // Enable instant interruption when user starts speaking
    enabled: true,
    
    // Clear avatar's pending response on interruption
    clearPendingResponse: true,
    
    // Show visual feedback when interruption occurs
    showVisualFeedback: true,
  },

  /**
   * Presets for different use cases
   * 
   * Use these presets for common scenarios
   */
  presets: {
    // Ultra-low latency for real-time conversation
    realtime: {
      silenceDurationMs: 800,
      transcriptGracePeriod: 800,
    },
    
    // Balanced for most use cases (CURRENT ACTIVE PRESET - RECOMMENDED FOR TRAINING)
    balanced: {
      silenceDurationMs: 1200,
      transcriptGracePeriod: 1000,
    },
    
    // High accuracy for careful conversation
    accurate: {
      silenceDurationMs: 1800,
      transcriptGracePeriod: 2000,
    },
  },
};

/**
 * Helper function to get preset configuration
 */
export function getPresetConfig(preset: 'realtime' | 'balanced' | 'accurate') {
  return {
    ...AVATAR_CONFIG,
    latency: {
      ...AVATAR_CONFIG.latency,
      ...AVATAR_CONFIG.presets[preset],
    },
  };
}


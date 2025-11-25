/**
 * LiveAvatar SDK Integration
 * This module handles communication with the LiveAvatar API using the official Web SDK
 */

import { getLiveAvatarApiKey } from "./config";
import {
  LiveAvatarSession,
  SessionEvent,
  AgentEventsEnum,
  VoiceChatEvent,
} from "@heygen/liveavatar-web-sdk";

const API_BASE_URL = "https://api.liveavatar.com";

export interface TranscriptEvent {
  text: string;
  speaker: "user" | "avatar";
  timestamp: number;
}

export class LiveAvatarClient {
  private apiKey: string;
  private avatarId: string;
  private voiceId: string | null;
  private contextId: string | null;
  private mode: "FULL" | "CUSTOM";
  private enforceTurnTaking: boolean;
  private videoElement: HTMLVideoElement | null = null;
  private transcriptCallback: ((event: TranscriptEvent) => void) | null = null;
  private liveAvatarInstance: LiveAvatarSession | null = null;
  private sessionId: string | null = null;
  private recentTranscripts = new Map<"user" | "avatar", { text: string; timestamp: number }>();
  // Track speaking state so we can reduce the chance of the avatar
  // talking over the user in FULL mode.
  private isUserSpeaking = false;
  private isAvatarSpeaking = false;
  // Turn-taking control: ensure the avatar never starts or continues
  // the conversation on its own. It may only speak once after each
  // user turn.
  private hasUserEverSpoken = false;
  private hasAvatarSpokenSinceLastUser = false;
  private userSpeakingTimeout: NodeJS.Timeout | null = null;
  private userFinishedSpeakingTimeout: NodeJS.Timeout | null = null;
  private lastInterruptTime = 0;
  private interruptCooldown = 500; // Minimum 500ms between interrupt calls
  // Track if avatar is currently playing audio (for CUSTOM mode with OpenAI)
  private isPlayingAudio = false;
  // Track if avatar has been interrupted (to prevent sending more audio)
  private isInterrupted = false;

  constructor(config: {
    apiKey: string;
    avatarId: string;
    voiceId?: string;
    contextId?: string;
    mode?: "FULL" | "CUSTOM";
    enforceTurnTaking?: boolean;
  }) {
    this.apiKey = config.apiKey;
    this.avatarId = config.avatarId;
    this.voiceId = config.voiceId || null;
    this.contextId = config.contextId || null;
    this.mode = config.mode ?? "FULL";
    this.enforceTurnTaking = config.enforceTurnTaking ?? true;
  }

  /**
   * Request microphone permission so we can forward the user's audio to the avatar.
   */
  private async requestMicrophonePermission(): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      console.warn("MediaDevices API is not available in this environment.");
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      console.log("Microphone permission granted");
      return true;
    } catch (error) {
      console.warn("Microphone permission denied:", error);
      return false;
    }
  }

  /**
   * Validate if a string is a valid UUID format
   */
  private isValidUUID(str: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  /**
   * Determine if we should emit a transcript entry (prevents duplicate spam).
   */
  private shouldEmitTranscript(speaker: "user" | "avatar", text: string): boolean {
    const normalized = text.trim();
    if (!normalized) {
      return false;
    }

    const now = Date.now();
    const last = this.recentTranscripts.get(speaker);
    if (last && last.text === normalized && now - last.timestamp < 1500) {
      // Duplicate within 1.5s – skip
      return false;
    }

    this.recentTranscripts.set(speaker, { text: normalized, timestamp: now });
    return true;
  }

  /**
   * Create session token via API (required before initializing SDK)
   */
  private async createSessionToken(): Promise<string> {
    // Build avatar_persona object (FULL mode only)
    const avatarPersona: Record<string, string | null> = {
      language: "en",
    };

    if (this.voiceId && this.isValidUUID(this.voiceId)) {
      avatarPersona.voice_id = this.voiceId;
    }

    if (this.mode === "FULL" && this.contextId && this.isValidUUID(this.contextId)) {
      avatarPersona.context_id = this.contextId;
    }

    if (this.mode === "FULL" && !avatarPersona.context_id) {
      throw new Error(
        "context_id is required and must be a valid UUID in FULL mode. " +
        "Please add this value to your avatar configuration in lib/avatars.ts. " +
        "You can find this value in your LiveAvatar dashboard."
      );
    }

    const requestBody: any = {
      mode: this.mode,
      avatar_id: this.avatarId,
    };

    if (this.mode === "FULL") {
      requestBody.avatar_persona = avatarPersona;
    }

    console.log("Creating session token with request:", JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${API_BASE_URL}/v1/sessions/token`, {
      method: "POST",
      headers: {
        "X-API-KEY": this.apiKey,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    console.log("Session token response status:", response.status);

    if (!response.ok) {
      let errorMessage = `Failed to create session token: ${response.status} ${response.statusText}`;
      try {
        const errorData = JSON.parse(responseText);
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch {
        errorMessage += ` - ${responseText}`;
      }
      throw new Error(errorMessage);
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (error) {
      throw new Error(`Invalid JSON response from API: ${responseText}`);
    }

    // Extract token from response - LiveAvatar returns it in data.session_token
    const token = data.data?.session_token || data.session_token || data.token || data.access_token;

    if (!token) {
      throw new Error(
        `Session token not found in response. Response keys: ${Object.keys(data).join(", ")}`
      );
    }

    console.log("Session token created successfully");
    return token;
  }

  /**
   * Initialize the LiveAvatar session using the official SDK
   */
  async initialize(videoElement: HTMLVideoElement): Promise<void> {
    this.videoElement = videoElement;

    try {
      console.log("Step 1: Creating session token...");
      const sessionToken = await this.createSessionToken();

      console.log("Checking microphone permission...");
      const hasMicAccess = await this.requestMicrophonePermission();

      const sessionConfig: {
        apiKey: string;
        apiUrl: string;
        voiceChat?: { defaultMuted?: boolean; deviceId?: string };
      } = {
        apiKey: this.apiKey,
        apiUrl: API_BASE_URL,
      };

      if (hasMicAccess) {
        sessionConfig.voiceChat = { defaultMuted: false };
      } else {
        console.warn("Microphone access not granted. Voice chat will be disabled.");
      }

      console.log("Step 2: Initializing LiveAvatar SDK...");
      // Initialize the LiveAvatar SDK instance with session token
      this.liveAvatarInstance = new LiveAvatarSession(sessionToken, sessionConfig);

      // Set up event listeners before starting
      this.setupEventListeners();

      console.log("Step 3: Starting session...");
      await this.liveAvatarInstance.start();
      
      console.log("Session started, waiting for stream...");
      // The SESSION_STREAM_READY event will trigger attachment
      // Don't attach here as stream might not be ready yet

      // Note: sessionId is now retrieved from public methods if needed
      console.log("LiveAvatar session initialized");
    } catch (error) {
      console.error("Error initializing LiveAvatar:", error);
      throw error;
    }
  }

  /**
   * Setup event listeners for the LiveAvatar SDK
   */
  private setupEventListeners(): void {
    if (!this.liveAvatarInstance) return;

    // Wrap all event handlers in try-catch to prevent crashes
    const safeHandler = <T extends any[]>(
      eventName: string,
      handler: (...args: T) => void
    ) => {
      return (...args: T) => {
        try {
          handler(...args);
        } catch (error) {
          console.error(`Error in ${eventName} handler:`, error);
        }
      };
    };

    const voiceChat = this.liveAvatarInstance.voiceChat;
    if (voiceChat) {
      voiceChat.on(VoiceChatEvent.STATE_CHANGED, safeHandler("VoiceChat.STATE_CHANGED", (state) => {
        console.log("Voice chat state:", state);
      }));
      voiceChat.on(VoiceChatEvent.MUTED, safeHandler("VoiceChat.MUTED", () => {
        console.log("Voice chat muted");
      }));
      voiceChat.on(VoiceChatEvent.UNMUTED, safeHandler("VoiceChat.UNMUTED", () => {
        console.log("Voice chat unmuted");
      }));
    }

    // Handle stream ready event
    this.liveAvatarInstance.on(SessionEvent.SESSION_STREAM_READY, safeHandler("SESSION_STREAM_READY", () => {
      console.log("Stream ready - attaching video");
      if (!this.videoElement || !this.liveAvatarInstance) {
        return;
      }

      try {
          // Check if element is visible
          const rect = this.videoElement.getBoundingClientRect();
          console.log("Video element dimensions:", {
            width: rect.width,
            height: rect.height,
            visible: rect.width > 0 && rect.height > 0
          });
          
          this.liveAvatarInstance.attach(this.videoElement);
          console.log("Video attached successfully");
          
          // Check if video has srcObject
          setTimeout(() => {
            if (this.videoElement) {
              const hasStream = !!(this.videoElement.srcObject);
              console.log("Video element srcObject:", hasStream);
              console.log("Video element readyState:", this.videoElement.readyState);
              console.log("Video element videoWidth:", this.videoElement.videoWidth);
              console.log("Video element videoHeight:", this.videoElement.videoHeight);
            }
          }, 1000);
          
          // Ensure video plays
          if (this.videoElement) {
            this.videoElement.play().then(() => {
              console.log("Video playback started");
            }).catch((error) => {
              console.error("Error playing video:", error);
            });
          }
      } catch (error) {
        console.error("Error attaching video:", error);
      }
    }));

    // Track speaking state to minimize avatar/user talk-over and enforce
    // strict turn-taking where the avatar never initiates or restarts
    // the conversation on its own.
    if (this.enforceTurnTaking) {
      this.liveAvatarInstance.on(AgentEventsEnum.USER_SPEAK_STARTED, safeHandler("USER_SPEAK_STARTED", () => {
      console.log("Agent event: USER_SPEAK_STARTED");
      this.isUserSpeaking = true;
      this.hasUserEverSpoken = true;
      
      // Cancel the "finished speaking" timeout if user starts speaking again
      // This handles continuous speech with pauses
      if (this.userFinishedSpeakingTimeout) {
        clearTimeout(this.userFinishedSpeakingTimeout);
        this.userFinishedSpeakingTimeout = null;
        console.log("⏸️ User still speaking (cancelled avatar response timer)");
      }
      
      // Clear any existing timeout
      if (this.userSpeakingTimeout) {
        clearTimeout(this.userSpeakingTimeout);
      }
      
      // Safety timeout: If USER_SPEAK_ENDED doesn't fire within 10 seconds,
      // assume VAD got stuck and force recovery
      this.userSpeakingTimeout = setTimeout(() => {
        console.warn("USER_SPEAK_ENDED not received after 10s - forcing state recovery");
        this.isUserSpeaking = false;
        this.hasAvatarSpokenSinceLastUser = false;
        this.userSpeakingTimeout = null;
      }, 10000); // Increased from 8s to 10s for longer speeches

      // Only interrupt if avatar is actually speaking
      // Add cooldown to prevent too many interrupt() calls which can destabilize the SDK
      if (this.liveAvatarInstance && this.isAvatarSpeaking) {
        const now = Date.now();
        if (now - this.lastInterruptTime >= this.interruptCooldown) {
          console.log("Interrupting avatar because user started speaking");
          try {
            this.liveAvatarInstance.interrupt();
            this.lastInterruptTime = now;
          } catch (error) {
            console.error("Error interrupting avatar:", error);
          }
        } else {
          console.log("⏸️ Interrupt cooldown active - skipping interrupt call");
        }
        this.isAvatarSpeaking = false;
      }
      }));

      this.liveAvatarInstance.on(AgentEventsEnum.USER_SPEAK_ENDED, safeHandler("USER_SPEAK_ENDED", () => {
      console.log("Agent event: USER_SPEAK_ENDED");
      this.isUserSpeaking = false;
      
      // Clear the safety timeout
      if (this.userSpeakingTimeout) {
        clearTimeout(this.userSpeakingTimeout);
        this.userSpeakingTimeout = null;
      }
      
      // Clear any existing "finished speaking" timeout
      if (this.userFinishedSpeakingTimeout) {
        clearTimeout(this.userFinishedSpeakingTimeout);
      }
      
      // IMPROVED FIX: Wait 1.5 seconds after USER_SPEAK_ENDED before allowing avatar to respond
      // This handles long speeches with natural pauses where VAD might trigger multiple times
      this.userFinishedSpeakingTimeout = setTimeout(() => {
        this.hasAvatarSpokenSinceLastUser = false;
        console.log("✓ Avatar can now respond to user (user finished speaking)");
        this.userFinishedSpeakingTimeout = null;
      }, 1500);
      }));

      this.liveAvatarInstance.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, safeHandler("AVATAR_SPEAK_STARTED", () => {
      console.log("Agent event: AVATAR_SPEAK_STARTED");

      // Enforce training rules:
      // - Avatar must never start the conversation.
      // - Avatar must never re-start talking on its own after a pause.
      // We therefore only allow the first avatar response after each
      // user turn. Any other avatar speech is immediately interrupted.
      const shouldAllowAvatarSpeech =
        this.hasUserEverSpoken && !this.hasAvatarSpokenSinceLastUser;

      if (!shouldAllowAvatarSpeech && this.liveAvatarInstance) {
        console.log(
          "⚠️ Blocking avatar: user hasn't spoken yet or avatar already responded"
        );
        const now = Date.now();
        if (now - this.lastInterruptTime >= this.interruptCooldown) {
          try {
            this.liveAvatarInstance.interrupt();
            this.lastInterruptTime = now;
          } catch (error) {
            console.error("Error interrupting avatar (blocking):", error);
          }
        } else {
          console.log("⏸️ Interrupt cooldown active - avatar will stop naturally");
        }
        return;
      }

      console.log("✓ Avatar speech allowed - responding to user");
      this.isAvatarSpeaking = true;
      // NOTE: Don't set hasAvatarSpokenSinceLastUser here - wait until avatar finishes speaking

      // Extra guard: if for any reason the user is marked as speaking when
      // the avatar starts, immediately interrupt to avoid overlap.
      if (this.isUserSpeaking && this.liveAvatarInstance) {
        console.log("⚠️ User is speaking while avatar started - interrupting avatar");
        const now = Date.now();
        if (now - this.lastInterruptTime >= this.interruptCooldown) {
          try {
            this.liveAvatarInstance.interrupt();
            this.lastInterruptTime = now;
          } catch (error) {
            console.error("Error interrupting avatar (user speaking):", error);
          }
        } else {
          console.log("⏸️ Interrupt cooldown active");
        }
        this.isAvatarSpeaking = false;
      }
      }));

      this.liveAvatarInstance.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, safeHandler("AVATAR_SPEAK_ENDED", () => {
      console.log("Agent event: AVATAR_SPEAK_ENDED");
      this.isAvatarSpeaking = false;
      this.isPlayingAudio = false; // Reset audio playing state
      // Set flag ONLY when avatar successfully completes speaking
      this.hasAvatarSpokenSinceLastUser = true;
      console.log("✓ Avatar finished speaking");
      }));
    }

    // Handle avatar transcription
    this.liveAvatarInstance.on(AgentEventsEnum.AVATAR_TRANSCRIPTION, safeHandler("AVATAR_TRANSCRIPTION", (data: any) => {
      const text = (data.text || data.transcript || "").trim();
      if (!this.shouldEmitTranscript("avatar", text)) {
        return;
      }

      console.log("Avatar transcription:", text);
      this.transcriptCallback?.({
        text,
        speaker: "avatar",
        timestamp: Date.now(),
      });
    }));

    // Handle user transcription
    this.liveAvatarInstance.on(AgentEventsEnum.USER_TRANSCRIPTION, safeHandler("USER_TRANSCRIPTION", (data: any) => {
      const text = (data.text || data.transcript || "").trim();
      if (!this.shouldEmitTranscript("user", text)) {
        return;
      }

      console.log("User transcription:", text);
      this.transcriptCallback?.({
        text,
        speaker: "user",
        timestamp: Date.now(),
      });
    }));

    // Handle connection events
    this.liveAvatarInstance.on(SessionEvent.SESSION_STATE_CHANGED, safeHandler("SESSION_STATE_CHANGED", (state: any) => {
      console.log("Session state changed:", state);
      if (state === "DISCONNECTING" || state === "DISCONNECTED") {
        console.warn("⚠️ Session is disconnecting - this may be due to:");
        console.warn("  - API session timeout (check your plan limits)");
        console.warn("  - Network issues");
        console.warn("  - SDK error from too many interrupts");
      }
    }));

    this.liveAvatarInstance.on(SessionEvent.SESSION_DISCONNECTED, safeHandler("SESSION_DISCONNECTED", () => {
      console.error("❌ Disconnected from LiveAvatar - session ended unexpectedly");
      console.error("Check the HeyGen dashboard for API usage and session limits");
    }));
  }

  /**
   * Send user audio/text to avatar
   */
  async sendMessage(text: string): Promise<void> {
    if (!this.liveAvatarInstance) {
      throw new Error("LiveAvatar instance not initialized");
    }

    const cleaned = text.trim();
    if (!cleaned) {
      return;
    }

    console.log("Sending message to LiveAvatar session:", cleaned);
    // In CUSTOM mode this controls what the avatar says.
    // In FULL mode it can be used to nudge or override behavior.
    this.liveAvatarInstance.message(cleaned);
  }

  /**
   * Play pre-generated PCM audio (24k mono) through the avatar.
   * Expects a base64-encoded PCM string compatible with AVATAR_SPEAK_AUDIO.
   */
  async speakPcmAudio(base64Pcm: string): Promise<void> {
    if (!this.liveAvatarInstance) {
      throw new Error("LiveAvatar instance not initialized");
    }

    const trimmed = base64Pcm.trim();
    if (!trimmed) {
      return;
    }

    // Don't send audio if we've been interrupted
    if (this.isInterrupted) {
      console.log("⏸️ Skipping audio - avatar was interrupted");
      this.isInterrupted = false; // Reset for next audio
      return;
    }

    // Mark avatar as playing audio
    this.isPlayingAudio = true;
    this.isInterrupted = false; // Reset interrupt flag
    console.log("Sending PCM audio to LiveAvatar (CUSTOM mode)");
    
    try {
      this.liveAvatarInstance.repeatAudio(trimmed);
    } catch (error) {
      this.isPlayingAudio = false;
      this.isInterrupted = false;
      throw error;
    }
  }

  /**
   * Set callback for transcript events
   */
  onTranscript(callback: (event: TranscriptEvent) => void): void {
    this.transcriptCallback = callback;
  }

  /**
   * Mark audio playback as finished (call this when audio completes naturally)
   */
  markAudioFinished(): void {
    this.isPlayingAudio = false;
    this.isAvatarSpeaking = false;
    this.isInterrupted = false; // Reset interrupt flag when audio finishes naturally
  }

  /**
   * Interrupt any ongoing avatar speech (CUSTOM mode playback)
   * For CUSTOM mode with OpenAI, this should be called immediately when user interrupts
   * @param force - If true, bypass cooldown and state checks for immediate interruption
   */
  interruptSpeech(force = false): void {
    if (!this.liveAvatarInstance) {
      return;
    }

    // For CUSTOM mode or forced interrupts, bypass cooldown for immediate response
    const now = Date.now();
    const canInterrupt = force || this.mode === "CUSTOM" || (now - this.lastInterruptTime >= this.interruptCooldown);
    
    if (!canInterrupt && !force) {
      console.log("⏸️ Interrupt cooldown active - skipping interrupt call");
      return;
    }

    // In CUSTOM mode, always interrupt if force is true (OpenAI detected user speech)
    // Otherwise, only interrupt if avatar is actually playing audio
    if (!force && !this.isPlayingAudio) {
      console.log("⏸️ Avatar not playing audio - skipping interrupt");
      return;
    }

    try {
      console.log(`🛑 Interrupting LiveAvatar speech${force ? " (forced by OpenAI)" : ""}`);
      this.liveAvatarInstance.interrupt();
      this.lastInterruptTime = now;
      this.isPlayingAudio = false;
      this.isAvatarSpeaking = false;
      this.isInterrupted = true; // Mark as interrupted to prevent sending more audio
    } catch (error) {
      console.error("Error interrupting avatar speech:", error);
      this.isPlayingAudio = false;
      this.isAvatarSpeaking = false;
      this.isInterrupted = true;
    }
  }

  /**
   * End the session and cleanup
   */
  async endSession(): Promise<void> {
    // Clean up timeouts
    if (this.userSpeakingTimeout) {
      clearTimeout(this.userSpeakingTimeout);
      this.userSpeakingTimeout = null;
    }
    
    if (this.userFinishedSpeakingTimeout) {
      clearTimeout(this.userFinishedSpeakingTimeout);
      this.userFinishedSpeakingTimeout = null;
    }
    
    if (this.liveAvatarInstance) {
      try {
        await this.liveAvatarInstance.stop();
        console.log("Session stopped successfully");
      } catch (error) {
        console.error("Error stopping session:", error);
      }
      this.liveAvatarInstance = null;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }

    this.sessionId = null;
    this.recentTranscripts.clear();
  }
}

/**
 * Create a new LiveAvatar client instance
 */
export const createLiveAvatarClient = (
  avatarId: string,
  voiceId?: string,
  contextId?: string,
  mode: "FULL" | "CUSTOM" = "FULL",
  options?: { enforceTurnTaking?: boolean }
): LiveAvatarClient => {
  const apiKey = getLiveAvatarApiKey();

  return new LiveAvatarClient({
    apiKey: apiKey,
    avatarId: avatarId,
    voiceId: voiceId,
    contextId: contextId,
    mode,
    enforceTurnTaking: options?.enforceTurnTaking,
  });
};

/**
 * Configuration file for LiveAvatar
 * This is a fallback if environment variables aren't loading properly
 */

// Fallback API key - in production, this should always come from environment variables
const FALLBACK_API_KEY = "ed58aa4b-3e18-405c-9ccc-db37f170c336";

export const getLiveAvatarApiKey = (): string => {
  // Try environment variable first
  const envKey = process.env.NEXT_PUBLIC_LIVEAVATAR_API_KEY;
  
  if (envKey) {
    return envKey;
  }
  
  // Fallback to hardcoded key (for development/testing)
  // TODO: Remove this fallback in production
  console.warn(
    "NEXT_PUBLIC_LIVEAVATAR_API_KEY not found in environment. Using fallback key."
  );
  return FALLBACK_API_KEY;
};


/**
 * Configuration file for LiveAvatar
 * Production-ready: requires environment variables, no fallbacks
 */

export const getLiveAvatarApiKey = (): string => {
  const envKey = process.env.NEXT_PUBLIC_LIVEAVATAR_API_KEY;
  
  if (!envKey) {
    throw new Error(
      "NEXT_PUBLIC_LIVEAVATAR_API_KEY is required but not found in environment variables. " +
      "Please set this in your production environment configuration."
    );
  }
  
  return envKey;
};


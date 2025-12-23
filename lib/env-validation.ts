/**
 * Environment variable validation for production
 * Validates required environment variables on module load
 */

const requiredEnvVars = {
  NEXT_PUBLIC_LIVEAVATAR_API_KEY: process.env.NEXT_PUBLIC_LIVEAVATAR_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

/**
 * Validate that all required environment variables are set
 * Throws an error if any are missing (prevents app from starting)
 */
export function validateEnvVars(): void {
  const missing: string[] = [];

  for (const [key, value] of Object.entries(requiredEnvVars)) {
    if (!value || value.trim() === '') {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Please set these in your production environment configuration.`
    );
  }
}

// Validate on module load (only in production)
if (process.env.NODE_ENV === 'production') {
  validateEnvVars();
}







import { parseCorsOrigins } from './http';

const REQUIRED_KEYS = ['JWT_SECRET', 'APP_PASSCODE', 'XMD', 'CORS_ORIGIN', 'MONGODB_URI'] as const;

// Checks required env vars and rejects the app boot if any are missing or invalid.
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  for (const key of REQUIRED_KEYS) {
    const value = config[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${key} is required`);
    }
  }

  const mongoUri = String(config.MONGODB_URI).trim();
  if (!mongoUri.startsWith('mongodb://') && !mongoUri.startsWith('mongodb+srv://')) {
    throw new Error('MONGODB_URI must be a mongodb:// or mongodb+srv:// URL');
  }

  const origins = parseCorsOrigins(String(config.CORS_ORIGIN));
  if (origins.length === 0) {
    throw new Error('CORS_ORIGIN is required');
  }

  for (const origin of origins) {
    try {
      new URL(origin);
    } catch {
      throw new Error(`CORS_ORIGIN contains an invalid origin: ${origin}`);
    }
  }

  return config;
}

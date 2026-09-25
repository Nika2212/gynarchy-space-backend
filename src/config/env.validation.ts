import { parseCorsOrigins } from './http';

const REQUIRED_KEYS = ['JWT_SECRET', 'APP_PASSCODE', 'XMD', 'CORS_ORIGIN'] as const;

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  for (const key of REQUIRED_KEYS) {
    const value = config[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${key} is required`);
    }
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

export const APP_ENV = {
  DEVELOPMENT: 'development',
  PRODUCTION: 'production',
} as const;

export type AppEnv = (typeof APP_ENV)[keyof typeof APP_ENV];

const ENV_FILES: Record<AppEnv, string> = {
  [APP_ENV.DEVELOPMENT]: '.env.dev',
  [APP_ENV.PRODUCTION]: '.env.prod',
};

export function resolveAppEnv(): AppEnv {
  return process.env.NODE_ENV === APP_ENV.PRODUCTION
    ? APP_ENV.PRODUCTION
    : APP_ENV.DEVELOPMENT;
}

export function resolveEnvFilePath(): string {
  return ENV_FILES[resolveAppEnv()];
}

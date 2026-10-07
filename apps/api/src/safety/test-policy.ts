export type AppEnvironment = 'development' | 'beta' | 'production';

// APP_ENV describes product rules; NODE_ENV only controls the runtime build.
// An unset APP_ENV preserves existing TEST_MODE deployments and defaults to beta.
export function appEnvironment(): AppEnvironment {
  const environment = process.env.APP_ENV;
  if (environment !== undefined) {
    if (environment !== 'development' && environment !== 'beta' && environment !== 'production') {
      throw new Error('APP_ENV must be development, beta or production');
    }
    return environment;
  }
  const value = process.env.TEST_MODE;
  if (value !== undefined && value !== 'true' && value !== 'false') {
    throw new Error('TEST_MODE must be true or false');
  }
  if (value === 'false') return 'production';
  return 'beta';
}

export function testMode(): boolean {
  return appEnvironment() === 'beta';
}

export function requireTester(_email: unknown): void {
  // Keep existing auth/session call sites and environment validation; beta access is public.
  appEnvironment();
}

export const TEST_LIMITS = Object.freeze({
  participants: 5,
  dailyMinutes: 60,
  voiceIntervalMs: 60_000,
  dailyOperations: 20_000,
  leaseMs: 90_000,
  heartbeatMs: 30_000,
  lobbyMs: 60_000,
});

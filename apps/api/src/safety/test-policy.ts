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

/**
 * Closed beta overrides. The limits are intentionally capped so a mistaken
 * deployment variable cannot silently create unlimited Agora consumption.
 * dailyMinutes counts participant-minutes across ALL beta rooms, not wall-clock
 * minutes. A 3-hour session with 6 connected voices may consume ~1080.
 */
export function betaLimits() {
  const configured = (key: string, fallback: number, ceiling: number) => {
    const raw = process.env[key];
    if (raw === undefined || raw === '') return fallback;
    if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${key} must be a positive integer`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < fallback || value > ceiling) {
      throw new Error(`${key} must be between ${fallback} and ${ceiling}`);
    }
    return value;
  };
  return {
    ...TEST_LIMITS,
    participants: configured('BETA_MAX_PARTICIPANTS', TEST_LIMITS.participants, 12),
    dailyMinutes: configured('BETA_DAILY_VOICE_MINUTES', TEST_LIMITS.dailyMinutes, 1440),
  };
}

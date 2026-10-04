import { ForbiddenException } from '@nestjs/common';

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

export function requireTester(email: unknown): void {
  if (!testMode()) return;
  const allowed = (process.env.TEST_ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (typeof email !== 'string' || !allowed.includes(email.trim().toLowerCase())) {
    throw new ForbiddenException('Beta fechada: esta conta não está autorizada para testes.');
  }
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

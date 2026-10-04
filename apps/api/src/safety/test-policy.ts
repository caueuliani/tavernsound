import { ForbiddenException } from '@nestjs/common';

// Closed by default, including when deployment configuration is incomplete.
export function testMode(): boolean {
  const value = process.env.TEST_MODE;
  if (value !== undefined && value !== 'true' && value !== 'false') {
    throw new Error('TEST_MODE must be true or false');
  }
  return value !== 'false';
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

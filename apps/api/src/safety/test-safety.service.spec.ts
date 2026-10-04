import { TestSafetyService } from './test-safety.service';
import { requireTester, TEST_LIMITS, testMode } from './test-policy';
import { budgetDatabase } from './test-database.double';

describe('Closed beta limits (transaction double)', () => {
  let db: ReturnType<typeof budgetDatabase>;
  let safety: TestSafetyService;
  let now: number;
  const previousMode = process.env.TEST_MODE;
  const previousEmails = process.env.TEST_ALLOWED_EMAILS;
  beforeEach(() => {
    process.env.TEST_MODE = 'true';
    process.env.TEST_ALLOWED_EMAILS = 'owner@example.test';
    now = Date.parse('2026-09-25T12:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    db = budgetDatabase(); safety = new TestSafetyService(db as any);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (previousMode === undefined) delete process.env.TEST_MODE; else process.env.TEST_MODE = previousMode;
    if (previousEmails === undefined) delete process.env.TEST_ALLOWED_EMAILS; else process.env.TEST_ALLOWED_EMAILS = previousEmails;
  });

  it('defaults closed, rejects an empty allowlist, normalizes authorized email', () => {
    delete process.env.TEST_MODE;
    expect(testMode()).toBe(true);
    expect(() => requireTester(' OWNER@example.test ')).not.toThrow();
    process.env.TEST_ALLOWED_EMAILS = '';
    expect(() => requireTester('owner@example.test')).toThrow('Beta fechada');
    process.env.TEST_MODE = 'tru';
    expect(() => testMode()).toThrow('TEST_MODE');
  });
  it('allows only one room even with concurrent creation attempts', async () => {
    const results = await Promise.allSettled(['ABC123', 'DEF456'].map(id => safety.createRoom({ id, name: 'Test', ownerId: 'owner' })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('admits at most five participants across separate service instances', async () => {
    const other = new TestSafetyService(db as any);
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => (i % 2 ? other : safety).admit('ABC123', `u${i}`, `s${i}`, `c${i}`)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(5);
    expect(db.state.participants).toHaveLength(5);
    expect(db.state.reservedMinutes).toBe(60);
  });
  it('rejects another room and duplicate account connections', async () => {
    await safety.admit('ABC123', 'owner', 's', 'c');
    await expect(safety.admit('DEF456', 'other', 's2', 'c2')).rejects.toThrow('Já existe');
    await expect(safety.admit('ABC123', 'owner', 's2', 'c2')).rejects.toThrow('já está conectada');
  });
  it('reconnection and process replacement preserve the original deadline', async () => {
    const deadline = await safety.admit('ABC123', 'owner', 's', 'c');
    await safety.release('c'); now += 5 * 60_000;
    const restarted = new TestSafetyService(db as any);
    expect(await restarted.admit('ABC123', 'owner', 's', 'new')).toBe(deadline);
    now = deadline!;
    await expect(restarted.admit('ABC123', 'owner', 's', 'again')).rejects.toThrow('Tempo diário');
    now += 24 * 60 * 60_000;
    await expect(restarted.admit('ABC123', 'owner', 's', 'tomorrow')).resolves.toBeGreaterThan(now);
  });
  it('does not let a session cross the UTC daily reset', async () => {
    now = Date.parse('2026-09-25T23:50:00Z');
    expect(await safety.admit('ABC123', 'owner', 's', 'c')).toBe(Date.parse('2026-09-26T00:00:00Z'));
  });
  it('requires a live matching session for voice and caps its token at the lease deadline', async () => {
    await expect(safety.voiceDeadline('ABC123', 'owner', 's')).rejects.toThrow('Entre na sala');
    await safety.admit('ABC123', 'owner', 's', 'c');
    expect(await safety.voiceDeadline('ABC123', 'owner', 's')).toBe((now + TEST_LIMITS.leaseMs) / 1000);
    await expect(safety.voiceDeadline('ABC123', 'owner', 'forged')).rejects.toThrow('Entre na sala');
    await safety.release('c');
    await expect(safety.voiceDeadline('ABC123', 'owner', 's')).rejects.toThrow('Entre na sala');
  });
  it('expires abandoned leases and never extends the test window on heartbeat', async () => {
    const end = await safety.admit('ABC123', 'owner', 's', 'c');
    now += 30_000; await safety.heartbeat('c');
    expect(db.state.endsAt.getTime()).toBe(end);
    now += TEST_LIMITS.leaseMs;
    await expect(safety.heartbeat('c')).rejects.toThrow('expirada');
    await expect(safety.admit('ABC123', 'owner', 's', 'new')).resolves.toBe(end);
  });
  it('does not issue near-expiry tokens that could cause an SDK renewal loop', async () => {
    await safety.admit('ABC123', 'owner', 's', 'c');
    now += 60_000;
    await expect(safety.voiceDeadline('ABC123', 'owner', 's')).rejects.toThrow('terminando');
  });
  it('enforces the last daily operation atomically and survives service replacement', async () => {
    await safety.consumeOperation(); db.state.operations = TEST_LIMITS.dailyOperations - 1;
    const results = await Promise.allSettled([safety.consumeOperation(), safety.consumeOperation()]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await expect(new TestSafetyService(db as any).consumeOperation()).rejects.toThrow('Cota diária');
    now += 86_400_000;
    await safety.consumeOperation(); expect(db.state.operations).toBe(1);
  });
  it('stops heartbeats when the daily operation quota is exhausted', async () => {
    await safety.admit('ABC123', 'owner', 's', 'c');
    db.state.operations = TEST_LIMITS.dailyOperations;
    await expect(safety.heartbeat('c')).rejects.toThrow('Cota diária');
  });
  it('fails closed if the database or migration is unavailable', async () => {
    const failed = new TestSafetyService({ $transaction: async () => { throw new Error('database offline'); } } as any);
    await expect(failed.admit('ABC123', 'owner', 's', 'c')).rejects.toThrow('Acesso pausado');
    await expect(failed.consumeOperation()).rejects.toThrow('Acesso pausado');
  });
  it('blocks uploads and excessive actions, then resets the short rate window', () => {
    expect(() => safety.requireUploads()).toThrow('Uploads');
    safety.rate('user', 1); expect(() => safety.rate('user', 1)).toThrow('Muitas ações');
    now += 60_000; expect(() => safety.rate('user', 1)).not.toThrow();
  });
});

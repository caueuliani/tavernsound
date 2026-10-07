import { TestSafetyService } from './test-safety.service';
import { appEnvironment, requireTester, TEST_LIMITS, testMode } from './test-policy';
import { budgetDatabase } from './test-database.double';

describe('Beta limits (transaction double)', () => {
  let db: ReturnType<typeof budgetDatabase>;
  let safety: TestSafetyService;
  let now: number;
  const previousMode = process.env.TEST_MODE;
  const previousEnvironment = process.env.APP_ENV;
  const previousNodeEnvironment = process.env.NODE_ENV;
  const previousEmails = process.env.TEST_ALLOWED_EMAILS;
  beforeEach(() => {
    process.env.TEST_MODE = 'true';
    process.env.APP_ENV = 'beta';
    process.env.TEST_ALLOWED_EMAILS = 'owner@example.test';
    now = Date.parse('2026-09-25T12:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    db = budgetDatabase(); safety = new TestSafetyService(db as any);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (previousMode === undefined) delete process.env.TEST_MODE; else process.env.TEST_MODE = previousMode;
    if (previousEnvironment === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = previousEnvironment;
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnvironment;
    if (previousEmails === undefined) delete process.env.TEST_ALLOWED_EMAILS; else process.env.TEST_ALLOWED_EMAILS = previousEmails;
  });

  it('defaults to beta, permits any email with or without the legacy allowlist, and validates the environment', () => {
    delete process.env.APP_ENV;
    delete process.env.TEST_MODE;
    expect(testMode()).toBe(true);
    expect(() => requireTester('outsider@example.test')).not.toThrow();
    process.env.TEST_ALLOWED_EMAILS = '';
    expect(() => requireTester('outsider@example.test')).not.toThrow();
    delete process.env.TEST_ALLOWED_EMAILS;
    expect(() => requireTester('outsider@example.test')).not.toThrow();
    process.env.TEST_MODE = 'tru';
    expect(() => testMode()).toThrow('TEST_MODE');
    process.env.TEST_MODE = 'false';
    expect(appEnvironment()).toBe('production');
  });
  it('selects local, beta and production rules independently of NODE_ENV', async () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ENV = 'development';
    expect(appEnvironment()).toBe('development');
    expect(testMode()).toBe(false);
    expect(() => requireTester('any@example.test')).not.toThrow();
    await safety.admit('ABC123', 'owner', 's', 'c');
    expect(db.state.participants).toHaveLength(0);

    process.env.APP_ENV = 'beta';
    expect(testMode()).toBe(true);
    expect(() => requireTester('any@example.test')).not.toThrow();

    process.env.APP_ENV = 'production';
    expect(testMode()).toBe(false);
    expect(() => requireTester('any@example.test')).not.toThrow();

    process.env.APP_ENV = 'invalid';
    expect(() => appEnvironment()).toThrow('APP_ENV');
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
    expect(db.state.reservedMinutes).toBe(0);
  });
  it('rejects another room and duplicate account connections', async () => {
    await safety.admit('ABC123', 'owner', 's', 'c');
    await expect(safety.admit('DEF456', 'other', 's2', 'c2')).rejects.toThrow('Já existe');
    await expect(safety.admit('ABC123', 'owner', 's2', 'c2')).rejects.toThrow('já está conectada');
  });
  it('reclaims stale leases immediately after restart but keeps live duplicate and participant limits', async () => {
    await safety.admit('ABC123', 'owner', 's', 'old');
    const restarted = new TestSafetyService(db as any);
    await expect(restarted.admit('ABC123', 'owner', 's', 'new', new Set(['new']))).resolves.toBeUndefined();
    expect(db.state.participants).toHaveLength(1);
    expect(db.state.participants[0].connectionId).toBe('new');
    await expect(restarted.admit('ABC123', 'owner', 's', 'another', new Set(['new', 'another']))).rejects.toThrow('já está conectada');
    for (let i = 1; i < TEST_LIMITS.participants; i++) {
      await restarted.admit('ABC123', `u${i}`, `s${i}`, `c${i}`, new Set(['new', ...Array.from({ length: i }, (_, n) => `c${n + 1}`)]));
    }
    await expect(restarted.admit('ABC123', 'extra', 's', 'extra', new Set(['new', 'extra', ...Array.from({ length: 4 }, (_, n) => `c${n + 1}`)]))).rejects.toThrow('cinco participantes');
  });
  it('allows VTT reconnection after voice quota is exhausted', async () => {
    await safety.admit('ABC123', 'owner', 's', 'c');
    db.state.reservedMinutes = TEST_LIMITS.dailyMinutes;
    await safety.release('c'); now += 5 * 60_000;
    const restarted = new TestSafetyService(db as any);
    await expect(restarted.admit('ABC123', 'owner', 's', 'new')).resolves.toBeUndefined();
    await expect(restarted.voiceDeadline('ABC123', 'owner', 's')).rejects.toThrow('Cota diária de voz');
    now += 86_400_000;
    await expect(restarted.voiceDeadline('ABC123', 'owner', 's')).rejects.toThrow('Entre na sala');
  });
  it('caps voice grants at the UTC daily reset', async () => {
    now = Date.parse('2026-09-25T23:59:15Z');
    await safety.admit('ABC123', 'owner', 's', 'c');
    expect(await safety.voiceDeadline('ABC123', 'owner', 's')).toBe(Date.parse('2026-09-26T00:00:00Z') / 1000);
  });
  it('requires a live matching session for voice and caps its token at the lease deadline', async () => {
    await expect(safety.voiceDeadline('ABC123', 'owner', 's')).rejects.toThrow('Entre na sala');
    await safety.admit('ABC123', 'owner', 's', 'c');
    expect(await safety.voiceDeadline('ABC123', 'owner', 's')).toBe((now + TEST_LIMITS.voiceIntervalMs) / 1000);
    expect(db.state.reservedMinutes).toBe(1);
    await expect(safety.voiceDeadline('ABC123', 'owner', 'forged')).rejects.toThrow('Entre na sala');
    await safety.release('c');
    await expect(safety.voiceDeadline('ABC123', 'owner', 's')).rejects.toThrow('Entre na sala');
  });
  it('expires abandoned leases and keeps the VTT available', async () => {
    await safety.admit('ABC123', 'owner', 's', 'c');
    now += 30_000; await safety.heartbeat('c');
    now += TEST_LIMITS.leaseMs;
    await expect(safety.heartbeat('c')).rejects.toThrow('expirada');
    await expect(safety.admit('ABC123', 'owner', 's', 'new')).resolves.toBeUndefined();
  });
  it('charges only short voice grants and preserves the quota across instances', async () => {
    await safety.admit('ABC123', 'owner', 's', 'c');
    const first = await safety.voiceDeadline('ABC123', 'owner', 's');
    expect(await safety.voiceDeadline('ABC123', 'owner', 's')).toBe(first);
    expect(db.state.reservedMinutes).toBe(1);
    now += 30_000; await safety.heartbeat('c');
    const second = await new TestSafetyService(db as any).voiceDeadline('ABC123', 'owner', 's');
    expect(second).toBe(first + 60);
    expect(db.state.reservedMinutes).toBe(2);
  });
  it('grants only the last available voice minute under concurrent requests', async () => {
    await safety.admit('ABC123', 'owner', 's', 'c');
    await safety.admit('ABC123', 'other', 's2', 'c2');
    db.state.reservedMinutes = TEST_LIMITS.dailyMinutes - 1;
    const other = new TestSafetyService(db as any);
    const results = await Promise.allSettled([
      safety.voiceDeadline('ABC123', 'owner', 's'),
      other.voiceDeadline('ABC123', 'other', 's2'),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(db.state.reservedMinutes).toBe(TEST_LIMITS.dailyMinutes);
    await expect(safety.heartbeat('c')).resolves.toBeUndefined();
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

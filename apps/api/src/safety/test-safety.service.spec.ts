import { TestSafetyService } from './test-safety.service';
import { appEnvironment, requireTester, TEST_LIMITS, testMode } from './test-policy';
import { budgetDatabase } from './test-database.double';
import { createHash } from 'crypto';

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
  it('does not let owner A create a second room even with concurrent attempts', async () => {
    const results = await Promise.allSettled(['ABC123', 'DEF456'].map(id => safety.createRoom({ id, name: 'Test', ownerId: 'owner' })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await expect(safety.createRoom({ id: 'GHI789', name: 'Second', ownerId: 'owner' }))
      .rejects.toThrow('A beta permite uma única sala. Utilize a sala existente.');
  });
  it('lets owner B create a room when owner A already has one', async () => {
    await safety.createRoom({ id: 'ABC123', name: 'A', ownerId: 'owner-a' });
    await expect(safety.createRoom({ id: 'DEF456', name: 'B', ownerId: 'owner-b' })).resolves.toMatchObject({ ownerId: 'owner-b' });
    expect(db.rooms).toHaveLength(2);
  });
  it('lets owner B create a room even when they are a member of owner A’s room', async () => {
    await safety.createRoom({ id: 'ABC123', name: 'A', ownerId: 'owner-a' });
    db.addMember('ABC123', 'owner-b');
    expect(db.rooms[0].members).toContain('owner-b');
    await expect(safety.createRoom({ id: 'DEF456', name: 'B', ownerId: 'owner-b' })).resolves.toMatchObject({ ownerId: 'owner-b' });
  });
  it('lets two masters own one room each concurrently', async () => {
    const results = await Promise.allSettled([
      safety.createRoom({ id: 'ABC123', name: 'A', ownerId: 'owner-a' }),
      new TestSafetyService(db as any).createRoom({ id: 'DEF456', name: 'B', ownerId: 'owner-b' }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
    expect(db.rooms.map(room => room.ownerId).sort()).toEqual(['owner-a', 'owner-b']);
  });
  it('admits at most five participants across separate service instances', async () => {
    const other = new TestSafetyService(db as any);
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => (i % 2 ? other : safety).admit('ABC123', `u${i}`, `s${i}`, `c${i}`)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(5);
    expect(db.state.participants).toHaveLength(5);
    expect(db.state.reservedMinutes).toBe(0);
  });
  it('admits participants to rooms A and B simultaneously', async () => {
    await safety.admit('ABC123', 'owner-a', 'sa', 'ca');
    await safety.admit('DEF456', 'owner-b', 'sb', 'cb');
    expect(db.state.participants.map((lease: { roomId: string }) => lease.roomId).sort()).toEqual(['ABC123', 'DEF456']);
  });
  it('caps room A at five without consuming room B capacity', async () => {
    for (let i = 0; i < TEST_LIMITS.participants; i++) await safety.admit('ABC123', `a${i}`, `sa${i}`, `ca${i}`);
    await expect(safety.admit('ABC123', 'extra', 'sx', 'cx')).rejects.toThrow('cinco participantes');
    await expect(safety.admit('DEF456', 'b0', 'sb0', 'cb0')).resolves.toBeUndefined();
  });
  it('gives room B its own five-participant limit', async () => {
    await safety.admit('ABC123', 'a0', 'sa0', 'ca0');
    for (let i = 0; i < TEST_LIMITS.participants; i++) await safety.admit('DEF456', `b${i}`, `sb${i}`, `cb${i}`);
    await expect(safety.admit('DEF456', 'extra', 'sx', 'cx')).rejects.toThrow('cinco participantes');
    await expect(safety.admit('ABC123', 'a1', 'sa1', 'ca1')).resolves.toBeUndefined();
  });
  it('rejects a duplicate account in the same room but permits that account in another room', async () => {
    await safety.admit('ABC123', 'owner', 's', 'ca');
    await expect(safety.admit('ABC123', 'owner', 's2', 'duplicate')).rejects.toThrow('já está conectada');
    await expect(safety.admit('DEF456', 'owner', 's', 'cb')).resolves.toBeUndefined();
  });
  it('keeps room B leases when room A reconnects after a restart', async () => {
    await safety.admit('ABC123', 'owner-a', 'sa', 'old');
    await safety.admit('DEF456', 'owner-b', 'sb', 'live');
    const restarted = new TestSafetyService(db as any);
    await restarted.admit('ABC123', 'owner-a', 'sa', 'new', new Set(['live', 'new']));
    expect(db.state.participants.map((lease: { connectionId: string }) => lease.connectionId).sort()).toEqual(['live', 'new']);
    await expect(restarted.heartbeat('live')).resolves.toBeUndefined();
  });
  it('uses only a matching room lease for voice and preserves the global voice budget', async () => {
    await safety.admit('ABC123', 'owner-a', 'sa', 'ca');
    await expect(safety.voiceDeadline('DEF456', 'owner-a', 'sa')).rejects.toThrow('Entre na sala');
    await safety.admit('DEF456', 'owner-b', 'sb', 'cb');
    await expect(safety.voiceDeadline('DEF456', 'owner-b', 'sb')).resolves.toBe((now + TEST_LIMITS.voiceIntervalMs) / 1000);
    await expect(safety.voiceDeadline('ABC123', 'owner-a', 'sa')).resolves.toBe((now + TEST_LIMITS.voiceIntervalMs) / 1000);
    expect(db.state.reservedMinutes).toBe(2);
  });
  it('isolates heartbeat and release by connection across rooms', async () => {
    await safety.admit('ABC123', 'owner-a', 'sa', 'ca');
    await safety.admit('DEF456', 'owner-b', 'sb', 'cb');
    now += 30_000;
    await safety.heartbeat('cb');
    await safety.release('ca');
    expect(db.state.participants.map((lease: { connectionId: string }) => lease.connectionId)).toEqual(['cb']);
    await expect(safety.voiceDeadline('ABC123', 'owner-a', 'sa')).rejects.toThrow('Entre na sala');
    await expect(safety.heartbeat('cb')).resolves.toBeUndefined();
    await expect(safety.voiceDeadline('DEF456', 'owner-b', 'sb')).resolves.toBeGreaterThan(0);
  });
  it('recognizes active leases saved before room IDs were stored per participant', async () => {
    db.state.roomId = 'ABC123';
    db.state.participants = [{ connectionId: 'old', userId: 'owner', sessionHash: createHash('sha256').update('s').digest('hex'), expiresAt: now + TEST_LIMITS.leaseMs }];
    await expect(safety.voiceDeadline('ABC123', 'owner', 's')).resolves.toBeGreaterThan(0);
    await expect(safety.voiceDeadline('DEF456', 'owner', 's')).rejects.toThrow('Entre na sala');
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

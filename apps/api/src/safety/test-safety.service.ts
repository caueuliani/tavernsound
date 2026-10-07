import { ForbiddenException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TEST_LIMITS, testMode } from './test-policy';

type Lease = { connectionId: string; userId: string; sessionHash: string; expiresAt: number; voiceUntil?: number };
type Budget = { id: string; day: string; operations: number; reservedMinutes: number; roomId: string | null; endsAt: Date | null; participants: Prisma.JsonValue };

@Injectable()
export class TestSafetyService {
  private rates = new Map<string, { count: number; until: number }>();
  get enabled() { return testMode(); }

  constructor(private readonly prisma: PrismaService) { testMode(); }

  rate(key: string, limit: number, windowMs = 60_000): void {
    if (!this.enabled) return;
    const now = Date.now();
    let bucket = this.rates.get(key);
    if (!bucket || bucket.until <= now) {
      if (this.rates.size >= 2_000) {
        for (const [id, entry] of this.rates) if (entry.until <= now) this.rates.delete(id);
        if (this.rates.size >= 2_000) throw new HttpException('Limite de testes atingido. Tente mais tarde.', 429);
      }
      bucket = { count: 0, until: now + windowMs };
      this.rates.set(key, bucket);
    }
    if (++bucket.count > limit) throw new HttpException('Muitas ações durante os testes. Aguarde um instante.', 429);
  }

  private hash(sid: string) { return createHash('sha256').update(sid).digest('hex'); }
  private leases(state: Budget, now: number): Lease[] {
    return (state.participants as unknown as Lease[]).filter(p => p.expiresAt > now);
  }

  // One PostgreSQL row serializes admissions and counters across restarts/instances.
  // One row keeps participant leases and voice grants atomic across instances.
  private async locked<T>(action: (state: Budget, tx: Prisma.TransactionClient, now: number) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`INSERT INTO "TestBudget" ("id", "day", "operations", "reservedMinutes", "participants") VALUES ('beta', '', 0, 0, '[]'::jsonb) ON CONFLICT ("id") DO NOTHING`;
        const [state] = await tx.$queryRaw<Budget[]>`SELECT * FROM "TestBudget" WHERE "id" = 'beta' FOR UPDATE`;
        const now = Date.now();
        const day = new Date(now).toISOString().slice(0, 10);
        if (state.day !== day) { state.day = day; state.operations = 0; state.reservedMinutes = 0; }
        const result = await action(state, tx, now);
        await tx.testBudget.update({ where: { id: 'beta' }, data: {
          day: state.day, operations: state.operations, reservedMinutes: state.reservedMinutes,
          roomId: state.roomId, endsAt: state.endsAt, participants: state.participants as Prisma.InputJsonValue,
        } });
        return result;
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // A missing migration or unavailable database must never disable the limit.
      throw new ServiceUnavailableException('Não foi possível verificar os limites de testes. Acesso pausado.');
    }
  }

  async consumeOperation() {
    if (!this.enabled) return;
    await this.locked(async state => {
      if (state.operations >= TEST_LIMITS.dailyOperations) throw new HttpException('Cota diária de testes atingida. Retorne após 00:00 UTC.', 429);
      state.operations++;
    });
  }

  async createRoom(data: { id: string; name: string; ownerId: string }) {
    if (!this.enabled) return this.prisma.room.create({ data });
    return this.locked(async (_state, tx) => {
      if (await tx.room.count({ where: { ownerId: data.ownerId } }) >= 1) throw new ForbiddenException('A beta permite uma única sala. Utilize a sala existente.');
      return tx.room.create({ data });
    });
  }

  async admit(roomId: string, userId: string, sid: string, connectionId: string, activeConnections?: ReadonlySet<string>): Promise<void> {
    if (!this.enabled) return;
    return this.locked(async (state, _tx, now) => {
      const leases = this.leases(state, now).filter(p => p.connectionId !== connectionId && (!activeConnections || activeConnections.has(p.connectionId)));
      if (leases.length && state.roomId !== roomId) throw new ForbiddenException('Já existe uma sala de teste ativa.');
      if (leases.some(p => p.userId === userId)) throw new ForbiddenException('Esta conta já está conectada. Feche a outra conexão ou aguarde 90 segundos.');
      if (leases.length >= TEST_LIMITS.participants) throw new ForbiddenException('A sala de testes permite até cinco participantes.');
      if (!leases.length) state.roomId = roomId;
      leases.push({ connectionId, userId, sessionHash: this.hash(sid), expiresAt: now + TEST_LIMITS.leaseMs });
      state.participants = leases;
    });
  }

  async heartbeat(connectionId: string): Promise<void> {
    if (!this.enabled) return;
    await this.locked(async (state, _tx, now) => {
      if (state.operations >= TEST_LIMITS.dailyOperations) throw new ForbiddenException('Cota diária de testes atingida.');
      const leases = this.leases(state, now);
      const lease = leases.find(p => p.connectionId === connectionId);
      if (!lease) throw new ForbiddenException('Conexão de teste expirada.');
      lease.expiresAt = now + TEST_LIMITS.leaseMs;
      state.participants = leases;
    });
  }

  async release(connectionId: string) {
    if (!this.enabled) return;
    await this.locked(async state => {
      state.participants = (state.participants as unknown as Lease[]).filter(p => p.connectionId !== connectionId);
    });
  }

  async voiceDeadline(roomId: string, userId: string, sid: string): Promise<number> {
    if (!this.enabled) return Number.MAX_SAFE_INTEGER;
    return this.locked(async (state, _tx, now) => {
      const lease = this.leases(state, now).find(p => p.userId === userId && p.sessionHash === this.hash(sid));
      if (state.roomId !== roomId || !lease) {
        throw new ForbiddenException('Entre na sala durante uma sessão de testes ativa para usar voz.');
      }
      const midnight = Date.parse(new Date(now).toISOString().slice(0, 10)) + 86_400_000;
      if (!lease.voiceUntil || lease.voiceUntil - now <= 30_000) {
        if (state.reservedMinutes >= TEST_LIMITS.dailyMinutes) {
          throw new ForbiddenException('Cota diária de voz esgotada. A mesa continua disponível; retorne após 00:00 UTC para usar áudio.');
        }
        state.reservedMinutes++;
        lease.voiceUntil = Math.min(Math.max(now, lease.voiceUntil || now) + TEST_LIMITS.voiceIntervalMs, midnight);
        state.participants = this.leases(state, now);
      }
      const deadline = Math.min(lease.voiceUntil, lease.expiresAt, midnight);
      if (deadline - now <= 30_000) throw new ForbiddenException('A janela de voz desta sessão está terminando.');
      return Math.floor(deadline / 1000);
    });
  }

  requireUploads() {
    if (this.enabled) throw new ForbiddenException('Uploads estão desativados durante a beta de testes.');
  }
}

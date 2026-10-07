import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import { PrismaService } from '../prisma/prisma.service';
import { sessionCookie, signSession, verifySession } from '../common/session.util';
import { requireTester } from '../safety/test-policy';

export const SESSION_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class SessionService extends EventEmitter {
  constructor(private readonly prisma: PrismaService) { super(); }

  voiceUid(session: { id: string; sid: string }) {
    return createHash('sha256').update(`voice:${session.id}:${session.sid}`).digest('hex').slice(0, 32);
  }

  private hash(sid: string) { return createHash('sha256').update(sid).digest('hex'); }

  async create(userId: string): Promise<string> {
    const iat = Math.floor(Date.now() / 1000);
    const claims = { id: userId, sid: randomBytes(32).toString('hex'), iat, exp: iat + SESSION_SECONDS };
    const token = signSession(claims);
    await this.prisma.session.create({ data: {
      userId, sessionToken: this.hash(claims.sid), expires: new Date(claims.exp * 1000),
    } });
    return token;
  }

  async resolve(cookieHeader?: string) {
    const token = sessionCookie(cookieHeader);
    const claims = token ? verifySession(token) : null;
    if (!claims) return null;
    const session = await this.prisma.session.findUnique({
      where: { sessionToken: this.hash(claims.sid) },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!session || session.userId !== claims.id || session.expires.getTime() <= Date.now()) return null;
    requireTester(session.user.email);
    return { ...session.user, sid: claims.sid, exp: claims.exp };
  }

  async require(cookieHeader?: string) {
    const session = await this.resolve(cookieHeader);
    if (!session) throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    return session;
  }

  async revoke(cookieHeader?: string) {
    const token = sessionCookie(cookieHeader);
    const claims = token ? verifySession(token) : null;
    if (claims) {
      await this.prisma.session.deleteMany({ where: { sessionToken: this.hash(claims.sid) } });
      this.emit('revoked', claims.sid);
    }
  }
}

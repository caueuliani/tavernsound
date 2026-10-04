import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { TestSafetyService } from './test-safety.service';
import { sessionCookie, verifySession } from '../common/session.util';

@Injectable()
export class TestSafetyGuard implements CanActivate {
  constructor(private readonly safety: TestSafetyService) {}
  async canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http' || !this.safety.enabled) return true;
    const req = context.switchToHttp().getRequest<Request>();
    // Don't trust caller-supplied X-Forwarded-For. A shared proxy shares this cap.
    this.safety.rate(`http:${req.ip || req.socket.remoteAddress}`, 120);
    if (req.path === '/' || req.path === '/auth/logout') return true;
    if (req.path.startsWith('/subscriptions') && req.method !== 'GET') {
      throw new ForbiddenException('Pagamentos estão desativados durante os testes.');
    }
    if (req.path.startsWith('/auth/') && req.method === 'POST') this.safety.rate(`login:${req.ip}`, 10);
    const cookie = sessionCookie(req.headers.cookie);
    const session = cookie ? verifySession(cookie) : null;
    if (session) this.safety.rate(`http-user:${session.id}`, 60);
    await this.safety.consumeOperation();
    return true;
  }
}

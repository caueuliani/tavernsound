import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { SessionService } from './session.service';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    request.user = await this.sessions.require(request.headers.cookie);
    return true;
  }
}

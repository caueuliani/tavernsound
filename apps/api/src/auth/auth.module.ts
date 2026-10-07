// apps/api/src/auth/auth.module.ts

import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { SessionService } from './session.service';
import { SessionAuthGuard } from './session-auth.guard';

@Global()
@Module({
  controllers: [AuthController],
  providers: [SessionService, SessionAuthGuard],
  exports: [SessionService, SessionAuthGuard],
})
export class AuthModule {}
